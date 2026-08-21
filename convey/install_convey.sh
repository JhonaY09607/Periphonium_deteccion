#!/bin/bash

# Definir color cian
color="\e[36m"  # Cian

# Mostrar la barra de progreso con color cian
show_progress() {
    local progress=$1
    local total=$2
    local width=50
    local percent=$((progress * 100 / total))
    local filled=$((width * progress / total))
    local unfilled=$((width - filled))
    local progress_bar=$(printf "%${filled}s" | tr ' ' '#')$(printf "%${unfilled}s" | tr ' ' '-')

    # Imprimir la barra de progreso con el porcentaje coloreado en cian
    echo -ne "${color}[${progress_bar}] ${percent}%\e[0m\r"
}

# Inicialización
echo -e "${color}Iniciando el proceso...\e[0m"

# Alzar el volumen al 100%
echo -e "${color}1% - Alzando el volumen y crontab actualiado para ajustar volumen al reiniciar...\e[0m"
amixer -c 2 set PCM 4dB
# Añadir una línea al crontab para que al reiniciar suba el volumen
(crontab -l ; echo "@reboot amixer -c 2 set PCM 4dB") | crontab -
show_progress 1 10
sleep 1

# Guardar la ruta del directorio actual
CURRENT_DIR=$(pwd)
# Obtén el nombre del usuario actual
CURRENT_USER=$(whoami)

# Reemplaza las rutas en el archivo consumer.sh
echo -e "${color}10% - Reemplazando rutas en consumer.sh...\e[0m"
sed -i 's|source "$CURRENT_DIR/vcard/bin/activate"|source "$CURRENT_DIR/project_convey/vconvey/bin/activate"|g' consumer.sh
sed -i 's|python "$CURRENT_DIR/raspconsumer_entrada.py"|python "$CURRENT_DIR/project_convey/main.py"|g' consumer.sh
show_progress 2 10
sleep 1

# Reemplaza las rutas en el archivo .service
echo -e "${color}20% - Reemplazando rutas en convey_server.service...\e[0m"
sed -i "s|WorkingDirectory=.*|WorkingDirectory=${CURRENT_DIR}|g" convey_server.service
sed -i "s|ExecStart=.*|ExecStart=${CURRENT_DIR}/consumer.sh|g" convey_server.service
# Reemplaza el User
sed -i "s|User=.*|User=${CURRENT_USER}|g" convey_server.service
show_progress 3 10
sleep 1

# Actualizar la lista de paquetes
echo -e "${color}30% - Actualizando la lista de paquetes...\e[0m"
sudo apt update
show_progress 4 10
sleep 1

# Instalar evemu-tools y python3-evdev
echo -e "${color}40% - Instalando paquetes necesarios...\e[0m"
sudo apt install -y evemu-tools python3-evdev mpg123
show_progress 5 10
sleep 1


# Copiar archivo de sonido /etc/asound.conf
echo -e "${color}50% - Copiando archivo de configuración de sonido...\e[0m"
if [ -f "$CURRENT_DIR/asound.conf" ]; then
    sudo cp "$CURRENT_DIR/asound.conf" /etc/asound.conf
else
    echo "El archivo asound.conf no se encuentra en el directorio actual."
    exit 1
fi
show_progress 6 10
sleep 1

# Copiar archivo de servicio systemd
echo -e "${color}60% - Copiando archivo de servicio systemd...\e[0m"
if [ -f "$CURRENT_DIR/convey_server.service" ]; then
    sudo cp "$CURRENT_DIR/convey_server.service" /etc/systemd/system/convey_server.service
else
    echo "El archivo convey_server.service no se encuentra en el directorio actual."
    exit 1
fi
show_progress 7 10
sleep 1

# Dar permisos de ejecución al script consumer.sh
echo -e "${color}70% - Dando permisos de ejecución al script consumer.sh...\e[0m"
if [ -f "$CURRENT_DIR/consumer.sh" ]; then
    chmod +x "$CURRENT_DIR/consumer.sh"
else
    echo "El archivo consumer.sh no se encuentra en el directorio actual."
    exit 1
fi
show_progress 8 10
sleep 1

# Crear y activar el entorno virtual
echo -e "${color}80% - Creando y activando el entorno virtual...\e[0m"
cd "$CURRENT_DIR/project_convey"
python3 -m venv vconvey
source "$CURRENT_DIR/project_convey/vconvey/bin/activate"
show_progress 9 10
sleep 1

# Instalar las dependencias
echo -e "${color}90% - Instalando las dependencias...\e[0m"
pip install --upgrade pip
pip install -r "requirements.txt"
deactivate
show_progress 10 10
sleep 1

# Recargar los servicios de systemd y habilitar el servicio
echo -e "${color}98% - Recargando servicios y habilitando el servicio...\e[0m"
sudo systemctl daemon-reload
sudo systemctl enable convey_server.service
show_progress 10 10

# Iniciar el servicio
echo -e "${color}100% - Iniciando el servicio...\e[0m"
sudo systemctl start convey_server.service

echo -e "${color}\nINSTALACIÓN Y CONFIGURACIÓN COMPLETADAS.\e[0m"

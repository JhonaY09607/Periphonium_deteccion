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
    echo -ne "${color}[${progress_bar}] ${percent}%\e[0m\r"
}

# Inicialización
echo -e "${color}Iniciando el proceso de instalación...\e[0m"

# Guardar la ruta del directorio actual y usuario
CURRENT_DIR=$(pwd)
CURRENT_USER=$(whoami)

# Paso 1: Reemplazar rutas en archivo .service
echo -e "${color}20% - Configurando archivo index_server.service...\e[0m"
sed -i "s|WorkingDirectory=.*|WorkingDirectory=${CURRENT_DIR}/proyecto_index|g" index_server.service
sed -i "s|ExecStart=.*|ExecStart=/usr/bin/node ${CURRENT_DIR}/proyecto_index/index.js|g" index_server.service
sed -i "s|User=.*|User=${CURRENT_USER}|g" index_server.service
show_progress 2 10
sleep 1

# Paso 2: Actualizar paquetes
echo -e "${color}30% - Actualizando lista de paquetes del sistema...\e[0m"
sudo apt update -y
show_progress 3 10
sleep 1

# Paso 3: Instalar Node.js y npm
echo -e "${color}40% - Instalando Node.js y npm...\e[0m"
sudo apt install -y nodejs npm
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)

if [ "$NODE_VERSION" -lt 14 ]; then
    echo -e "\e[31mERROR: Node.js debe ser versión >=14. Instálalo manualmente o usa NodeSource.\e[0m"
    exit 1
fi

show_progress 4 10
sleep 1

# Paso 4: Instalar Chromium
echo -e "${color}50% - Instalando Chromium...\e[0m"
sudo apt install -y chromium-browser
sudo apt install -y chromium
show_progress 5 10
sleep 1

# Paso 5: Instalar dependencias de npm
echo -e "${color}65% - Instalando dependencias de npm...\e[0m"
cd "${CURRENT_DIR}/proyecto_index"

npm install puppeteer
npm install axios
npm install whatsapp-web.js
npm install nodemailer
npm install play-sound
npm install qrcode-terminal

cd "$CURRENT_DIR"
show_progress 7 10
sleep 1

# Paso 6: Copiar archivo .service
echo -e "${color}80% - Copiando archivo index_server.service...\e[0m"
if [ -f "$CURRENT_DIR/index_server.service" ]; then
    sudo cp "$CURRENT_DIR/index_server.service" /etc/systemd/system/index_server.service
else
    echo -e "\e[31mERROR: El archivo index_server.service no se encuentra en el directorio actual.\e[0m"
    exit 1
fi
show_progress 8 10
sleep 1

# Paso 7: Recargar systemd y habilitar servicio
echo -e "${color}95% - Habilitando servicio index_server...\e[0m"
sudo systemctl daemon-reload
sudo systemctl enable index_server.service
show_progress 10 10

echo -e "${color}\nINSTALACIÓN COMPLETADA CON ÉXITO.\e[0m"
echo -e "${color}Puedes iniciar el servicio con:\e[0m sudo systemctl start index_server.service"

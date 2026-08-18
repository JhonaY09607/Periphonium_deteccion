#!/bin/bash
set -e

color="\e[36m"
echo -e "${color}Instalando CGBInstrusion (deteccion + audio + WhatsApp)...\e[0m"

CURRENT_DIR=$(pwd)
CURRENT_USER=$(whoami)

# 1. Paquetes del sistema para audio (Python/mpg123)
echo -e "${color}Instalando dependencias del sistema (mpg123, ffmpeg)...\e[0m"
sudo apt update
sudo apt install -y mpg123 ffmpeg python3-venv

# 2. Paquetes del sistema para el sidecar de WhatsApp (Node/Chromium)
echo -e "${color}Instalando Node.js, npm y Chromium...\e[0m"
sudo apt install -y nodejs npm chromium-browser || sudo apt install -y nodejs npm chromium

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 14 ]; then
    echo -e "\e[31mERROR: Node.js debe ser version >=14. Instalalo manualmente o usa NodeSource.\e[0m"
    exit 1
fi

# 3. Configuracion de audio (tarjeta 2 = salida jack 3.5mm en Raspberry Pi 4)
echo -e "${color}Copiando configuracion de sonido a /etc/asound.conf...\e[0m"
sudo cp "$CURRENT_DIR/asound.conf" /etc/asound.conf
amixer -c 2 set PCM 4dB || true
(crontab -l 2>/dev/null; echo "@reboot amixer -c 2 set PCM 4dB") | crontab -

# 4. Entorno virtual Python
echo -e "${color}Creando entorno virtual Python e instalando dependencias...\e[0m"
python3 -m venv "$CURRENT_DIR/venv"
source "$CURRENT_DIR/venv/bin/activate"
pip install --upgrade pip
pip install -r "$CURRENT_DIR/requirements.txt"
deactivate

# 5. Dependencias del sidecar de WhatsApp
echo -e "${color}Instalando dependencias npm del sidecar de WhatsApp...\e[0m"
cd "$CURRENT_DIR/whatsapp"
npm install
cd "$CURRENT_DIR"

# 6. Servicio systemd unico
echo -e "${color}Configurando servicio systemd cgbinstrusion.service...\e[0m"
sed -i "s|WorkingDirectory=.*|WorkingDirectory=${CURRENT_DIR}|g" cgbinstrusion.service
sed -i "s|ExecStart=.*|ExecStart=${CURRENT_DIR}/venv/bin/python3 ${CURRENT_DIR}/main.py|g" cgbinstrusion.service
sed -i "s|User=.*|User=${CURRENT_USER}|g" cgbinstrusion.service
sudo cp cgbinstrusion.service /etc/systemd/system/cgbinstrusion.service
sudo systemctl daemon-reload
sudo systemctl enable cgbinstrusion.service

echo -e "${color}\nINSTALACION COMPLETADA.\e[0m"
echo -e "${color}Antes de iniciar el servicio revisa CGBInstrusion/config.py y whatsapp/config.js.\e[0m"
echo -e "${color}Inicia el servicio manualmente la primera vez para escanear el QR de WhatsApp:\e[0m"
echo -e "  ${CURRENT_DIR}/venv/bin/python3 ${CURRENT_DIR}/main.py"
echo -e "${color}Una vez vinculado, arrancalo como servicio con:\e[0m sudo systemctl start cgbinstrusion.service"

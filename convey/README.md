# convey — Servicio de reproducción de audio en Raspberry Pi

Servicio Python/Flask que se ejecuta en cada Raspberry Pi con parlantes. Recibe archivos de audio vía HTTP (enviados por `srvconvey`), los convierte a MP3 y los reproduce en orden a través de los parlantes del sistema. También puede activar un relé físico (GPIO) cuando recibe una palabra clave SOS.

---

## Requisitos previos

- Raspberry Pi con parlantes conectados
- Python 3
- `mpg123` (reproductor de audio por terminal)
- `ffmpeg` (requerido por pydub para convertir formatos de audio)

---

## Instalación

### 1. Otorgar permisos de ejecución al instalador

```bash
chmod +x install_convey.sh
```

### 2. Ejecutar el instalador

```bash
./install_convey.sh
```

El script realiza los siguientes pasos automáticamente:

- Sube el volumen al máximo y lo configura en el crontab para que se restaure en cada reinicio
- Instala los paquetes del sistema necesarios (`mpg123`, `evemu-tools`, `python3-evdev`)
- Copia la configuración de sonido `/etc/asound.conf`
- Crea y activa un entorno virtual Python (`vconvey`)
- Instala las dependencias Python del archivo `requirements.txt`
- Instala y habilita el servicio systemd `convey_server.service`
- Inicia el servicio

---

## Configuración

Edita el archivo `project_convey/config.py` antes de instalar o después de reiniciar el servicio:

```python
LED_PIN = 21                  # Pin GPIO del relé (modo BCM)
LUGAR   = "Alarma Principal"  # Nombre descriptivo de esta Raspberry Pi
TYPE_OPEN_DOOR = "RELE"       # Tipo de actuador: "RELE" activa el GPIO al recibir SOS
```

Para aplicar cambios en la configuración, reinicia el servicio:

```bash
sudo systemctl restart convey_server.service
```

---

## API del servicio (puerto 5000)

El servicio expone dos endpoints HTTP que usa `srvconvey` automáticamente.

### `POST /upload` — Recibir y reproducir audio

Recibe un archivo de audio, lo convierte a MP3 y lo encola para reproducción.

Formatos soportados: `.ogg`, `.mp3`, `.mpeg`, `.wav`, `.m4a`

```bash
curl -X POST http://<IP-RPi>:5000/upload -F "file=@audio.ogg"
```

### `POST /text` — Activar relé por palabra clave SOS

Si el texto recibido es `SOS`, activa el relé en el pin GPIO configurado durante 30 segundos.

```bash
curl -X POST http://<IP-RPi>:5000/text -H "Content-Type: application/json" -d '{"text":"SOS"}'
```

---

## Control del volumen

Durante la instalación se configura la tarjeta de sonido en `/etc/asound.conf` (tarjeta 2, que corresponde al audio por jack 3.5mm en la Raspberry Pi 4).

Si los parlantes no tienen control de volumen propio, puedes ajustarlo con:

```bash
alsamixer
```

Si no aparecen los controles de volumen:

1. Presiona **F6** para seleccionar la tarjeta de sonido
2. Elige **bcm2835 Headphones** (o la tarjeta predeterminada configurada)
3. Ajusta el volumen con las teclas **↑ ↓**

Para subir el volumen directamente por terminal:

```bash
amixer -c 2 set PCM 4dB
```

---

## Comandos útiles

| Acción | Comando |
|---|---|
| Ver estado del servicio | `sudo systemctl status convey_server.service` |
| Ver logs en tiempo real | `journalctl -u convey_server.service -f` |
| Iniciar el servicio | `sudo systemctl start convey_server.service` |
| Detener el servicio | `sudo systemctl stop convey_server.service` |
| Reiniciar el servicio | `sudo systemctl restart convey_server.service` |
| Habilitar inicio automático | `sudo systemctl enable convey_server.service` |

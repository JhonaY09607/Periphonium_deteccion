# CGBInstrusion — Servicio unificado de detección, audio y WhatsApp

Servicio único (`cgbinstrusion.service`) que corre en la Raspberry Pi conectada a la cámara
y a los parlantes. Reemplaza a los proyectos separados `convey` y `srvconvey`, reuniendo
solo lo necesario de cada uno:

- **De `convey`**: la reproducción de audio por la salida de sonido (cola + `mpg123`),
  el endpoint `/upload` para audios reenviados desde WhatsApp, `/text` para activar el
  relé por palabra clave SOS, y `/stop` para detener la reproducción.
- **De `srvconvey`**: el cliente de WhatsApp Web (`whatsapp-web.js`) que escucha el grupo
  de perifoneo, ahora recortado a lo esencial y ejecutado como un sidecar Node.js
  controlado por el propio servicio Python.
- **Nuevo**: el endpoint `/camera/intrusion`, que la cámara CGB llama al detectar una
  intrusión. Ese evento dispara en paralelo (a) el audio de alerta por los parlantes y
  (b) un mensaje de WhatsApp al grupo configurado, con una foto en vivo de la cámara
  adjunta, avisando que se detectó a una persona.

## Arquitectura

```
                     POST /camera/intrusion
Cámara CGB  ────────────────────────────────▶  main.py (Flask, puerto 5000)
   │                                                    │
   │  GET /cgi-bin/snapshot.cgi (foto JPEG)              │
   ◀────────────────────────────────────────────────────┤
                                                          │
                              ┌───────────────────────────┴───────────────────────┐
                              │                                                    │
                     cola de audio → mpg123                        POST 127.0.0.1:3001/notify
                     (salida de audio Raspberry)                   (mensaje + foto en base64)
                                                                                    │
                                                                                    ▼
                                                                  whatsapp/index.js (sidecar Node)
                                                                  cliente whatsapp-web.js
                                                                                    │
                                                                                    ▼
                                                                    Grupo de WhatsApp configurado
```

`main.py` es el único punto de entrada y el único servicio systemd. Al arrancar, lanza
el sidecar de Node (`whatsapp/index.js`) como subproceso y lo reinicia automáticamente
si se cae. La comunicación entre ambos es HTTP local (`127.0.0.1:3001`), por eso
funcionan como "un solo servicio" aunque sean dos runtimes (Python no puede ejecutar
`whatsapp-web.js`, que es una librería exclusiva de Node.js).

## Configuración

### `config.py` (Python)

```python
LED_PIN        = 21
LUGAR          = "Alarma Principal"
TYPE_OPEN_DOOR = "RELE"
ALERT_COOLDOWN = 30   # segundos entre alertas de intrusión (audio + WhatsApp)

# Cámara Dahua (detección de intrusión)
CAMERA_IP   = "10.1.3.219"
CAMERA_USER = "admin"
CAMERA_PASS = "asd12345"

# Códigos de evento IVS de Dahua que cuentan como "intrusión"
INTRUSION_EVENT_CODES = ["CrossLineDetection", "CrossRegionDetection"]

# ── Mensaje de alerta por WhatsApp ──────────────────────────────────────────
# Plantilla del texto del mensaje. Placeholders disponibles:
#   {lugar}  -> valor de LUGAR
#   {fecha}  -> fecha y hora completa (YYYY-MM-DD HH:MM:SS)
#   {hora}   -> solo la hora (HH:MM:SS)
#   {origen} -> de dónde vino la alerta (cámara/webhook manual)
ALERT_MESSAGE_TEMPLATE = "🚨 Intrusión detectada en {lugar} ({fecha})"

# Ubicación opcional. Solo se agregan al mensaje si el flag correspondiente
# está en True; si no, no aparecen.
DIRECCION         = ""     # ej. "Av. Siempre Viva 123, Ciudad"
INCLUIR_DIRECCION = False  # True para agregar la línea de dirección

UBICACION_LAT = None       # ej. -12.0464
UBICACION_LON = None       # ej. -77.0428
INCLUIR_MAPA  = False      # True para agregar un link a Google Maps

# Foto de la cámara adjunta a la alerta
ENVIAR_FOTO_EN_ALERTA = True
CAMERA_SNAPSHOT_PATH  = "/cgi-bin/snapshot.cgi?channel=1"  # endpoint CGI de snapshot de la cámara
```

Para cambiar el texto o los datos que se mandan por WhatsApp, solo se edita este
archivo — no hace falta tocar `main.py`. Tras editar, hay que reiniciar el servicio
(`sudo systemctl restart cgbinstrusion.service`).

### `whatsapp/config.js` (Node)

```js
gruposWhatsApp: [
    { nombre: 'Perifoneo', id: '<ID_DEL_GRUPO>', raspberryIPs: ['127.0.0.1'] }
],
palabrasClaveSOS: ['SOS', 'AYUDA', 'EMERGENCIA', 'INCENDIO', 'ALERTA'],
```

Las notificaciones de intrusión se envían a **todos** los grupos listados en
`gruposWhatsApp`. `raspberryIPs` apunta a `127.0.0.1` porque Flask y el sidecar corren
en la misma Raspberry; agrega más IPs solo si necesitas reenviar audio de perifoneo a
otros equipos.

**Cómo obtener el `id` del grupo:** con el servicio corriendo y la sesión de WhatsApp
ya vinculada, manda cualquier mensaje al grupo (desde el celular) y mira los logs en
vivo:

```bash
journalctl -u cgbinstrusion.service -f
```

Va a aparecer una línea `MENSAJE OUTGOING: / De: <id>@g.us` — ese es el `id` que va en
`gruposWhatsApp`.

Las credenciales SMTP del aviso de desconexión son opcionales y se leen de variables de
entorno (`CGB_SMTP_USER`, `CGB_SMTP_PASS`, `CGB_SMTP_TO`) — nunca se escriben en el
código. Defínelas en `cgbinstrusion.service` si las necesitas.

## Instalación

```bash
chmod +x install_cgbinstrusion.sh
./install_cgbinstrusion.sh
```

El script instala `mpg123`/`ffmpeg` (audio), Node.js/Chromium (WhatsApp), crea el
entorno virtual Python, instala las dependencias de `whatsapp/` con `npm install`, y
registra `cgbinstrusion.service`.

**Primer arranque manual** (para escanear el QR de WhatsApp):

```bash
venv/bin/python3 main.py
```

Escanea el QR que aparece en la terminal con el WhatsApp que hará de bot. Una vez
vinculado (la sesión queda guardada por `LocalAuth` en `whatsapp/.wwebjs_auth/`), detén
el proceso con `Ctrl+C` e inicia el servicio:

```bash
sudo systemctl start cgbinstrusion.service
```

## API (puerto 5000)

| Endpoint | Método | Descripción |
|---|---|---|
| `/camera/intrusion` | POST | Evento de la cámara CGB. Reproduce el audio de `sounds/alerta_intrusion.mp3` y notifica por WhatsApp con una foto en vivo de la cámara adjunta (con cooldown de `ALERT_COOLDOWN` segundos). |
| `/upload` | POST | Recibe un audio (`.ogg`, `.mp3`, `.mpeg`, `.wav`, `.m4a`), lo convierte y lo encola para reproducir. Usado por el sidecar al reenviar audios del grupo. |
| `/text` | POST | Activa el relé (GPIO) — llamado por el sidecar cuando detecta una palabra clave SOS en el grupo. |
| `/stop` | POST | Detiene la reproducción en curso y vacía la cola. |

## Solución de problemas

**El cliente de WhatsApp nunca queda "listo" / no llegan notificaciones ni mensajes
entrantes.** Revisa si aparece la línea `Cliente de WhatsApp listo` en los logs:

```bash
journalctl -u cgbinstrusion.service -f
```

Si nunca aparece (aunque ya no pida escanear el QR), es señal de que Chromium se quedó
atascado sincronizando WhatsApp Web — algo común en la Raspberry Pi cuando hay poca RAM
libre (`free -h`). Solución: reinicia el servicio para que arranque un sidecar de Node
limpio:

```bash
sudo systemctl restart cgbinstrusion.service
```

**Error `Cannot read properties of undefined (reading 'getChat')` al notificar.**
El `id` del grupo en `whatsapp/config.js` está vacío o mal escrito — revisa la sección
de configuración de arriba para obtenerlo desde los logs.

## Comandos útiles

| Acción | Comando |
|---|---|
| Ver estado | `sudo systemctl status cgbinstrusion.service` |
| Ver logs en vivo | `journalctl -u cgbinstrusion.service -f` |
| Reiniciar | `sudo systemctl restart cgbinstrusion.service` |
| Detener | `sudo systemctl stop cgbinstrusion.service` |

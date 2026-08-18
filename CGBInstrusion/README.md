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
  (b) un mensaje de WhatsApp al grupo configurado avisando que se detectó a una persona.

## Arquitectura

```
                POST /camera/intrusion
Cámara CGB  ─────────────────────────────▶  main.py (Flask, puerto 5000)
                                                 │
                              ┌──────────────────┼───────────────────┐
                              │                                      │
                     cola de audio → mpg123                POST 127.0.0.1:3001/notify
                     (salida de audio Raspberry)                     │
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
LED_PIN = 21
LUGAR   = "Alarma Principal"
TYPE_OPEN_DOOR = "RELE"
ALERT_COOLDOWN = 30   # segundos entre alertas de intrusión (audio + WhatsApp)
```

### `whatsapp/config.js` (Node)

```js
gruposWhatsApp: [
    { nombre: 'Perifoneo CCE', id: '<ID_DEL_GRUPO>', raspberryIPs: ['127.0.0.1'] }
],
palabrasClaveSOS: ['SOS', 'AYUDA', 'EMERGENCIA', 'INCENDIO', 'ALERTA'],
```

Las notificaciones de intrusión se envían a **todos** los grupos listados en
`gruposWhatsApp`. `raspberryIPs` apunta a `127.0.0.1` porque Flask y el sidecar corren
en la misma Raspberry; agrega más IPs solo si necesitas reenviar audio de perifoneo a
otros equipos.

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
| `/camera/intrusion` | POST | Evento de la cámara CGB. Reproduce el audio de `sounds/alerta_intrusion.mp3` y notifica por WhatsApp (con cooldown de `ALERT_COOLDOWN` segundos). |
| `/upload` | POST | Recibe un audio (`.ogg`, `.mp3`, `.mpeg`, `.wav`, `.m4a`), lo convierte y lo encola para reproducir. Usado por el sidecar al reenviar audios del grupo. |
| `/text` | POST | Activa el relé (GPIO) — llamado por el sidecar cuando detecta una palabra clave SOS en el grupo. |
| `/stop` | POST | Detiene la reproducción en curso y vacía la cola. |

## Comandos útiles

| Acción | Comando |
|---|---|
| Ver estado | `sudo systemctl status cgbinstrusion.service` |
| Ver logs en vivo | `journalctl -u cgbinstrusion.service -f` |
| Reiniciar | `sudo systemctl restart cgbinstrusion.service` |
| Detener | `sudo systemctl stop cgbinstrusion.service` |

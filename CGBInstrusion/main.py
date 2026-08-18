from flask import Flask, request, jsonify
import os
import subprocess
import threading
import time
import uuid
import queue
import atexit
import requests
from requests.auth import HTTPDigestAuth
from io import BytesIO
from pydub import AudioSegment
from gpiozero import LED
from time import sleep
from config import (
    TYPE_OPEN_DOOR,
    LED_PIN,
    LUGAR,
    ALERT_COOLDOWN,
    WHATSAPP_SIDECAR_DIR,
    WHATSAPP_NOTIFY_URL,
    CAMERA_IP,
    CAMERA_USER,
    CAMERA_PASS,
    INTRUSION_EVENT_CODES,
)

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
SOUNDS_FOLDER = os.path.join(BASE_DIR, "sounds")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(SOUNDS_FOLDER, exist_ok=True)

ALERT_AUDIO = os.path.join(SOUNDS_FOLDER, "alerta_intrusion.mp3")
ALLOWED_EXTENSIONS = (".ogg", ".mp3", ".mpeg", ".wav", ".m4a")

last_alert_time = 0

# ── Relé / valla ──────────────────────────────────────────────────────────────


def activar_rele():
    if TYPE_OPEN_DOOR == "RELE":
        led = LED(LED_PIN)
        print(f"Pin {LED_PIN} activado — {LUGAR}")
        led.on()
        sleep(30)
        led.off()


# ── Conversión de audio ───────────────────────────────────────────────────────


def convertir_audio_a_mp3(audio_bytes, extension):
    audio = AudioSegment.from_file(BytesIO(audio_bytes), format=extension)
    audio = audio.set_frame_rate(44100).set_channels(2).set_sample_width(2)

    mp3_filename = f"{uuid.uuid4().hex}.mp3"
    mp3_path = os.path.join(UPLOAD_FOLDER, mp3_filename)
    audio.export(mp3_path, format="mp3", bitrate="192k")

    print(f"Audio convertido: {mp3_path}")
    return mp3_path


# ── Reproducción ──────────────────────────────────────────────────────────────

# Cada elemento de la cola es (ruta_mp3, auto_delete)
audio_queue = queue.Queue()

current_process = None
process_lock = threading.Lock()


def reproducir_con_mpg123(file_path):
    global current_process
    print(f"Reproduciendo: {file_path}")
    proc = subprocess.Popen(["mpg123", "-a", "hw:0,0", file_path])
    with process_lock:
        current_process = proc
    proc.wait()
    with process_lock:
        if current_process is proc:
            current_process = None


def reproductor_audio():
    while True:
        mp3_path, auto_delete = audio_queue.get()
        try:
            reproducir_con_mpg123(mp3_path)
        except Exception as e:
            print(f"Error en reproducción: {e}")
        finally:
            if auto_delete:
                try:
                    os.remove(mp3_path)
                    print(f"Archivo eliminado: {mp3_path}")
                except Exception as e:
                    print(f"No se pudo eliminar {mp3_path}: {e}")
            audio_queue.task_done()


# ── Notificación de WhatsApp (vía sidecar Node) ───────────────────────────────


def enviar_alerta_whatsapp(mensaje):
    try:
        requests.post(WHATSAPP_NOTIFY_URL, json={"mensaje": mensaje}, timeout=5)
        print(f"[WHATSAPP] Notificación enviada: {mensaje}")
    except Exception as e:
        print(f"[WHATSAPP] No se pudo notificar (¿sidecar caído?): {e}")


# ── Endpoints ─────────────────────────────────────────────────────────────────


@app.route("/upload", methods=["POST"])
def upload_file():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    if not file.filename.lower().endswith(ALLOWED_EXTENSIONS):
        return jsonify({"error": "Formato de audio no soportado"}), 400

    try:
        audio_bytes = file.read()
        extension = file.filename.split(".")[-1].lower()
        if extension == "mpeg":
            extension = "mp3"

        mp3_path = convertir_audio_a_mp3(audio_bytes, extension)
        audio_queue.put((mp3_path, True))
        print(f"Audio encolado: {mp3_path}")
        return jsonify({"message": "Audio recibido y encolado"}), 200
    except Exception as e:
        print(f"Error procesando audio: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/text", methods=["POST"])
def process_text():
    # El sidecar de WhatsApp ya filtró las palabras clave; aquí solo se activa el relé
    threading.Thread(target=activar_rele, daemon=True).start()
    return jsonify({"message": "Relé activado"}), 200


@app.route("/stop", methods=["POST"])
def stop_audio():
    return _detener_audio()


def _detener_audio():
    """Detiene el audio en curso y vacía la cola de pendientes."""
    global current_process

    with process_lock:
        proc = current_process
    if proc and proc.poll() is None:
        proc.kill()
        print("Proceso mpg123 detenido")

    vaciados = 0
    while not audio_queue.empty():
        try:
            mp3_path, auto_delete = audio_queue.get_nowait()
            audio_queue.task_done()
            vaciados += 1
            if auto_delete:
                try:
                    os.remove(mp3_path)
                except Exception:
                    pass
        except queue.Empty:
            break

    msg = f"Reproducción detenida. {vaciados} archivo(s) pendiente(s) eliminado(s)."
    print(msg)
    return jsonify({"message": msg}), 200


def procesar_alerta_intrusion(origen="desconocido"):
    """Reproduce el audio de alerta y notifica por WhatsApp, respetando el cooldown."""
    global last_alert_time

    current_time = time.time()
    if current_time - last_alert_time < ALERT_COOLDOWN:
        print(f"[INTRUSION] Alerta ignorada por cooldown ({ALERT_COOLDOWN}s)")
        return False

    if not os.path.exists(ALERT_AUDIO):
        print(f"[ERROR] No se encontró el archivo de audio: {ALERT_AUDIO}")
        return False

    # Audio permanente -> auto_delete = False
    audio_queue.put((ALERT_AUDIO, False))
    last_alert_time = current_time
    print(f"[INTRUSION] Audio de alerta agregado a la cola (origen: {origen})")

    mensaje = f"🚨 Intrusión detectada en {LUGAR} ({time.strftime('%Y-%m-%d %H:%M:%S')})"
    threading.Thread(target=enviar_alerta_whatsapp, args=(mensaje,), daemon=True).start()
    return True


@app.route("/camera/intrusion", methods=["POST"])
def camera_intrusion():
    """Endpoint manual de respaldo/pruebas. El disparo real llega por
    escuchar_eventos_camara(), que se conecta directamente a la cámara."""
    raw_data = request.get_data()
    print(f"[INTRUSION] Evento manual recibido: {raw_data[:200]}")
    procesar_alerta_intrusion(origen="webhook manual")
    return jsonify({"message": "Evento procesado"}), 200


def escuchar_eventos_camara():
    """Se conecta al API de eventos de la cámara Dahua (eventManager.cgi) y
    mantiene la conexión abierta escuchando eventos en tiempo real."""
    if not CAMERA_IP:
        print("[CAMERA] CAMERA_IP no configurada; no se escucharán eventos de la cámara")
        return

    url = f"http://{CAMERA_IP}/cgi-bin/eventManager.cgi?action=attach&codes=[All]&heartbeat=5"

    while True:
        try:
            print(f"[CAMERA] Conectando a eventos de {CAMERA_IP}...")
            resp = requests.get(
                url,
                auth=HTTPDigestAuth(CAMERA_USER, CAMERA_PASS),
                stream=True,
                timeout=60,
            )
            resp.raise_for_status()
            print("[CAMERA] Conectado, escuchando eventos...")

            for line in resp.iter_lines(decode_unicode=True):
                if not line or not line.startswith("Code="):
                    continue
                print(f"[CAMERA] Evento: {line}")

                campos = dict(
                    campo.split("=", 1) for campo in line.split(";") if "=" in campo
                )
                codigo = campos.get("Code")
                accion = campos.get("action")

                if codigo in INTRUSION_EVENT_CODES and accion == "Start":
                    procesar_alerta_intrusion(origen=f"cámara ({codigo})")

        except requests.exceptions.RequestException as e:
            print(f"[CAMERA] Error de conexión con la cámara: {e}")

        print("[CAMERA] Reconectando en 10s...")
        time.sleep(10)


# ── Limpieza periódica de archivos antiguos ───────────────────────────────────


def archivos_antiguos(directorio, dias=2):
    ahora = time.time()
    edad_maxima = dias * 24 * 60 * 60
    for archivo in os.listdir(directorio):
        ruta = os.path.join(directorio, archivo)
        if os.path.isfile(ruta):
            if ahora - os.path.getmtime(ruta) > edad_maxima:
                try:
                    os.remove(ruta)
                    print(f"Archivo antiguo eliminado: {ruta}")
                except Exception as e:
                    print(f"Error al eliminar {ruta}: {e}")


def limpieza_periodica():
    while True:
        archivos_antiguos(UPLOAD_FOLDER, dias=2)
        time.sleep(3600)


# ── Supervisor del sidecar de WhatsApp (Node.js) ──────────────────────────────

whatsapp_process = None


def iniciar_whatsapp_sidecar():
    global whatsapp_process
    sidecar_dir = os.path.join(BASE_DIR, WHATSAPP_SIDECAR_DIR)
    entry = os.path.join(sidecar_dir, "index.js")

    if not os.path.exists(entry):
        print(f"[WHATSAPP] No se encontró {entry}; el sidecar no se inició")
        return

    while True:
        print("[WHATSAPP] Iniciando proceso Node del sidecar de WhatsApp...")
        whatsapp_process = subprocess.Popen(["node", "index.js"], cwd=sidecar_dir)
        whatsapp_process.wait()
        print("[WHATSAPP] El sidecar de WhatsApp finalizó; reintentando en 10s...")
        time.sleep(10)


def detener_whatsapp_sidecar():
    if whatsapp_process and whatsapp_process.poll() is None:
        whatsapp_process.terminate()


atexit.register(detener_whatsapp_sidecar)


if __name__ == "__main__":
    if not os.path.exists(ALERT_AUDIO):
        print(f"[ADVERTENCIA] No se encontró el archivo de audio de alerta: {ALERT_AUDIO}")
        print(f"[ADVERTENCIA] Coloca tu archivo MP3 en: {ALERT_AUDIO}")

    threading.Thread(target=limpieza_periodica, daemon=True).start()
    threading.Thread(target=reproductor_audio, daemon=True).start()
    threading.Thread(target=iniciar_whatsapp_sidecar, daemon=True).start()
    threading.Thread(target=escuchar_eventos_camara, daemon=True).start()

    app.run(host="0.0.0.0", port=5000)

from flask import Flask, request, jsonify
import os
import subprocess
import threading
import time
import uuid
import queue
from io import BytesIO
from pydub import AudioSegment
from gpiozero import LED
from time import sleep
from config import TYPE_OPEN_DOOR, LED_PIN, LUGAR

app = Flask(__name__)
UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ── Relé / sirena ─────────────────────────────────────────────────────────────

def activar_rele():
    if TYPE_OPEN_DOOR == "RELE":
        led = LED(LED_PIN)
        print(f"Pin {LED_PIN} activado — {LUGAR}")
        led.on()
        sleep(30)
        led.off()

# ── Conversión de audio ───────────────────────────────────────────────────────

def convertir_audio_a_mp3(audio_bytes, extension):
    try:
        audio = AudioSegment.from_file(BytesIO(audio_bytes), format=extension)
        audio = audio.set_frame_rate(44100).set_channels(2).set_sample_width(2)

        mp3_filename = f"{uuid.uuid4().hex}.mp3"
        mp3_path = os.path.join(UPLOAD_FOLDER, mp3_filename)
        audio.export(mp3_path, format="mp3", bitrate="192k")

        print(f"Audio convertido: {mp3_path}")
        return mp3_path
    except Exception as e:
        raise Exception(f"Error al convertir audio: {str(e)}")

# ── Reproducción ──────────────────────────────────────────────────────────────

audio_queue = queue.Queue()

# Proceso mpg123 activo y su lock para acceso seguro entre hilos
current_process = None
process_lock = threading.Lock()

def reproducir_con_mpg123(file_path):
    global current_process
    print(f"Reproduciendo: {file_path}")
    proc = subprocess.Popen(["mpg123", file_path])
    with process_lock:
        current_process = proc
    proc.wait()
    with process_lock:
        if current_process is proc:
            current_process = None

def reproductor_audio():
    while True:
        mp3_path = audio_queue.get()
        try:
            reproducir_con_mpg123(mp3_path)
        except Exception as e:
            print(f"Error en reproducción: {e}")
        finally:
            try:
                os.remove(mp3_path)
                print(f"Archivo eliminado: {mp3_path}")
            except Exception as e:
                print(f"No se pudo eliminar {mp3_path}: {e}")
            audio_queue.task_done()

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.route("/upload", methods=["POST"])
def upload_file():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    ALLOWED_EXTENSIONS = (".ogg", ".mp3", ".mpeg", ".wav", ".m4a")
    if not file.filename.lower().endswith(ALLOWED_EXTENSIONS):
        return jsonify({"error": "Formato de audio no soportado"}), 400

    try:
        audio_bytes = file.read()
        extension = file.filename.split(".")[-1].lower()
        if extension == "mpeg":
            extension = "mp3"

        mp3_path = convertir_audio_a_mp3(audio_bytes, extension)
        audio_queue.put(mp3_path)
        print(f"Audio encolado: {mp3_path}")
        return jsonify({"message": "Audio recibido y encolado"}), 200
    except Exception as e:
        print(f"Error procesando audio: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/text", methods=["POST"])
def process_text():
    # srvconvey ya filtró las palabras clave; aquí solo se activa el relé
    threading.Thread(target=activar_rele, daemon=True).start()
    return jsonify({"message": "Relé activado"}), 200


@app.route("/stop", methods=["POST"])
def stop_audio():
    return _detener_audio()


def _detener_audio():
    """Detiene el audio en curso y vacía la cola de pendientes."""
    global current_process

    # Matar proceso activo
    with process_lock:
        proc = current_process
    if proc and proc.poll() is None:
        proc.kill()
        print("Proceso mpg123 detenido")

    # Vaciar cola
    vaciados = 0
    while not audio_queue.empty():
        try:
            path = audio_queue.get_nowait()
            audio_queue.task_done()
            vaciados += 1
            try:
                os.remove(path)
            except Exception:
                pass
        except queue.Empty:
            break

    msg = f"Reproducción detenida. {vaciados} archivo(s) pendiente(s) eliminado(s)."
    print(msg)
    return jsonify({"message": msg}), 200

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

# ── Arranque ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    threading.Thread(target=limpieza_periodica, daemon=True).start()
    threading.Thread(target=reproductor_audio, daemon=True).start()
    app.run(host="0.0.0.0", port=5000)

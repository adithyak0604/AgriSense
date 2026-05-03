"""
AgriSense — app.py
==================
Entry point. Creates the Flask app and registers all route blueprints.

HOW TO RUN:
  1. pip install flask flask-cors flask-sqlalchemy
  2. cd into this folder
  3. python app.py
  4. Open http://localhost:5000

  Soil sensor (serial_reader.py) launches automatically.
  Set SENSOR_PORT in this file to your ESP32 COM port.
    Windows example : SENSOR_PORT = "COM5"
    Linux example   : SENSOR_PORT = "/dev/ttyUSB0"
"""

import os
import sys
import subprocess
import atexit
import importlib
from flask import Flask, render_template
from flask_cors import CORS

# ══════════════════════════════════════════════════════════════════════════════
# SENSOR DAEMON — auto-launched alongside Flask
# ══════════════════════════════════════════════════════════════════════════════
# Set this to your ESP32 serial port.
#   Windows : "COM3", "COM4", "COM5", etc.
#   Linux   : "/dev/ttyUSB0", "/dev/ttyACM0", etc.
# Set to "" or None to disable auto-launch (run serial_reader.py manually).
SENSOR_PORT = "COM5"
SENSOR_BAUD = 9600

_serial_proc = None   # holds the subprocess handle

def _launch_serial_daemon():
    """Spawn serial_reader.py as a background subprocess (USB mode only)."""
    global _serial_proc
    # Import SENSOR_MODE from soil route to decide whether to launch daemon
    try:
        from routes.soil import SENSOR_MODE
        if SENSOR_MODE == "wifi":
            print("  ℹ  Sensor mode: Wi-Fi — serial_reader.py not started.")
            print("     ESP32 will push data directly to /api/soil/ingest")
            return
    except ImportError:
        pass
    if not SENSOR_PORT:
        print("  ⚠  SENSOR_PORT not set — serial_reader.py not started.")
        print("     Set SENSOR_PORT in app.py or run serial_reader.py manually.")
        return

    reader_path = os.path.join(os.path.dirname(__file__), "serial_reader.py")
    if not os.path.exists(reader_path):
        print(f"  ⚠  serial_reader.py not found at: {reader_path}")
        return

    try:
        _serial_proc = subprocess.Popen(
            [sys.executable, reader_path,
             "--port", SENSOR_PORT,
             "--baud", str(SENSOR_BAUD)],
            stdout=subprocess.DEVNULL,   # suppress daemon output in Flask console
            stderr=subprocess.DEVNULL,
        )
        print(f"  ✅ serial_reader.py started  (PID {_serial_proc.pid})")
        print(f"     Port : {SENSOR_PORT}  @  {SENSOR_BAUD} baud")
        print(f"     Sensor HTTP : http://localhost:5001/latest")
    except Exception as e:
        print(f"  ❌ Could not start serial_reader.py: {e}")
        print(f"     Run it manually: python serial_reader.py --port {SENSOR_PORT}")

def _stop_serial_daemon():
    """Terminate the serial daemon when Flask exits."""
    global _serial_proc
    if _serial_proc and _serial_proc.poll() is None:
        _serial_proc.terminate()
        try:
            _serial_proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            _serial_proc.kill()
        print("  🛑 serial_reader.py stopped.")

atexit.register(_stop_serial_daemon)

# ── Create app ────────────────────────────────────────────────────────────────
app = Flask(__name__, template_folder="templates", static_folder="static")
CORS(app)

# ── Database (SQLite — auto-creates agrisense.db on first run) ────────────────
from database import init_db
init_db(app)

# ── Core blueprints (always required) ─────────────────────────────────────────
from routes.weather  import weather_bp
from routes.disease  import disease_bp
from routes.history  import history_bp

app.register_blueprint(weather_bp)
app.register_blueprint(disease_bp)
app.register_blueprint(history_bp)

# ── Optional blueprints — safe to add when files exist ────────────────────────
for mod, bp_name in [
    ("routes.overview", "overview_bp"),
    ("routes.soil",     "soil_bp"),
    ("routes.crop",     "crop_bp"),
]:
    try:
        module = importlib.import_module(mod)
        app.register_blueprint(getattr(module, bp_name))
    except (ImportError, AttributeError):
        pass

# ── Index route ───────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("base.html")

# ── Start ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55)
    print("  AgriSense Backend running!")
    print("  Open: http://localhost:5000")
    import socket
    try:
        local_ip = socket.gethostbyname(socket.gethostname())
        print(f"  Wi-Fi: http://{local_ip}:5000  (ESP32 ingest target)")
    except Exception:
        pass
    print()
    print("  Routes active:")
    for rule in sorted(app.url_map.iter_rules(), key=lambda r: r.rule):
        print(f"    {rule.rule}")
    print("=" * 55)
    # Launch serial daemon only in the main process (not the reloader child)
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        _launch_serial_daemon()

    app.run(debug=True, host='0.0.0.0', port=5000)

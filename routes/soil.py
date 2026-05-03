"""
routes/soil.py
--------------
Handles soil sensor readings from two possible sources:

  USB MODE  (default):
    serial_reader.py daemon runs on the host PC, reads data over USB serial.
    Dashboard Read Sensor button calls POST /api/soil/read which pulls
    the latest reading from the daemon at http://localhost:5001/latest.

  WI-FI MODE:
    ESP32 connects to Wi-Fi and pushes readings directly via HTTP POST
    to /api/soil/ingest  (no USB cable, no serial_reader.py needed).
    The dashboard Read Sensor button calls /api/soil/latest to retrieve
    the most recently pushed reading.

  Toggle between modes by setting SENSOR_MODE below.

Endpoints:
  POST /api/soil/ingest      <- ESP32 Wi-Fi push (Wi-Fi mode)
  POST /api/soil/read        <- Dashboard Read Sensor button (USB mode)
  GET  /api/soil/latest      <- Dashboard display (both modes)
  GET  /api/soil/history     <- History charts
  DELETE /api/soil/clear     <- Clear all logs
  GET  /api/soil/mode        <- Returns current mode to dashboard
"""

import logging
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request
from database import db, SoilReading

soil_bp = Blueprint("soil", __name__)
logger  = logging.getLogger(__name__)

# =============================================================================
# SENSOR MODE CONFIGURATION
# =============================================================================
# Set to "wifi"  -> ESP32 pushes data wirelessly to /api/soil/ingest
# Set to "usb"   -> serial_reader.py daemon feeds data via /api/soil/read
SENSOR_MODE = "usb"

# Secret token the ESP32 must include in every POST request.
# Change this to any random string and update the Arduino sketch to match.
INGEST_TOKEN = "agrisense-esp32-secret"

# Only used in USB mode
SENSOR_DAEMON_URL = "http://localhost:5001/latest"

# Sensor health thresholds
THRESHOLDS = {
    "ph":          {"low": 5.5, "high": 7.5, "unit": "",       "label": "pH"},
    "moisture":    {"low": 20,  "high": 80,  "unit": "%",      "label": "Moisture"},
    "temperature": {"low": 10,  "high": 35,  "unit": "C",      "label": "Soil Temp"},
    "nitrogen":    {"low": 20,  "high": 300, "unit": " mg/kg", "label": "Nitrogen"},
    "phosphorus":  {"low": 10,  "high": 200, "unit": " mg/kg", "label": "Phosphorus"},
    "potassium":   {"low": 50,  "high": 400, "unit": " mg/kg", "label": "Potassium"},
    "conductivity":{"low": 100, "high": 2000,"unit": " uS/cm", "label": "Conductivity"},
}

def _status(key, val):
    if val is None: return "unknown"
    t = THRESHOLDS.get(key, {})
    if val < t.get("low",  float('-inf')): return "low"
    if val > t.get("high", float('inf')):  return "high"
    return "ok"

def _parse_floats(data):
    required = {"nitrogen","phosphorus","potassium","ph","moisture","temperature","conductivity"}
    missing  = required - set(data.keys())
    if missing: return None, f"Missing fields: {missing}"
    try:
        return {k: float(data[k]) for k in required}, None
    except (ValueError, TypeError) as e:
        return None, f"Invalid numeric value: {e}"

def _save_and_respond(values):
    try:
        record = SoilReading(**values)
        db.session.add(record)
        db.session.commit()
        logger.info("Soil reading saved: id=%d  ph=%.2f", record.id, record.ph)
        d = record.to_dict()
        d["status"]     = {k: _status(k, d.get(k)) for k in THRESHOLDS}
        d["thresholds"] = THRESHOLDS
        return jsonify({"saved": True, "data": d})
    except Exception as e:
        db.session.rollback()
        logger.error("Soil DB save error: %s", e)
        return jsonify({"error": str(e)}), 500

# Routes

@soil_bp.route("/api/soil/mode", methods=["GET"])
def get_mode():
    return jsonify({"mode": SENSOR_MODE})

@soil_bp.route("/api/soil/ingest", methods=["POST"])
def ingest():
    if SENSOR_MODE != "wifi":
        return jsonify({"error": "Wi-Fi ingest disabled. Set SENSOR_MODE='wifi' in soil.py"}), 403
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No JSON body received"}), 400
    if data.get("token") != INGEST_TOKEN:
        logger.warning("Soil ingest: invalid token from %s", request.remote_addr)
        return jsonify({"error": "Unauthorised — invalid token"}), 401
    values, err = _parse_floats(data)
    if err:
        return jsonify({"error": err}), 400
    logger.info("Wi-Fi ingest from %s", request.remote_addr)
    return _save_and_respond(values)

@soil_bp.route("/api/soil/read", methods=["POST"])
def read_now():
    if SENSOR_MODE == "wifi":
        row = SoilReading.query.order_by(SoilReading.timestamp.desc()).first()
        if not row:
            return jsonify({"error": "No reading received from ESP32 yet. "
                                     "Make sure ESP32 is powered and on the same Wi-Fi."}), 404
        d = row.to_dict()
        d["status"]     = {k: _status(k, d.get(k)) for k in THRESHOLDS}
        d["thresholds"] = THRESHOLDS
        return jsonify({"saved": False, "data": d, "source": "wifi"})
    import requests as req
    try:
        r = req.get(SENSOR_DAEMON_URL, timeout=3)
    except Exception as e:
        return jsonify({"error": f"Cannot reach sensor daemon: {e}"}), 503
    if r.status_code == 404:
        return jsonify({"error": "No reading yet — sensor warming up."}), 404
    values, err = _parse_floats(r.json())
    if err:
        return jsonify({"error": err}), 400
    return _save_and_respond(values)

@soil_bp.route("/api/soil/latest", methods=["GET"])
def latest():
    row = SoilReading.query.order_by(SoilReading.timestamp.desc()).first()
    if not row:
        return jsonify({"data": None, "message": "No readings yet"})
    d = row.to_dict()
    d["status"]     = {k: _status(k, d.get(k)) for k in THRESHOLDS}
    d["thresholds"] = THRESHOLDS
    return jsonify({"data": d})

@soil_bp.route("/api/soil/history", methods=["GET"])
def history():
    limit = min(int(request.args.get("limit", 50)), 500)
    rows  = SoilReading.query.order_by(SoilReading.timestamp.desc()).limit(limit).all()
    return jsonify({"records": [r.to_dict() for r in reversed(rows)], "count": len(rows)})

@soil_bp.route("/api/soil/clear", methods=["DELETE"])
def clear():
    try:
        count = db.session.query(SoilReading).delete()
        db.session.commit()
        return jsonify({"cleared": count})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

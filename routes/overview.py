"""
routes/overview.py
──────────────────
Serves the main HTML page and the Overview dashboard API.
"""

import random
from flask import Blueprint, render_template, jsonify

overview_bp = Blueprint("overview", __name__)


@overview_bp.route("/")
def index():
    """Serves the main dashboard page."""
    return render_template("base.html")


@overview_bp.route("/api/overview")
def api_overview():
    """
    Returns the four stat cards on the Overview page.

    🔌 REAL SENSOR: Replace random values with actual sensor readings,
    e.g. from a DHT22 (temperature/humidity) or soil moisture probe.
    """
    return jsonify({
        "temperature":  round(random.uniform(22, 35), 1),   # °C
        "soil_moisture": round(random.uniform(40, 80), 1),  # %
        "soil_ph":       round(random.uniform(5.5, 7.5), 1),
        "rainfall":      round(random.uniform(0, 12), 1),   # mm today
    })


@overview_bp.route("/api/alerts")
def api_alerts():
    """
    Returns active farm alerts shown in the notification bell.

    🔌 REAL LOGIC: Generate alerts dynamically from sensor thresholds,
    e.g. if soil_moisture < 30: append a low-moisture alert.
    """
    alerts = [
        {
            "id": 1,
            "type": "warning",
            "title": "Low Soil Moisture",
            "message": "Field A moisture dropped to 28%. Consider irrigation.",
            "time": "10 min ago",
        },
        {
            "id": 2,
            "type": "info",
            "title": "Rainfall Expected",
            "message": "60% chance of rain tomorrow afternoon.",
            "time": "1 hr ago",
        },
        {
            "id": 3,
            "type": "success",
            "title": "Soil pH Stable",
            "message": "pH has been in optimal range (6.2) for 7 days.",
            "time": "3 hr ago",
        },
    ]
    return jsonify({"count": len(alerts), "alerts": alerts})

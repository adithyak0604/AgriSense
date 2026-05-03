"""
database.py — SQLite via SQLAlchemy
Tables: disease_history, weather_log, alerts_log
"""
from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

def init_db(app):
    app.config.setdefault("SQLALCHEMY_DATABASE_URI", "sqlite:///agrisense.db")
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    db.init_app(app)
    with app.app_context():
        db.create_all()


class DiseaseHistory(db.Model):
    __tablename__ = "disease_history"
    id          = db.Column(db.Integer, primary_key=True)
    timestamp   = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    crop        = db.Column(db.String(32),  nullable=False)
    disease     = db.Column(db.String(128), nullable=False)
    confidence  = db.Column(db.Float,       nullable=False)
    severity    = db.Column(db.String(16),  nullable=False)
    action      = db.Column(db.Text,        nullable=True)
    meta        = db.Column(db.String(64),  nullable=True)   # model name / ensemble info

    def to_dict(self):
        return {
            "id":         self.id,
            "timestamp":  self.timestamp.isoformat(),
            "crop":       self.crop,
            "disease":    self.disease,
            "confidence": self.confidence,
            "severity":   self.severity,
            "action":     self.action,
            "meta":       self.meta,
        }


class WeatherLog(db.Model):
    __tablename__ = "weather_log"
    id          = db.Column(db.Integer, primary_key=True)
    timestamp   = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    location    = db.Column(db.String(128), nullable=True)
    temp_c      = db.Column(db.Float, nullable=True)
    feels_c     = db.Column(db.Float, nullable=True)
    humidity    = db.Column(db.Integer, nullable=True)
    wind_kmh    = db.Column(db.Float,   nullable=True)
    precip_mm   = db.Column(db.Float,   nullable=True)
    pressure    = db.Column(db.Float,   nullable=True)
    uv          = db.Column(db.Float,   nullable=True)
    condition   = db.Column(db.String(64), nullable=True)

    def to_dict(self):
        return {
            "id":        self.id,
            "timestamp": self.timestamp.isoformat(),
            "location":  self.location,
            "temp_c":    self.temp_c,
            "feels_c":   self.feels_c,
            "humidity":  self.humidity,
            "wind_kmh":  self.wind_kmh,
            "precip_mm": self.precip_mm,
            "pressure":  self.pressure,
            "uv":        self.uv,
            "condition": self.condition,
        }


class AlertLog(db.Model):
    __tablename__ = "alerts_log"
    id          = db.Column(db.Integer, primary_key=True)
    timestamp   = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    alert_type  = db.Column(db.String(32),  nullable=False)   # weather | disease
    severity    = db.Column(db.String(16),  nullable=False)   # low | medium | high | critical
    title       = db.Column(db.String(128), nullable=False)
    message     = db.Column(db.Text,        nullable=True)
    resolved    = db.Column(db.Boolean,     default=False)

    def to_dict(self):
        return {
            "id":         self.id,
            "timestamp":  self.timestamp.isoformat(),
            "alert_type": self.alert_type,
            "severity":   self.severity,
            "title":      self.title,
            "message":    self.message,
            "resolved":   self.resolved,
        }

class SoilReading(db.Model):
    __tablename__ = "soil_readings"
    id           = db.Column(db.Integer, primary_key=True)
    timestamp    = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    nitrogen     = db.Column(db.Float, nullable=True)   # mg/kg
    phosphorus   = db.Column(db.Float, nullable=True)   # mg/kg
    potassium    = db.Column(db.Float, nullable=True)   # mg/kg
    ph           = db.Column(db.Float, nullable=True)   # 0–14
    moisture     = db.Column(db.Float, nullable=True)   # %
    temperature  = db.Column(db.Float, nullable=True)   # °C
    conductivity = db.Column(db.Float, nullable=True)   # µS/cm

    def to_dict(self):
        return {
            "id":          self.id,
            "timestamp":   self.timestamp.isoformat(),
            "nitrogen":    self.nitrogen,
            "phosphorus":  self.phosphorus,
            "potassium":   self.potassium,
            "ph":          self.ph,
            "moisture":    self.moisture,
            "temperature": self.temperature,
            "conductivity":self.conductivity,
        }

class CropRecommendation(db.Model):
    __tablename__ = "crop_recommendations"
    id           = db.Column(db.Integer, primary_key=True)
    timestamp    = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    crop         = db.Column(db.String(64),  nullable=False)   # recommended crop name
    confidence   = db.Column(db.Float,       nullable=False)   # top crop confidence %
    season       = db.Column(db.String(32),  nullable=True)    # rainy, winter, etc.
    source       = db.Column(db.String(16),  nullable=False, default="manual")  # "sensor" | "manual"
    # Input parameters used
    nitrogen     = db.Column(db.Float, nullable=True)
    phosphorus   = db.Column(db.Float, nullable=True)
    potassium    = db.Column(db.Float, nullable=True)
    ph           = db.Column(db.Float, nullable=True)
    temperature  = db.Column(db.Float, nullable=True)
    humidity     = db.Column(db.Float, nullable=True)
    rainfall     = db.Column(db.Float, nullable=True)
    # Result extras
    reason       = db.Column(db.Text,        nullable=True)    # why this crop
    all_scores   = db.Column(db.Text,        nullable=True)    # JSON: top 3 as [{crop, confidence}]

    def to_dict(self):
        import json as _json
        return {
            "id":          self.id,
            "timestamp":   self.timestamp.isoformat(),
            "crop":        self.crop,
            "confidence":  self.confidence,
            "season":      self.season,
            "source":      self.source,
            "nitrogen":    self.nitrogen,
            "phosphorus":  self.phosphorus,
            "potassium":   self.potassium,
            "ph":          self.ph,
            "temperature": self.temperature,
            "humidity":    self.humidity,
            "rainfall":    self.rainfall,
            "reason":      self.reason,
            "all_scores":  _json.loads(self.all_scores) if self.all_scores else [],
        }

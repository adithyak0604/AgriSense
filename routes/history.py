"""
routes/history.py — History & log API endpoints
"""
from flask import Blueprint, jsonify, request
from database import db, DiseaseHistory, WeatherLog, AlertLog, CropRecommendation, SoilReading, SoilReading

history_bp = Blueprint("history", __name__)

@history_bp.route("/api/history/disease", methods=["GET"])
def get_disease_history():
    limit = min(int(request.args.get("limit", 50)), 200)
    crop  = request.args.get("crop", "").strip().lower() or None
    q = DiseaseHistory.query.order_by(DiseaseHistory.timestamp.desc())
    if crop:
        q = q.filter_by(crop=crop)
    rows = q.limit(limit).all()
    return jsonify({"records": [r.to_dict() for r in rows], "count": len(rows)})

@history_bp.route("/api/history/disease/<int:record_id>", methods=["DELETE"])
def delete_disease_record(record_id):
    r = db.session.get(DiseaseHistory, record_id)
    if not r:
        return jsonify({"error": "Not found"}), 404
    db.session.delete(r)
    db.session.commit()
    return jsonify({"deleted": record_id})

@history_bp.route("/api/history/weather", methods=["GET"])
def get_weather_log():
    limit = min(int(request.args.get("limit", 48)), 200)
    rows  = WeatherLog.query.order_by(WeatherLog.timestamp.desc()).limit(limit).all()
    return jsonify({"records": [r.to_dict() for r in rows], "count": len(rows)})

@history_bp.route("/api/history/weather/clear", methods=["DELETE"])
def clear_weather_log():
    try:
        count = db.session.query(WeatherLog).delete()
        db.session.commit()
        return jsonify({"cleared": count})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

@history_bp.route("/api/history/alerts", methods=["GET"])
def get_alerts():
    limit    = min(int(request.args.get("limit", 50)), 200)
    resolved = request.args.get("resolved")
    q = AlertLog.query.order_by(AlertLog.timestamp.desc())
    if resolved == "false":
        q = q.filter_by(resolved=False)
    elif resolved == "true":
        q = q.filter_by(resolved=True)
    rows = q.limit(limit).all()
    return jsonify({"records": [r.to_dict() for r in rows], "count": len(rows)})

@history_bp.route("/api/history/alerts/<int:alert_id>/resolve", methods=["POST"])
def resolve_alert(alert_id):
    a = db.session.get(AlertLog, alert_id)
    if not a:
        return jsonify({"error": "Not found"}), 404
    a.resolved = True
    db.session.commit()
    return jsonify({"resolved": alert_id})

@history_bp.route("/api/history/crop", methods=["GET"])
def get_crop_history():
    limit  = min(int(request.args.get("limit", 50)), 200)
    season = request.args.get("season", "").strip().lower() or None
    source = request.args.get("source", "").strip().lower() or None
    q = CropRecommendation.query.order_by(CropRecommendation.timestamp.desc())
    if season: q = q.filter_by(season=season)
    if source: q = q.filter_by(source=source)
    rows = q.limit(limit).all()
    return jsonify({"records": [r.to_dict() for r in rows], "count": len(rows)})

@history_bp.route("/api/history/crop/<int:record_id>", methods=["DELETE"])
def delete_crop_record(record_id):
    r = db.session.get(CropRecommendation, record_id)
    if not r:
        return jsonify({"error": "Not found"}), 404
    db.session.delete(r)
    db.session.commit()
    return jsonify({"deleted": record_id})

@history_bp.route("/api/history/crop/clear", methods=["DELETE"])
def clear_crop_history():
    try:
        count = db.session.query(CropRecommendation).delete()
        db.session.commit()
        return jsonify({"cleared": count})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

@history_bp.route("/api/history/soil", methods=["GET"])
def get_soil_history():
    limit = min(int(request.args.get("limit", 50)), 200)
    rows  = SoilReading.query.order_by(SoilReading.timestamp.desc()).limit(limit).all()
    return jsonify({"records": [r.to_dict() for r in rows], "count": len(rows)})

@history_bp.route("/api/history/soil/<int:record_id>", methods=["DELETE"])
def delete_soil_record(record_id):
    r = db.session.get(SoilReading, record_id)
    if not r:
        return jsonify({"error": "Not found"}), 404
    db.session.delete(r)
    db.session.commit()
    return jsonify({"deleted": record_id})

@history_bp.route("/api/history/soil/clear", methods=["DELETE"])
def clear_soil_history():
    try:
        count = db.session.query(SoilReading).delete()
        db.session.commit()
        return jsonify({"cleared": count})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

@history_bp.route("/api/history/summary", methods=["GET"])
def get_summary():
    from sqlalchemy import func
    disease_count = db.session.query(func.count(DiseaseHistory.id)).scalar()
    weather_count = db.session.query(func.count(WeatherLog.id)).scalar()
    alert_count   = db.session.query(func.count(AlertLog.id)).scalar()
    unresolved    = db.session.query(func.count(AlertLog.id)).filter_by(resolved=False).scalar()
    top_disease   = db.session.query(
        DiseaseHistory.disease, func.count(DiseaseHistory.id).label("n")
    ).group_by(DiseaseHistory.disease).order_by(func.count(DiseaseHistory.id).desc()).first()
    crop_count = db.session.query(func.count(CropRecommendation.id)).scalar()
    top_crop = db.session.query(
        CropRecommendation.crop, func.count(CropRecommendation.id).label("n")
    ).group_by(CropRecommendation.crop).order_by(func.count(CropRecommendation.id).desc()).first()
    soil_count = db.session.query(func.count(SoilReading.id)).scalar()
    return jsonify({
        "disease_detections":  disease_count,
        "weather_logs":        weather_count,
        "total_alerts":        alert_count,
        "unresolved_alerts":   unresolved,
        "crop_recommendations":crop_count,
        "soil_readings":       soil_count,
        "top_disease":         top_disease[0] if top_disease else None,
        "top_crop":            top_crop[0] if top_crop else None,
    })

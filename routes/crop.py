"""
routes/crop.py
──────────────
Crop Advisor API — loads your trained Logistic Regression model and returns
the top 3 crop recommendations based on soil, climate, and season inputs.
"""

import os
import pickle
import numpy as np
from flask import Blueprint, jsonify, request

crop_bp = Blueprint("crop", __name__)

# ── Load model files on startup ───────────────────────────────────────────────
#
# Place your Rec_Model/ folder next to app.py:
#
#   agrisense/
#   ├── app.py
#   └── Rec_Model/
#       ├── crop_recommendation_model.pkl
#       ├── season_encoder.pkl
#       └── scaler.pkl

MODEL_PATH   = os.path.join("Rec_Models", "crop_recommendation_model.pkl")
ENCODER_PATH = os.path.join("Rec_Models", "season_encoder.pkl")
SCALER_PATH  = os.path.join("Rec_Models", "scaler.pkl")

# Number of top crops to return
TOP_N = 3


def load_pickle(path):
    """Load a .pkl file, or return None with a warning if missing."""
    if not os.path.exists(path):
        print(f"  ⚠️  WARNING: {path} not found.")
        return None
    with open(path, "rb") as f:
        obj = pickle.load(f)
    print(f"  ✅ Loaded: {path}")
    return obj


crop_model     = load_pickle(MODEL_PATH)
season_encoder = load_pickle(ENCODER_PATH)
crop_scaler    = load_pickle(SCALER_PATH)

# ── Crop display info ─────────────────────────────────────────────────────────
#
# Maps each crop label (lowercase) to display info shown in the frontend.
# Add/remove entries to match whatever your model was trained on.

CROP_INFO = {
    "rice":        {"latin": "Oryza sativa",         "icon": "grass",        "reason": "High humidity, warm temperature, and adequate rainfall match rice requirements.",          "tips": ["Maintain flooded conditions during vegetative stage.", "Apply nitrogenous fertilizer in 3 split doses.", "Monitor for brown planthopper and blast disease."]},
    "wheat":       {"latin": "Triticum aestivum",     "icon": "grass",        "reason": "Cool temperatures and moderate rainfall are ideal for wheat cultivation.",                "tips": ["Sow at optimal density (100–125 kg/ha seed rate).", "Irrigate at crown root initiation and heading stages.", "Watch for rust disease in humid conditions."]},
    "maize":       {"latin": "Zea mays",              "icon": "grass",        "reason": "Warm temperatures, moderate humidity, and good rainfall suit maize growth.",              "tips": ["Apply starter fertilizer near the seed at planting.", "Side-dress nitrogen at V6 stage for best yields.", "Ensure good drainage to prevent root rot."]},
    "tomato":      {"latin": "Solanum lycopersicum",  "icon": "spa",          "reason": "Moderate temperature and humidity with good potassium levels support tomatoes.",          "tips": ["Stake or cage plants for support as they grow.", "Use drip irrigation to keep foliage dry.", "Apply calcium to prevent blossom-end rot."]},
    "banana":      {"latin": "Musa spp.",             "icon": "potted_plant", "reason": "High temperature, humidity, and potassium-rich soil create perfect banana conditions.",  "tips": ["Requires high potassium — supplement with potash fertilizer.", "Mulch heavily to retain soil moisture.", "Remove suckers to redirect energy to the main plant."]},
    "chickpea":    {"latin": "Cicer arietinum",       "icon": "grass",        "reason": "Dry conditions and cooler temperatures with low nitrogen match chickpea needs.",          "tips": ["Inoculate seeds with Rhizobium bacteria for nitrogen fixation.", "Avoid waterlogging — chickpea is sensitive to excess moisture.", "Harvest when 90% of pods turn brown."]},
    "cotton":      {"latin": "Gossypium hirsutum",    "icon": "potted_plant", "reason": "Hot dry climate with moderate rainfall suits cotton cultivation.",                        "tips": ["Thin seedlings to 25–30 cm spacing.", "Apply potassium to improve fibre quality.", "Monitor for bollworm and aphid infestations."]},
    "jute":        {"latin": "Corchorus olitorius",   "icon": "grass",        "reason": "High humidity and warm temperature favour jute fibre production.",                        "tips": ["Sow in well-drained loamy soil.", "Retting in clean water improves fibre quality.", "Harvest before flowering for best yield."]},
    "coffee":      {"latin": "Coffea arabica",        "icon": "spa",          "reason": "Mild temperature, high humidity, and acidic soil create ideal coffee conditions.",        "tips": ["Shade-grow for better flavour development.", "Prune annually to maintain bush shape.", "Mulch heavily to retain soil moisture."]},
    "mango":       {"latin": "Mangifera indica",      "icon": "potted_plant", "reason": "Tropical heat, dry winters, and deep soil support mango fruiting.",                      "tips": ["Allow a dry period before flowering to stimulate blooms.", "Thin fruit clusters to improve size.", "Apply micronutrient sprays (Zn, B) at flowering."]},
    "grapes":      {"latin": "Vitis vinifera",        "icon": "spa",          "reason": "Warm dry summers and well-drained soil are perfect for grape cultivation.",               "tips": ["Train vines on a trellis system.", "Prune dormant canes each winter.", "Manage irrigation carefully — stressed vines produce better fruit."]},
    "watermelon":  {"latin": "Citrullus lanatus",     "icon": "spa",          "reason": "High heat, moderate moisture, and sandy loam soil suit watermelon growth.",               "tips": ["Plant on raised beds for drainage.", "Use drip irrigation to keep foliage dry.", "Harvest when the tendril nearest the fruit browns."]},
    "papaya":      {"latin": "Carica papaya",         "icon": "potted_plant", "reason": "Tropical warmth, high humidity, and fertile soil accelerate papaya growth.",              "tips": ["Avoid waterlogging — roots rot easily.", "Apply balanced NPK every 2 weeks.", "Remove male trees once female trees are identified."]},
    "coconut":     {"latin": "Cocos nucifera",        "icon": "potted_plant", "reason": "Sandy coastal soil, high humidity, and warm temperatures favour coconut.",                "tips": ["Space palms 7–10 m apart.", "Apply potassium and magnesium regularly.", "Irrigate during dry spells for consistent yield."]},
    "lentil":      {"latin": "Lens culinaris",        "icon": "grass",        "reason": "Cool dry climate and low nitrogen soil are ideal for lentils.",                           "tips": ["Inoculate with Rhizobium before sowing.", "Avoid heavy clay soils.", "Harvest when lower pods start to rattle."]},
    "blackgram":   {"latin": "Vigna mungo",           "icon": "grass",        "reason": "Warm humid conditions and moderate rainfall suit blackgram.",                             "tips": ["Sow at the start of the monsoon.", "Apply phosphorus at sowing.", "Use short-duration varieties for double cropping."]},
    "mungbean":    {"latin": "Vigna radiata",         "icon": "grass",        "reason": "Warm weather and well-drained loamy soil support mungbean.",                             "tips": ["Sow at 30 cm row spacing.", "Apply rhizobium inoculant.", "Harvest in the morning to prevent pod shattering."]},
    "mothbeans":   {"latin": "Vigna aconitifolia",    "icon": "grass",        "reason": "Very drought-tolerant — thrives in sandy, arid soils.",                                  "tips": ["Grows well without irrigation.", "Fix atmospheric nitrogen — no N fertilizer needed.", "Harvest pods as they mature to prevent losses."]},
    "pigeonpeas":  {"latin": "Cajanus cajan",         "icon": "grass",        "reason": "Semi-arid climate and well-drained soils suit pigeonpeas.",                              "tips": ["Intercrop with cereals for land efficiency.", "Tolerates drought once established.", "Deep taproot improves soil structure."]},
    "kidneybeans": {"latin": "Phaseolus vulgaris",    "icon": "grass",        "reason": "Moderate temperatures and well-drained fertile soil suit kidney beans.",                  "tips": ["Avoid frost — sow after last frost date.", "Do not over-irrigate; beans are drought-tolerant.", "Harvest when pods are dry and crisp."]},
}


def get_crop_info(crop_name):
    """Return display info for a crop. Falls back gracefully for unknown names."""
    key  = crop_name.lower().replace(" ", "")
    info = CROP_INFO.get(key) or next(
        (v for k, v in CROP_INFO.items() if k in key or key in k), None
    )
    return info or {
        "latin":  "—",
        "icon":   "grass",
        "reason": f"Your model determined that {crop_name} best matches the given conditions.",
        "tips":   [
            "Follow standard agronomic practices for this crop.",
            "Consult a local agricultural extension officer for region-specific advice.",
        ],
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@crop_bp.route("/api/seasons")
def api_seasons():
    """
    Returns the season options for the frontend dropdown.
    Reads directly from season_encoder.classes_ so it always matches
    whatever seasons the model was trained on.
    """
    SEASON_ICONS = {
        "autumn": "🍂", "rainy": "🌧️", "spring": "🌸",
        "summer": "☀️", "winter": "❄️", "zaid":   "🌾",
    }
    season_list = (
        list(season_encoder.classes_)
        if season_encoder is not None
        else ["autumn", "rainy", "spring", "summer", "winter", "zaid"]
    )
    return jsonify([
        {"value": s, "label": s.title(), "icon": SEASON_ICONS.get(s, "🌱")}
        for s in season_list
    ])


@crop_bp.route("/api/crop-recommend", methods=["POST"])
def api_crop_recommend():
    """
    Accepts soil, climate, and season inputs. Returns top 3 crop predictions.

    Request JSON:
      { "n": 90, "p": 45, "k": 50, "temp": 28, "humidity": 72,
        "ph": 6.5, "rainfall": 120, "season": "rainy" }

    Response JSON:
      {
        "top_crop":        { rank, crop, confidence, latin, icon, reason, tips },
        "recommendations": [ top 3 crops ],
        "all_scores":      [ all crops ranked by confidence ],
        "season_used":     "rainy"
      }
    """
    if crop_model is None:
        return jsonify({"error": "crop_recommendation_model.pkl not found in Crop_Models/"}), 503
    if season_encoder is None:
        return jsonify({"error": "season_encoder.pkl not found in Crop_Models/"}), 503
    if crop_scaler is None:
        return jsonify({"error": "scaler.pkl not found in Crop_Models/"}), 503

    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body provided"}), 400

    # 1. Parse inputs
    try:
        N           = float(body["n"])
        P           = float(body["p"])
        K           = float(body["k"])
        temperature = float(body["temp"])
        humidity    = float(body["humidity"])
        ph          = float(body["ph"])
        rainfall    = float(body["rainfall"])
        season      = str(body["season"]).strip().lower()
    except (KeyError, ValueError) as e:
        return jsonify({"error": f"Missing or invalid field: {e}"}), 400

    # 2. Encode season using saved LabelEncoder
    if season not in season_encoder.classes_:
        valid = ", ".join(season_encoder.classes_)
        return jsonify({"error": f"Invalid season '{season}'. Valid: {valid}"}), 400

    season_encoded = int(season_encoder.transform([season])[0])

    # 3. Build feature vector — order matches Crop_model.py's X = df.drop('label')
    #    Columns: N, P, K, temperature, humidity, ph, rainfall, season
    features = np.array([[N, P, K, temperature, humidity, ph, rainfall, season_encoded]])

    # 4. Scale
    features_scaled = crop_scaler.transform(features)

    # 5. Predict probabilities
    probabilities = crop_model.predict_proba(features_scaled)[0]
    classes       = crop_model.classes_

    # 6. Build top N recommendations
    top_indices = np.argsort(probabilities)[::-1][:TOP_N]
    recommendations = []
    for rank, i in enumerate(top_indices, start=1):
        name       = classes[i]
        confidence = round(float(probabilities[i]) * 100, 2)
        info       = get_crop_info(name)
        recommendations.append({
            "rank":       rank,
            "crop":       name.title(),
            "confidence": confidence,
            "latin":      info["latin"],
            "icon":       info["icon"],
            "reason":     info["reason"],
            "tips":       info["tips"],
        })

    # 7. Full ranked list for charts
    all_scores = sorted(
        [{"name": str(c), "score": round(float(p) * 100, 2)} for c, p in zip(classes, probabilities)],
        key=lambda x: x["score"], reverse=True,
    )

    top = recommendations[0]

    # ── Save to database ──────────────────────────────────────────────────────
    try:
        import json as _json
        from database import db, CropRecommendation
        source = "sensor" if body.get("from_sensor") else "manual"
        record = CropRecommendation(
            crop        = top["crop"].lower(),
            confidence  = top["confidence"],
            season      = season,
            source      = source,
            nitrogen    = N,
            phosphorus  = P,
            potassium   = K,
            ph          = ph,
            temperature = temperature,
            humidity    = humidity,
            rainfall    = rainfall,
            reason      = top["reason"],
            all_scores  = _json.dumps([
                {"crop": r["crop"], "confidence": r["confidence"]}
                for r in recommendations
            ]),
        )
        db.session.add(record)
        db.session.commit()
    except Exception as db_err:
        import logging
        logging.getLogger(__name__).warning("Crop DB save failed (non-fatal): %s", db_err)

    return jsonify({
        "top_crop":        top,
        "recommendations": recommendations,
        "all_scores":      all_scores,
        "season_used":     season,
    })

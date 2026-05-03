# AgriSense — Complete Project Summary

## What Was Built
**AgriSense** is a Smart Farm Intelligence Dashboard — a locally-hosted Flask web application that integrates IoT soil sensing, AI disease detection, crop recommendation, and weather intelligence into one unified multilingual dashboard.

---

## Architecture
- **Backend:** Python 3.10, Flask Blueprint architecture, SQLite via SQLAlchemy
- **Frontend:** Single-page app — HTML5, Tailwind CSS, Vanilla JavaScript (app.js ~3500+ lines)
- **Hardware:** ESP32 DevKit v1 + 7-in-1 RS485 Soil Sensor + MAX RS485 Module
- **Deployment:** Local-first, offline-capable, runs on `localhost:5000`

---

## Five Core Subsystems

### 1. Soil Monitoring
- ESP32 reads pH, moisture, temperature, N, P, K, conductivity via RS485 Modbus
- `serial_reader.py` daemon bridges USB serial to Flask via HTTP on port 5001
- Two-thread architecture — serial thread + HTTP server thread
- Window-accumulation parser collects all 7 values before storing
- Manual Read Sensor button on dashboard — on-demand, not auto-poll
- Supports both **USB mode** (serial daemon) and **Wi-Fi mode** (ESP32 HTTP push to `/api/soil/ingest` with token authentication)
- `SENSOR_MODE = "usb"` currently active in `routes/soil.py`

### 2. Plant Disease Detection
- Five crops, five different architectures:
  - **Banana** — Keras soft-voting ensemble (LeNet + ResNet50 + InceptionV3), 128×128, 7 classes
  - **Coffee** — PyTorch CLIP ViT (HuggingFace), text-prompt scoring, 5 classes
  - **Corn** — PyTorch ResNet18, ImageNet normalisation, 256×256, 4 classes
  - **Mango** — Keras EfficientNetB7 with L1/L2 regularisation, 224×224, 8 classes
  - **Paddy** — Keras DenseNet121, 256×256, 10 classes
- All models lazy-loaded and cached in memory
- Keras 2→3 compatibility patches implemented
- **Pre-inference image validation** (`validate_image()`):
  - Resolution check (min 80×80)
  - Brightness (20–240)
  - Blur via Laplacian variance (threshold **35** — lowered from 80 after moderate photos were wrongly rejected)
  - Plant colour profile (5 signals: green, yellow, brown, dark-green, red-tinted)
  - Returns HTTP 422 with reason code and actionable hint per rejection type
- **Camera capture** via `getUserMedia` API — live modal with leaf framing guide, flash effect, flip camera button
- Error state fully reset when switching from camera back to file upload (bug fix applied)

### 3. Crop Recommendation
- scikit-learn Logistic Regression — 3 pkl files: `crop_recommendation_model.pkl`, `season_encoder.pkl`, `scaler.pkl`
- Located in `Rec_Models/` — must match `SENSOR_MODE` in `routes/crop.py`
- 8 inputs: N, P, K, Temperature, Humidity, pH, Rainfall, Season
- **Fill from Sensor** button auto-populates 6 fields from latest soil reading
- `from_sensor` flag stored in DB to distinguish sensor vs manual input
- Returns top-3 crops with agronomic reason, growing tips, parameter compatibility chart
- All recommendations saved to `crop_recommendations` table
- Known issue: `_pickle.UnpicklingError: invalid load key, 'v'` — pkl files are corrupted/wrong format. Fix: re-export from training notebook using `pickle.dump()` or switch loader to `joblib.load()`

### 4. Weather Intelligence
- Dual-source: OpenWeatherMap (forecast + AQI) + WeatherAPI (real-time conditions)
- Concurrent fetch, priority merge — OWM leads on forecast, WeatherAPI on current
- **3-day forecast** (changed from 5-day after API trial ended)
- `grid-cols-3` in both Overview and Weather HTML
- Automated farm alerts: Extreme UV (>10), High UV (8–10), Rain probability (>70%), Frost risk (<4°C), High humidity (>85%)
- Location via GPS geolocation or manual city search with autocomplete

### 5. History & Analytics
- **5 tabs** on the History page:
  1. Disease detections
  2. Weather logs
  3. Alerts
  4. Crop Advisor
  5. Soil Readings ← added in last session
- Summary strip shows counts for all 5 categories
- `/api/history/soil` + delete + clear endpoints added to `history.py`
- `SoilReading` imported into `history.py`

---

## Database — 5 SQLAlchemy Tables

| Table | Records |
|---|---|
| `soil_readings` | pH, moisture, temp, N, P, K, EC + timestamp |
| `disease_history` | crop, disease, confidence, severity, action, model metadata |
| `weather_log` | full meteorological parameters per fetch |
| `alerts_log` | type, severity, message, resolved flag |
| `crop_recommendations` | all 8 inputs + crop + confidence + source + alternatives JSON |

---

## Multilingual Support
- 3 languages: English, Malayalam, Hindi
- 354 translation keys each in `en.json`, `ml.json`, `hi.json`
- Dropdown selector in Settings page — persists to localStorage
- `applyTranslations()` walks DOM for `data-i18n`, `data-i18n-placeholder`, `data-i18n-title`
- Dynamic strings (disease action, crop tips) use JSON keys first, LibreTranslate API as fallback
- All alert messages support `{uv}`, `{rain}`, `{temp}`, `{hum}` interpolation

---

## Key Bugs Fixed During Development

| Bug | Fix |
|---|---|
| Selfie photo returning disease prediction | Implemented `validate_image()` with plant colour profile check |
| Moderate quality leaf rejected as blurry | Lowered Laplacian blur threshold from 80 → 35 |
| Theme toggle needed 3 clicks | Removed monkey-patch, unified `s.colourMode` and `s.theme` keys, fixed `applySettings()` conflict |
| Camera error persisting on next upload | `resetDiseaseResult()` now fully resets `className` and clears all error panel elements |
| serial_reader.py not reflecting on dashboard | `SENSOR_MODE` was set to `"wifi"` — switched back to `"usb"` in `routes/soil.py` |
| `_pickle.UnpicklingError` on startup | Pkl files corrupted — needs re-export from training notebook using `pickle.dump()` |
| Conductivity always missing from sensor | Switched to window-accumulation parser — waits for all 7 values |
| Page title not translating on language switch | Fixed `pages` registry to use `titleKey`/`subKey` references |

---

## Files in the Project

```
agrisense/
├── app.py                        # Flask entry, blueprint registration, serial daemon auto-launch
├── database.py                   # 5 SQLAlchemy models
├── serial_reader.py              # USB serial daemon (2 threads)
├── AgriSense_ESP32_WiFi.ino      # Arduino Wi-Fi firmware
├── requirements.txt
├── README.md
├── .gitignore
├── .env.example
├── routes/
│   ├── soil.py                   # SENSOR_MODE="usb", USB+WiFi dual mode
│   ├── weather.py                # Dual API, 3-day forecast
│   ├── disease.py                # ML pipeline, validate_image(), BLUR_THRESHOLD=35
│   ├── crop.py                   # LR model, pkl loading
│   └── history.py                # 5-category history + soil endpoints
├── templates/
│   ├── base.html                 # Sidebar, header, theme toggle
│   └── sections/
│       ├── overview.html         # 4 stat cards, weather, soil status, alerts
│       ├── weather.html          # Full weather page, 3-day forecast
│       ├── soil.html             # Read Sensor button, 7-param display, USB/WiFi badge
│       ├── crops.html            # 8-field form, Fill from Sensor
│       ├── disease.html          # Upload + camera modal, result cards
│       ├── history.html          # 5-tab interface
│       └── settings.html         # Language, theme, units, farm profile
├── static/
│   ├── js/app.js                 # ~3500+ lines, all frontend logic
│   ├── css/
│   │   ├── tailwind.min.css      # Local Tailwind (offline-safe, 30KB)
│   │   └── fonts-local.css       # System font fallbacks for offline mode
│   └── translations/
│       ├── en.json               # 354 keys
│       ├── ml.json               # 354 keys
│       └── hi.json               # 354 keys
└── Disease_Models/
    └── */labels.json             # Label files only (models on HuggingFace)
```

---

## API Endpoints (16 total)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/` | Serve dashboard |
| GET | `/api/weather` | Dual-source weather fetch |
| GET | `/api/weather/search` | Location autocomplete |
| POST | `/api/soil/read` | Read sensor (USB) or get latest (WiFi) |
| POST | `/api/soil/ingest` | ESP32 Wi-Fi push endpoint |
| GET | `/api/soil/latest` | Latest soil reading |
| GET | `/api/soil/history` | Paginated soil readings |
| DELETE | `/api/soil/clear` | Clear soil log |
| GET | `/api/soil/mode` | Returns "usb" or "wifi" |
| POST | `/api/disease/analyze` | Run disease inference |
| GET | `/api/disease/crops` | Model status per crop |
| POST | `/api/crop-recommend` | Crop recommendation |
| GET | `/api/history/soil,disease,weather,alerts,crop` | Per-category history |
| DELETE | `/api/history/*/clear` | Clear category |
| GET | `/api/history/summary` | 5-category counts |
| GET | `/api/seasons` | Available seasons |

---

## Hardware Setup

```
Soil Sensor (12V) → MAX RS485 (A/B lines) → ESP32 GPIO16/17/4 → USB → PC
                                                                  ↓ Wi-Fi (optional)
                                                             Flask :5000
```

- DE/RE pin (GPIO4) controls RS485 bus direction
- CP2102/CH340 chip creates virtual COM port (COM5 on Windows)
- `serial_reader.py` auto-launched by `app.py` on startup (USB mode)
- Flask binds to `0.0.0.0:5000` for Wi-Fi accessibility

---

## Documents Generated

1. `AgriSense_Abstract.docx` — Project abstract (9 sections)
2. `AgriSense_ProposedSystem.docx` — Three-layer architecture document
3. `AgriSense_DetailedProposedSystem.docx` — 515-paragraph detailed system
4. `AgriSense_ImplementationSteps.docx` — 11-phase implementation guide
5. `AgriSense_Testing.docx` — 924-paragraph 5-level testing document
6. `AgriSense_Final.zip` — Complete project download

---

## Pending / Known Issues

1. **pkl files corrupted** — `crop_recommendation_model.pkl` fails with `UnpicklingError`. Re-export from training notebook using `pickle.dump()`
2. **History tab order** — Currently: Disease → Weather → Alerts → Crop → Soil. Rename and reorder pending (last request in conversation)
3. **Tailwind offline** — Local `tailwind.min.css` deployed but `base.html` CDN tags still need manual replacement (instructions provided)
4. **Model training accuracies** — Blank cells left in `AgriSense_Testing.docx` for Banana and Corn accuracy scores — need to be filled in manually

---

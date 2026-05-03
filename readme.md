# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

```bash
pip install -r requirements.txt     # ~2-4GB download, requires 8GB RAM minimum
python app.py                       # Starts Flask on http://localhost:5000 + serial daemon
```

**Important context:**
- Flask runs with `debug=True`, so hot reload is enabled — changes to `routes/` or `app.py` restart the server automatically
- If `SENSOR_MODE = "usb"` in `routes/soil.py`, a serial daemon subprocess is spawned automatically (connects to ESP32 on configured port)
- Database auto-creates at `instance/agrisense.db` on first run

**Manual serial port testing (if needed):**
```bash
python serial_reader.py --list                           # List available COM ports
python serial_reader.py --port COM5 --baud 9600         # Windows
python serial_reader.py --port /dev/ttyUSB0 --baud 9600 # Linux
```

## Architecture Overview
Agrisense is a **3-layer full-stack application**:

### Layer 1: Backend (Flask Microservices)
Located in `routes/`, implemented as Flask blueprints:
- **soil.py** — Soil sensor API (reads from USB serial daemon or accepts Wi-Fi POST from ESP32)
- **weather.py** — Dual-source weather (OpenWeatherMap + WeatherAPI, parallel fetching, merged response)
- **disease.py** — Per-crop disease detection inference pipeline (5 crops with independent ML models)
- **crop.py** — Crop recommendation engine using scikit-learn Logistic Regression
- **history.py** — History/analytics (queryable logs for disease, weather, crops, alerts)

Routes auto-register via blueprint pattern, no explicit routing config needed.

### Layer 2: Frontend (Single-Page App)
- **base.html** — Main HTML shell with sidebar navigation (7 dashboard pages)
- **app.js** (3,134 lines) — Unified JavaScript engine handling:
  - Page routing (`showPage()` function, no backend templating)
  - API calls to Flask backend
  - State management (cached weather, polling soil data)
  - Image upload + disease detection workflow
  - Crop recommendation UI
  - i18n translation system (`t()` function)
- **translations/** — JSON-based i18n (en.json, ml.json, hi.json, 347 keys each)
- **css/** — Tailwind CSS (minified locally) + Material Icons

### Layer 3: Database (SQLAlchemy ORM + SQLite)
Auto-created `instance/agrisense.db` with 5 tables:
- `disease_history` — Plant disease detections (crop, confidence, severity, image URL)
- `weather_log` — Historical weather data from both APIs
- `alerts_log` — Weather + disease alerts (threshold-triggered, soft-deleted when resolved)
- `soil_readings` — NPK, pH, moisture, temperature, conductivity (tagged by timestamp, sensor mode)
- `crop_recommendations` — Recommended crops with input parameters

### Hardware Layer
- **USB mode** (default): Serial daemon (`serial_reader.py`) runs as separate subprocess, listens on ESP32 USB, exposes HTTP endpoint on port 5001 (`/latest`). Flask polls this endpoint every N seconds.
- **Wi-Fi mode** (optional): ESP32 directly POST-requests soil data to Flask `POST /api/soil/ingest`. No daemon launched.
- **Configuration**: Mode set in `routes/soil.py` (`SENSOR_MODE = "usb"` or `"wifi"`). Port set in `app.py` (`SENSOR_PORT`).

### ML Models Layer
5 independent per-crop disease detection pipelines in `Disease_Models/<crop>/`:
- **Banana** — Soft-voting ensemble: 3 Keras models (LeNet, ResNet50, InceptionV3) average probabilities
- **Coffee** — PyTorch ViT (Vision Transformer, CLIP-based)
- **Corn** — PyTorch ResNet18
- **Mango** — Keras EfficientNetB7
- **Paddy** — Keras DenseNet121

Models cached in `_cache` dict after first load to avoid reload overhead. Each crop has independent `predict_<crop>.py` script with its own image preprocessing & label mapping.

## Key Architectural Patterns

### 1. Sensor Dual-Mode Architecture
**USB mode** (serial daemon):
```
ESP32 (USB) → serial_reader.py (separate process) → HTTP server on :5001 (/latest endpoint)
                                                              ↑
                                                    Flask polls every N sec
```
Why separate process? Graceful handling of sensor disconnects without blocking Flask.

**Wi-Fi mode** (direct HTTP):
```
ESP32 (Wi-Fi) → POST /api/soil/ingest → Flask directly writes to DB
```
No daemon. Set `INGEST_TOKEN` in ESP32 firmware for authentication.

### 2. ML Model Caching
Models are loaded once and stored in `_cache` dict in `routes/disease.py`. Subsequent requests reuse cached instances. This avoids TensorFlow/PyTorch initialization overhead on each inference request. Cache keys are crop names.

### 3. Parallel Weather API Integration
`routes/weather.py` uses `ThreadPoolExecutor` to call OpenWeatherMap and WeatherAPI **simultaneously** (not sequentially). Each API provides different data:
- **OpenWeatherMap** — Core weather (temp, humidity, condition)
- **WeatherAPI** — Supplemental (UV index, AQI, rain probability, hourly forecast)

Results merged into single JSON response. If one API fails, response includes partial data from the working API.

### 4. Per-Crop Model Modularity
Each crop is entirely independent:
- Own model architecture (Keras vs PyTorch, different sizes)
- Own `predict_<crop>.py` script with image preprocessing
- Own `labels.json` file mapping class indices to disease names
- Route `/api/disease/predict/<crop>` auto-generated

Adding a new crop doesn't require code changes outside `Disease_Models/<crop>/` and brief registration in `routes/disease.py`.

### 5. i18n (Internationalization)
Translation keys stored in JSON files (`static/translations/<lang>.json`). Frontend calls `t(key)` function to interpolate. 347 keys cover all UI strings. Language selected via dropdown in settings page, persisted to localStorage.

### 6. No Tests or Linting
Project has no pytest/unittest files or linting configuration (black, flake8, etc.). This is a pure Flask dev setup. When adding code, follow existing style conventions (Snake_case for functions, docstrings for APIs).

## Configuration Before Running

**See README.md for detailed installation steps.** Key configurations:

1. **API Keys** (`routes/weather.py`):
   ```python
   OWM_API_KEY  = "your_openweathermap_key"
   WAPI_API_KEY = "your_weatherapi_key"
   ```

2. **Sensor Mode** (`routes/soil.py`):
   ```python
   SENSOR_MODE = "usb"   # USB serial cable (default)
   # or
   SENSOR_MODE = "wifi"  # ESP32 Wi-Fi push mode
   ```

3. **Serial Port** (`app.py`, USB mode only):
   ```python
   SENSOR_PORT = "COM5"           # Windows
   # or
   SENSOR_PORT = "/dev/ttyUSB0"   # Linux
   ```

4. **Model Files**: Download from HuggingFace (see README) → place in `Disease_Models/<crop>/`

5. **Crop Recommendation Models**: Place `.pkl` files in `Rec_Models/`

## Common Development Tasks

### Adding a New Crop Disease Model
1. Create `Disease_Models/<crop>/` directory
2. Add `labels.json` (mapping class indices to disease names)
3. Add `predict_<crop>.py` with inference function signature:
   ```python
   def predict(image_path: str) -> dict:
       # Return {"disease": str, "confidence": float, "severity": str}
   ```
4. Download model weights (.h5 or .pt) into same directory
5. Register in `routes/disease.py` (add to `SUPPORTED_CROPS` list)
6. Flask auto-discovers route `/api/disease/predict/<crop>`

### Debugging the Serial Daemon
- Check if daemon started: `SENSOR_MODE = "usb"` in `routes/soil.py`?
- Check if port configured: `SENSOR_PORT` in `app.py`?
- Test manually: `python serial_reader.py --port COM5` (should print received data)
- Flask endpoint: `GET /api/soil/latest` should return latest reading (empty if daemon not sending)
- Logs: Check Flask console for serial errors

### Adding a New Frontend Page
1. Create `templates/sections/<page>.html` (template fragment)
2. Add page button/nav item in `templates/base.html`
3. Add page route in `static/js/app.js` (`showPage()` function)
4. Add translation keys in `static/translations/<lang>.json`
5. Flask serves via `base.html` (single entry point), JavaScript switches content

## Development Workflow

- **Hot reload enabled** — Changes to `routes/`, `database.py`, `app.py` automatically restart server
- **Frontend changes** (JS/CSS) take effect on page refresh (no server restart needed)
- **CORS enabled** (all origins) — Useful for local development, consider restricting in production
- **Check browser console** for frontend errors (API failures, JS exceptions, translation missing keys)
- **DevTools Network tab** — Debug API calls, inspect request/response payloads
- **Database queries** — Use SQLAlchemy directly in routes, no query builder needed

## File Structure Reference

```
agrisense/
├── app.py                      # Flask app + serial daemon launcher
├── database.py                 # SQLAlchemy models
├── serial_reader.py            # USB serial daemon (separate process)
├── requirements.txt
├── routes/
│   ├── soil.py                 # Sensor API (USB/Wi-Fi modes)
│   ├── weather.py              # Dual weather API (parallel fetching)
│   ├── disease.py              # Disease detection (per-crop models)
│   ├── crop.py                 # Crop recommendation
│   ├── history.py              # History/analytics
│   └── __init__.py
├── templates/
│   ├── base.html               # Main shell + sidebar
│   └── sections/               # 7 page templates
├── static/
│   ├── js/app.js               # Frontend SPA engine (3,134 lines)
│   ├── css/                    # Tailwind (minified)
│   └── translations/           # i18n JSON files (EN/ML/HI)
├── Disease_Models/
│   ├── banana/                 # 3 ensemble models + labels
│   ├── coffee/                 # PyTorch ViT + labels
│   ├── corn/                   # PyTorch ResNet18 + labels
│   ├── mango/                  # Keras EfficientNetB7 + labels
│   └── paddy/                  # Keras DenseNet121 + labels
├── Rec_Models/                 # Crop recommendation .pkl files
├── instance/                   # Runtime dir (auto-created)
└── uploads/                    # User-uploaded images
```

## Useful API Endpoints (for frontend development)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/soil/read` | POST | Trigger sensor read (USB mode) |
| `/api/soil/latest` | GET | Latest sensor reading |
| `/api/soil/history` | GET | Paginated soil readings |
| `/api/weather` | GET | Current + 3-day forecast (merged) |
| `/api/disease/predict/<crop>` | POST | Upload image → disease detection |
| `/api/crop/recommend` | POST | Soil/climate params → crop recommendation |
| `/api/history/disease` | GET | Disease detection history |
| `/api/history/weather` | GET | Weather log |
| `/api/history/crop` | GET | Crop recommendations log |
| `/api/history/alerts` | GET | Alert logs (disease + weather) |

## Production Notes

- CORS enabled for all origins — restrict to specific domains in production
- No authentication layer — suitable for local farm network, add auth if exposing externally
- Serial daemon spawns as subprocess — ensure proper cleanup if deploying as systemd service
- Model files (~500MB total) — consider offloading to remote storage or containerizing
- Database file unencrypted — use proper filesystem permissions or encrypt in production

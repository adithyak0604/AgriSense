# 🌾 AgriSense — Smart Farm Intelligence Dashboard

AgriSense is an intelligent agricultural platform that combines **crop disease detection**, **soil monitoring**, **weather insights**, and **crop recommendations** to help farmers make data-driven decisions. Powered by deep learning models and real-time sensor data, it provides actionable intelligence for modern farming.

---

## ✨ Features

### 🦠 **Disease Detection**
- **Multi-crop support**: Banana, Coffee, Corn, Mango, Paddy
- **Deep learning models**: ResNet, EfficientNet, DenseNet, CLIP ViT
- **Image-based diagnosis**: Upload plant photos for instant disease identification
- **Confidence scoring**: Probabilistic disease predictions

### 🌱 **Soil Monitoring**
- **Real-time sensor data**: Temperature, humidity, pH, nutrient levels
- **Dual connectivity**:
  - **USB mode**: ESP32 connected via serial (COM ports on Windows, `/dev/ttyUSB*` on Linux)
  - **Wi-Fi mode**: Direct ESP32 HTTP push to the dashboard
- **Historical trends**: Track soil conditions over time

### 🌤️ **Weather Integration**
- **Live weather data**: Temperature, precipitation, humidity from OpenWeatherMap
- **Disease risk scoring**: Weather-based pathogen risk assessment
- **Forecast insights**: 5-day forecast for crop planning

### 🌾 **Crop Recommendations**
- **ML-based suggestions**: scikit-learn models recommend optimal crops
- **Contextual analysis**: Based on soil, weather, and farm history
- **Seasonal planning**: Year-round crop rotation insights

### 📊 **Data Persistence**
- **SQLite database**: Lightweight, file-based storage (`agrisense.db`)
- **Historical records**: Track all predictions, sensor readings, and recommendations
- **Analytics dashboard**: View trends over days, weeks, months

---

## 🚀 Quick Start

### **Prerequisites**
- **Python 3.10** (64-bit) — *TensorFlow doesn't support 32-bit Python*
- **8 GB RAM minimum** (16 GB recommended)
- **Stable internet** (large models: ~2–4 GB download)

### **Installation**

1. **Clone or navigate to the project:**
   ```bash
   cd d:/Installer/Project/Agrisense
   ```

2. **Create a virtual environment (optional but recommended):**
   ```bash
   python -m venv venv
   # Windows:
   venv\Scripts\activate
   # Linux/Mac:
   source venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
   *First install takes 10–20 minutes due to TensorFlow/PyTorch downloads.*

4. **Configure the sensor (optional):**
   - Edit `app.py` and set your ESP32 serial port:
     ```python
     SENSOR_PORT = "COM5"      # Windows
     # or
     SENSOR_PORT = "/dev/ttyUSB0"  # Linux
     ```
   - Leave blank to skip sensor auto-launch

5. **Run the application:**
   ```bash
   python app.py
   ```

6. **Open in browser:**
   - Local: `http://localhost:5000`
   - Network: `http://<your-machine-ip>:5000` (e.g., `http://192.168.1.100:5000`)

---

## 📁 Project Structure
```
agrisense/
├── app.py                   # Flask app entry point, sensor daemon launcher
├── database.py              # SQLAlchemy models and ORM setup
├── serial_reader.py         # ESP32 USB serial listener (auto-launched)
├── requirements.txt         # Python dependencies
│
├── routes/                  # API blueprints & endpoints
│   ├── disease.py          # Disease detection & model inference
│   ├── soil.py             # Sensor data ingestion & querying
│   ├── weather.py          # OpenWeatherMap integration
│   ├── crop.py             # Recommendation engine
│   ├── history.py          # Historical data retrieval
│   └── overview.py         # Dashboard summary stats
│
├── Disease_Models/         # Pre-trained disease detection models
│   ├── banana/             # LeNet + ResNet50 + InceptionV3
│   ├── coffee/             # CLIP ViT (vision-language model)
│   ├── corn/               # ResNet18
│   ├── mango/              # EfficientNetB7
│   └── paddy/              # DenseNet121
│
├── Rec_Models/             # Crop recommendation ML models
│   └── model_dwnld.py      # Scikit-learn model management
│
├── templates/              # HTML pages
│   ├── base.html           # Main UI shell
│   └── sections/           # Component templates
│
├── static/                 # Frontend assets
│   ├── css/                # Stylesheets
│   ├── js/                 # JavaScript & React components
│   ├── fonts/              # Custom fonts
│   └── translations/       # i18n strings
│
└── instance/               # Runtime state (created on first run)
    └── agrisense.db        # SQLite database
```

---

## 🛠️ API Endpoints

### **Disease Detection**
- `POST /api/disease/predict` — Analyze uploaded plant image
  - Body: `{ "crop": "banana", "image": <binary> }`
  - Returns: `{ "disease": "...", "confidence": 0.95, "remedies": [...] }`

### **Soil Monitoring**
- `GET /api/soil/latest` — Current soil sensor readings
- `POST /api/soil/ingest` — Ingest ESP32 sensor data (Wi-Fi mode)
- `GET /api/soil/history?days=7` — Historical sensor trends

### **Weather**
- `GET /api/weather/current` — Live weather conditions
- `GET /api/weather/forecast` — 5-day forecast

### **Recommendations**
- `GET /api/crop/recommend` — Get crop recommendations
  - Params: `soil_ph`, `soil_moisture`, `temperature`

### **History**
- `GET /api/history/predictions` — All past disease predictions
- `GET /api/history/sensor` — All past soil readings

---

## ⚙️ Configuration

### **Sensor Modes**
Edit `routes/soil.py`:
```python
SENSOR_MODE = "usb"   # Serial connection (default)
SENSOR_MODE = "wifi"  # ESP32 pushes data over HTTP
```

### **Weather API**
Add your OpenWeatherMap API key in `routes/weather.py`:
```python
OPENWEATHER_API_KEY = "your_key_here"
```
Add your WeatherAPI key in `routes/weather.py`:
```python
WEATHER_API_KEY = "your_key_here"
```


### **Database**
- Automatically created as `instance/agrisense.db` (SQLite)
- Location is configurable in `database.py`

---

## 🧠 Disease Detection Models

| Crop      | Model Architecture        | Input Size | Framework    |
|-----------|---------------------------|------------|-------------|
| **Banana**  | LeNet + ResNet50 + InceptionV3 | 224×224    | TensorFlow  |
| **Coffee**  | CLIP ViT (vision-language)    | 224×224    | PyTorch     |
| **Corn**    | ResNet18                      | 224×224    | PyTorch     |
| **Mango**   | EfficientNetB7                | 280×280    | TensorFlow  |
| **Paddy**   | DenseNet121                   | 224×224    | TensorFlow  |

Models are auto-downloaded on first use (see `Disease_Models/*/model_dwnld.py`).

---

## 📡 Sensor Integration

### **USB Mode (Serial)**
1. Connect ESP32 to PC via USB-C
2. Identify COM port (Windows) or `/dev/ttyUSB*` (Linux)
3. Set `SENSOR_PORT` in `app.py`
4. Run `python app.py` — sensor daemon auto-launches
5. Data available at `http://localhost:5001/latest` or via Flask API

### **Wi-Fi Mode**
1. Configure ESP32 to push JSON to `http://<machine-ip>:5000/api/soil/ingest`
2. Set `SENSOR_MODE = "wifi"` in `routes/soil.py`
3. No serial daemon needed

---

## 🔧 Troubleshooting

### **TensorFlow Installation Issues**
- Ensure Python 3.10 64-bit: `python -c "import struct; print(struct.calcsize('P') * 8)"`
- On Windows, may need Visual C++ redistributable
- Try: `pip install --upgrade tensorflow`

### **Sensor Not Connecting**
- Verify COM port: `python -m serial.tools.list_ports`
- Check baud rate matches ESP32 config (default: 9600)
- Try manual mode: comment `SENSOR_PORT` and run `python serial_reader.py --port COM5 --baud 9600`

### **Models Not Downloading**
- Check internet connection (models are 500 MB–2 GB each)
- Clear cache: `rm -rf .cache/`
- Manual download: see `Disease_Models/*/model_dwnld.py`

### **Port Already in Use**
- Change Flask port in `app.py`: `app.run(..., port=5001)`
- Kill existing process: `lsof -i :5000` (Linux/Mac) or `netstat -ano | findstr :5000` (Windows)

---

## 📦 Dependencies Summary

| Category | Key Packages |
|----------|-------------|
| **Web** | Flask, Flask-CORS, Flask-SQLAlchemy |
| **Database** | SQLAlchemy, SQLite3 (bundled) |
| **ML** | TensorFlow 2.12+, PyTorch 2.0+, scikit-learn |
| **Vision** | Pillow, transformers (CLIP processor) |
| **Sensors** | pyserial, requests |
| **Utils** | numpy |

See `requirements.txt` for full details and version constraints.

---

## 🚀 Development

### **Adding a New Crop Model**
1. Create `Disease_Models/your_crop/`
2. Add `model_dwnld.py` (model fetching logic)
3. Add `predict_your_crop.py` (inference wrapper)
4. Add `your_crop_labels.json` (disease class names)
5. Register in `routes/disease.py`

### **Extending APIs**
1. Create new blueprint in `routes/new_feature.py`
2. Register in `app.py`: `app.register_blueprint(new_feature_bp)`
3. Access at `/api/new_feature/...`

### **Frontend Changes**
- Edit `templates/` and `static/js/`
- No build step required — Flask serves static files directly
- Hot-reload enabled in debug mode

---

## 📊 Database Schema

Key tables in SQLite:
- **Predictions**: `(id, crop, disease, confidence, image_path, timestamp)`
- **SensorReadings**: `(id, temperature, humidity, ph, moisture, timestamp)`
- **WeatherSnapshots**: `(id, temp, humidity, rainfall, timestamp)`
- **Recommendations**: `(id, crop, reason, timestamp)`

---

## 🔐 Security Notes

- Database stored locally (`instance/agrisense.db`) — no cloud sync
- API keys (Weather) — store in environment variables or `config.py` (not in git)
- CORS enabled for localhost only (edit `app.py` to restrict)
- No authentication layer by default — add if exposing to internet

---

## 📝 License

[Add your license here]

---

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repo
2. Create a feature branch
3. Submit a pull request with clear commit messages

---

## ❓ Support & Feedback

- **Issues**: Check GitHub issues or create a new one
- **Docs**: See inline comments in source files
- **Contact**: <adithyakrishnatk0604@gmail.com>   

---

**Happy farming! 🌾** — AgriSense Team

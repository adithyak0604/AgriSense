"""
routes/weather.py
─────────────────
Combined weather using OpenWeatherMap + WeatherAPI.com
Both APIs are called in parallel using concurrent.futures.
Data is merged — each API contributes what it does best.

🔑 PASTE YOUR KEYS BELOW:
"""

import requests
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Blueprint, jsonify, request

weather_bp = Blueprint("weather", __name__)

# ── API Keys ───────────────────────────────────────────────────────────────────
OWM_API_KEY     = ""       # ← OpenWeatherMap key (openweathermap.org)
WAPI_API_KEY    = ""      # ← WeatherAPI key (weatherapi.com)

OWM_BASE        = "https://api.openweathermap.org/data/2.5"
WAPI_BASE       = "https://api.weatherapi.com/v1"

ICON_MAP = {
    "sunny": "wb_sunny", "clear": "wb_sunny", "partly cloudy": "partly_cloudy_day",
    "cloudy": "cloud", "overcast": "cloud", "rain": "rainy", "drizzle": "rainy",
    "shower": "rainy", "thunder": "thunderstorm", "snow": "ac_unit",
    "sleet": "ac_unit", "fog": "foggy", "mist": "foggy", "haze": "foggy",
}

OWM_ICON_MAP = {
    "01": "wb_sunny", "02": "partly_cloudy_day", "03": "cloud", "04": "cloud",
    "09": "rainy", "10": "rainy", "11": "thunderstorm", "13": "ac_unit", "50": "foggy",
}

EPA_LABELS = {
    1: "Good", 2: "Moderate", 3: "Unhealthy (Sensitive)",
    4: "Unhealthy", 5: "Very Unhealthy", 6: "Hazardous",
}

def get_icon_from_text(text):
    t = (text or "").lower()
    for kw, icon in ICON_MAP.items():
        if kw in t:
            return icon
    return "cloud"

def get_icon_from_owm(icon_code):
    prefix = icon_code[:2] if icon_code else "03"
    return OWM_ICON_MAP.get(prefix, "cloud")


# ── OpenWeatherMap calls ───────────────────────────────────────────────────────

def owm_by_coords(lat, lon):
    resp = requests.get(f"{OWM_BASE}/weather",
        params={"lat": lat, "lon": lon, "appid": OWM_API_KEY, "units": "metric"},
        timeout=8)
    resp.raise_for_status()
    return resp.json()

def owm_by_city(city):
    resp = requests.get(f"{OWM_BASE}/weather",
        params={"q": city, "appid": OWM_API_KEY, "units": "metric"},
        timeout=8)
    resp.raise_for_status()
    return resp.json()

def owm_forecast(lat, lon):
    resp = requests.get(f"{OWM_BASE}/forecast",
        params={"lat": lat, "lon": lon, "appid": OWM_API_KEY, "units": "metric"},
        timeout=8)
    resp.raise_for_status()
    return resp.json()


# ── WeatherAPI calls ───────────────────────────────────────────────────────────

def wapi_forecast(location, days=3):
    resp = requests.get(f"{WAPI_BASE}/forecast.json",
        params={"key": WAPI_API_KEY, "q": location, "days": days, "aqi": "yes"},
        timeout=8)
    resp.raise_for_status()
    return resp.json()

def wapi_search(q):
    resp = requests.get(f"{WAPI_BASE}/search.json",
        params={"key": WAPI_API_KEY, "q": q},
        timeout=5)
    resp.raise_for_status()
    return resp.json()


# ── Merge logic ────────────────────────────────────────────────────────────────

def merge_weather(owm_current, owm_fcst, wapi_data) -> dict:
    """
    OWM contributes: temperature, pressure, visibility, wind, humidity, condition
    WeatherAPI contributes: UV index, AQI, rain chance, hourly, sunrise/sunset
    """
    ow = owm_current
    wc = wapi_data.get("current", {})
    wl = wapi_data.get("location", {})

    location_name = (
        ow.get("name", "") + ", " + ow.get("sys", {}).get("country", "")
    )

    # ── Current (OWM primary, WAPI fills gaps) ────────────────────────────────
    current = {
        "location":      location_name,
        "local_time":    wl.get("localtime", datetime.now().strftime("%Y-%m-%d %H:%M")),
        # OWM fields
        "temperature":   round(ow["main"]["temp"], 1),
        "feels_like":    round(ow["main"]["feels_like"], 1),
        "humidity":      ow["main"]["humidity"],
        "pressure":      ow["main"]["pressure"],
        "visibility":    round(ow.get("visibility", 0) / 1000, 1),
        "cloud_cover":   ow.get("clouds", {}).get("all", "--"),
        "wind_speed":    round(ow.get("wind", {}).get("speed", 0) * 3.6, 1),  # m/s → km/h
        "wind_dir":      ow.get("wind", {}).get("deg", "--"),
        "wind_gust":     round(ow.get("wind", {}).get("gust", 0) * 3.6, 1),
        "precipitation": ow.get("rain", {}).get("1h", 0),
        "condition":     ow.get("weather", [{}])[0].get("description", "--").title(),
        "icon":          get_icon_from_owm(ow.get("weather", [{}])[0].get("icon", "03d")),
        "is_day":        wc.get("is_day", 1),
        # WeatherAPI fills these (not free on OWM)
        "uv_index":      wc.get("uv", "--"),
        "aqi": {
            "pm2_5":  round(wc.get("air_quality", {}).get("pm2_5", 0), 1),
            "pm10":   round(wc.get("air_quality", {}).get("pm10",  0), 1),
            "no2":    round(wc.get("air_quality", {}).get("no2",   0), 1),
            "o3":     round(wc.get("air_quality", {}).get("o3",    0), 1),
            "us_epa": wc.get("air_quality", {}).get("us-epa-index", "--"),
            "label":  EPA_LABELS.get(wc.get("air_quality", {}).get("us-epa-index"), "--"),
        },
        # Source attribution
        "sources": ["OpenWeatherMap", "WeatherAPI"],
    }

    # ── 3-Day forecast (OWM 3hr → daily aggregation + WAPI rain chance) ───────
    # OWM gives 3-hour slots; we group by date for daily summary
    days_short = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    owm_by_date = {}
    for slot in owm_fcst.get("list", []):
        date = slot["dt_txt"][:10]
        owm_by_date.setdefault(date, []).append(slot)

    # WAPI forecast keyed by date for rain_chance / sunrise
    wapi_days = {d["date"]: d for d in wapi_data.get("forecast", {}).get("forecastday", [])}

    forecast = []
    for i, (date, slots) in enumerate(list(owm_by_date.items())[:3]):
        temps   = [s["main"]["temp"] for s in slots]
        icons   = [s["weather"][0]["icon"] for s in slots]
        desc    = slots[len(slots)//2]["weather"][0]["description"].title()
        wd      = wapi_days.get(date, {})
        wdd     = wd.get("day", {})
        astro   = wd.get("astro", {})
        try:
            weekday = days_short[datetime.strptime(date, "%Y-%m-%d").weekday()]
        except Exception:
            weekday = "--"
        forecast.append({
            "day":         "Today" if i == 0 else weekday,
            "date":        date,
            "high":        round(max(temps), 1),
            "low":         round(min(temps), 1),
            "humidity":    round(sum(s["main"]["humidity"] for s in slots) / len(slots)),
            "condition":   desc,
            "icon":        get_icon_from_owm(icons[len(icons)//2]),
            # WAPI fills rain chance and sunrise (not in OWM free)
            "rain_chance": wdd.get("daily_chance_of_rain", "--"),
            "rain_mm":     wdd.get("totalprecip_mm", "--"),
            "uv_index":    wdd.get("uv", "--"),
            "wind_max":    wdd.get("maxwind_kph", "--"),
            "sunrise":     astro.get("sunrise", "--"),
            "sunset":      astro.get("sunset", "--"),
        })

    # ── Hourly for today (WeatherAPI — has rain chance per hour) ──────────────
    history = []
    today_hours = wapi_data.get("forecast", {}).get("forecastday", [{}])[0].get("hour", [])
    for hour in today_hours:
        history.append({
            "time":        hour.get("time", "")[-5:],
            "temp":        hour.get("temp_c", 0),
            "rain":        hour.get("precip_mm", 0),
            "humidity":    hour.get("humidity", 0),
            "rain_chance": hour.get("chance_of_rain", 0),
        })

    return {"current": current, "forecast": forecast, "history": history}


# ── Routes ────────────────────────────────────────────────────────────────────

def _check_keys():
    missing = []
    if OWM_API_KEY  == "YOUR_OWM_KEY_HERE":  missing.append("OpenWeatherMap")
    if WAPI_API_KEY == "YOUR_WAPI_KEY_HERE": missing.append("WeatherAPI")
    return missing


@weather_bp.route("/api/weather")
def api_weather():
    """
    GET /api/weather?location=Kochi
    GET /api/weather?lat=9.93&lon=76.26   (from browser geolocation)
    Fetches both APIs in parallel and merges results.
    """
    missing = _check_keys()
    if missing:
        return jsonify({"error": f"API keys not set for: {', '.join(missing)}. Open routes/weather.py."}), 503

    lat  = request.args.get("lat", "").strip()
    lon  = request.args.get("lon", "").strip()
    city = request.args.get("location", "").strip()

    if not city and not (lat and lon):
        return jsonify({"error": "Provide ?location=CityName or ?lat=X&lon=Y"}), 400

    # Determine OWM query params
    if lat and lon:
        wapi_query  = f"{lat},{lon}"
        owm_current_fn = lambda: owm_by_coords(lat, lon)
    else:
        wapi_query  = city
        owm_current_fn = lambda: owm_by_city(city)

    try:
        # Fetch OWM current first to get coords for the forecast call
        owm_cur = owm_current_fn()
        clat = owm_cur["coord"]["lat"]
        clon = owm_cur["coord"]["lon"]

        # Now fetch OWM forecast + WAPI in parallel
        with ThreadPoolExecutor(max_workers=2) as pool:
            f_owm_fcst = pool.submit(owm_forecast, clat, clon)
            f_wapi     = pool.submit(wapi_forecast, wapi_query)
            owm_fcst   = f_owm_fcst.result(timeout=10)
            wapi_data  = f_wapi.result(timeout=10)

        merged = merge_weather(owm_cur, owm_fcst, wapi_data)

        # ── Log to database (non-fatal) ───────────────────────────────────────
        try:
            from database import db, WeatherLog

            def _num(val, fallback=None):
                """Safely convert to float — returns fallback if value is
                None, '--', or any non-numeric string."""
                try:
                    return float(val) if val not in (None, "--", "") else fallback
                except (TypeError, ValueError):
                    return fallback

            cur = merged.get("current", {})
            record = WeatherLog(
                location  = cur.get("location") or None,
                temp_c    = _num(cur.get("temperature")),
                feels_c   = _num(cur.get("feels_like")),
                humidity  = _num(cur.get("humidity")),
                wind_kmh  = _num(cur.get("wind_speed")),
                precip_mm = _num(cur.get("precipitation"), 0.0),
                pressure  = _num(cur.get("pressure")),
                uv        = _num(cur.get("uv_index")),
                condition = cur.get("condition") or None,
            )
            db.session.add(record)
            db.session.commit()
        except Exception:
            pass

        return jsonify(merged)

    except requests.exceptions.HTTPError as e:
        code = e.response.status_code
        if code == 401: return jsonify({"error": "Invalid API key — check routes/weather.py."}), 401
        if code == 404: return jsonify({"error": f"Location not found: '{city}'."}), 404
        return jsonify({"error": f"API error {code}"}), code
    except requests.exceptions.ConnectionError:
        return jsonify({"error": "Cannot reach weather APIs. Check internet connection."}), 503
    except requests.exceptions.Timeout:
        return jsonify({"error": "Request timed out. Try again."}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@weather_bp.route("/api/weather/search")
def api_weather_search():
    """GET /api/weather/search?q=koc — city autocomplete via WeatherAPI."""
    q = request.args.get("q", "").strip()
    if len(q) < 2 or WAPI_API_KEY == "YOUR_WAPI_KEY_HERE":
        return jsonify([])
    try:
        results = wapi_search(q)
        return jsonify([
            {"name": r["name"], "region": r["region"], "country": r["country"]}
            for r in results
        ])
    except Exception:
        return jsonify([])

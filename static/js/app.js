// ─────────────────────────────────────────────────────────────────────────────
// AgriSense — static/js/app.js
//
// Sections:
//   1. Page navigation
//   2. Season dropdown
//   3. Crop Advisor
//   4. Slider sync
//   5. Weather (geolocation + merged OWM + WAP)
// ─────────────────────────────────────────────────────────────────────────────


// ── 1. Page navigation ────────────────────────────────────────────────────────

const pages = {
  overview: { titleKey: "nav.overview",  subKey: "overview.subtitle" },
  weather:  { titleKey: "nav.weather",   subKey: "weather.subtitle"  },
  soil:     { titleKey: "nav.soil",      subKey: "soil.subtitle"     },
  crops:    { titleKey: "nav.crops",     subKey: "crops.subtitle"    },
  disease:  { titleKey: "nav.disease",   subKey: "disease.subtitle"  },
  history:  { titleKey: "nav.history",   subKey: "history.subtitle"  },
  settings: { titleKey: "nav.settings",  subKey: "settings.subtitle" },
};

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active', 'fade-in'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

  const pageEl = document.getElementById('page-' + name);
  if (pageEl) {
    pageEl.classList.add('active');
    void pageEl.offsetWidth;
    pageEl.classList.add('fade-in');
  }

  const btn = document.querySelector(`[data-page="${name}"]`);
  if (btn) btn.classList.add('active');

  if (pages[name]) {
    document.getElementById('page-title').textContent   = t(pages[name].titleKey);
    const subEl = document.getElementById('page-subtitle');
    if (subEl) subEl.textContent = t(pages[name].subKey);
  }

  // When switching to weather page, restore from cache or prompt user
  if (name === 'weather') {
    triggerGeolocation();
  }

  // When switching to overview, instantly sync from shared cache — no re-fetch
  if (name === 'overview' && _cachedWeather) {
    populateOverview(_cachedWeather);
    const loc = _cachedWeather?.current?.location;
    const ovInput = document.getElementById('ov-location-input');
    if (ovInput && loc) ovInput.value = loc;
  }
  // Load latest soil reading into the overview soil card
  if (name === 'overview') loadOverviewSoil();
  if (name === 'soil') { detectSensorMode(); }

  // When switching to history page, load summary + active tab
  if (name === 'history') {
    loadHistorySummary();
    histTab(_histActiveTab || 'disease');
  }

  // Soil page — start live polling; stop when leaving
  if (name === 'soil') {
    startSoilPolling();
  } else {
    stopSoilPolling();
  }
}


// ── 2. Season dropdown ────────────────────────────────────────────────────────

const SEASON_META = {
  autumn: { label: 'Autumn', icon: '🍂' },
  rainy:  { label: 'Rainy',  icon: '🌧️' },
  spring: { label: 'Spring', icon: '🌸' },
  summer: { label: 'Summer', icon: '☀️' },
  winter: { label: 'Winter', icon: '❄️' },
  zaid:   { label: 'Zaid',   icon: '🌾' },
};

document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('inp-season');
  if (sel) {
    sel.addEventListener('change', () => {
      const meta  = SEASON_META[sel.value];
      const badge = document.getElementById('season-badge');
      if (meta) {
        document.getElementById('season-badge-icon').textContent  = meta.icon;
        document.getElementById('season-badge-label').textContent = t('crops.season_' + meta.label.toLowerCase()) || meta.label;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    });
  }
});


// ── 3. Crop Advisor ───────────────────────────────────────────────────────────

// ── Fill Crop Advisor form from soil sensor ───────────────────────────────────
async function fillFromSensor() {
  const btn = document.getElementById('crop-sensor-btn');
  if (btn) { btn.textContent = ''; btn.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">refresh</span><span class="font-mono text-sm">Loading…</span>'; }

  try {
    const res  = await fetch('/api/soil/latest');
    const json = await res.json();

    if (!json.data) {
      // No sensor data yet
      if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-lg">sensors_off</span><span class="font-mono text-sm">No sensor data</span>';
      setTimeout(() => {
        if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-lg">sensors</span><span class="font-mono text-sm">Fill from Sensor</span>';
      }, 2500);
      return;
    }

    const d = json.data;

    // Fill NPK
    if (d.nitrogen    != null) _setCropField('inp-n',    Math.round(d.nitrogen));
    if (d.phosphorus  != null) _setCropField('inp-p',    Math.round(d.phosphorus));
    if (d.potassium   != null) _setCropField('inp-k',    Math.round(d.potassium));
    // Fill pH
    if (d.ph          != null) _setCropField('inp-ph',   d.ph.toFixed(2));
    // Fill soil temperature as crop temperature
    if (d.temperature != null) {
      _setCropField('inp-temp', d.temperature.toFixed(1));
      const slider = document.getElementById('slider-temp');
      if (slider) { slider.value = d.temperature.toFixed(1); }
      const lbl = document.getElementById('temp-label');
      if (lbl) lbl.textContent = d.temperature.toFixed(1);
    }
    // Fill moisture as humidity approximation
    if (d.moisture != null) {
      const hum = Math.min(Math.round(d.moisture), 100);
      _setCropField('inp-hum', hum);
      const slider = document.getElementById('slider-hum');
      if (slider) { slider.value = hum; }
      const lbl = document.getElementById('hum-label');
      if (lbl) lbl.textContent = hum;
    }

    // Update pH indicator bar position
    const phEl = document.getElementById('inp-ph');
    if (phEl) phEl.dispatchEvent(new Event('input'));

    // Show success banner
    const banner = document.getElementById('crop-sensor-banner');
    const bannerText = document.getElementById('crop-sensor-banner-text');
    const bannerTs   = document.getElementById('crop-sensor-ts');
    const formLabel  = document.getElementById('crop-form-source-label');
    const sensorDot  = document.getElementById('crop-form-sensor-dot');

    if (banner) banner.classList.remove('hidden');
    if (bannerText) bannerText.textContent = t('crops.banner_filled');
    if (bannerTs) bannerTs.textContent = t('crops.banner_reading') + ' ' + new Date(d.timestamp).toLocaleTimeString();
    if (formLabel) formLabel.textContent = t('crops.sensor_filled');
    if (sensorDot) sensorDot.classList.remove('hidden');
    window._cropFromSensor = true;

    // Restore button
    if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-lg">check_circle</span><span class="font-mono text-sm">' + t('crops.filled') + '</span>';
    setTimeout(() => {
      if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-lg">sensors</span><span class="font-mono text-sm">Fill from Sensor</span>';
    }, 2000);

  } catch(e) {
    console.warn('fillFromSensor error:', e);
    if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-lg">sensors</span><span class="font-mono text-sm">Fill from Sensor</span>';
  }
}

function _setCropField(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

async function getCropRecommendation() {
  const n      = parseFloat(document.getElementById('inp-n').value);
  const p      = parseFloat(document.getElementById('inp-p').value);
  const k      = parseFloat(document.getElementById('inp-k').value);
  const temp   = parseFloat(document.getElementById('inp-temp').value);
  const hum    = parseFloat(document.getElementById('inp-hum').value);
  const ph     = parseFloat(document.getElementById('inp-ph').value);
  const rain   = parseFloat(document.getElementById('inp-rain').value);
  const season = document.getElementById('inp-season').value;

  const numericMissing = [n, p, k, temp, hum, ph, rain].some(v => isNaN(v));
  if (numericMissing || !season) {
    const btn = document.querySelector('[onclick="getCropRecommendation()"]');
    btn.style.background = '#ef4444';
    btn.innerHTML = '⚠ ' + t('crops.fill_all_fields');
    setTimeout(() => {
      btn.style.background = '';
      btn.innerHTML = '<span class="material-symbols-outlined text-lg">agriculture</span> Get Recommendation';
    }, 2500);
    return;
  }

  const btn = document.querySelector('[onclick="getCropRecommendation()"]');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined text-lg">refresh</span> Analysing…';

  try {
    const response = await fetch('/api/crop-recommend', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ n, p, k, temp, humidity: hum, ph, rainfall: rain, season, from_sensor: !!window._cropFromSensor }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Server error');

    window._cropFromSensor = false;
    const best       = data.top_crop;
    const recs       = data.recommendations;
    const seasonUsed = data.season_used;

    document.getElementById('crop-empty-state').classList.add('hidden');
    document.getElementById('crop-result-content').classList.remove('hidden');
    document.getElementById('result-crop-name').textContent  = best.crop;
    document.getElementById('result-crop-latin').textContent = best.latin;
    document.getElementById('result-icon').textContent       = best.icon;
    document.getElementById('result-score').textContent      = best.confidence + '%';
    // Translate reason and tips
    translateCropReason(best.crop, best.reason).then(tr => {
      document.getElementById('result-reason').textContent = tr;
    });
    setTimeout(() => { document.getElementById('result-bar').style.width = best.confidence + '%'; }, 100);

    document.getElementById('result-params').innerHTML = recs.map(r => {
      const s     = r.confidence / 100;
      const color = s > 0.5  ? 'text-primary border-primary/30 bg-primary/5'
                  : s > 0.15 ? 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5'
                             : 'text-red-400 border-red-400/30 bg-red-400/5';
      const icon  = s > 0.5  ? 'check_circle' : s > 0.15 ? 'warning' : 'cancel';
      const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉';
      return `<div class="flex items-center justify-between bg-surface-2 rounded-lg px-3 py-2.5 border ${color}">
        <span class="text-slate-300 text-xs capitalize">${medal} ${r.crop}</span>
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-mono font-bold">${r.confidence}%</span>
          <span class="material-symbols-outlined text-sm">${icon}</span>
        </div>
      </div>`;
    }).join('');

    translateCropTips(best.crop, best.tips).then(translatedTips => {
      document.getElementById('result-tips').innerHTML = translatedTips.map((t, i) => `
        <div class="flex items-start gap-3 bg-surface-2 rounded-lg px-3 py-2.5 border border-surface-3">
          <span class="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 font-mono">${i + 1}</span>
          <span class="text-slate-300 text-sm">${t}</span>
        </div>`).join('');
    });

    const sm = SEASON_META[seasonUsed] || { label: seasonUsed, icon: '🌱' };
    document.getElementById('crop-summary-card').classList.remove('hidden');
    document.getElementById('summary-values').innerHTML = [
      { l: 'N',        v: n + ' mg/kg',             c: 'text-blue-400'   },
      { l: 'P',        v: p + ' mg/kg',             c: 'text-orange-400' },
      { l: 'K',        v: k + ' mg/kg',             c: 'text-purple-400' },
      { l: 'Temp',     v: temp + '°C',              c: 'text-orange-300' },
      { l: 'Humidity', v: hum + '%',                c: 'text-blue-300'   },
      { l: 'pH',       v: ph,                       c: 'text-primary'    },
      { l: 'Rainfall', v: rain + 'mm',              c: 'text-purple-300' },
      { l: 'Season',   v: sm.icon + ' ' + sm.label, c: 'text-yellow-400' },
    ].map(x => `<div class="bg-surface-2 rounded-lg p-2 text-center border border-surface-3">
      <p class="text-text-dim text-xs font-mono">${x.l}</p>
      <p class="${x.c} font-mono font-bold text-sm mt-0.5">${x.v}</p>
    </div>`).join('');

    document.getElementById('slider-temp').value = temp;
    document.getElementById('slider-hum').value  = hum;

  } catch (err) {
    document.getElementById('crop-empty-state').classList.add('hidden');
    document.getElementById('crop-result-content').classList.remove('hidden');
    document.getElementById('result-crop-name').textContent  = t('common.error');
    document.getElementById('result-crop-latin').textContent = err.message;
    document.getElementById('result-score').textContent      = '--';
    document.getElementById('result-reason').textContent = t('common.backend_error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined text-lg">agriculture</span> Get Recommendation';
  }
}

function resetCropForm() {
  // Hide sensor banner and reset source label
  const banner    = document.getElementById('crop-sensor-banner');
  const formLabel = document.getElementById('crop-form-source-label');
  const sensorDot = document.getElementById('crop-form-sensor-dot');
  if (banner)    banner.classList.add('hidden');
  if (formLabel) formLabel.textContent = t('crops.manual_input');
  if (sensorDot) sensorDot.classList.add('hidden');
  // Original reset continues below...
  ['inp-n','inp-p','inp-k','inp-temp','inp-hum','inp-ph','inp-rain'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('inp-season').value = '';
  document.getElementById('season-badge').classList.add('hidden');
  document.getElementById('slider-temp').value = 25;
  document.getElementById('slider-hum').value  = 65;
  document.getElementById('crop-empty-state').classList.remove('hidden');
  document.getElementById('crop-result-content').classList.add('hidden');
  document.getElementById('crop-summary-card').classList.add('hidden');
  document.getElementById('result-bar').style.width = '0%';
}


// ── 4. Slider sync ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const tempSlider = document.getElementById('slider-temp');
  const humSlider  = document.getElementById('slider-hum');
  if (tempSlider) {
    tempSlider.addEventListener('input', () => {
      document.getElementById('inp-temp').value         = tempSlider.value;
      document.getElementById('temp-label').textContent = tempSlider.value;
    });
  }
  if (humSlider) {
    humSlider.addEventListener('input', () => {
      document.getElementById('inp-hum').value         = humSlider.value;
      document.getElementById('hum-label').textContent = humSlider.value;
    });
  }
  const phInput = document.getElementById('inp-ph');
  if (phInput) {
    phInput.addEventListener('input', () => {
      const v = parseFloat(phInput.value);
      if (!isNaN(v)) {
        const pct = Math.min(Math.max((v / 14) * 100, 0), 100);
        document.getElementById('ph-indicator').style.left = pct + '%';
      }
    });
  }
});



// ── 5. Weather (Overview + Weather page, shared) ──────────────────────────────

let weatherHourlyData = [];
let chartMode         = 'temp';
let _cachedWeather    = null;   // shared cache so overview & weather page stay in sync

const EPA_LABELS = {
  1: "Good", 2: "Moderate", 3: "Unhealthy (Sensitive)",
  4: "Unhealthy", 5: "Very Unhealthy", 6: "Hazardous",
};

// ── Alert engine — generates farming-relevant alerts from weather data ─────────
function generateWeatherAlerts(current, forecast) {
  const alerts = [];

  const uv   = Number(current.uv_index);
  const wind = Number(current.wind_speed);
  const temp = Number(current.temperature);
  const hum  = Number(current.humidity);
  const rain = forecast[0]?.rain_chance || 0;
  const epa  = current.aqi?.us_epa || 0;

  if (uv >= 8)
    alerts.push({ level: 'red',    icon: 'wb_sunny',        text: t('alert.extreme_uv').replace('{uv}', uv) });
  else if (uv >= 6)
    alerts.push({ level: 'orange', icon: 'wb_sunny',        text: t('alert.high_uv').replace('{uv}', uv) });

  if (wind >= 50)
    alerts.push({ level: 'red',    icon: 'air',             text: `Strong winds ${wind} km/h — suspend spraying operations` });
  else if (wind >= 30)
    alerts.push({ level: 'orange', icon: 'air',             text: `Elevated winds ${wind} km/h — check for crop lodging risk` });

  if (rain >= 70)
    alerts.push({ level: 'blue',   icon: 'rainy',           text: t('alert.high_rain').replace('{rain}', rain) });
  else if (rain >= 40)
    alerts.push({ level: 'blue',   icon: 'water_drop',      text: `Rain likely (${rain}%) — irrigation may not be needed` });

  if (temp >= 38)
    alerts.push({ level: 'red',    icon: 'thermostat',      text: `Extreme heat ${temp}°C — irrigate early morning or evening` });
  else if (temp <= 8)
    alerts.push({ level: 'orange', icon: 'ac_unit',         text: t('alert.frost_risk').replace('{temp}', temp) });

  if (hum >= 85 && temp >= 22)
    alerts.push({ level: 'orange', icon: 'humidity_high',   text: t('alert.high_humidity').replace('{hum}', hum) });

  if (epa >= 4)
    alerts.push({ level: 'orange', icon: 'air',             text: `Poor air quality (EPA ${epa}) — limit prolonged outdoor exposure` });

  if (alerts.length === 0)
    alerts.push({ level: 'green',  icon: 'check_circle',    text: 'All conditions normal — no active weather alerts' });

  return alerts;
}

function renderOverviewAlerts(alerts) {
  const COLOURS = {
    red:    'bg-red-400',
    orange: 'bg-orange-400',
    blue:   'bg-blue-400',
    green:  'bg-primary',
  };
  const ICON_COLOURS = {
    red: 'text-red-400', orange: 'text-orange-400', blue: 'text-blue-400', green: 'text-primary',
  };
  document.getElementById('ov-alerts').innerHTML = alerts.map(a => `
    <div class="flex items-center gap-2 bg-surface-2 rounded-lg p-2.5">
      <div class="w-1.5 h-8 rounded-full ${COLOURS[a.level] || 'bg-surface-3'} flex-shrink-0"></div>
      <span class="material-symbols-outlined ${ICON_COLOURS[a.level] || 'text-text-dim'} text-base">
        ${a.icon}
      </span>
      <p class="text-white text-xs leading-snug">${a.text}</p>
    </div>
  `).join('');
}

// ── Populate overview weather card ────────────────────────────────────────────
function populateOverview(data) {
  const c = data.current;
  const f = data.forecast;

  // Sync the overview location input to always reflect current location
  const ovInput = document.getElementById('ov-location-input');
  if (ovInput) ovInput.value = c.location;

  // Top stat cards — with unit conversion
  document.getElementById('ov-stat-temp').textContent        = fmtTemp(c.temperature);
  document.getElementById('ov-stat-temp-loc').textContent    = c.location.split(',')[0];
  document.getElementById('ov-stat-rain').textContent        = fmtRain(c.precipitation);
  document.getElementById('ov-stat-rain-chance').textContent = f[0] ? f[0].rain_chance + '% ' + t('overview.rain_chance') : '';

  // Big weather card
  document.getElementById('ov-icon').textContent             = c.icon;
  document.getElementById('ov-temp').textContent             = cvtTemp(c.temperature).val;
  const ovTempUnit = document.getElementById('ov-temp-unit');
  if (ovTempUnit) ovTempUnit.textContent = getUnits().temp === 'F' ? '°F' : '°C';
  document.getElementById('ov-condition').textContent        = c.condition;
  document.getElementById('ov-feels').textContent            = `${t('overview.feels_like')} ${fmtTemp(c.feels_like)}`;
  document.getElementById('ov-location-display').textContent = '\uD83D\uDCCD ' + c.location;
  document.getElementById('ov-humidity').textContent         = c.humidity + ' %';
  document.getElementById('ov-wind').textContent             = fmtWind(c.wind_speed) + ' ' + degToCompass(c.wind_dir);
  document.getElementById('ov-precip').textContent           = fmtRain(c.precipitation);
  document.getElementById('ov-pressure').textContent         = c.pressure + ' hPa';
  document.getElementById('ov-vis').textContent              = c.visibility + ' km';

  // UV with colour
  const uvEl = document.getElementById('ov-uv');
  const uv   = Number(c.uv_index);
  uvEl.textContent  = c.uv_index;
  uvEl.className    = 'font-mono font-bold mt-1 ' +
    (uv <= 2 ? 'text-green-400' : uv <= 5 ? 'text-yellow-400' : uv <= 7 ? 'text-orange-400' : 'text-red-400');

  // Mini 4-day forecast — with unit conversion
  const tempUnit = getUnits().temp === 'F' ? '°F' : '°C';
  document.getElementById('ov-forecast').innerHTML = f.slice(0, 3).map(day => `
    <div class="day-card bg-surface-2/50 rounded-lg p-3 border border-surface-2 flex flex-col items-center gap-2 hover:border-primary/30 transition-colors">
      <span class="text-text-dim text-xs font-mono">${day.day}</span>
      <span class="material-symbols-outlined text-yellow-400 text-3xl" style="font-variation-settings:'FILL' 1">${day.icon}</span>
      <span class="text-white text-sm font-bold font-mono">${cvtTemp(day.high).val}° / ${cvtTemp(day.low).val}° <span class="text-text-dim text-xs">${tempUnit}</span></span>
      <span class="text-blue-300 text-xs font-mono">${day.rain_chance}% 🌧</span>
    </div>
  `).join('');

  // Alerts (use raw °C values for threshold logic)
  renderOverviewAlerts(generateWeatherAlerts(c, f));

  // Show data, hide skeleton
  document.getElementById('ov-weather-loading').classList.add('hidden');
  document.getElementById('ov-weather-data').classList.remove('hidden');
  document.getElementById('ov-weather-error').classList.add('hidden');
}

// ── Overview Soil Status ─────────────────────────────────────────────────────
async function loadOverviewSoil() {
  try {
    const res  = await fetch('/api/soil/latest');
    const json = await res.json();

    const nodata = document.getElementById('ov-soil-nodata');
    const data   = document.getElementById('ov-soil-data');

    if (!json.data) {
      if (nodata) nodata.classList.remove('hidden');
      if (data)   data.classList.add('hidden');
      return;
    }

    const d  = json.data;
    const st = d.status || {};

    if (nodata) nodata.classList.add('hidden');
    if (data)   data.classList.remove('hidden');

    // Timestamp
    const ts = document.getElementById('ov-soil-ts');
    if (ts && d.timestamp) {
      ts.textContent = new Date(d.timestamp).toLocaleTimeString();
      ts.classList.remove('hidden');
    }

    // Top stat cards
    const statMoist = document.getElementById('ov-stat-moisture');
    const statPh    = document.getElementById('ov-stat-ph');
    if (statMoist && d.moisture != null) statMoist.textContent = d.moisture.toFixed(1) + '%';
    if (statPh    && d.ph       != null) statPh.textContent    = d.ph.toFixed(2);

    // pH
    if (d.ph != null) {
      const el = document.getElementById('ov-soil-ph');
      if (el) el.textContent = d.ph.toFixed(2);
      const marker = document.getElementById('ov-soil-ph-marker');
      if (marker) marker.style.left = Math.min(Math.max((d.ph / 14) * 100, 2), 98) + '%';
      const badge = document.getElementById('ov-soil-ph-badge');
      if (badge) _applyOvSoilBadge(badge, st.ph);
    }

    // Moisture ring
    if (d.moisture != null) {
      const el = document.getElementById('ov-soil-moist');
      if (el) el.textContent = d.moisture.toFixed(1) + '%';
      const ring = document.getElementById('ov-soil-moist-ring');
      if (ring) ring.setAttribute('stroke-dashoffset',
        (238.76 - (Math.min(d.moisture, 100) / 100) * 238.76).toFixed(1));
    }

    // Temperature
    if (d.temperature != null) {
      const el = document.getElementById('ov-soil-temp');
      if (el) el.textContent = d.temperature.toFixed(1) + '°C';
    }

    // NPK
    [['nitrogen','n'],['phosphorus','p'],['potassium','k']].forEach(([key, id]) => {
      const val = d[key];
      const el  = document.getElementById('ov-soil-' + id);
      if (el && val != null) el.textContent = Math.round(val);
      const badge = document.getElementById('ov-soil-' + id + '-badge');
      if (badge) _applyOvSoilBadge(badge, st[key]);
    });

    // Conductivity
    if (d.conductivity != null) {
      const el = document.getElementById('ov-soil-ec');
      if (el) el.textContent = Math.round(d.conductivity);
      const badge = document.getElementById('ov-soil-ec-badge');
      if (badge) _applyOvSoilBadge(badge, st.conductivity);
    }

  } catch(e) {
    console.warn('loadOverviewSoil error:', e);
  }
}

function _applyOvSoilBadge(el, status) {
  const map = {
    ok:      { textKey: 'soil.status_ok',   cls: 'text-green-400' },
    low:     { textKey: 'soil.status_low',  cls: 'text-yellow-400' },
    high:    { textKey: 'soil.status_high', cls: 'text-red-400' },
    unknown: { textKey: null,               cls: 'text-text-dim' },
  };
  const s = map[status] || map.unknown;
  el.textContent = s.textKey ? t(s.textKey) : '--';
  el.className   = el.className.replace(/text-\w+-\d+|text-text-dim/g, '').trim() + ' ' + s.cls;
}

// ── Fetch for overview (geo first, fallback to last searched location) ────────
async function loadOverviewWeather(lat = null, lon = null, city = null) {
  document.getElementById('ov-weather-loading').classList.remove('hidden');
  document.getElementById('ov-weather-data').classList.add('hidden');
  document.getElementById('ov-weather-error').classList.add('hidden');

  // Spin refresh icon
  const icon = document.getElementById('ov-refresh-icon');
  if (icon) icon.style.animation = 'spin 1s linear infinite';

  let url = '/api/weather?';
  if (lat && lon)   url += `lat=${lat}&lon=${lon}`;
  else if (city)    url += `location=${encodeURIComponent(city)}`;
  else              url += `location=London`;  // safe fallback

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Weather unavailable');
    _cachedWeather = data;
    populateOverview(data);
  } catch (err) {
    document.getElementById('ov-weather-loading').classList.add('hidden');
    document.getElementById('ov-weather-error').classList.remove('hidden');
    document.getElementById('ov-weather-error-msg').textContent = err.message;
    renderOverviewAlerts([{ level: 'orange', icon: 'cloud_off', text: 'Weather data unavailable — check API keys' }]);
  } finally {
    if (icon) icon.style.animation = '';
  }
}

function refreshOverviewWeather() {
  const city = document.getElementById('ov-location-input').value.trim();
  if (city) {
    loadOverviewWeather(null, null, city);
  } else {
    autoLoadOverviewWeather();
  }
}

function autoLoadOverviewWeather() {
  // If weather page already fetched data, reuse it — don't fire a second request
  if (_cachedWeather) {
    populateOverview(_cachedWeather);
    const loc = _cachedWeather?.current?.location;
    const ovInput = document.getElementById('ov-location-input');
    if (ovInput && loc) ovInput.value = loc;
    return;
  }
  // First load — use geolocation
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => loadOverviewWeather(pos.coords.latitude, pos.coords.longitude),
      ()  => loadOverviewWeather(null, null, null)
    );
  } else {
    loadOverviewWeather(null, null, null);
  }
}

// ── Overview autocomplete ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Auto-load weather when overview is visible
  autoLoadOverviewWeather();

  const ovInput    = document.getElementById('ov-location-input');
  const ovDropdown = document.getElementById('ov-autocomplete');
  if (!ovInput) return;
  let ovTimer;
  ovInput.addEventListener('input', () => {
    clearTimeout(ovTimer);
    const q = ovInput.value.trim();
    if (q.length < 2) { ovDropdown.classList.add('hidden'); return; }
    ovTimer = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/weather/search?q=${encodeURIComponent(q)}`);
        const list = await res.json();
        if (!list.length) { ovDropdown.classList.add('hidden'); return; }
        ovDropdown.innerHTML = list.map(r => `
          <button class="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-surface-2 transition-colors flex items-center gap-2"
            onclick="selectOvLocation('${r.name}, ${r.country}')">
            <span class="material-symbols-outlined text-text-dim text-xs">location_on</span>
            <span>${r.name}, ${r.region}, ${r.country}</span>
          </button>`).join('');
        ovDropdown.classList.remove('hidden');
      } catch { ovDropdown.classList.add('hidden'); }
    }, 350);
  });
  document.addEventListener('click', e => {
    if (!ovInput.contains(e.target) && !ovDropdown.contains(e.target))
      ovDropdown.classList.add('hidden');
  });
});

function selectOvLocation(name) {
  document.getElementById('ov-location-input').value = name;
  document.getElementById('ov-autocomplete').classList.add('hidden');
  loadOverviewWeather(null, null, name);
}

// ── Weather PAGE functions (search page) ──────────────────────────────────────
function fetchWeatherByGeo() {
  if (!navigator.geolocation) { showWeatherError("Geolocation not supported."); return; }
  setWeatherLoading(true);
  navigator.geolocation.getCurrentPosition(
    pos => fetchWeather(null, pos.coords.latitude, pos.coords.longitude),
    ()  => { setWeatherLoading(false); showWeatherError("Location access denied. Search manually."); }
  );
}

async function fetchWeather(city = null, lat = null, lon = null) {
  if (!city && !lat) {
    city = document.getElementById('weather-location-input')?.value.trim();
    if (!city) return;
  }
  document.getElementById('weather-autocomplete')?.classList.add('hidden');
  setWeatherLoading(true);
  hideWeatherPanels();

  const url = '/api/weather?' + ((lat && lon) ? `lat=${lat}&lon=${lon}` : `location=${encodeURIComponent(city)}`);
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Unknown error');
    _cachedWeather = data;
    renderWeather(data);
    populateOverview(data);   // keep overview in sync with weather page location
  } catch (err) {
    showWeatherError(err.message);
    document.getElementById('weather-empty')?.classList.remove('hidden');
  } finally {
    setWeatherLoading(false);
  }
}

function renderWeather(data) {
  const c = data.current;
  document.getElementById('weather-location-name').textContent = c.location;
  const badge = document.getElementById('weather-location-badge');
  badge.classList.remove('hidden'); badge.classList.add('flex');
  document.getElementById('weather-location-input').value = c.location;

  document.getElementById('w-icon').textContent      = c.icon;
  document.getElementById('w-temp').textContent      = cvtTemp(c.temperature).val;
  document.getElementById('w-condition').textContent = c.condition;
  document.getElementById('w-feels').textContent     = `${t('overview.feels_like')} ${fmtTemp(c.feels_like)}`;
  document.getElementById('w-localtime').textContent = c.local_time;
  document.getElementById('w-humidity').textContent  = c.humidity + ' %';
  document.getElementById('w-wind').textContent      = fmtWind(c.wind_speed);
  document.getElementById('w-winddir').textContent   = degToCompass(c.wind_dir);
  document.getElementById('w-gust').textContent      = fmtWind(c.wind_gust);
  document.getElementById('w-precip').textContent    = fmtRain(c.precipitation);
  document.getElementById('w-pressure').textContent  = c.pressure + ' hPa';
  document.getElementById('w-vis').textContent       = c.visibility + ' km';
  document.getElementById('w-uv').textContent        = c.uv_index;
  document.getElementById('w-pm25').textContent      = c.aqi.pm2_5;
  document.getElementById('w-pm10').textContent      = c.aqi.pm10;
  document.getElementById('w-no2').textContent       = c.aqi.no2;
  document.getElementById('w-o3').textContent        = c.aqi.o3;
  document.getElementById('w-epa').textContent       = c.aqi.us_epa;
  document.getElementById('w-epa-label').textContent = c.aqi.label || EPA_LABELS[c.aqi.us_epa] || '--';

  // Update the °C label next to big temp to reflect unit
  const tempUnitEl = document.querySelector('#weather-current .text-3xl.text-text-dim');
  if (tempUnitEl) tempUnitEl.textContent = getUnits().temp === 'F' ? '°F' : '°C';

  const uvEl = document.getElementById('w-uv');
  const uv = Number(c.uv_index);
  uvEl.className = 'font-mono text-2xl font-bold mt-1 ' +
    (uv <= 2 ? 'text-green-400' : uv <= 5 ? 'text-yellow-400' : uv <= 7 ? 'text-orange-400' : 'text-red-400');

  document.getElementById('weather-current').classList.remove('hidden');

  // Forecast cards with unit conversion
  document.getElementById('weather-forecast-grid').innerHTML = data.forecast.map(day => `
    <div class="bg-surface rounded-xl border border-surface-2 p-4 flex flex-col items-center gap-2 hover:border-primary/30 transition-colors">
      <span class="text-text-dim text-xs font-mono uppercase">${day.day}</span>
      <span class="material-symbols-outlined text-yellow-400 text-4xl" style="font-variation-settings:'FILL' 1">${day.icon}</span>
      <p class="text-white text-xs text-center leading-tight">${day.condition}</p>
      <div class="flex gap-2 items-baseline">
        <span class="text-white font-mono font-bold">${cvtTemp(day.high).val}°</span>
        <span class="text-text-dim font-mono text-xs">${cvtTemp(day.low).val}°</span>
        <span class="text-text-dim font-mono text-xs">${getUnits().temp === 'F' ? 'F' : 'C'}</span>
      </div>
      <div class="w-full border-t border-surface-2 pt-2 grid grid-cols-2 gap-1 text-center">
        <div><p class="text-text-dim text-xs">Rain%</p><p class="text-blue-300 font-mono text-xs font-bold">${day.rain_chance}%</p></div>
        <div><p class="text-text-dim text-xs">UV</p><p class="text-yellow-300 font-mono text-xs font-bold">${day.uv_index}</p></div>
        <div class="col-span-2"><p class="text-text-dim text-xs">${day.sunrise} \u2191  ${day.sunset} \u2193</p></div>
      </div>
    </div>
  `).join('');
  document.getElementById('weather-forecast-section').classList.remove('hidden');

  weatherHourlyData = data.history;
  renderWeatherChart(chartMode);
  document.getElementById('weather-chart-section').classList.remove('hidden');
}

function renderWeatherChart(mode) {
  chartMode = mode;

  // Update tab button styles
  ['temp','rain','humidity','rain_chance'].forEach(m => {
    const btn = document.getElementById('chart-btn-' + m);
    if (!btn) return;
    btn.className = m === mode
      ? 'px-3 py-1 text-xs font-medium bg-primary/15 text-primary rounded font-mono'
      : 'px-3 py-1 text-xs font-medium text-text-dim hover:text-white transition-colors font-mono';
  });

  if (!weatherHourlyData.length) return;

  // Sample every 2nd hour for readability
  const data   = weatherHourlyData.filter((_, i) => i % 2 === 0);
  // Convert temp values if unit is °F
  const values = data.map(h => {
    const raw = Number(h[mode]) || 0;
    return (mode === 'temp') ? cvtTemp(raw).val : raw;
  });
  const rawMax = Math.max(...values);
  const rawMin = Math.min(...values);

  // For percentage modes, always use 100 as the scale ceiling
  // so bars are proportional even when max is e.g. 30%
  const PERCENT_MODES = ['rain_chance', 'humidity'];
  const scaleMax = PERCENT_MODES.includes(mode) ? 100 : (rawMax || 1);

  const UNITS = {
    temp:        getUnits().temp === 'F' ? '°F' : '°C',
    rain:        getUnits().rain === 'in' ? 'in' : 'mm',
    humidity:    '%',
    rain_chance: '%'
  };
  const unit  = UNITS[mode] || '';

  document.getElementById('chart-min').textContent = `min ${rawMin}${unit}`;
  document.getElementById('chart-max').textContent = `max ${rawMax}${unit}`;

  const COLOURS = {
    temp:        ['#13ec49', '#0b5e22'],
    rain:        ['#60a5fa', '#1e40af'],
    humidity:    ['#a78bfa', '#4c1d95'],
    rain_chance: ['#38bdf8', '#0369a1'],
  };
  const [colTop, colBot] = COLOURS[mode] || COLOURS.temp;
  const isLight = document.body.classList.contains('light');

  const container = document.getElementById('weather-chart');
  container.innerHTML = '';

  // All-zero rain — show a friendly message instead of flat stubs
  if (rawMax === 0 && (mode === 'rain' || mode === 'rain_chance')) {
    const msg = document.createElement('div');
    msg.style.cssText = 'width:100%;height:160px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;';
    msg.innerHTML = `
      <span style="font-size:32px;opacity:0.4;">🌤️</span>
      <span style="font-size:12px;color:${isLight ? '#3d7a4a' : '#7faa88'};font-family:'DM Mono',monospace;">
        No ${mode === 'rain' ? 'precipitation' : 'rain chance'} forecast for today
      </span>`;
    container.appendChild(msg);
    return;
  }

  // Build canvas — immune to CSS transitions
  const canvas = document.createElement('canvas');
  const dpr    = window.devicePixelRatio || 1;
  const W      = container.clientWidth || 600;
  const H      = 160;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const PAD_LEFT = 8, PAD_RIGHT = 8, PAD_TOP = 24, PAD_BOT = 28;
  const chartW = W - PAD_LEFT - PAD_RIGHT;
  const chartH = H - PAD_TOP - PAD_BOT;
  const barW   = Math.max(4, Math.floor(chartW / data.length) - 3);
  const gap    = Math.max(0, (chartW - barW * data.length) / (data.length - 1 || 1));

  // Draw a subtle baseline
  ctx.strokeStyle = isLight ? '#c8e6ce' : '#1e3a24';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_LEFT, PAD_TOP + chartH);
  ctx.lineTo(W - PAD_RIGHT, PAD_TOP + chartH);
  ctx.stroke();

  data.forEach((h, i) => {
    const rawVal = Number(h[mode]) || 0;
    // Convert temp if needed — use same converted values array for height
    const val    = values[i];
    // Minimum visible bar height: 6px when val > 0, 3px stub when val === 0
    const barH = rawVal > 0
      ? Math.max(6, Math.round((val / scaleMax) * chartH))
      : 3;
    const x = PAD_LEFT + i * (barW + gap);
    const y = PAD_TOP + chartH - barH;

    // Bar gradient
    const grad = ctx.createLinearGradient(x, y, x, y + barH);
    grad.addColorStop(0, rawVal > 0 ? colTop : (isLight ? '#c8e6ce' : '#243f29'));
    grad.addColorStop(1, rawVal > 0 ? colBot : (isLight ? '#d4edda' : '#1e3a24'));
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, barW, barH, [3, 3, 0, 0]);
    } else {
      ctx.rect(x, y, barW, barH);
    }
    ctx.fill();

    // Value label above bar (only when val > 0)
    if (rawVal > 0) {
      ctx.fillStyle  = isLight ? '#0f2614' : '#e2e8f0';
      ctx.font       = `500 9px 'DM Mono', monospace`;
      ctx.textAlign  = 'center';
      const label    = val + unit;
      ctx.fillText(label, x + barW / 2, y - 4);
    }

    // Time label below — every 2nd bar
    if (i % 2 === 0) {
      ctx.fillStyle = isLight ? '#3d7a4a' : '#7faa88';
      ctx.font      = `400 9px 'DM Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(h.time, x + barW / 2, H - 6);
    }
  });
}

function setChartMode(mode) { renderWeatherChart(mode); }

function setWeatherLoading(on) {
  document.getElementById('weather-loading')?.classList.toggle('hidden', !on);
  const btn = document.querySelector('[onclick="fetchWeather()"]');
  if (btn) btn.disabled = on;
}

function hideWeatherPanels() {
  ['weather-error','weather-current','weather-forecast-section',
   'weather-chart-section','weather-empty'].forEach(id =>
    document.getElementById(id)?.classList.add('hidden'));
}

function showWeatherError(msg) {
  document.getElementById('weather-error-msg').textContent = msg;
  document.getElementById('weather-error').classList.remove('hidden');
}

function degToCompass(deg) {
  if (!deg || deg === '--') return '--';
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(Number(deg) / 45) % 8];
}

// ── Weather page autocomplete ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const input    = document.getElementById('weather-location-input');
  const dropdown = document.getElementById('weather-autocomplete');
  if (!input) return;
  let timer;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') fetchWeather(); });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { dropdown.classList.add('hidden'); return; }
    timer = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/weather/search?q=${encodeURIComponent(q)}`);
        const list = await res.json();
        if (!list.length) { dropdown.classList.add('hidden'); return; }
        dropdown.innerHTML = list.map(r => `
          <button class="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-surface-2 transition-colors flex items-center gap-2"
            onclick="selectWeatherLocation('${r.name}, ${r.country}')">
            <span class="material-symbols-outlined text-text-dim text-sm">location_on</span>
            <span>${r.name}</span>
            <span class="text-text-dim text-xs ml-1">${r.region}, ${r.country}</span>
          </button>`).join('');
        dropdown.classList.remove('hidden');
      } catch { dropdown.classList.add('hidden'); }
    }, 350);
  });
  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !dropdown.contains(e.target))
      dropdown.classList.add('hidden');
  });
});

function selectWeatherLocation(name) {
  document.getElementById('weather-location-input').value = name;
  document.getElementById('weather-autocomplete').classList.add('hidden');
  fetchWeather(name);
}


// ── 6. Calendar Panel ─────────────────────────────────────────────────────────
// Slide-in panel from the right.
// - Month grid with weather overlay (rain chance + temp per day from forecast)
// - Crop growth timeline (sowing → harvest countdown per crop)

const CROP_DURATIONS = {
  // crop: { sow_to_harvest_days, growth_stages: [{name, days, icon}] }
  rice:        { days: 120, stages: [{ n:"Seedling", d:15, i:"grass" },       { n:"Tillering",  d:30, i:"device_hub" }, { n:"Heading",   d:30, i:"spa" },       { n:"Harvest",    d:45, i:"agriculture" }] },
  wheat:       { days: 110, stages: [{ n:"Germination", d:10, i:"grass" },    { n:"Vegetative", d:40, i:"eco" },        { n:"Flowering", d:20, i:"spa" },       { n:"Harvest",    d:40, i:"agriculture" }] },
  maize:       { days: 95,  stages: [{ n:"Seedling", d:10, i:"grass" },       { n:"Vegetative", d:35, i:"eco" },        { n:"Silking",   d:20, i:"spa" },       { n:"Harvest",    d:30, i:"agriculture" }] },
  tomato:      { days: 80,  stages: [{ n:"Seedling", d:20, i:"grass" },       { n:"Vegetative", d:25, i:"eco" },        { n:"Flowering", d:20, i:"spa" },       { n:"Harvest",    d:15, i:"agriculture" }] },
  banana:      { days: 270, stages: [{ n:"Shoot",    d:30, i:"potted_plant"}, { n:"Vegetative", d:120, i:"eco" },       { n:"Flowering", d:60, i:"spa" },       { n:"Harvest",    d:60, i:"agriculture" }] },
  chickpea:    { days: 100, stages: [{ n:"Germination", d:10, i:"grass" },    { n:"Vegetative", d:40, i:"eco" },        { n:"Podding",   d:30, i:"spa" },       { n:"Harvest",    d:20, i:"agriculture" }] },
  cotton:      { days: 150, stages: [{ n:"Seedling", d:15, i:"grass" },       { n:"Squaring",   d:45, i:"eco" },        { n:"Boll Dev.", d:50, i:"spa" },       { n:"Harvest",    d:40, i:"agriculture" }] },
  coffee:      { days: 365, stages: [{ n:"Nursery",  d:90, i:"potted_plant"}, { n:"Vegetative", d:180, i:"eco" },       { n:"Flowering", d:30, i:"spa" },       { n:"Harvest",    d:65, i:"agriculture" }] },
  mango:       { days: 120, stages: [{ n:"Flowering",d:20, i:"spa" },         { n:"Fruit Set",  d:30, i:"potted_plant"},{ n:"Dev.",       d:50, i:"eco" },       { n:"Harvest",    d:20, i:"agriculture" }] },
  watermelon:  { days: 75,  stages: [{ n:"Seedling", d:10, i:"grass" },       { n:"Vine Growth",d:30, i:"eco" },        { n:"Flowering", d:15, i:"spa" },       { n:"Harvest",    d:20, i:"agriculture" }] },
  lentil:      { days: 100, stages: [{ n:"Germination", d:10, i:"grass" },    { n:"Vegetative", d:40, i:"eco" },        { n:"Podding",   d:30, i:"spa" },       { n:"Harvest",    d:20, i:"agriculture" }] },
  default:     { days: 90,  stages: [{ n:"Seedling", d:15, i:"grass" },       { n:"Vegetative", d:35, i:"eco" },        { n:"Flowering", d:20, i:"spa" },       { n:"Harvest",    d:20, i:"agriculture" }] },
};

// Persistent crop timelines: [{ crop, sowDate }]
let cropTimelines = JSON.parse(localStorage.getItem('agri_timelines') || '[]');

function saveTimelines() {
  localStorage.setItem('agri_timelines', JSON.stringify(cropTimelines));
}

// ── Open / close panel ────────────────────────────────────────────────────────
function openCalendar() {
  let panel = document.getElementById('cal-panel');
  if (!panel) { buildCalendarDOM(); panel = document.getElementById('cal-panel'); }
  panel.classList.remove('translate-x-full');
  document.getElementById('cal-backdrop').classList.remove('hidden');
  renderCalendar();
}

function closeCalendar() {
  document.getElementById('cal-panel')?.classList.add('translate-x-full');
  document.getElementById('cal-backdrop')?.classList.add('hidden');
}

// ── Build DOM (once) ──────────────────────────────────────────────────────────
function buildCalendarDOM() {
  // Backdrop
  const bd = document.createElement('div');
  bd.id = 'cal-backdrop';
  bd.className = 'fixed inset-0 bg-black/40 backdrop-blur-sm z-40';
  bd.onclick = closeCalendar;
  document.body.appendChild(bd);

  // Panel
  const panel = document.createElement('div');
  panel.id = 'cal-panel';
  panel.className = 'fixed top-0 right-0 h-full w-[520px] max-w-full bg-bg-mid border-l border-surface-2 z-50 flex flex-col shadow-2xl transform translate-x-full transition-transform duration-300 ease-out';
  panel.innerHTML = `
    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-5 border-b border-surface-2 flex-shrink-0">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-primary text-xl" style="font-variation-settings:'FILL' 1">calendar_month</span>
        </div>
        <div>
          <h2 class="font-display font-bold text-white text-base">Farm Calendar</h2>
          <p class="text-text-dim text-xs font-mono">Weather overlay + crop timelines</p>
        </div>
      </div>
      <button onclick="closeCalendar()" class="w-8 h-8 rounded-lg bg-surface hover:bg-surface-2 flex items-center justify-center text-text-dim hover:text-white transition-colors">
        <span class="material-symbols-outlined text-lg">close</span>
      </button>
    </div>

    <!-- Tab bar -->
    <div class="flex gap-1 px-6 pt-4 flex-shrink-0">
      <button onclick="calTab('weather')" id="cal-tab-weather"
        class="px-4 py-1.5 text-xs font-medium rounded-lg font-mono bg-primary/15 text-primary">
        Weather
      </button>
      <button onclick="calTab('timeline')" id="cal-tab-timeline"
        class="px-4 py-1.5 text-xs font-medium rounded-lg font-mono text-text-dim hover:text-white transition-colors">
        Crop Timelines
      </button>
    </div>

    <!-- Scrollable content -->
    <div class="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-5">

      <!-- ── WEATHER TAB ── -->
      <div id="cal-weather-view">
        <!-- Month nav -->
        <div class="flex items-center justify-between mb-4">
          <button onclick="calChangeMonth(-1)" class="w-8 h-8 rounded-lg bg-surface hover:bg-surface-2 flex items-center justify-center text-text-dim hover:text-primary transition-colors">
            <span class="material-symbols-outlined text-lg">chevron_left</span>
          </button>
          <span id="cal-month-label" class="font-display font-bold text-white text-sm"></span>
          <button onclick="calChangeMonth(1)"  class="w-8 h-8 rounded-lg bg-surface hover:bg-surface-2 flex items-center justify-center text-text-dim hover:text-primary transition-colors">
            <span class="material-symbols-outlined text-lg">chevron_right</span>
          </button>
        </div>

        <!-- Day headers -->
        <div class="grid grid-cols-7 mb-1">
          ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d =>
            `<div class="text-center text-text-dim text-xs font-mono py-1">${d}</div>`).join('')}
        </div>

        <!-- Calendar grid -->
        <div id="cal-grid" class="grid grid-cols-7 gap-1"></div>

        <!-- Legend -->
        <div class="flex items-center gap-4 mt-4 pt-4 border-t border-surface-2 flex-wrap">
          <span class="text-text-dim text-xs font-mono">Legend:</span>
          <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full bg-blue-400/80"></div><span class="text-text-dim text-xs">Rain likely</span></div>
          <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full bg-yellow-400/80"></div><span class="text-text-dim text-xs">Hot day</span></div>
          <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full bg-primary/80"></div><span class="text-text-dim text-xs">Good conditions</span></div>
          <div class="flex items-center gap-1.5 text-xs text-text-dim">${t('weather.forecast_limit')}</div>
        </div>

        <!-- Selected day detail -->
        <div id="cal-day-detail" class="hidden mt-4 bg-surface rounded-xl border border-surface-2 p-4 flex flex-col gap-3">
          <h4 id="cal-detail-date" class="font-display font-bold text-white text-sm"></h4>
          <div class="grid grid-cols-2 gap-3" id="cal-detail-grid"></div>
        </div>
      </div>

      <!-- ── TIMELINE TAB ── -->
      <div id="cal-timeline-view" class="hidden flex flex-col gap-5">

        <!-- Add crop form -->
        <div class="bg-surface rounded-xl border border-surface-2 p-4 flex flex-col gap-3">
          <p class="text-white text-sm font-semibold">Add Crop Timeline</p>
          <div class="flex gap-2">
            <select id="cal-crop-select"
              class="flex-1 bg-surface-2 border border-surface-2 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-primary/50">
              <option value="">Select crop…</option>
              ${Object.keys(CROP_DURATIONS).filter(k => k !== 'default').sort().map(c =>
                `<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('')}
            </select>
            <input type="date" id="cal-sow-date"
              class="bg-surface-2 border border-surface-2 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-primary/50"
              style="color-scheme:dark"/>
            <button onclick="addCropTimeline()"
              class="px-3 py-2 bg-primary text-bg-deep text-xs font-bold rounded-lg hover:bg-primary-dim transition-colors flex items-center gap-1">
              <span class="material-symbols-outlined text-sm">add</span>Add
            </button>
          </div>
        </div>

        <!-- Timeline list -->
        <div id="cal-timeline-list" class="flex flex-col gap-4"></div>

        <div id="cal-timeline-empty" class="text-center py-8 text-text-dim text-sm hidden">
          No crop timelines yet — add one above.
        </div>
      </div>

    </div>
  `;
  document.body.appendChild(panel);

  // Set today as default sow date
  document.getElementById('cal-sow-date').value = new Date().toISOString().split('T')[0];
}

// ── Tab switching ─────────────────────────────────────────────────────────────
let _calTab = 'weather';
function calTab(tab) {
  _calTab = tab;
  document.getElementById('cal-weather-view').classList.toggle('hidden', tab !== 'weather');
  document.getElementById('cal-timeline-view').classList.toggle('hidden', tab !== 'timeline');
  document.getElementById('cal-tab-weather').className  = tab === 'weather'
    ? 'px-4 py-1.5 text-xs font-medium rounded-lg font-mono bg-primary/15 text-primary'
    : 'px-4 py-1.5 text-xs font-medium rounded-lg font-mono text-text-dim hover:text-white transition-colors';
  document.getElementById('cal-tab-timeline').className = tab === 'timeline'
    ? 'px-4 py-1.5 text-xs font-medium rounded-lg font-mono bg-primary/15 text-primary'
    : 'px-4 py-1.5 text-xs font-medium rounded-lg font-mono text-text-dim hover:text-white transition-colors';
  if (tab === 'timeline') renderTimelines();
}

// ── Calendar month state ──────────────────────────────────────────────────────
let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth(); // 0-indexed

function calChangeMonth(delta) {
  _calMonth += delta;
  if (_calMonth > 11) { _calMonth = 0;  _calYear++; }
  if (_calMonth < 0)  { _calMonth = 11; _calYear--; }
  renderCalendar();
}

// ── Render calendar grid ──────────────────────────────────────────────────────
function renderCalendar() {
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  document.getElementById('cal-month-label').textContent = `${MONTHS[_calMonth]} ${_calYear}`;

  const today    = new Date();
  const forecast = _cachedWeather?.forecast || [];

  // Build a lookup: "YYYY-MM-DD" → forecast day data
  const fcLookup = {};
  forecast.forEach(d => { fcLookup[d.date] = d; });

  const firstDay = new Date(_calYear, _calMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();

  let html = '';

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    html += `<div class="h-16 rounded-lg bg-surface/30 opacity-30"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr  = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday  = day === today.getDate() && _calMonth === today.getMonth() && _calYear === today.getFullYear();
    const isPast   = new Date(dateStr) < new Date(today.toDateString());
    const fcDay    = fcLookup[dateStr];

    // Determine cell colour
    let accent = 'border-surface-2 bg-surface';
    let dotHtml = '';
    let tempHtml = '';
    let iconHtml = '';

    if (fcDay) {
      const rain = Number(fcDay.rain_chance);
      const temp = Number(fcDay.high);
      if (rain >= 60)       accent = 'border-blue-500/40 bg-blue-500/10';
      else if (temp >= 35)  accent = 'border-yellow-500/40 bg-yellow-500/10';
      else                  accent = 'border-primary/30 bg-primary/5';

      dotHtml  = `<div class="flex gap-0.5 mt-0.5">
        <span class="text-blue-300 text-xs font-mono leading-none">${rain}%</span>
      </div>`;
      tempHtml = `<span class="text-white text-xs font-mono font-bold">${temp}°</span>`;
      iconHtml = `<span class="material-symbols-outlined text-yellow-400 text-sm" style="font-variation-settings:'FILL' 1">${fcDay.icon}</span>`;
    }

    const todayRing = isToday ? 'ring-2 ring-primary ring-offset-1 ring-offset-bg-mid' : '';
    const pastDim   = isPast && !isToday ? 'opacity-50' : '';

    html += `
      <div onclick="calSelectDay('${dateStr}')"
        class="h-16 rounded-lg border ${accent} ${todayRing} ${pastDim} p-1.5 flex flex-col justify-between cursor-pointer hover:border-primary/50 transition-all">
        <div class="flex items-center justify-between">
          <span class="text-xs font-mono ${isToday ? 'text-primary font-bold' : 'text-text-dim'}">${day}</span>
          ${iconHtml}
        </div>
        ${tempHtml}
        ${dotHtml}
      </div>`;
  }

  document.getElementById('cal-grid').innerHTML = html;
  document.getElementById('cal-day-detail').classList.add('hidden');
}

// ── Day detail pop-up inside panel ────────────────────────────────────────────
function calSelectDay(dateStr) {
  const forecast = _cachedWeather?.forecast || [];
  const fcDay    = forecast.find(d => d.date === dateStr);
  const detail   = document.getElementById('cal-day-detail');
  const dateObj  = new Date(dateStr + 'T12:00:00');
  const label    = dateObj.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  document.getElementById('cal-detail-date').textContent = label;

  if (fcDay) {
    document.getElementById('cal-detail-grid').innerHTML = [
      { label:'High / Low',    val: `${fcDay.high}° / ${fcDay.low}°C` },
      { label:'Rain Chance',   val: `${fcDay.rain_chance}%` },
      { label:'Rainfall',      val: `${fcDay.rain_mm} mm` },
      { label:'Humidity',      val: `${fcDay.humidity}%` },
      { label:'UV Index',      val: `${fcDay.uv_index}` },
      { label:'Max Wind',      val: `${fcDay.wind_max} km/h` },
      { label:'Sunrise',       val: fcDay.sunrise },
      { label:'Sunset',        val: fcDay.sunset },
    ].map(r => `
      <div class="bg-surface-2 rounded-lg p-3">
        <p class="text-text-dim text-xs font-mono">${r.label}</p>
        <p class="text-white font-mono font-bold text-sm mt-0.5">${r.val}</p>
      </div>`).join('');
    detail.classList.remove('hidden');
  } else {
    document.getElementById('cal-detail-grid').innerHTML = `
      <div class="col-span-2 text-center py-4 text-text-dim text-xs">
        ${t('weather.no_forecast_date')}
      </div>`;
    detail.classList.remove('hidden');
  }
}

// ── Crop timeline ─────────────────────────────────────────────────────────────
function addCropTimeline() {
  const crop    = document.getElementById('cal-crop-select').value;
  const sowDate = document.getElementById('cal-sow-date').value;
  if (!crop || !sowDate) return;

  cropTimelines.unshift({ crop, sowDate, id: Date.now() });
  saveTimelines();
  renderTimelines();

  // Reset
  document.getElementById('cal-crop-select').value = '';
}

function removeCropTimeline(id) {
  cropTimelines = cropTimelines.filter(t => t.id !== id);
  saveTimelines();
  renderTimelines();
}

function renderTimelines() {
  const list  = document.getElementById('cal-timeline-list');
  const empty = document.getElementById('cal-timeline-empty');

  if (!cropTimelines.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  list.innerHTML = cropTimelines.map(t => {
    const info    = CROP_DURATIONS[t.crop] || CROP_DURATIONS.default;
    const sow     = new Date(t.sowDate + 'T00:00:00');
    const harvest = new Date(sow.getTime() + info.days * 86400000);
    const elapsed = Math.max(0, Math.floor((today - sow) / 86400000));
    const pct     = Math.min(100, Math.round((elapsed / info.days) * 100));
    const daysLeft = Math.ceil((harvest - today) / 86400000);
    const isComplete = daysLeft <= 0;

    // Status label
    let statusText, statusClass;
    if (isComplete) {
      statusText = 'Ready to Harvest'; statusClass = 'text-primary';
    } else if (daysLeft <= 14) {
      statusText = `${daysLeft}d to harvest`; statusClass = 'text-yellow-400';
    } else {
      statusText = `${daysLeft}d remaining`; statusClass = 'text-text-dim';
    }

    // Current stage
    let stageDaysCounted = 0, currentStage = info.stages[0];
    for (const stage of info.stages) {
      stageDaysCounted += stage.d;
      currentStage = stage;
      if (elapsed < stageDaysCounted) break;
    }

    // Stage progress bar segments
    const stageHtml = info.stages.map((s, i) => {
      const stageStart = info.stages.slice(0, i).reduce((a, x) => a + x.d, 0);
      const stageEnd   = stageStart + s.d;
      const stagePct   = Math.round((s.d / info.days) * 100);
      const filled     = elapsed >= stageEnd ? 100 : elapsed >= stageStart ? Math.round(((elapsed - stageStart) / s.d) * 100) : 0;
      return `<div class="flex-1 flex flex-col gap-1 min-w-0">
        <div class="h-2 rounded-full bg-surface-3 overflow-hidden">
          <div class="h-full rounded-full bg-primary transition-all" style="width:${filled}%"></div>
        </div>
        <p class="text-text-dim text-xs font-mono truncate">${s.n}</p>
      </div>`;
    }).join('');

    const cropLabel = t.crop.charAt(0).toUpperCase() + t.crop.slice(1);
    const sowLabel  = sow.toLocaleDateString('en-IN', { day:'numeric', month:'short' });
    const harvLabel = harvest.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });

    return `
      <div class="bg-surface rounded-xl border ${isComplete ? 'border-primary/40' : 'border-surface-2'} p-4 flex flex-col gap-3">
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-primary text-lg">eco</span>
              <span class="text-white font-display font-bold">${cropLabel}</span>
              ${isComplete ? '<span class="px-2 py-0.5 bg-primary/20 text-primary text-xs rounded-full font-mono">Harvest!</span>' : ''}
            </div>
            <p class="text-text-dim text-xs font-mono mt-1">Sown ${sowLabel} · Harvest ~${harvLabel}</p>
          </div>
          <button onclick="removeCropTimeline(${t.id})"
            class="text-text-dim hover:text-red-400 transition-colors">
            <span class="material-symbols-outlined text-sm">delete</span>
          </button>
        </div>

        <!-- Overall progress -->
        <div>
          <div class="flex justify-between text-xs mb-1.5">
            <span class="text-text-dim font-mono">Day ${elapsed} / ${info.days}</span>
            <span class="font-mono font-bold ${statusClass}">${statusText}</span>
          </div>
          <div class="h-2 rounded-full bg-surface-3 overflow-hidden">
            <div class="h-full rounded-full transition-all ${isComplete ? 'bg-primary' : 'bg-primary/70'}" style="width:${pct}%"></div>
          </div>
          <p class="text-text-dim text-xs font-mono mt-1">${pct}% complete · Currently: <span class="text-white">${currentStage.n}</span></p>
        </div>

        <!-- Stage breakdown -->
        <div class="flex gap-2 items-end pt-1 border-t border-surface-2">
          ${stageHtml}
        </div>
      </div>`;
  }).join('');
}

// ── Wire calendar button in header ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const calBtn = document.querySelector('[data-cal-btn]') ||
    (() => {
      // Find the calendar_today button in the header and add the handler
      document.querySelectorAll('button').forEach(btn => {
        if (btn.querySelector('.material-symbols-outlined')?.textContent?.trim() === 'calendar_today') {
          btn.setAttribute('onclick', 'openCalendar()');
        }
      });
    })();
});


// ── 7. Settings ───────────────────────────────────────────────────────────────

const SETTINGS_KEY = 'agri_settings';

const DEFAULT_SETTINGS = {
  appTitle:      'AgriSense',
  farmName:      '',
  farmLocation:  '',
  cropType:      '',
  theme:         'dark',
  language:      'en',
  sidebarStyle:  'full',
  units: { temp: 'C', wind: 'kmh', rain: 'mm' },
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

function persistSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ── Unit conversion helpers ───────────────────────────────────────────────────
function getUnits() {
  return loadSettings().units || DEFAULT_SETTINGS.units;
}

function cvtTemp(c) {
  // c = Celsius from API
  const u = getUnits();
  if (u.temp === 'F') return { val: Math.round(c * 9/5 + 32), unit: '°F' };
  return { val: Math.round(c), unit: '°C' };
}

function cvtWind(kmh) {
  const u = getUnits();
  if (u.wind === 'mph') return { val: Math.round(kmh * 0.621371 * 10) / 10, unit: 'mph' };
  return { val: kmh, unit: 'km/h' };
}

function cvtRain(mm) {
  const u = getUnits();
  if (u.rain === 'in') return { val: Math.round(mm * 0.0393701 * 100) / 100, unit: 'in' };
  return { val: mm, unit: 'mm' };
}

// Format helpers — return "23°C" style strings
function fmtTemp(c)   { const {val,unit} = cvtTemp(c);  return `${val}${unit}`; }
function fmtWind(kmh) { const {val,unit} = cvtWind(kmh); return `${val} ${unit}`; }
function fmtRain(mm)  { const {val,unit} = cvtRain(mm);  return `${val} ${unit}`; }

// ── Apply settings to DOM on load ────────────────────────────────────────────
function applySettings(s) {
  // Title
  const title = s.appTitle || 'AgriSense';
  document.title = title;
  const logoText = document.querySelector('aside h1');
  if (logoText) logoText.textContent = title;
  const aboutTitle = document.getElementById('st-about-title');
  if (aboutTitle) aboutTitle.textContent = title;

  // Theme — handled entirely by applyLightDark(); do not apply here to avoid conflict

  // Sidebar
  document.body.classList.remove('sidebar-compact');
  if (s.sidebarStyle === 'compact') document.body.classList.add('sidebar-compact');

  // Populate settings inputs
  const fields = {
    'st-app-title':     s.appTitle,
    'st-farm-name':     s.farmName,
    'st-farm-location': s.farmLocation,
    'st-crop-type':     s.cropType,
  };
  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  });

  // Theme buttons
  document.querySelectorAll('.theme-btn').forEach(btn => {
    const active = btn.dataset.theme === (s.theme || 'dark');
    btn.className = btn.className
      .replace(/ring-2 ring-\S+ ring-offset-2 ring-offset-bg-mid/g, '')
      .replace(/border-primary\/40 bg-primary\/10 text-white/g, 'border-surface-2 bg-surface-2 text-text-dim')
      .trim();
    if (active) {
      btn.classList.remove('border-surface-2', 'bg-surface-2', 'text-text-dim');
      btn.classList.add('border-primary/40', 'bg-primary/10', 'text-white',
        'ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-bg-mid');
    }
  });

  // Sidebar buttons
  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    const active = btn.dataset.sidebar === (s.sidebarStyle || 'full');
    btn.classList.toggle('border-primary/40', active);
    btn.classList.toggle('bg-primary/10',    active);
    btn.classList.toggle('text-white',        active);
    btn.classList.toggle('ring-2',            active);
    btn.classList.toggle('ring-primary',      active);
    btn.classList.toggle('ring-offset-2',     active);
    btn.classList.toggle('ring-offset-bg-mid',active);
    btn.classList.toggle('border-surface-2',  !active);
    btn.classList.toggle('bg-surface-2',      !active);
    btn.classList.toggle('text-text-dim',     !active);
  });

  // Unit buttons
  const units = s.units || DEFAULT_SETTINGS.units;
  [['temp',['C','F']], ['wind',['kmh','mph']], ['rain',['mm','in']]].forEach(([key, opts]) => {
    opts.forEach(opt => {
      const el = document.getElementById(`unit-${key}-${opt}`);
      if (!el) return;
      const active = units[key] === opt;
      el.className = `unit-btn flex-1 py-2 text-sm font-mono transition-colors ${
        active ? 'bg-primary/15 text-primary' : 'bg-surface-2 text-text-dim hover:text-white'}`;
    });
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────
function saveAppTitle() {
  const s = loadSettings();
  s.appTitle = document.getElementById('st-app-title').value.trim() || 'AgriSense';
  persistSettings(s);
  applySettings(s);
  flashToast('st-profile-toast');
}

function saveProfile() {
  const s = loadSettings();
  s.appTitle     = document.getElementById('st-app-title').value.trim()     || 'AgriSense';
  s.farmName     = document.getElementById('st-farm-name').value.trim();
  s.farmLocation = document.getElementById('st-farm-location').value.trim();
  s.cropType     = document.getElementById('st-crop-type').value;
  persistSettings(s);
  applySettings(s);
  flashToast('st-profile-toast');

  // If a farm location was set, use it as default weather location
  if (s.farmLocation) {
    const ovInput = document.getElementById('ov-location-input');
    if (ovInput && !ovInput.value) ovInput.value = s.farmLocation;
  }
}

function setTheme(theme) {
  const s = loadSettings();
  s.theme      = theme;
  s.colourMode = theme;
  s.lightMode  = (theme === 'light');
  persistSettings(s);
  applySettings(s);
  applyLightDark(theme);
}

function setSidebarStyle(style) {
  const s = loadSettings();
  s.sidebarStyle = style;
  persistSettings(s);
  applySettings(s);
}

function setUnit(key, val) {
  const s = loadSettings();
  s.units = s.units || {};
  s.units[key] = val;
  persistSettings(s);
  applySettings(s);
  // Re-render both pages from cache so values update immediately
  if (_cachedWeather) {
    populateOverview(_cachedWeather);
    if (document.getElementById('weather-current') &&
        !document.getElementById('weather-current').classList.contains('hidden')) {
      renderWeather(_cachedWeather);
    }
  }
}

function resetAllSettings() {
  if (!confirm('Reset all settings to defaults?')) return;
  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem('agri_timelines');
  applySettings({ ...DEFAULT_SETTINGS });
  flashToast('st-profile-toast');
}

function flashToast(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
  el.classList.add('flex');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.classList.add('hidden');
    el.classList.remove('flex');
  }, 2500);
}

// ── Register settings page + boot ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Add settings to page registry so showPage() handles it
  pages['settings'] = { title: 'Settings', sub: 'Customise your AgriSense dashboard' };

  // Apply saved settings immediately
  const _bootSettings = loadSettings();
  applySettings(_bootSettings);
  _applyThemeFromSettings(_bootSettings);
});


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12 — i18n  (Internationalisation)
// ═══════════════════════════════════════════════════════════════════════════════

const SUPPORTED_LANGS = ['en', 'ml', 'hi'];
let _translations  = {};   // active language strings
let _currentLang   = 'en';

// ── Load a language JSON file and apply it ────────────────────────────────────
async function setLanguage(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) lang = 'en';
  try {
    const res  = await fetch(`/static/translations/${lang}.json`);
    const data = await res.json();
    _translations = data;
    _currentLang  = lang;
    applyTranslations();
    // Persist in settings
    const s = loadSettings();
    s.language = lang;
    persistSettings(s);
    // Sync dropdown and active label in settings
    const sel = document.getElementById('language-select');
    if (sel) sel.value = lang;
    const LANG_NAMES = { en: 'English', ml: 'മലയാളം', hi: 'हिन्दी' };
    const lbl = document.getElementById('lang-active-label');
    if (lbl) lbl.textContent = LANG_NAMES[lang] || lang;
  } catch(e) {
    console.warn('i18n load error:', e);
  }
}

// ── Translate a key, return English fallback if missing ───────────────────────
function t(key) {
  return _translations[key] || key;
}

// ── Walk DOM and replace text content for all [data-i18n] elements ────────────
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const val = t(key);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = val;
    } else {
      el.textContent = val;
    }
  });
  // data-i18n-html for elements that need innerHTML
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  // data-i18n-placeholder for input placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  // data-i18n-title for button/element titles (tooltips)
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  // Re-translate the live page title/subtitle when language changes
  const activePage = document.querySelector('.page.active');
  if (activePage) {
    const name = activePage.id.replace('page-', '');
    if (pages[name]) {
      const titleEl = document.getElementById('page-title');
      const subEl   = document.getElementById('page-subtitle');
      if (titleEl) titleEl.textContent = t(pages[name].titleKey);
      if (subEl)   subEl.textContent   = t(pages[name].subKey);
    }
  }
}

// ── Disease label → JSON key mapping ─────────────────────────────────────────
const DISEASE_KEY_MAP = {
  "black sigatoka":"black_sigatoka","bract mosaic virus":"bract_mosaic_virus",
  "healthy":"healthy","insect pest damage":"insect_pest_damage",
  "moko disease":"moko_disease","panama disease":"panama_disease",
  "yellow sigatoka":"yellow_sigatoka","cercospora":"cercospora",
  "miner":"miner","phoma":"phoma","rust":"rust","blight":"blight",
  "common_rust":"common_rust","gray_leaf_spot":"gray_leaf_spot",
  "anthracnose":"anthracnose","bacterial canker":"bacterial_canker",
  "cutting weevil":"cutting_weevil","die back":"die_back",
  "gall midge":"gall_midge","powdery mildew":"powdery_mildew",
  "sooty mould":"sooty_mould","bacterial_leaf_blight":"bacterial_leaf_blight",
  "bacterial_leaf_streak":"bacterial_leaf_streak",
  "bacterial_panicle_blight":"bacterial_panicle_blight",
  "blast":"blast","brown_spot":"brown_spot","dead_heart":"dead_heart",
  "downy_mildew":"downy_mildew","hispa":"hispa","normal":"healthy","tungro":"tungro",
};

// ── LibreTranslate fallback for unknown dynamic strings ───────────────────────
const LIBRETRANSLATE_URL = 'https://libretranslate.com/translate';
const _translateCache = {};

async function translateDynamic(text, targetLang) {
  if (!text || targetLang === 'en') return text;
  const cacheKey = `${targetLang}:${text}`;
  if (_translateCache[cacheKey]) return _translateCache[cacheKey];
  try {
    const res = await fetch(LIBRETRANSLATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: 'en', target: targetLang, format: 'text' })
    });
    const data = await res.json();
    const translated = data.translatedText || text;
    _translateCache[cacheKey] = translated;
    return translated;
  } catch(e) {
    console.warn('LibreTranslate unavailable, using English fallback');
    return text;
  }
}

// ── Translate a disease action string ─────────────────────────────────────────
async function translateDiseaseAction(diseaseLabel, actionText) {
  if (_currentLang === 'en') return actionText;
  const key = DISEASE_KEY_MAP[diseaseLabel.toLowerCase()];
  if (key) {
    const jsonKey = `disease.action.${key}`;
    const val = _translations[jsonKey];
    if (val) return val;
  }
  // Fallback to LibreTranslate
  return await translateDynamic(actionText, _currentLang);
}

// ── Translate a crop reason string ────────────────────────────────────────────
async function translateCropReason(cropName, reasonText) {
  if (_currentLang === 'en') return reasonText;
  const key = `crop.reason.${cropName.toLowerCase().replace(/\s+/g,'_')}`;
  const val = _translations[key];
  if (val) return val;
  return await translateDynamic(reasonText, _currentLang);
}

// ── Translate crop tips array ─────────────────────────────────────────────────
async function translateCropTips(cropName, tips) {
  if (_currentLang === 'en' || !tips) return tips;
  return Promise.all(tips.map((tip, i) => {
    const key = `crop.tips.${cropName.toLowerCase().replace(/\s+/g,'_')}.${i}`;
    const val = _translations[key];
    return val ? Promise.resolve(val) : translateDynamic(tip, _currentLang);
  }));
}

// ── Translate weather alert text ──────────────────────────────────────────────
async function translateAlertText(text) {
  if (_currentLang === 'en' || !text) return text;
  return await translateDynamic(text, _currentLang);
}

// ── Boot: load saved language on startup ─────────────────────────────────────
(async function initI18n() {
  const s = loadSettings();
  await setLanguage(s.language || 'en');
})();

// ── 8. Theme toggle — dark ↔ light ───────────────────────────────────────────

function applyLightDark(mode) {
  // Normalise: accept legacy boolean values from old localStorage
  if (mode === true  || mode === 'silver') mode = 'light';
  if (mode === false || !mode)             mode = 'dark';

  // Apply body class — this is the single place that sets the theme
  document.body.classList.remove('light');
  if (mode === 'light') document.body.classList.add('light');

  // Update toggle icon in header
  const icon = document.getElementById('theme-toggle-icon');
  if (icon) icon.textContent = mode === 'light' ? 'dark_mode' : 'light_mode';

  // Update toggle label in Settings page
  const stIcon  = document.getElementById('st-mode-icon');
  const stLabel = document.getElementById('st-mode-label');
  if (stIcon)  stIcon.textContent  = mode === 'light' ? 'dark_mode' : 'light_mode';
  if (stLabel) stLabel.textContent = mode === 'light' ? t('settings.dark_mode') : t('settings.light_mode');
}

function toggleDarkLight() {
  const s      = loadSettings();
  // Read current mode from the body class — not from settings —
  // so the toggle always reflects what is actually visible on screen
  const isLight = document.body.classList.contains('light');
  const next    = isLight ? 'dark' : 'light';

  // Persist under all keys so nothing gets out of sync
  s.colourMode = next;
  s.theme      = next;
  s.lightMode  = (next === 'light');
  persistSettings(s);
  applyLightDark(next);
}


// ── 9. Disease AI — two-stage detection ───────────────────────────────────────

const CROP_ICONS = {
  banana: "🍌", coffee: "☕", corn: "🌽", mango: "🥭", paddy: "🌾", default: "🌿"
};

const SEVERITY_STYLES = {
  none:     { bg: "#13ec49", text: "#0b1a10", labelKey: "disease.severity_none" },
  low:      { bg: "#84cc16", text: "#1a2e05", labelKey: "disease.severity_low" },
  medium:   { bg: "#f59e0b", text: "#1c1404", labelKey: "disease.severity_medium" },
  high:     { bg: "#ef4444", text: "#1c0404", labelKey: "disease.severity_high" },
  critical: { bg: "#dc2626", text: "#fff",    label: "Critical" },
  unknown:  { bg: "#6b7280", text: "#fff",    label: "Unknown" },
};



let _diseaseHistory = JSON.parse(localStorage.getItem('agri_disease_history') || '[]');
let _selectedFile   = null;

// ── Boot: load model status and render history ────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadDiseaseStatus();
  renderDiseaseHistory();
});

async function loadDiseaseStatus() {
  const list = document.getElementById('dis-model-list');
  const bar  = document.getElementById('dis-status-bar');
  try {
    const resp = await fetch('/api/disease/crops');
    const data = await resp.json();

    // Header status bar
    const ready = data.crops.filter(c => c.ready).length;
    if (bar) {
      bar.innerHTML = `
        <span class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border ${
          ready === data.crops.length
            ? 'bg-primary/10 text-primary border-primary/20'
            : 'bg-orange-500/10 text-orange-300 border-orange-500/20'
        }">
          <span class="material-symbols-outlined text-sm">${ready === data.crops.length ? 'check_circle' : 'warning'}</span>
          ${ready}/${data.crops.length} Models Ready
        </span>`;
    }

    // Model list — per-file status rows, ensemble badge for banana
    if (list && data.crops) {
      list.innerHTML = data.crops.map(c => {
        const allOk   = c.models.every(m => m.found);
        const dot     = allOk ? 'bg-primary' : (c.models.some(m => m.found) ? 'bg-yellow-400' : 'bg-red-400');
        const fileRows = c.models.map(m => `
          <div class="flex items-center gap-1.5 ml-5 mt-0.5">
            <span class="material-symbols-outlined text-xs ${m.found ? 'text-primary/50' : 'text-red-400/70'}">
              ${m.found ? 'check' : 'close'}
            </span>
            <span class="text-text-dim text-xs font-mono truncate">${m.file}</span>
          </div>`).join('');
        return `
          <div class="py-1.5 border-b border-surface-2 last:border-0">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full flex-shrink-0 ${dot}"></span>
              <span class="text-white text-xs font-mono capitalize flex-1">${c.name}</span>
              ${c.ensemble ? '<span class="px-1.5 py-0.5 bg-primary/10 text-primary text-xs font-mono rounded border border-primary/20">ensemble×3</span>' : ''}
              <span class="text-text-dim text-xs font-mono">${c.num_classes} cls</span>
            </div>
            ${fileRows}
          </div>`;
      }).join('');
    }
  } catch (e) {
    if (list) list.innerHTML = '<p class="text-text-dim text-xs font-mono">Server not reachable.</p>';
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION — Camera Capture (Disease AI)
// ═══════════════════════════════════════════════════════════════════════════════

let _cameraStream   = null;   // active MediaStream
let _cameraFacingMode = 'environment';  // 'environment' = rear, 'user' = front

async function openCamera() {
  const modal = document.getElementById('camera-modal');
  const video = document.getElementById('camera-video');
  const errEl = document.getElementById('camera-error');
  const errMsg = document.getElementById('camera-error-msg');
  const capBtn = document.getElementById('camera-capture-btn');

  modal.classList.remove('hidden');
  errEl.classList.add('hidden');
  if (capBtn) capBtn.disabled = false;

  // Check if getUserMedia is supported
  if (!navigator.mediaDevices?.getUserMedia) {
    errEl.classList.remove('hidden');
    if (errMsg) errMsg.textContent = t('disease.camera_not_supported');
    return;
  }

  await _startCameraStream();
}

async function _startCameraStream() {
  const video  = document.getElementById('camera-video');
  const errEl  = document.getElementById('camera-error');
  const errMsg = document.getElementById('camera-error-msg');

  // Stop any existing stream first
  if (_cameraStream) {
    _cameraStream.getTracks().forEach(t => t.stop());
    _cameraStream = null;
  }

  try {
    _cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: _cameraFacingMode,
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    video.srcObject = _cameraStream;
    video.classList.remove('hidden');
  } catch(err) {
    errEl.classList.remove('hidden');
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      if (errMsg) errMsg.textContent = t('disease.camera_denied');
    } else if (err.name === 'NotFoundError') {
      if (errMsg) errMsg.textContent = t('disease.camera_not_found');
    } else {
      if (errMsg) errMsg.textContent = t('disease.camera_error') + ': ' + err.message;
    }
    console.warn('Camera error:', err);
  }
}

async function flipCamera() {
  _cameraFacingMode = _cameraFacingMode === 'environment' ? 'user' : 'environment';
  await _startCameraStream();
}

function capturePhoto() {
  const video   = document.getElementById('camera-video');
  const canvas  = document.getElementById('camera-canvas');
  const flash   = document.getElementById('camera-flash');

  if (!_cameraStream || !video.videoWidth) return;

  // Flash effect
  if (flash) {
    flash.style.opacity = '0.7';
    setTimeout(() => { flash.style.opacity = '0'; }, 150);
  }

  // Draw video frame to canvas at full resolution
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  // Convert canvas to a File object
  canvas.toBlob(blob => {
    if (!blob) return;
    const file = new File([blob], 'camera_capture.jpg', { type: 'image/jpeg' });

    // Inject into the existing disease upload pipeline
    _selectedFile = file;

    // Show preview in the upload zone
    const placeholder = document.getElementById('dis-upload-placeholder');
    const preview     = document.getElementById('dis-preview');
    if (placeholder) placeholder.classList.add('hidden');
    if (preview) {
      preview.src = URL.createObjectURL(file);
      preview.classList.remove('hidden');
    }

    resetDiseaseResult();
    _updateAnalyzeBtn();

    // Close camera after short delay so user sees the flash
    setTimeout(() => closeCamera(), 200);

  }, 'image/jpeg', 0.92);
}

function closeCamera() {
  const modal = document.getElementById('camera-modal');
  const video = document.getElementById('camera-video');

  // Stop all camera tracks
  if (_cameraStream) {
    _cameraStream.getTracks().forEach(t => t.stop());
    _cameraStream = null;
  }
  if (video) video.srcObject = null;
  if (modal) modal.classList.add('hidden');
}

// Close camera modal on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCamera();
});

// ── File selection ────────────────────────────────────────────────────────────
function onDiseaseFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  _selectedFile = file;

  const placeholder = document.getElementById('dis-upload-placeholder');
  const preview     = document.getElementById('dis-preview');
  if (placeholder) placeholder.classList.add('hidden');
  if (preview) {
    preview.src = URL.createObjectURL(file);
    preview.classList.remove('hidden');
  }
  resetDiseaseResult();
  _updateAnalyzeBtn();
}

function onCropSelected() {
  _updateAnalyzeBtn();
}

function _updateAnalyzeBtn() {
  const hasFile = !!_selectedFile;
  const hasCrop = !!document.getElementById('dis-crop-select')?.value;
  const btn     = document.getElementById('dis-analyze-btn');
  const hint    = document.getElementById('dis-btn-hint');

  if (hasFile && hasCrop) {
    btn.disabled  = false;
    btn.className = 'w-full py-3 bg-primary text-bg-deep font-bold text-sm rounded-xl hover:bg-primary-dim transition-all flex items-center justify-center gap-2 cursor-pointer';
    if (hint) hint.classList.add('hidden');
  } else {
    btn.disabled  = true;
    btn.className = 'w-full py-3 bg-surface-3 text-text-dim font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 cursor-not-allowed opacity-60';
    if (hint) {
      hint.classList.remove('hidden');
      hint.textContent = !hasFile && !hasCrop ? t('disease.upload_hint')
                       : !hasFile             ? t('disease.upload_image_hint')
                                              : t('disease.select_crop_hint');
    }
  }
}

// ── Main analysis ─────────────────────────────────────────────────────────────
async function runDiseaseAnalysis() {
  const crop = document.getElementById('dis-crop-select')?.value;
  if (!_selectedFile || !crop) {
    _updateAnalyzeBtn();
    return;
  }

  const btn = document.getElementById('dis-analyze-btn');
  btn.disabled = true;

  showDiseaseLoading(true, `Analysing ${crop} disease…`, 1);

  const formData = new FormData();
  formData.append('image', _selectedFile);
  formData.append('crop', crop);

  try {
    // Small delay so user sees stage 1 message
    await new Promise(r => setTimeout(r, 400));
    showDiseaseLoading(true, 'Running disease model…', 2);

    const resp = await fetch('/api/disease/analyze', { method: 'POST', body: formData });
    const data = await resp.json();

    if (!resp.ok) {
      const detail = [data.error, data.stage ? `(stage: ${data.stage})` : ''].filter(Boolean).join(' ');
      const err = new Error(detail || `Server error ${resp.status}`);
      err._reason = data.reason || null;   // e.g. 'not_a_leaf', 'blurry', etc.
      throw err;
    }

    showDiseaseLoading(false);
    renderDiseaseResult(data);
    addDiseaseHistory(data, _selectedFile);

  } catch (err) {
    showDiseaseLoading(false);
    _showDiseaseError(err._reason || null, err.message);
  } finally {
    btn.disabled = false;
  }
}

// ── Render result ─────────────────────────────────────────────────────────────

// ── Disease error display — shows specific icon + hint per rejection reason ───
const _QUALITY_ERROR_META = {
  not_a_leaf:  { icon: 'eco',           color: 'orange', title: 'disease.err_not_leaf',  hint: 'disease.hint_not_leaf'  },
  blurry:      { icon: 'blur_on',       color: 'yellow', title: 'disease.err_blurry',    hint: 'disease.hint_blurry'    },
  too_dark:    { icon: 'brightness_low',color: 'yellow', title: 'disease.err_dark',      hint: 'disease.hint_dark'      },
  overexposed: { icon: 'wb_sunny',      color: 'yellow', title: 'disease.err_exposed',   hint: 'disease.hint_exposed'   },
  too_small:   { icon: 'photo_size_select_small', color: 'red', title: 'disease.err_small', hint: 'disease.hint_small' },
};

function _showDiseaseError(reason, message) {
  document.getElementById('dis-empty')?.classList.add('hidden');
  document.getElementById('dis-result')?.classList.add('hidden');

  const wrap  = document.getElementById('dis-error');
  const icon  = document.getElementById('dis-error-icon');
  const iconW = document.getElementById('dis-error-icon-wrap');
  const title = document.getElementById('dis-error-title');
  const msg   = document.getElementById('dis-error-msg');
  const hint  = document.getElementById('dis-error-hint');

  const meta = reason ? (_QUALITY_ERROR_META[reason] || null) : null;

  if (meta) {
    const c = meta.color;
    const colorMap = {
      orange: { icon:'text-orange-400', wrap:'bg-orange-500/10 border-orange-500/20', box:'bg-orange-500/5 border-orange-500/20' },
      yellow: { icon:'text-yellow-400', wrap:'bg-yellow-500/10 border-yellow-500/20', box:'bg-yellow-500/5 border-yellow-500/20' },
      red:    { icon:'text-red-400',    wrap:'bg-red-500/10 border-red-500/20',        box:'bg-red-500/5 border-red-500/20'        },
    };
    const cols = colorMap[c] || colorMap.red;
    if (icon)  { icon.textContent = meta.icon; icon.className = `material-symbols-outlined ${cols.icon}`; }
    if (iconW) iconW.className = `w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${cols.wrap}`;
    if (wrap)  wrap.className  = `rounded-xl p-5 flex flex-col gap-3 border ${cols.box}`;
    if (title) title.textContent = t(meta.title);
    if (hint)  { hint.textContent = t(meta.hint); hint.classList.remove('hidden'); }
  } else {
    // Generic error styling
    if (icon)  { icon.textContent = 'error'; icon.className = 'material-symbols-outlined text-red-400'; }
    if (iconW) iconW.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-red-500/10 border border-red-500/20';
    if (wrap)  wrap.className  = 'rounded-xl p-5 flex flex-col gap-3 border bg-red-500/5 border-red-500/20';
    if (title) title.textContent = t('disease.analysis_failed');
    if (hint)  hint.classList.add('hidden');
  }

  if (msg) msg.textContent = message || '';
  wrap?.classList.remove('hidden');
}

function renderDiseaseResult(data) {
  document.getElementById('dis-empty').classList.add('hidden');
  document.getElementById('dis-error').classList.add('hidden');
  const hint = document.getElementById('dis-error-hint');
  if (hint) hint.classList.add('hidden');
  document.getElementById('dis-result').classList.remove('hidden');

  const crop   = data.crop;
  const top    = data.predictions[0];
  const colour = top.colour || '#6b7280';
  const sevLabel = {
    none:'Healthy', low:'Low', medium:'Moderate', high:'High', critical:'Critical', unknown:'Unknown',
    get _t() { return {
      none: t('disease.severity_none') || 'Healthy',
      low: t('disease.severity_low') || 'Low',
      medium: t('disease.severity_medium') || 'Moderate',
      high: t('disease.severity_high') || 'High',
      critical: t('disease.severity_critical') || 'Critical',
      unknown: t('common.no_data') || 'Unknown',
    }; }
  };

  // Crop banner
  document.getElementById('dis-crop-icon-wrap').textContent = CROP_ICONS[crop] || CROP_ICONS.default;
  document.getElementById('dis-crop-name').textContent      = crop;
  document.getElementById('dis-crop-badge').textContent     =
    data.manual_crop ? 'Manual' : `${data.crop_confidence}% confident`;
  // Ensemble badge
  const modelNameEl = document.getElementById('dis-crop-model-name');
  if (modelNameEl) {
    modelNameEl.textContent = data.ensemble
      ? `Ensemble (${data.models_used.length} models)`
      : (data.models_used?.[0] || crop);
  }

  // Primary diagnosis card
  const primary = document.getElementById('dis-primary');
  primary.style.borderColor = colour;

  document.getElementById('dis-disease-name').textContent = top.label;
  document.getElementById('dis-confidence').textContent   = top.confidence + '%';
  translateDiseaseAction(top.disease || '', top.action || 'Consult an agricultural officer.').then(ta => {
    document.getElementById('dis-action').textContent = ta;
  });

  const dot  = document.getElementById('dis-severity-dot');
  const slbl = document.getElementById('dis-severity-label');
  dot.style.backgroundColor = colour;
  slbl.textContent           = (sevLabel._t[top.severity] || 'Unknown') + ' ' + t('disease.severity_suffix');
  slbl.style.color           = colour;

  const confBar = document.getElementById('dis-conf-bar');
  confBar.style.width           = top.confidence + '%';
  confBar.style.backgroundColor = colour;

  // All predictions breakdown
  document.getElementById('dis-predictions').innerHTML = data.predictions.map((p, i) => {
    const pcol = p.colour || '#6b7280';
    const slb  = sevLabel._t[p.severity] || 'Unknown';
    return `
    <div class="flex items-center gap-3 py-1 ${i < data.predictions.length-1 ? 'border-b border-surface-2' : ''}">
      <span class="text-text-dim text-xs font-mono w-4 flex-shrink-0">${i + 1}.</span>
      <div class="flex-1 min-w-0">
        <div class="flex justify-between mb-1 gap-2">
          <span class="text-white text-xs font-medium truncate">${p.label}</span>
          <span class="text-text-dim text-xs font-mono flex-shrink-0">${p.confidence}%</span>
        </div>
        <div class="h-1.5 bg-surface-2 rounded-full overflow-hidden">
          <div class="h-full rounded-full" style="width:${p.confidence}%;background:${pcol}"></div>
        </div>
      </div>
      <span class="px-2 py-0.5 rounded-full text-xs font-mono flex-shrink-0"
        style="background:${pcol}20;color:${pcol}">${slb}</span>
    </div>`;
  }).join('');
}

// ── History ───────────────────────────────────────────────────────────────────
function addDiseaseHistory(data, file) {
  const entry = {
    id:        Date.now(),
    crop:      data.crop,
    disease:   data.top_disease,
    confidence:data.confidence,
    severity:  data.severity,
    colour:    data.colour,
    time:      new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    imgUrl:    URL.createObjectURL(file),
  };
  _diseaseHistory.unshift(entry);
  if (_diseaseHistory.length > 12) _diseaseHistory = _diseaseHistory.slice(0, 12);
  // Note: object URLs don't survive refresh — store metadata only
  const storable = _diseaseHistory.map(({ imgUrl: _, ...rest }) => rest);
  try { localStorage.setItem('agri_disease_history', JSON.stringify(storable)); } catch {}
  renderDiseaseHistory();
}

function renderDiseaseHistory() {
  const el = document.getElementById('dis-history');
  if (!el) return;
  if (!_diseaseHistory.length) {
    el.innerHTML = `<div class="bg-surface rounded-xl border border-surface-2 p-4 flex flex-col items-center gap-2 text-center">
      <span class="material-symbols-outlined text-text-dim text-3xl">hourglass_empty</span>
      <p class="text-text-dim text-xs font-mono">${t('disease.no_scans')}</p></div>`;
    return;
  }
  el.innerHTML = _diseaseHistory.map(h => `
    <div class="bg-surface rounded-xl border border-surface-2 p-3 flex flex-col gap-2 hover:border-primary/30 transition-colors cursor-default">
      <div class="flex items-center justify-between">
        <span class="text-lg">${CROP_ICONS[h.crop] || '🌿'}</span>
        <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${h.colour}"></span>
      </div>
      <div>
        <p class="text-white text-xs font-medium capitalize leading-tight">${h.disease}</p>
        <p class="text-text-dim text-xs font-mono mt-0.5 capitalize">${h.crop}</p>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-text-dim text-xs font-mono">${h.confidence}%</span>
        <span class="text-text-dim text-xs font-mono">${h.time}</span>
      </div>
    </div>`).join('');
}

function clearDiseaseHistory() {
  _diseaseHistory = [];
  localStorage.removeItem('agri_disease_history');
  renderDiseaseHistory();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showDiseaseLoading(show, msg = '', stage = 1) {
  document.getElementById('dis-empty').classList.toggle('hidden', show);
  document.getElementById('dis-loading').classList.toggle('hidden', !show);
  if (show) {
    document.getElementById('dis-loading-msg').textContent = msg;
    document.getElementById('dis-loading').querySelector('.text-xs.font-mono').textContent =
      `Stage ${stage} of 2`;
    const s1 = document.getElementById('dis-stage-1');
    const s2 = document.getElementById('dis-stage-2');
    if (stage === 1) {
      s1.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 text-primary border border-primary/30 text-xs font-mono';
      s2.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 text-text-dim border border-surface-2 text-xs font-mono';
    } else {
      s1.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 text-text-dim border border-surface-2 text-xs font-mono';
      s2.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 text-primary border border-primary/30 text-xs font-mono';
    }
  }
}

function resetDiseaseResult() {
  document.getElementById('dis-empty').classList.remove('hidden');
  document.getElementById('dis-result').classList.add('hidden');
  document.getElementById('dis-loading').classList.add('hidden');

  // Reset error panel completely — clear coloured className set by _showDiseaseError()
  // so the next error renders with fresh styling, not stale orange/yellow/red from before
  const errWrap  = document.getElementById('dis-error');
  const errIcon  = document.getElementById('dis-error-icon');
  const errIconW = document.getElementById('dis-error-icon-wrap');
  const errHint  = document.getElementById('dis-error-hint');
  const errMsg   = document.getElementById('dis-error-msg');
  const errTitle = document.getElementById('dis-error-title');

  if (errWrap)  { errWrap.className  = 'hidden rounded-xl p-5 flex flex-col gap-3 border bg-red-500/5 border-red-500/20'; }
  if (errIcon)  { errIcon.className  = 'material-symbols-outlined text-red-400'; errIcon.textContent = 'error'; }
  if (errIconW) { errIconW.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-red-500/10 border border-red-500/20'; }
  if (errHint)  { errHint.classList.add('hidden'); errHint.textContent = ''; }
  if (errMsg)   { errMsg.textContent = ''; }
  if (errTitle) { errTitle.textContent = t('disease.analysis_failed'); }
}

function resetDiseaseAnalysis() {
  _selectedFile = null;
  document.getElementById('dis-file-input').value = '';
  document.getElementById('dis-preview').classList.add('hidden');
  document.getElementById('dis-upload-placeholder').classList.remove('hidden');
  const sel = document.getElementById('dis-crop-select');
  if (sel) sel.value = '';
  _updateAnalyzeBtn();
  resetDiseaseResult();
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10 — History Page
// ═══════════════════════════════════════════════════════════════════════════════

const SEVERITY_COLOURS = {
  none: '#13ec49', low: '#a3e635', medium: '#fbbf24',
  high: '#f97316', critical: '#ef4444', unknown: '#7faa88'
};

let _histActiveTab = 'disease';

function histTab(tab) {
  _histActiveTab = tab;
  ['disease','weather','alerts','crop','soil'].forEach(t => {
    const btn   = document.getElementById(`hist-tab-${t}`);
    const panel = document.getElementById(`hist-panel-${t}`);
    if (t === tab) {
      btn.classList.add('bg-surface-2','text-white');
      btn.classList.remove('text-text-dim');
      panel.classList.remove('hidden');
    } else {
      btn.classList.remove('bg-surface-2','text-white');
      btn.classList.add('text-text-dim');
      panel.classList.add('hidden');
    }
  });
  if (tab === 'disease') loadDiseaseHistory();
  if (tab === 'weather') loadWeatherLog();
  if (tab === 'alerts')  loadAlerts();
  if (tab === 'crop')    loadCropHistory();
  if (tab === 'soil')    loadSoilHistoryLog();
}

async function loadHistorySummary() {
  try {
    const data = await fetch('/api/history/summary').then(r => r.json());
    const el = document.getElementById('hist-summary');
    if (!el) return;
    el.innerHTML = [
      { icon: 'biotech',         label: t('history.total_scans'),    val: data.disease_detections },
      { icon: 'landscape',       label: t('history.tab_soil'),       val: data.soil_readings ?? 0 },
      { icon: 'agriculture',     label: t('history.tab_crop'),       val: data.crop_recommendations ?? 0 },
      { icon: 'cloud',           label: t('history.weather_logs'),   val: data.weather_logs },
      { icon: 'notifications',   label: t('history.tab_alerts'),     val: data.total_alerts },
    ].map(c => `
      <div class="flex items-center gap-2 bg-surface rounded-lg px-3 py-2 border border-surface-2">
        <span class="material-symbols-outlined text-primary text-sm">${c.icon}</span>
        <span class="text-text-dim text-xs font-mono">${c.label}</span>
        <span class="text-white text-sm font-bold font-mono">${c.val ?? 0}</span>
      </div>`).join('');
    // Alert badge
    const badge = document.getElementById('hist-alert-badge');
    if (badge && data.unresolved_alerts > 0) {
      badge.textContent = data.unresolved_alerts;
      badge.classList.remove('hidden');
    }
  } catch(e) { console.warn('History summary failed', e); }
}

async function loadDiseaseHistory() {
  const crop  = document.getElementById('hist-crop-filter')?.value || '';
  const limit = document.getElementById('hist-limit')?.value || 50;
  const el    = document.getElementById('hist-disease-table');
  if (!el) return;
  el.innerHTML = '<div class="p-8 text-center text-text-dim text-sm font-mono">Loading…</div>';
  try {
    const params = new URLSearchParams({ limit });
    if (crop) params.append('crop', crop);
    const data = await fetch(`/api/history/disease?${params}`).then(r => r.json());
    if (!data.records?.length) {
      el.innerHTML = '<div class="p-8 text-center text-text-dim text-sm font-mono">No disease detections recorded yet.</div>';
      return;
    }
    el.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-surface-2 text-text-dim text-xs font-mono uppercase">
              <th class="px-4 py-3 text-left">Time</th>
              <th class="px-4 py-3 text-left">Crop</th>
              <th class="px-4 py-3 text-left">Disease</th>
              <th class="px-4 py-3 text-left">Confidence</th>
              <th class="px-4 py-3 text-left">Severity</th>
              <th class="px-4 py-3 text-left">Model</th>
              <th class="px-4 py-3 text-left"></th>
            </tr>
          </thead>
          <tbody id="hist-disease-tbody">
            ${data.records.map(r => _disRow(r)).join('')}
          </tbody>
        </table>
      </div>`;
  } catch(e) {
    el.innerHTML = `<div class="p-8 text-center text-red-400 text-sm font-mono">${t('common.failed_load')}: ${e.message}</div>`;
  }
}

function _disRow(r) {
  const col = SEVERITY_COLOURS[r.severity] || '#7faa88';
  const ts  = new Date(r.timestamp).toLocaleString();
  const crop_emoji = {banana:'🍌',coffee:'☕',corn:'🌽',mango:'🥭',paddy:'🌾'}[r.crop] || '🌿';
  return `
    <tr class="border-b border-surface-2/50 hover:bg-surface-2/30 transition-colors" id="dis-row-${r.id}">
      <td class="px-4 py-3 text-text-dim text-xs font-mono">${ts}</td>
      <td class="px-4 py-3 text-white capitalize">${crop_emoji} ${r.crop}</td>
      <td class="px-4 py-3 text-white font-medium">${r.disease}</td>
      <td class="px-4 py-3 font-mono font-bold" style="color:${col}">${r.confidence}%</td>
      <td class="px-4 py-3">
        <span class="px-2 py-0.5 rounded-full text-xs font-mono font-bold text-bg-deep"
          style="background:${col}">${r.severity}</span>
      </td>
      <td class="px-4 py-3 text-text-dim text-xs font-mono">${r.meta || '—'}</td>
      <td class="px-4 py-3">
        <button onclick="deleteDiseaseRecord(${r.id})"
          class="text-text-dim hover:text-red-400 transition-colors"
          title="Delete record">
          <span class="material-symbols-outlined text-base">delete</span>
        </button>
      </td>
    </tr>`;
}

async function deleteDiseaseRecord(id) {
  if (!confirm('Delete this record?')) return;
  try {
    await fetch(`/api/history/disease/${id}`, { method: 'DELETE' });
    document.getElementById(`dis-row-${id}`)?.remove();
    loadHistorySummary();
  } catch(e) { alert('Delete failed'); }
}

async function loadWeatherLog() {
  const el = document.getElementById('hist-weather-table');
  if (!el) return;
  el.innerHTML = '<div class="p-8 text-center text-text-dim text-sm font-mono">Loading…</div>';
  try {
    const data = await fetch('/api/history/weather?limit=48').then(r => r.json());
    if (!data.records?.length) {
      el.innerHTML = '<div class="p-8 text-center text-text-dim text-sm font-mono">No weather readings logged yet.</div>';
      return;
    }
    el.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-surface-2 text-text-dim text-xs font-mono uppercase">
              <th class="px-4 py-3 text-left">Time</th>
              <th class="px-4 py-3 text-left">Location</th>
              <th class="px-4 py-3 text-left">Temp</th>
              <th class="px-4 py-3 text-left">Humidity</th>
              <th class="px-4 py-3 text-left">Wind</th>
              <th class="px-4 py-3 text-left">Precip</th>
              <th class="px-4 py-3 text-left">UV</th>
              <th class="px-4 py-3 text-left">Condition</th>
            </tr>
          </thead>
          <tbody>
            ${data.records.map(r => {
              const fmt = (v, suffix='') => (v != null && v !== '' && !isNaN(v)) ? v+suffix : '—';
              return `
              <tr class="border-b border-surface-2/50 hover:bg-surface-2/30 transition-colors">
                <td class="px-4 py-3 text-text-dim text-xs font-mono">${new Date(r.timestamp).toLocaleString()}</td>
                <td class="px-4 py-3 text-white text-xs">${r.location || '—'}</td>
                <td class="px-4 py-3 text-white font-mono font-bold">${fmt(r.temp_c,'°C')}</td>
                <td class="px-4 py-3 text-white font-mono">${fmt(r.humidity,'%')}</td>
                <td class="px-4 py-3 text-white font-mono">${fmt(r.wind_kmh,' km/h')}</td>
                <td class="px-4 py-3 text-white font-mono">${fmt(r.precip_mm,' mm')}</td>
                <td class="px-4 py-3 text-white font-mono">${fmt(r.uv)}</td>
                <td class="px-4 py-3 text-text-dim text-xs capitalize">${r.condition || '—'}</td>
              </tr>`;}).join('')}
          </tbody>
        </table>
      </div>`;
  } catch(e) {
    el.innerHTML = `<div class="p-8 text-center text-red-400 text-sm font-mono">${t('common.failed_load')}: ${e.message}</div>`;
  }
}

async function loadAlerts() {
  const resolved = document.getElementById('hist-alert-filter')?.value || '';
  const el = document.getElementById('hist-alerts-list');
  if (!el) return;
  el.innerHTML = '<div class="p-8 text-center text-text-dim text-sm font-mono">Loading…</div>';
  try {
    const params = new URLSearchParams({ limit: 50 });
    if (resolved) params.append('resolved', resolved);
    const data = await fetch(`/api/history/alerts?${params}`).then(r => r.json());
    if (!data.records?.length) {
      el.innerHTML = '<div class="p-8 text-center text-text-dim text-sm font-mono bg-surface rounded-xl border border-surface-2">No alerts logged yet.</div>';
      return;
    }
    el.innerHTML = data.records.map(a => {
      const col = SEVERITY_COLOURS[a.severity] || '#7faa88';
      return `
        <div class="bg-surface rounded-xl border border-surface-2 p-4 flex items-start gap-4" id="alert-row-${a.id}">
          <div class="w-2 h-2 rounded-full mt-2 flex-shrink-0" style="background:${col}"></div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-white font-medium text-sm">${a.title}</span>
              <span class="px-2 py-0.5 rounded-full text-xs font-mono font-bold text-bg-deep"
                style="background:${col}">${a.severity}</span>
              <span class="text-text-dim text-xs font-mono">${a.alert_type}</span>
              ${a.resolved ? '<span class="text-xs text-green-400 font-mono">✓ resolved</span>' : ''}
            </div>
            ${a.message ? `<p class="text-text-dim text-xs mt-1">${a.message}</p>` : ''}
            <p class="text-text-dim text-xs font-mono mt-1">${new Date(a.timestamp).toLocaleString()}</p>
          </div>
          ${!a.resolved ? `
            <button onclick="resolveAlert(${a.id})"
              class="text-xs text-text-dim hover:text-primary font-mono transition-colors flex-shrink-0">
              Mark resolved
            </button>` : ''}
        </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = `<div class="p-8 text-center text-red-400 text-sm font-mono">${t('common.failed_load')}: ${e.message}</div>`;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION — Crop Recommendation History
// ═══════════════════════════════════════════════════════════════════════════════

async function loadCropHistory() {
  const season = document.getElementById('hist-crop-season-filter')?.value || '';
  const source = document.getElementById('hist-crop-source-filter')?.value || '';
  const limit  = document.getElementById('hist-crop-limit')?.value || 50;
  const el     = document.getElementById('hist-crop-table');
  if (!el) return;
  el.innerHTML = `<div class="p-8 text-center text-text-dim text-sm font-mono">${t('common.loading')}</div>`;
  try {
    const params = new URLSearchParams({ limit });
    if (season) params.append('season', season);
    if (source) params.append('source', source);
    const data = await fetch(`/api/history/crop?${params}`).then(r => r.json());
    if (!data.records?.length) {
      el.innerHTML = `<div class="p-8 text-center text-text-dim text-sm font-mono">${t('history.no_crop_records')}</div>`;
      return;
    }
    el.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-surface-2 text-text-dim text-xs font-mono uppercase">
              <th class="px-4 py-3 text-left">${t('history.date')}</th>
              <th class="px-4 py-3 text-left">${t('crops.recommendation')}</th>
              <th class="px-4 py-3 text-left">${t('disease.confidence')}</th>
              <th class="px-4 py-3 text-left">${t('crops.season')}</th>
              <th class="px-4 py-3 text-left">${t('history.source')}</th>
              <th class="px-4 py-3 text-left">N / P / K</th>
              <th class="px-4 py-3 text-left">pH</th>
              <th class="px-4 py-3 text-left">${t('overview.temperature')}</th>
              <th class="px-4 py-3 text-left">${t('crops.alternatives')}</th>
              <th class="px-4 py-3 text-left"></th>
            </tr>
          </thead>
          <tbody id="hist-crop-tbody">
            ${data.records.map(r => _cropRow(r)).join('')}
          </tbody>
        </table>
      </div>`;
  } catch(e) {
    el.innerHTML = `<div class="p-8 text-center text-red-400 text-sm font-mono">${t('common.failed_load')}: ${e.message}</div>`;
  }
}

const CROP_EMOJI = {
  rice:'🌾', wheat:'🌾', maize:'🌽', corn:'🌽', banana:'🍌', coffee:'☕',
  tomato:'🍅', cotton:'🌿', jute:'🌿', mango:'🥭', grapes:'🍇',
  watermelon:'🍉', papaya:'🧃', coconut:'🥥', lentil:'🫘', chickpea:'🫘',
  blackgram:'🫘', mungbean:'🫘', mothbeans:'🫘', pigeonpeas:'🫘', kidneybeans:'🫘',
};

function _cropRow(r) {
  const ts     = new Date(r.timestamp).toLocaleString();
  const emoji  = CROP_EMOJI[r.crop?.toLowerCase()] || '🌱';
  const srcBadge = r.source === 'sensor'
    ? `<span class="px-2 py-0.5 rounded-full text-xs font-mono bg-green-500/15 text-green-400 border border-green-500/25">${t('history.source_sensor')}</span>`
    : `<span class="px-2 py-0.5 rounded-full text-xs font-mono bg-surface-2 text-text-dim border border-surface-3">${t('history.source_manual')}</span>`;
  const alts = (r.all_scores || []).slice(1).map(s =>
    `<span class="text-xs text-text-dim font-mono">${CROP_EMOJI[s.crop?.toLowerCase()] || '🌱'} ${s.crop} (${s.confidence}%)</span>`
  ).join('<br>');
  const fmt = (v, suffix='') => (v != null) ? v + suffix : '—';
  return `
    <tr class="border-b border-surface-2/50 hover:bg-surface-2/30 transition-colors" id="crop-row-${r.id}">
      <td class="px-4 py-3 text-text-dim text-xs font-mono">${ts}</td>
      <td class="px-4 py-3">
        <span class="text-white font-bold capitalize">${emoji} ${r.crop}</span>
        <div class="text-text-dim text-xs font-mono mt-0.5 max-w-[180px] truncate" title="${r.reason || ''}">${r.reason || '—'}</div>
      </td>
      <td class="px-4 py-3 text-primary font-mono font-bold">${r.confidence}%</td>
      <td class="px-4 py-3 text-white capitalize font-mono text-xs">${r.season || '—'}</td>
      <td class="px-4 py-3">${srcBadge}</td>
      <td class="px-4 py-3 text-white font-mono text-xs">${fmt(r.nitrogen,'N')} / ${fmt(r.phosphorus,'P')} / ${fmt(r.potassium,'K')}</td>
      <td class="px-4 py-3 text-white font-mono text-xs">${fmt(r.ph)}</td>
      <td class="px-4 py-3 text-white font-mono text-xs">${fmt(r.temperature,'°C')}</td>
      <td class="px-4 py-3 text-xs leading-relaxed">${alts || '—'}</td>
      <td class="px-4 py-3">
        <button onclick="deleteCropRecord(${r.id})"
          class="text-text-dim hover:text-red-400 transition-colors" title="Delete">
          <span class="material-symbols-outlined text-base">delete</span>
        </button>
      </td>
    </tr>`;
}

async function deleteCropRecord(id) {
  if (!confirm(t('history.confirm_delete'))) return;
  try {
    await fetch(`/api/history/crop/${id}`, { method: 'DELETE' });
    document.getElementById(`crop-row-${id}`)?.remove();
    loadHistorySummary();
  } catch(e) { alert(t('common.failed')); }
}

async function clearCropHistory() {
  if (!confirm(t('history.confirm_clear_crop'))) return;
  try {
    await fetch('/api/history/crop/clear', { method: 'DELETE' });
    loadCropHistory();
    loadHistorySummary();
  } catch(e) { alert(t('history.clear_failed_crop')); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION — Soil Reading History (History page tab)
// ═══════════════════════════════════════════════════════════════════════════════

async function loadSoilHistoryLog() {
  const limit = document.getElementById('hist-soil-limit')?.value || 50;
  const el    = document.getElementById('hist-soil-table');
  if (!el) return;
  el.innerHTML = `<div class="p-8 text-center text-text-dim text-sm font-mono">${t('common.loading')}</div>`;
  try {
    const data = await fetch(`/api/history/soil?limit=${limit}`).then(r => r.json());
    if (!data.records?.length) {
      el.innerHTML = `<div class="p-8 text-center text-text-dim text-sm font-mono">${t('history.no_soil_records')}</div>`;
      return;
    }
    el.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-surface-2 text-text-dim text-xs font-mono uppercase">
              <th class="px-4 py-3 text-left">${t('history.date')}</th>
              <th class="px-4 py-3 text-left">pH</th>
              <th class="px-4 py-3 text-left">${t('soil.moisture')} %</th>
              <th class="px-4 py-3 text-left">${t('soil.temperature')} °C</th>
              <th class="px-4 py-3 text-left">N mg/kg</th>
              <th class="px-4 py-3 text-left">P mg/kg</th>
              <th class="px-4 py-3 text-left">K mg/kg</th>
              <th class="px-4 py-3 text-left">EC µS/cm</th>
              <th class="px-4 py-3 text-left"></th>
            </tr>
          </thead>
          <tbody id="hist-soil-tbody">
            ${data.records.map(r => _soilHistRow(r)).join('')}
          </tbody>
        </table>
      </div>`;
  } catch(e) {
    el.innerHTML = `<div class="p-8 text-center text-red-400 text-sm font-mono">${t('common.failed_load')}: ${e.message}</div>`;
  }
}

const SOIL_STATUS_COLOUR = { ok:'text-green-400', low:'text-yellow-400', high:'text-red-400', unknown:'text-text-dim' };

function _soilHistRow(r) {
  const ts  = new Date(r.timestamp).toLocaleString();
  const fmt = (v, dec=1) => (v != null && !isNaN(v)) ? parseFloat(v).toFixed(dec) : '—';
  const badge = (v, key) => {
    const s = r.status?.[key] || 'unknown';
    const c = SOIL_STATUS_COLOUR[s] || 'text-text-dim';
    return `<span class="font-mono font-bold ${c}">${fmt(v)}</span>`;
  };
  return `
    <tr class="border-b border-surface-2/50 hover:bg-surface-2/30 transition-colors" id="soil-hist-row-${r.id}">
      <td class="px-4 py-3 text-text-dim text-xs font-mono">${ts}</td>
      <td class="px-4 py-3">${badge(r.ph,   'ph')}</td>
      <td class="px-4 py-3">${badge(r.moisture,    'moisture')}</td>
      <td class="px-4 py-3">${badge(r.temperature, 'temperature')}</td>
      <td class="px-4 py-3">${badge(r.nitrogen,    'nitrogen')}</td>
      <td class="px-4 py-3">${badge(r.phosphorus,  'phosphorus')}</td>
      <td class="px-4 py-3">${badge(r.potassium,   'potassium')}</td>
      <td class="px-4 py-3">${badge(r.conductivity,'conductivity')}</td>
      <td class="px-4 py-3">
        <button onclick="deleteSoilRecord(${r.id})"
          class="text-text-dim hover:text-red-400 transition-colors" title="Delete">
          <span class="material-symbols-outlined text-base">delete</span>
        </button>
      </td>
    </tr>`;
}

async function deleteSoilRecord(id) {
  if (!confirm(t('history.confirm_delete'))) return;
  try {
    await fetch(`/api/history/soil/${id}`, { method: 'DELETE' });
    document.getElementById(`soil-hist-row-${id}`)?.remove();
    loadHistorySummary();
  } catch(e) { alert(t('common.failed')); }
}

async function clearSoilHistoryLog() {
  if (!confirm(t('history.confirm_clear_soil'))) return;
  try {
    await fetch('/api/history/soil/clear', { method: 'DELETE' });
    loadSoilHistoryLog();
    loadHistorySummary();
  } catch(e) { alert(t('history.clear_failed_soil')); }
}


async function clearWeatherLog() {
  if (!confirm('Clear all weather log entries? This cannot be undone.')) return;
  try {
    const res = await fetch('/api/history/weather/clear', { method: 'DELETE' });
    const data = await res.json();
    if (data.error) { alert(t('common.failed') + ': ' + data.error); return; }
    loadWeatherLog();
    loadHistorySummary();
  } catch(e) { alert(t('history.clear_failed_weather')); }
}

async function resolveAlert(id) {
  try {
    await fetch(`/api/history/alerts/${id}/resolve`, { method: 'POST' });
    loadAlerts();
    loadHistorySummary();
  } catch(e) { alert(t('history.resolve_failed')); }
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11 — Soil Sensor Page
// ═══════════════════════════════════════════════════════════════════════════════

let _soilChartParam  = 'moisture';
// Soil readings are fetched manually via the Read Sensor button
// On page load, detect sensor mode and update UI accordingly
async function detectSensorMode() {
  try {
    const res  = await fetch('/api/soil/mode');
    const data = await res.json();
    const mode = data.mode || 'usb';
    const sub  = document.getElementById('soil-mode-subtitle');
    const badge = document.getElementById('soil-mode-badge');
    if (sub) {
      sub.textContent = mode === 'wifi'
        ? t('soil.subtitle_wifi')
        : t('soil.subtitle');
    }
    if (badge) {
      badge.textContent = mode === 'wifi' ? 'Wi-Fi' : 'USB';
      badge.className = mode === 'wifi'
        ? 'text-xs font-mono px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/25'
        : 'text-xs font-mono px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/25';
    }
    // In Wi-Fi mode, auto-refresh latest reading every 30s
    if (mode === 'wifi') {
      setInterval(loadSoilLatest, 30000);
    }
  } catch(e) { /* silently ignore */ }
}

// ── Manual read trigger ───────────────────────────────────────────────────────
async function readSensorNow() {
  const btn = document.getElementById('soil-read-btn');
  const setBtn = (icon, label, spin=false) => {
    if (!btn) return;
    btn.innerHTML = `<span class="material-symbols-outlined text-base${spin?' animate-spin':''}">${icon}</span><span>${label}</span>`;
  };

  if (btn) btn.disabled = true;
  setBtn('refresh', 'Reading…', true);

  try {
    const res  = await fetch('/api/soil/read', { method: 'POST' });
    const json = await res.json();

    if (!res.ok) {
      // Show the error message from Flask
      const msg = json.error || 'Unknown error';
      setBtn('sensors_off', t('soil.failed'));
      _setSoilStatus('error');
      // Show error in the no-data notice
      const noData = document.getElementById('soil-no-data');
      const noDataMsg = noData?.querySelector('p:last-of-type');
      if (noData) noData.classList.remove('hidden');
      if (noDataMsg) noDataMsg.textContent = msg;
      setTimeout(() => setBtn('sensors', t('soil.read_sensor')), 3000);
      return;
    }

    // Success — update all UI with the saved reading
    const d = json.data;
    const st = d.status || {};

    const noData = document.getElementById('soil-no-data');
    if (noData) noData.classList.add('hidden');

    _setSoilStatus('live');
    const lu = document.getElementById('soil-last-updated');
    if (lu) {
      lu.textContent = t('soil.saved_at') + ' ' + new Date(d.timestamp).toLocaleTimeString();
      lu.classList.remove('hidden');
    }

    // Top stat cards
    const statMoist = document.getElementById('ov-stat-moisture');
    const statPh    = document.getElementById('ov-stat-ph');
    if (statMoist && d.moisture != null) statMoist.textContent = d.moisture.toFixed(1) + '%';
    if (statPh    && d.ph       != null) statPh.textContent    = d.ph.toFixed(2);

    // pH
    if (d.ph != null) {
      _setText('soil-ph-val', d.ph.toFixed(2));
      _setText('soil-ph-badge', d.ph.toFixed(1));
      const pct = Math.min(Math.max((d.ph / 14) * 100, 2), 98);
      const marker = document.getElementById('soil-ph-marker');
      if (marker) marker.style.left = pct + '%';
    }
    _setStatusBadge('soil-ph-status', st.ph);

    // Moisture
    if (d.moisture != null) {
      _setText('soil-moist-val', d.moisture.toFixed(1));
      const offset = 251.2 - (Math.min(d.moisture, 100) / 100) * 251.2;
      const ring = document.getElementById('soil-moist-ring');
      if (ring) ring.setAttribute('stroke-dashoffset', offset.toFixed(1));
    }
    _setStatusBadge('soil-moist-status', st.moisture);

    // Temperature
    if (d.temperature != null) _setText('soil-temp-val', d.temperature.toFixed(1));
    _setStatusBadge('soil-temp-status', st.temperature);

    // Conductivity
    if (d.conductivity != null) {
      _setText('soil-cond-val', Math.round(d.conductivity));
      const bar = document.getElementById('soil-cond-bar');
      if (bar) bar.style.width = Math.min((d.conductivity / 3000) * 100, 100) + '%';
    }
    _setStatusBadge('soil-cond-status', st.conductivity);

    // NPK
    [['nitrogen','n',300],['phosphorus','p',200],['potassium','k',400]].forEach(([key,id,max]) => {
      const val = d[key];
      if (val != null) {
        _setText(`soil-${id}-val`, Math.round(val));
        const bar = document.getElementById(`soil-${id}-bar`);
        if (bar) bar.style.width = Math.min((val / max) * 100, 100) + '%';
      }
      const statusEl = document.getElementById(`soil-${id}-status`);
      if (statusEl) {
        const s = SOIL_STATUS_STYLE[st[key]] || SOIL_STATUS_STYLE.unknown;
        statusEl.textContent = _soilLabel(s);
        statusEl.className   = s.text + ' text-xs font-mono';
      }
    });

    // Refresh history chart
    loadSoilHistory();

    setBtn('check_circle', t('soil.saved'));
    setTimeout(() => setBtn('sensors', t('soil.read_sensor')), 2000);

  } catch(e) {
    console.warn('readSensorNow error:', e);
    setBtn('sensors_off', 'Error');
    setTimeout(() => setBtn('sensors', t('soil.read_sensor')), 2500);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Status → colour mapping
const SOIL_STATUS_STYLE = {
  ok:      { bg: 'bg-green-500/15',  text: 'text-green-400',  labelKey: 'soil.status_ok'   },
  low:     { bg: 'bg-blue-500/15',   text: 'text-blue-400',   labelKey: 'soil.status_low'  },
  high:    { bg: 'bg-red-500/15',    text: 'text-red-400',    labelKey: 'soil.status_high' },
  unknown: { bg: 'bg-surface-2',     text: 'text-text-dim',   labelKey: null               },
};
// Helper so callers can just use s.label and get translated text
function _soilLabel(s) { return s.labelKey ? t(s.labelKey) : '--'; }

function _soilStatusBadge(status) {
  const s = SOIL_STATUS_STYLE[status] || SOIL_STATUS_STYLE.unknown;
  return `${s.bg} ${s.text}`;
}

// ── Load latest reading ───────────────────────────────────────────────────────
async function loadSoilLatest() {
  try {
    const res  = await fetch('/api/soil/latest');
    const json = await res.json();

    const noData = document.getElementById('soil-no-data');

    if (!json.data) {
      if (noData) noData.classList.remove('hidden');
      _setSoilStatus('no-data');
      return;
    }
    if (noData) noData.classList.add('hidden');

    const d  = json.data;
    const st = d.status || {};

    // ── Status badge ──────────────────────────────────────────────────────────
    _setSoilStatus('live');
    const lu = document.getElementById('soil-last-updated');
    if (lu) {
      lu.textContent = t('soil.updated_at') + ' ' + new Date(d.timestamp).toLocaleTimeString();
      lu.classList.remove('hidden');
    }

    // ── pH ────────────────────────────────────────────────────────────────────
    const ph = d.ph ?? null;
    if (ph !== null) {
      _setText('soil-ph-val',  ph.toFixed(2));
      _setText('soil-ph-badge', ph.toFixed(1));
      // Marker position: 0–14 mapped to 0–100%
      const pct = Math.min(Math.max((ph / 14) * 100, 2), 98);
      const marker = document.getElementById('soil-ph-marker');
      if (marker) marker.style.left = pct + '%';
    }
    _setStatusBadge('soil-ph-status', st.ph);

    // ── Moisture ─────────────────────────────────────────────────────────────
    const moist = d.moisture ?? null;
    if (moist !== null) {
      _setText('soil-moist-val', moist.toFixed(1));
      // SVG ring: circumference = 251.2
      const offset = 251.2 - (Math.min(moist, 100) / 100) * 251.2;
      const ring = document.getElementById('soil-moist-ring');
      if (ring) ring.setAttribute('stroke-dashoffset', offset.toFixed(1));
    }
    _setStatusBadge('soil-moist-status', st.moisture);

    // ── Temperature ───────────────────────────────────────────────────────────
    const temp = d.temperature ?? null;
    if (temp !== null) _setText('soil-temp-val', temp.toFixed(1));
    _setStatusBadge('soil-temp-status', st.temperature);

    // ── Conductivity ──────────────────────────────────────────────────────────
    const cond = d.conductivity ?? null;
    if (cond !== null) {
      _setText('soil-cond-val', Math.round(cond));
      const condPct = Math.min((cond / 3000) * 100, 100);
      const condBar = document.getElementById('soil-cond-bar');
      if (condBar) condBar.style.width = condPct + '%';
    }
    _setStatusBadge('soil-cond-status', st.conductivity);

    // ── NPK ───────────────────────────────────────────────────────────────────
    const npk = [
      { key:'nitrogen',   id:'n', max:300, colour:'text-blue-400'   },
      { key:'phosphorus', id:'p', max:200, colour:'text-orange-400' },
      { key:'potassium',  id:'k', max:400, colour:'text-purple-400' },
    ];
    npk.forEach(({ key, id, max }) => {
      const val = d[key] ?? null;
      if (val !== null) {
        _setText(`soil-${id}-val`, Math.round(val));
        const bar = document.getElementById(`soil-${id}-bar`);
        if (bar) bar.style.width = Math.min((val / max) * 100, 100) + '%';
      }
      const statusEl = document.getElementById(`soil-${id}-status`);
      if (statusEl) {
        const s = SOIL_STATUS_STYLE[st[key]] || SOIL_STATUS_STYLE.unknown;
        statusEl.textContent = _soilLabel(s);
        statusEl.className   = s.text + ' text-xs font-mono';
      }
    });

    // Load history chart too
    loadSoilHistory();

  } catch(e) {
    console.warn('Soil fetch failed:', e);
    _setSoilStatus('error');
  }
}

function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _setStatusBadge(id, status) {
  const el = document.getElementById(id);
  if (!el) return;
  const s = SOIL_STATUS_STYLE[status] || SOIL_STATUS_STYLE.unknown;
  el.textContent = _soilLabel(s);
  el.className   = `text-xs font-mono px-2 py-0.5 rounded-full ${s.bg} ${s.text}`;
}

function _setSoilStatus(state) {
  const badge   = document.getElementById('soil-status-badge');
  const dot     = badge?.querySelector('span:first-child');
  const txt     = document.getElementById('soil-status-text');
  if (!badge || !dot || !txt) return;
  const states = {
    live:    { dot:'bg-green-400', textKey:'overview.live',         badge:'border-green-500/30' },
    'no-data':{ dot:'bg-yellow-400', textKey:'soil.no_data_yet',    badge:'border-yellow-500/30' },
    error:   { dot:'bg-red-400',   textKey:'common.conn_error',     badge:'border-red-500/30'   },
  };
  const s = states[state] || states['no-data'];
  dot.className   = `w-2 h-2 rounded-full ${s.dot}`;
  txt.textContent = t(s.textKey || 'common.no_data');
  badge.className = `flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface border text-xs font-mono ${s.badge}`;
}

// ── History chart ─────────────────────────────────────────────────────────────
async function loadSoilHistory() {
  try {
    const res  = await fetch('/api/soil/history?limit=30');
    const json = await res.json();
    renderSoilChart(json.records || [], _soilChartParam);
  } catch(e) { console.warn('Soil history fetch failed:', e); }
}

function setSoilChartParam(param) {
  _soilChartParam = param;
  document.querySelectorAll('.soil-chart-btn').forEach(btn => {
    const active = btn.id === `soil-chart-btn-${param}`;
    btn.className = `soil-chart-btn px-3 py-1 text-xs font-mono rounded transition-colors ${
      active ? 'bg-primary/15 text-primary' : 'text-text-dim hover:text-white'}`;
  });
  loadSoilHistory();
}

function renderSoilChart(records, param) {
  const chart  = document.getElementById('soil-chart');
  const labels = document.getElementById('soil-chart-labels');
  if (!chart) return;

  if (!records.length) {
    chart.innerHTML  = `<div class="flex-1 flex items-center justify-center text-text-dim text-xs font-mono">${t('soil.no_history')}</div>`;
    if (labels) labels.innerHTML = '';
    return;
  }

  const vals = records.map(r => r[param] ?? 0);
  const max  = Math.max(...vals, 1);
  const COLOURS = {
    moisture:'#3b82f6', ph:'#22c55e', temperature:'#f97316',
    nitrogen:'#60a5fa', phosphorus:'#fb923c', potassium:'#c084fc',
    conductivity:'#facc15',
  };
  const colour = COLOURS[param] || 'var(--primary)';

  chart.innerHTML = records.map((r, i) => {
    const h = Math.max((vals[i] / max) * 100, 2);
    const ts = new Date(r.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    return `
      <div class="flex-1 flex flex-col items-center gap-1 group relative">
        <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-surface-2 border border-surface-3
          text-white text-xs font-mono px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100
          transition-opacity pointer-events-none z-10">
          ${vals[i]?.toFixed?.(2) ?? vals[i]}<br><span class="text-text-dim">${ts}</span>
        </div>
        <div class="w-full flex-1 flex items-end">
          <div class="w-full rounded-t transition-all duration-500"
            style="height:${h}%;background:${colour};opacity:0.85;min-height:4px"></div>
        </div>
      </div>`;
  }).join('');

  if (labels) {
    // Show only first, middle and last timestamp labels
    const show = new Set([0, Math.floor(records.length/2), records.length-1]);
    labels.innerHTML = records.map((r, i) => {
      const ts = show.has(i)
        ? new Date(r.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
        : '';
      return `<div class="flex-1 text-center text-text-dim font-mono" style="font-size:10px">${ts}</div>`;
    }).join('');
  }
}

// ── Clear history ─────────────────────────────────────────────────────────────
async function clearSoilHistory() {
  if (!confirm('Clear all soil sensor history? This cannot be undone.')) return;
  try {
    const res  = await fetch('/api/soil/clear', { method: 'DELETE' });
    const data = await res.json();
    if (data.error) { alert(t('common.failed') + ': ' + data.error); return; }
    loadSoilHistory();
  } catch(e) { alert(t('soil.clear_failed')); }
}

// ── Auto-poll when soil page is active ───────────────────────────────────────
function startSoilPolling() {
  // Load once when page is opened — no auto-polling
  loadSoilLatest();
}
function stopSoilPolling() {
  // Nothing to clear — polling is disabled
}

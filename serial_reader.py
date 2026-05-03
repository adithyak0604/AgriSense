"""
serial_reader.py — Sensor memory daemon
========================================
Reads the ESP32 USB serial output continuously and keeps the LATEST
complete reading in memory. It NEVER writes to the database itself.

It exposes a tiny HTTP server on port 5001 with one endpoint:
  GET /latest  → returns the most recent complete reading as JSON
                 (or 404 if no reading has arrived yet)

Flask calls GET http://localhost:5001/latest when the user presses
"Read Sensor" on the dashboard, then Flask saves it to the DB.

HOW TO RUN (separate terminal alongside Flask):
  pip install pyserial
  python serial_reader.py --port /dev/ttyUSB0   (Linux/Mac)
  python serial_reader.py --port COM3            (Windows)
  python serial_reader.py --list                 (show available ports)

Optional flags:
  --baud   9600          (must match Serial.begin() in Arduino sketch)
  --host   localhost     (address the HTTP server binds to)
  --hport  5001          (HTTP port Flask will call)
"""

import argparse
import json
import re
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

import serial
import serial.tools.list_ports


# ── Shared state (thread-safe via lock) ───────────────────────────────────────
_lock          = threading.Lock()
_latest        = None          # dict of the most recent complete reading
_reading_count = 0             # how many complete readings received so far


def _store(data: dict):
    global _latest, _reading_count
    with _lock:
        _latest = {**data, "received_at": datetime.now(timezone.utc).isoformat()}
        _reading_count += 1
        print(f"\n  ✓ Reading #{_reading_count}: N={data['nitrogen']} P={data['phosphorus']} "
              f"K={data['potassium']} pH={data['ph']} "
              f"Moist={data['moisture']}% Temp={data['temperature']}°C "
              f"EC={data['conductivity']}µS/cm")
        print("    (held in memory — not saved until Read Sensor is pressed)\n")


def get_latest():
    with _lock:
        return dict(_latest) if _latest else None


# ── Serial parser ─────────────────────────────────────────────────────────────
def parse_serial_output(lines: list) -> dict | None:
    data = {}
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        low  = line.lower()

        m = re.match(r'nitrogen[:\s]+(\d+)', low)
        if m: data['nitrogen'] = int(m.group(1)); i += 1; continue

        m = re.match(r'phosphorus[:\s]+(\d+)', low)
        if m: data['phosphorus'] = int(m.group(1)); i += 1; continue

        m = re.match(r'potassium[:\s]+(\d+)', low)
        if m: data['potassium'] = int(m.group(1)); i += 1; continue

        m = re.match(r'conductivity[:\s]+(\d+)', low)
        if m: data['conductivity'] = int(m.group(1)); i += 1; continue

        # Conductivity label on its own line — value on next line
        if 'conductivity' in low and not any(c.isdigit() for c in line):
            i += 1
            while i < len(lines) and not lines[i].strip(): i += 1
            if i < len(lines):
                try: data['conductivity'] = int(float(lines[i].strip()))
                except ValueError: pass
            i += 1; continue

        if 'ph value' in low or low == 'ph':
            i += 1
            while i < len(lines) and not lines[i].strip(): i += 1
            if i < len(lines):
                try: data['ph'] = round(float(lines[i].strip()), 2)
                except ValueError: pass
            i += 1; continue

        if 'soil moisture' in low:
            i += 1
            while i < len(lines) and not lines[i].strip(): i += 1
            if i < len(lines):
                try: data['moisture'] = round(float(lines[i].strip()), 1)
                except ValueError: pass
            i += 1; continue

        if 'soil temperature' in low:
            i += 1
            while i < len(lines) and not lines[i].strip(): i += 1
            if i < len(lines):
                try: data['temperature'] = round(float(lines[i].strip()), 1)
                except ValueError: pass
            i += 1; continue

        i += 1

    required = {'nitrogen', 'phosphorus', 'potassium',
                'ph', 'moisture', 'temperature', 'conductivity'}
    return data if required.issubset(data.keys()) else None


# Keys that must all be present before we consider a cycle complete
REQUIRED = {'nitrogen', 'phosphorus', 'potassium',
            'ph', 'moisture', 'temperature', 'conductivity'}

# ── Serial reading thread ─────────────────────────────────────────────────────
def serial_thread(port: str, baud: int):
    print(f"  Opening {port} at {baud} baud...")
    while True:
        try:
            ser = serial.Serial(port, baud, timeout=2)
            print(f"  Connected to {port}. Waiting for sensor data…\n")

            # Accumulate lines across multiple Arduino print cycles
            # until we have seen all 7 values at least once
            window = []

            while True:
                raw = ser.readline()
                if not raw:
                    continue
                line = raw.decode('utf-8', errors='replace').rstrip()
                window.append(line)

                # Try parsing what we have so far
                result = parse_serial_output(window)
                if result and REQUIRED.issubset(result.keys()):
                    _store(result)
                    window = []   # reset — start fresh for next complete reading

        except serial.SerialException as e:
            print(f"  Serial error: {e} — retrying in 3s…")
            time.sleep(3)
        except Exception as e:
            print(f"  Unexpected error: {e} — retrying in 3s…")
            time.sleep(3)


# ── Tiny HTTP server (Flask calls this) ───────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # Silence default HTTP log noise

    def do_GET(self):
        if self.path == '/latest':
            data = get_latest()
            if data:
                body = json.dumps(data).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_response(404)
                body = b'{"error": "No reading yet"}'
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()


def http_thread(host: str, hport: int):
    server = HTTPServer((host, hport), Handler)
    print(f"  HTTP server listening on http://{host}:{hport}/latest")
    server.serve_forever()


# ── List ports helper ─────────────────────────────────────────────────────────
def list_ports():
    ports = serial.tools.list_ports.comports()
    if not ports:
        print("No serial ports found.")
        return
    print("Available serial ports:")
    for p in ports:
        print(f"  {p.device:20s} — {p.description}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="AgriSense Serial Reader — holds latest sensor reading in memory"
    )
    parser.add_argument('--port',  default='',          help='Serial port (e.g. COM3 or /dev/ttyUSB0)')
    parser.add_argument('--baud',  type=int, default=9600)
    parser.add_argument('--host',  default='localhost', help='HTTP bind address')
    parser.add_argument('--hport', type=int, default=5001, help='HTTP port (default 5001)')
    parser.add_argument('--list',  action='store_true', help='List serial ports and exit')
    args = parser.parse_args()

    if args.list:
        list_ports()
        return

    if not args.port:
        print("ERROR: --port is required. Use --list to see available ports.")
        return

    print("=" * 55)
    print("  AgriSense Sensor Daemon")
    print(f"  Serial : {args.port} @ {args.baud} baud")
    print(f"  HTTP   : http://{args.host}:{args.hport}/latest")
    print()
    print("  Readings are held in memory only.")
    print("  Press 'Read Sensor' in the dashboard to save.")
    print("=" * 55)

    # Start serial reader in background thread
    t = threading.Thread(target=serial_thread, args=(args.port, args.baud), daemon=True)
    t.start()

    # Run HTTP server on main thread (blocks here)
    http_thread(args.host, args.hport)


if __name__ == '__main__':
    main()

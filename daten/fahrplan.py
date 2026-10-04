"""Busfahrplan Hamm (GTFS Deutschland, gtfs.de, CC BY 4.0) kompakt für die Karte.

Aufruf: python daten/fahrplan.py [pfad-zum-hamm-gtfs.zip]
Ausgabe: web/public/daten/fahrplan.json mit
  stops:    [[name, lat, lon], …]
  routes:   {route_id: kurzname}
  services: {service_id: {"tage": "1111100", "von": "20260928", "bis": "…", "plus": [...], "minus": [...]}}
  trips:    [[route_id, ziel, service_id, [stopIndex, sekunden, stopIndex, sekunden, …]], …]
Nur Fahrten mit mindestens einem Halt im Raum Hamm, nur Busse.
"""

import csv
import glob
import io
import json
import sys
import zipfile
from pathlib import Path

BBOX = (7.62, 51.58, 8.05, 51.78)
import os as _os
# Rohdaten (OSM-Auszüge, GTFS, ALKIS, Zensus): Umgebungsvariable HAM_ROHDATEN, sonst Nachbarprojekt ../HAM1226/pipeline/raw
ROH = _os.environ.get("HAM_ROHDATEN", str(Path(__file__).resolve().parents[2] / "HAM1226" / "pipeline" / "raw"))

src = sys.argv[1] if len(sys.argv) > 1 else sorted(glob.glob(ROH + "/gtfs/hamm-*.zip"))[-1]
z = zipfile.ZipFile(src)
rd = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8-sig"))

stops_raw = {r["stop_id"]: r for r in rd("stops.txt")}
routes = {r["route_id"]: r["route_short_name"] for r in rd("routes.txt") if r["route_type"] in ("3", "700", "702", "704")}
trips = {r["trip_id"]: r for r in rd("trips.txt") if r["route_id"] in routes}

def sek(t: str) -> int:
    h, m, s = (int(x) for x in t.split(":"))
    return h * 3600 + m * 60 + s

st: dict[str, list] = {}
for r in rd("stop_times.txt"):
    if r["trip_id"] in trips:
        st.setdefault(r["trip_id"], []).append((int(r["stop_sequence"]), r["stop_id"], sek(r["departure_time"] or r["arrival_time"])))

stop_index: dict[str, int] = {}
stops_out = []
def idx(sid: str) -> int:
    if sid not in stop_index:
        s = stops_raw[sid]
        stop_index[sid] = len(stops_out)
        stops_out.append([s["stop_name"], round(float(s["stop_lat"]), 6), round(float(s["stop_lon"]), 6)])
    return stop_index[sid]

def in_hamm(sid: str) -> bool:
    s = stops_raw[sid]
    lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
    return BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]

trips_out = []
used_services = set()
for tid, rows in st.items():
    rows.sort()
    if not any(in_hamm(sid) for _, sid, _ in rows):
        continue
    t = trips[tid]
    seq = []
    for _, sid, s in rows:
        seq += [idx(sid), s]
    ziel = t.get("trip_headsign") or stops_raw[rows[-1][1]]["stop_name"].replace("Hamm, ", "")
    trips_out.append([t["route_id"], ziel, t["service_id"], seq])
    used_services.add(t["service_id"])

services = {}
for r in rd("calendar.txt"):
    if r["service_id"] in used_services:
        services[r["service_id"]] = {"tage": "".join(r[d] for d in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")),
                                     "von": r["start_date"], "bis": r["end_date"], "plus": [], "minus": []}
for r in rd("calendar_dates.txt"):
    s = services.setdefault(r["service_id"], {"tage": "0000000", "von": "0", "bis": "0", "plus": [], "minus": []})
    (s["plus"] if r["exception_type"] == "1" else s["minus"]).append(r["date"])

out = Path(__file__).resolve().parents[1] / "web" / "public" / "daten" / "fahrplan.json"
out.write_text(json.dumps({"quelle": Path(src).name, "stops": stops_out, "routes": {k: routes[k] for k in {t[0] for t in trips_out}},
                           "services": services, "trips": trips_out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{len(trips_out)} Fahrten, {len(stops_out)} Halte, {out.stat().st_size / 1e6:.1f} MB")

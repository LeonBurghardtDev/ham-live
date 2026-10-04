"""Ladesäulen in Hamm aus dem Ladesäulenregister der Bundesnetzagentur (CC BY 4.0) als GeoJSON.

Aufruf: python daten/ladesaeulen.py [csv-url]
Die CSV (rund 55 MB, monatlich neu) wird mit Abrufdatum nach daten/raw/ geladen und zeilenweise gefiltert.
Ausgabe: web/public/daten/ladesaeulen.geojson
"""

import csv
import datetime as dt
import io
import json
import sys
import urllib.request
from pathlib import Path

URL = sys.argv[1] if len(sys.argv) > 1 else "https://data.bundesnetzagentur.de/Bundesnetzagentur/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/Ladesaeulenregister_BNetzA_2026-09-01.csv"
ROOT = Path(__file__).resolve().parents[1]
raw = ROOT / "daten" / "raw" / f"{Path(URL).stem}_abruf-{dt.date.today().isoformat()}.csv"
raw.parent.mkdir(parents=True, exist_ok=True)
if not raw.exists():
    req = urllib.request.Request(URL, headers={"User-Agent": "HAM-LAGE/0.1 (privat)"})
    with urllib.request.urlopen(req, timeout=120) as r, open(raw, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)

text = raw.read_bytes().decode("latin-1") if b"\xe4" in raw.read_bytes()[:200000] else raw.read_text(encoding="utf-8-sig")
lines = text.splitlines()
# Kopfzeile suchen (die Datei hat Vorspann-Zeilen)
start = next(i for i, l in enumerate(lines) if "Breitengrad" in l)
rd = csv.DictReader(io.StringIO("\n".join(lines[start:])), delimiter=";")
num = lambda v: float(str(v).replace(",", ".")) if v not in (None, "") else None
feats = []
for r in rd:
    ort = (r.get("Ort") or "") + " " + (r.get("Kreis/kreisfreie Stadt") or "")
    if "Hamm" not in ort:
        continue
    lat, lon = num(r.get("Breitengrad")), num(r.get("Längengrad"))
    if lat is None or lon is None or not (51.55 < lat < 51.8 and 7.6 < lon < 8.1):
        continue
    leistung = num(r.get("Nennleistung Ladeeinrichtung [kW]")) or 0
    punkte = r.get("Anzahl Ladepunkte") or "?"
    feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                  "properties": {"titel": r.get("Betreiber") or "Ladesäule",
                                 "sub": f"{r.get('Straße', '')} {r.get('Hausnummer', '')}, {punkte} Ladepunkte, {leistung:.0f} kW{' · Schnellladen' if leistung >= 50 else ''}".strip(),
                                 "kw": leistung, "schnell": leistung >= 50}})
out = ROOT / "web" / "public" / "daten" / "ladesaeulen.geojson"
out.write_text(json.dumps({"type": "FeatureCollection", "quelle": raw.name, "features": feats}, ensure_ascii=False), encoding="utf-8")
print(f"{len(feats)} Ladesäulen in Hamm")

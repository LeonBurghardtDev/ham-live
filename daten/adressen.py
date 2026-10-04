"""Amtliche Hauskoordinaten (Gebäudereferenzen, Geobasis NRW, dl-de/zero-2-0) für Hamm als Suchindex.

Aufruf in einer Python-Umgebung mit den Paketen (pyproj):
  uv run python daten/adressen.py   (Rohdaten in $HAM_ROHDATEN)
Quelle: $HAM_ROHDATEN/alkis/gebref_EPSG25832_ASCII_*.zip (NRW-weit, zeilenweise gelesen)
Ausgabe: web/public/daten/adressen.json  {"strassen": [name, …], "a": [[strasseIdx, "12a", lon, lat], …]}
"""

import glob
import io
import json
import zipfile
from pathlib import Path

from pyproj import Transformer

import os as _os
# Rohdaten (OSM-Auszüge, GTFS, ALKIS, Zensus): Umgebungsvariable HAM_ROHDATEN, sonst Nachbarprojekt ../HAM1226/pipeline/raw
ROH = _os.environ.get("HAM_ROHDATEN", str(Path(__file__).resolve().parents[2] / "HAM1226" / "pipeline" / "raw"))

src = sorted(glob.glob(ROH + "/alkis/gebref_EPSG25832_ASCII_*.zip"))[-1]
tr = Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True)
strassen: dict[str, int] = {}
adressen = []
gesehen = set()
with zipfile.ZipFile(src) as z, z.open("gebref.txt") as f:
    for zeile in io.TextIOWrapper(f, encoding="utf-8", errors="replace"):
        t = zeile.rstrip("\n").split(";")
        if len(t) < 20 or t[5] != "9" or t[7] != "15":  # Regierungsbezirk Arnsberg, kreisfreie Stadt Hamm (05915)
            continue
        name, nr, zus = t[14].strip(), t[15].strip(), t[16].strip()
        if not name or not nr:
            continue
        nr = nr + zus
        key = (name, nr)
        if key in gesehen:
            continue
        gesehen.add(key)
        lon, lat = tr.transform(float(t[18]), float(t[19]))
        i = strassen.setdefault(name, len(strassen))
        adressen.append([i, nr, round(lon, 6), round(lat, 6)])

out = Path(__file__).resolve().parents[1] / "web" / "public" / "daten" / "adressen.json"
out.write_text(json.dumps({"quelle": Path(src).name, "strassen": list(strassen), "a": adressen}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{len(adressen)} Adressen in {len(strassen)} Straßen, {out.stat().st_size / 1e6:.1f} MB")

"""Themenpunkte aus dem lokalen OSM-Auszug Hamm (ODbL) als GeoJSON für die Karte.

Aufruf in einer Python-Umgebung mit den Paketen (pyosmium):
  uv run python daten/osm_punkte.py   (Rohdaten in $HAM_ROHDATEN)
Ausgabe: HAM-LAGE/web/public/daten/osm-<thema>.geojson
"""

import glob
import json
from pathlib import Path

import osmium

THEMEN = {
    "bergbau": lambda t: t.get("man_made") == "mineshaft" or t.get("historic") in ("mine_shaft", "mine", "mine_adit") or (t.get("landuse") == "industrial" and t.get("industrial") == "mine") or t.get("man_made") == "headframe",
    "denkmal": lambda t: t.get("historic") in ("memorial", "monument", "wayside_cross", "boundary_stone", "castle", "archaeological_site") or "memorial" in t,
    "blitzer": lambda t: t.get("highway") == "speed_camera" or t.get("enforcement") in ("maxspeed", "traffic_signals") or t.get("speed_camera") is not None,
    "notfall": lambda t: t.get("emergency") in ("defibrillator", "fire_hydrant", "assembly_point") or t.get("amenity") in ("fire_station", "police", "hospital"),
}
import os as _os
# Rohdaten (OSM-Auszüge, GTFS, ALKIS, Zensus): Umgebungsvariable HAM_ROHDATEN, sonst Nachbarprojekt ../HAM1226/pipeline/raw
ROH = _os.environ.get("HAM_ROHDATEN", str(Path(__file__).resolve().parents[2] / "HAM1226" / "pipeline" / "raw"))

src = sorted(glob.glob(ROH + "/osm/hamm_*.osm.pbf"))[-1]
out = {k: [] for k in THEMEN}


class H(osmium.SimpleHandler):
    def _add(self, tags, lon, lat, oid):
        t = {k: v for k, v in tags}
        for thema, f in THEMEN.items():
            if f(t):
                out[thema].append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                                   "properties": {"id": oid, "titel": t.get("name") or t.get("historic") or t.get("man_made") or t.get("emergency") or t.get("amenity") or thema,
                                                  "sub": " · ".join(f"{k}={v}" for k, v in t.items() if k in ("historic", "man_made", "start_date", "end_date", "operator", "description", "inscription", "emergency", "amenity", "memorial", "maxspeed", "direction", "highway"))[:200]}})

    def node(self, n):
        if n.tags:
            self._add(n.tags, n.location.lon, n.location.lat, f"n{n.id}")

    def area(self, a):
        try:
            ring = next(iter(a.outer_rings()))
            xs = [p.lon for p in ring]; ys = [p.lat for p in ring]
            self._add(a.tags, sum(xs) / len(xs), sum(ys) / len(ys), f"a{a.id}")
        except Exception:
            pass


H().apply_file(src, locations=True)
d = Path(__file__).resolve().parents[1] / "web" / "public" / "daten"
d.mkdir(parents=True, exist_ok=True)
for k, v in out.items():
    (d / f"osm-{k}.geojson").write_text(json.dumps({"type": "FeatureCollection", "quelle": Path(src).name, "features": v}, ensure_ascii=False), encoding="utf-8")
    print(k, len(v))

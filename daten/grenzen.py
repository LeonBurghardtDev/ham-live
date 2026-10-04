"""Stadtgrenze, Stadtbezirke und Stadtteile von Hamm aus OpenStreetMap (ODbL) als GeoJSON.

Aufruf in einer Python-Umgebung mit den Paketen (pyosmium, shapely):
  uv run python daten/grenzen.py   (Rohdaten in $HAM_ROHDATEN)
Quelle: $HAM_ROHDATEN/osm/hamm_*.osm.pbf
Ausgabe: web/public/daten/grenzen.geojson, Merkmale {ebene: stadt|bezirk|stadtteil, name, osm}
  und web/public/daten/umland.geojson (Welt minus Hamm, für die Abdunklung außerhalb der Stadt).
"""

import glob
import json
from pathlib import Path

import osmium
from shapely import wkb
from shapely.geometry import box, mapping

import os as _os
# Rohdaten (OSM-Auszüge, GTFS, ALKIS, Zensus): Umgebungsvariable HAM_ROHDATEN, sonst Nachbarprojekt ../HAM1226/pipeline/raw
ROH = _os.environ.get("HAM_ROHDATEN", str(Path(__file__).resolve().parents[2] / "HAM1226" / "pipeline" / "raw"))

src = sorted(glob.glob(ROH + "/osm/hamm_*.osm.pbf"))[-1]
fab = osmium.geom.WKBFactory()
EBENE = {"6": "stadt", "9": "bezirk", "10": "stadtteil"}


class Grenzen(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.f = []

    def area(self, a):
        t = a.tags
        if t.get("boundary") != "administrative" or t.get("admin_level") not in EBENE or a.from_way():
            return
        try:
            g = wkb.loads(fab.create_multipolygon(a), hex=True)
        except Exception:
            return
        self.f.append({"ebene": EBENE[t["admin_level"]], "name": t.get("name", ""), "osm": a.orig_id(), "g": g})


h = Grenzen()
h.apply_file(src, locations=True)
stadt = [x for x in h.f if x["ebene"] == "stadt" and x["name"] == "Hamm"]
assert stadt, "Stadtgrenze Hamm nicht im Auszug"
hamm = stadt[0]["g"]
innen = hamm.buffer(0.001)
feats = []
for x in sorted(h.f, key=lambda x: ("stadt", "bezirk", "stadtteil").index(x["ebene"])):
    if x["ebene"] != "stadt" and not innen.contains(x["g"].representative_point()):
        continue
    if x["ebene"] == "stadt" and x is not stadt[0]:
        continue
    g = x["g"].simplify(0.00005)
    lp = g.representative_point() if x["ebene"] != "bezirk" else g.centroid if g.contains(g.centroid) else g.representative_point()
    feats.append({"type": "Feature", "properties": {"ebene": x["ebene"], "name": x["name"], "osm": x["osm"], "lon": round(lp.x, 5), "lat": round(lp.y, 5)}, "geometry": mapping(g)})

out = Path(__file__).resolve().parents[1] / "web" / "public" / "daten"
rund = lambda o: json.loads(json.dumps(o), parse_float=lambda v: round(float(v), 6))
(out / "grenzen.geojson").write_text(json.dumps(rund({"type": "FeatureCollection", "quelle": Path(src).name, "features": feats}), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
umland = box(5.5, 50.5, 10.5, 53).difference(hamm.simplify(0.00005))
(out / "umland.geojson").write_text(json.dumps(rund({"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": mapping(umland)}]}), separators=(",", ":")), encoding="utf-8")
from collections import Counter
print(Counter(f["properties"]["ebene"] for f in feats), [f["properties"]["name"] for f in feats if f["properties"]["ebene"] == "bezirk"])

"""Parkhäuser und größere Parkplätze in Hamm aus dem lokalen OSM-Auszug (ODbL) als GeoJSON.

Eine Live-Belegung der städtischen Parkhäuser gibt es nicht offen (Parkleitsystem nur über mobilitaetsplan-hamm.de mit Anmeldung),
deshalb nur Lage und Kapazität aus OSM. Aufnahme: parking=multi-storey/underground/rooftop immer, Flächenparkplätze ab 50 Plätzen
oder mit Namen und mindestens 20 Plätzen; ohne access=private/customers… nur öffentliche.

Aufruf in einer Python-Umgebung mit den Paketen (pyosmium):
  uv run python daten/parken.py   (Rohdaten in $HAM_ROHDATEN)
Ausgabe: HAM-LAGE/web/public/daten/parken.geojson
"""

import glob
import json
from pathlib import Path

import osmium

import os as _os
# Rohdaten (OSM-Auszüge, GTFS, ALKIS, Zensus): Umgebungsvariable HAM_ROHDATEN, sonst Nachbarprojekt ../HAM1226/pipeline/raw
ROH = _os.environ.get("HAM_ROHDATEN", str(Path(__file__).resolve().parents[2] / "HAM1226" / "pipeline" / "raw"))

src = sorted(glob.glob(ROH + "/osm/hamm_*.osm.pbf"))[-1]
ART = {"multi-storey": "Parkhaus", "underground": "Tiefgarage", "rooftop": "Parkdeck", "surface": "Parkplatz"}
NICHT_OEFFENTLICH = {"private", "no", "customers", "employees", "residents", "delivery", "permit"}
out = []


def zahl(v):
    try:
        return int(str(v).strip().split(";")[0].split(" ")[0])
    except (TypeError, ValueError):
        return None


class H(osmium.SimpleHandler):
    def _add(self, tags, lon, lat, oid):
        t = {k: v for k, v in tags}
        if t.get("amenity") != "parking" or t.get("access") in NICHT_OEFFENTLICH:
            return
        art = t.get("parking", "surface")
        kap = zahl(t.get("capacity"))
        haus = art in ("multi-storey", "underground", "rooftop")
        if not haus and not ((kap or 0) >= 50 or (t.get("name") and (kap or 0) >= 20)):
            return
        out.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                    "properties": {"id": oid, "name": t.get("name") or ART.get(art, "Parkplatz"), "art": ART.get(art, "Parkplatz"),
                                   "kapazitaet": kap, "betreiber": t.get("operator"), "gebuehr": t.get("fee"),
                                   "oeffnungszeiten": t.get("opening_hours"), "maxhoehe": t.get("maxheight")}})

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
out.sort(key=lambda f: f["properties"]["id"])
d = Path(__file__).resolve().parents[1] / "web" / "public" / "daten"
d.mkdir(parents=True, exist_ok=True)
(d / "parken.geojson").write_text(json.dumps({"type": "FeatureCollection", "quelle": Path(src).name, "lizenz": "© OpenStreetMap-Mitwirkende, ODbL", "features": out}, ensure_ascii=False), encoding="utf-8")
haeuser = [f for f in out if f["properties"]["art"] != "Parkplatz"]
print("gesamt", len(out), "Parkhäuser/Tiefgaragen", len(haeuser), "mit Kapazität", sum(1 for f in out if f["properties"]["kapazitaet"]))

"""Straßengeometrie je Name aus dem lokalen OSM-Auszug Hamm (ODbL) für die Blitzer-Schwerpunkte.

Aufruf in einer Python-Umgebung mit den Paketen (pyosmium, shapely):
  uv run python daten/strassen.py   (Rohdaten in $HAM_ROHDATEN)
Ausgabe: HAM-LAGE/web/public/daten/strassen.json
  { "quelle": "...", "strassen": { "Oststraße": [ { "b": "Mitte", "l": [ [[lon, lat], ...], ... ] }, ... ] } }
Autobahnen ohne Namen unter ihrer Nummer (ref, z. B. „A 2“). Ein Name kann in mehreren Stadtbezirken vorkommen (je Bezirk ein Eintrag). Bezirk aus boundary=administrative
admin_level=9 innerhalb der Stadt Hamm (admin_level=6), Präfix „Hamm-“ entfernt.
"""

import glob
import json
from collections import defaultdict
from pathlib import Path

import osmium
from shapely.geometry import LineString, MultiLineString
from shapely.ops import linemerge
from shapely.prepared import prep
from shapely import wkb

import os as _os
# Rohdaten (OSM-Auszüge, GTFS, ALKIS, Zensus): Umgebungsvariable HAM_ROHDATEN, sonst Nachbarprojekt ../HAM1226/pipeline/raw
ROH = _os.environ.get("HAM_ROHDATEN", str(Path(__file__).resolve().parents[2] / "HAM1226" / "pipeline" / "raw"))

SRC = sorted(glob.glob(ROH + "/osm/hamm_*.osm.pbf"))[-1]
STRASSEN = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street",
            "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link", "service", "road"}
TOLERANZ = 0.00004  # Grad, rund 3–4 m


def gebiete():
    """Stadt Hamm und ihre Stadtbezirke als Polygone."""
    fab = osmium.geom.WKBFactory()
    stadt, bezirke = None, []

    class A(osmium.SimpleHandler):
        def area(self, a):
            t = a.tags
            if t.get("boundary") != "administrative":
                return
            lvl, name = t.get("admin_level"), t.get("name")
            if lvl not in ("6", "9") or not name:
                return
            try:
                g = wkb.loads(fab.create_multipolygon(a), hex=True)
            except Exception:
                return
            nonlocal stadt
            if lvl == "6" and name == "Hamm":
                stadt = g
            elif lvl == "9":
                bezirke.append((name, g))

    A().apply_file(SRC, locations=True)
    pstadt = prep(stadt)
    bez = [(n.removeprefix("Hamm-"), prep(g)) for n, g in bezirke if pstadt.contains(g.representative_point())]
    return stadt, bez


def bezirk_von(bez, p):
    for n, g in bez:
        if g.contains(p):
            return n
    return None


def main():
    stadt, bez = gebiete()
    pstadt = prep(stadt)
    linien = defaultdict(list)

    class W(osmium.SimpleHandler):
        def way(self, w):
            t = w.tags
            name = t.get("name") or (t.get("ref") if t.get("highway") in ("motorway", "trunk", "motorway_link", "trunk_link") else None)
            if t.get("highway") not in STRASSEN or not name:
                return
            try:
                pts = [(n.location.lon, n.location.lat) for n in w.nodes]
            except osmium.InvalidLocationError:
                return
            if len(pts) >= 2:
                linien[name].append(LineString(pts))

    W().apply_file(SRC, locations=True)

    out = {}
    for name, ls in sorted(linien.items()):
        m = linemerge(ls) if len(ls) > 1 else ls[0]
        teile = list(m.geoms) if isinstance(m, MultiLineString) else [m]
        je_bezirk = defaultdict(list)
        for l in teile:
            mitte = l.interpolate(0.5, normalized=True)
            if not pstadt.contains(mitte):
                continue
            s = l.simplify(TOLERANZ)
            je_bezirk[bezirk_von(bez, mitte) or ""].append([[round(x, 5), round(y, 5)] for x, y in s.coords])
        if je_bezirk:
            out[name] = [{"b": b, "l": l} for b, l in sorted(je_bezirk.items())]

    d = Path(__file__).resolve().parents[1] / "web" / "public" / "daten"
    d.mkdir(parents=True, exist_ok=True)
    f = d / "strassen.json"
    f.write_text(json.dumps({"quelle": Path(SRC).name, "lizenz": "OpenStreetMap-Mitwirkende, ODbL", "strassen": out},
                            ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(len(out), "Straßennamen,", len(bez), "Bezirke:", ", ".join(n for n, _ in bez), f"{f.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()

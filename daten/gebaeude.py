"""Gebäude aus LoD2 NRW als GeoJSON (WGS84) mit Höhe für die 3D-Ansicht und den Schattenwurf.

Aufruf in einer Python-Umgebung mit den Paketen (CityGML-Leser dort):
  uv run python daten/gebaeude.py [radius_km]   (Rohdaten in $HAM_ROHDATEN)
Ausgabe: HAM-LAGE/web/public/daten/gebaeude.geojson
Lizenz der Daten: 3D-Gebäudemodell LoD2 NRW, Geobasis NRW, Datenlizenz Deutschland – Zero – 2.0.
"""

import json
import math
import sys
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Polygon, mapping
from shapely.ops import unary_union

from ham1226_pipeline.citygml import read_buildings
from ham1226_pipeline.paths import RAW_DIR

MITTE = (418385.0, 5726254.0)  # Marktplatz, EPSG:25832
RADIUS = float(sys.argv[1]) * 1000 if len(sys.argv) > 1 else 3000.0
OUT = Path(__file__).resolve().parents[1] / "web" / "public" / "daten" / "gebaeude.geojson"

tr = Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True)
feats = []
for p in sorted((RAW_DIR / "lod2").glob("LoD2_32_*.gml")):
    parts = p.name.split("_")
    e0, n0 = int(parts[2]) * 1000, int(parts[3]) * 1000
    # Kachel grob gegen den Kreis prüfen
    if math.hypot(max(abs(MITTE[0] - (e0 + 500)) - 500, 0), max(abs(MITTE[1] - (n0 + 500)) - 500, 0)) > RADIUS:
        continue
    for b in read_buildings(p):
        grounds = [s for s in b.surfaces if s.kind == "ground"]
        if not grounds:
            continue
        polys = [Polygon(s.exterior[:, :2]).buffer(0) for s in grounds if len(s.exterior) >= 3]
        fp = unary_union(polys)
        if fp.is_empty:
            continue
        c = fp.centroid
        if math.hypot(c.x - MITTE[0], c.y - MITTE[1]) > RADIUS:
            continue
        z0 = min(float(s.exterior[:, 2].min()) for s in grounds)
        z1 = max(float(s.exterior[:, 2].max()) for s in b.surfaces)
        h = round(max(z1 - z0, 2.5), 1)
        fp = fp.simplify(0.3)
        geoms = [fp] if fp.geom_type == "Polygon" else list(fp.geoms)
        for g in geoms:
            ring = [tr.transform(x, y) for x, y in g.exterior.coords]
            holes = [[tr.transform(x, y) for x, y in r.coords] for r in g.interiors]
            coords = [[[round(x, 7), round(y, 7)] for x, y in r] for r in [ring, *holes]]
            feats.append({"type": "Feature", "properties": {"id": b.id, "h": h, "f": b.function, "d": b.roof_type},
                          "geometry": {"type": "Polygon", "coordinates": coords}})

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")), encoding="utf-8")
print(f"{len(feats)} Gebäude, {OUT.stat().st_size / 1e6:.1f} MB -> {OUT}")

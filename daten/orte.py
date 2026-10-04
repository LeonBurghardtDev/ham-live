"""Ortssuche-Index aus dem lokalen OSM-Auszug Hamm (ODbL): Straßen, Stadtteile, benannte Orte, Parks, Gewässer.

Aufruf in einer Python-Umgebung mit den Paketen (pyosmium, shapely):
  uv run python daten/orte.py   (Rohdaten in $HAM_ROHDATEN)
Ausgabe: HAM-LAGE/web/public/daten/orte.json
  { "quelle": "...", "arten": [...], "orte": [ [name, art-index, lon, lat, stadtteil-index], ... ], "stadtteile": [...] }
Art und Stadtteil als Index in die Listen, damit die Datei klein bleibt. Stadtteil = nächster Ort mit
place=suburb|village (höchstens 3 km, im selben Stadtbezirk), sonst der Stadtbezirk. Nur Objekte in der Stadt Hamm.
Dubletten (gleicher Name, gleiche Art, < 300 m) werden zusammengefasst.
"""

import glob
import json
import math
from collections import defaultdict
from pathlib import Path

import osmium
from shapely import wkb
from shapely.geometry import LineString, Point
from shapely.ops import linemerge
from shapely.prepared import prep

import os as _os
# Rohdaten (OSM-Auszüge, GTFS, ALKIS, Zensus): Umgebungsvariable HAM_ROHDATEN, sonst Nachbarprojekt ../HAM1226/pipeline/raw
ROH = _os.environ.get("HAM_ROHDATEN", str(Path(__file__).resolve().parents[2] / "HAM1226" / "pipeline" / "raw"))

SRC = sorted(glob.glob(ROH + "/osm/hamm_*.osm.pbf"))[-1]
STRASSEN = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street",
            "pedestrian", "service", "road", "track", "footway", "cycleway", "path", "steps"}

# Reihenfolge = Vorrang bei der Zuordnung eines Objekts
AMENITY = {"school": "Schule", "kindergarten": "Kita", "hospital": "Krankenhaus", "clinic": "Klinik", "doctors": "Arzt",
           "pharmacy": "Apotheke", "place_of_worship": "Kirche", "townhall": "Rathaus", "police": "Polizei",
           "fire_station": "Feuerwehr", "library": "Bibliothek", "theatre": "Theater", "cinema": "Kino",
           "restaurant": "Restaurant", "cafe": "Café", "fast_food": "Imbiss", "pub": "Kneipe", "bar": "Bar",
           "biergarten": "Biergarten", "bank": "Bank", "post_office": "Post", "fuel": "Tankstelle",
           "parking": "Parkplatz", "university": "Hochschule", "college": "Hochschule", "community_centre": "Treffpunkt",
           "social_facility": "Soziale Einrichtung", "marketplace": "Markt", "museum": "Museum", "arts_centre": "Kultur",
           "nursing_home": "Pflegeheim", "dentist": "Zahnarzt", "veterinary": "Tierarzt", "grave_yard": "Friedhof"}
GROSS = {"Stadtteil", "Ortsteil", "Bahnhof", "Krankenhaus", "Rathaus", "Hochschule", "Museum", "Theater", "Park",
         "Gewässer", "Sehenswürdigkeit", "Einkaufszentrum", "Freizeit", "Friedhof", "Schule", "Kino", "Sportanlage"}


def art_von(t):
    pl = t.get("place")
    if pl in ("suburb", "village", "town"):
        return "Stadtteil"
    if pl in ("quarter", "neighbourhood", "hamlet", "isolated_dwelling", "locality"):
        return "Ortsteil"
    if t.get("railway") in ("station", "halt") or (t.get("public_transport") == "station" and t.get("railway")):
        return "Bahnhof"
    if t.get("highway") == "bus_stop" or t.get("public_transport") == "platform" and t.get("bus") == "yes":
        return "Haltestelle"
    if t.get("leisure") in ("park", "garden") or t.get("landuse") == "recreation_ground":
        return "Park"
    if t.get("natural") == "water" or t.get("waterway") in ("river", "canal", "stream", "riverbank") or t.get("water"):
        return "Gewässer"
    if t.get("landuse") == "cemetery":
        return "Friedhof"
    a = t.get("amenity")
    if a in AMENITY:
        return AMENITY[a]
    if t.get("shop") in ("mall", "department_store"):
        return "Einkaufszentrum"
    if t.get("shop"):
        return "Geschäft"
    if t.get("tourism") in ("hotel", "guest_house", "hostel", "motel"):
        return "Hotel"
    if t.get("tourism") == "museum":
        return "Museum"
    if t.get("tourism") in ("attraction", "viewpoint", "artwork", "zoo", "theme_park"):
        return "Sehenswürdigkeit"
    if t.get("tourism"):
        return "Tourismus"
    if t.get("historic"):
        return "Denkmal"
    if t.get("leisure") in ("sports_centre", "stadium", "pitch", "swimming_pool", "track", "golf_course", "ice_rink"):
        return "Sportanlage"
    if t.get("leisure") in ("playground",):
        return "Spielplatz"
    if t.get("leisure"):
        return "Freizeit"
    if a:
        return "Einrichtung"
    return None


def main():
    fab = osmium.geom.WKBFactory()
    stadt, bezirke = None, []
    roh = []  # (name, art, lon, lat)
    strassen = defaultdict(list)
    gewaesser = defaultdict(list)

    class H(osmium.SimpleHandler):
        def node(self, n):
            t = n.tags
            if not t.get("name"):
                return
            a = art_von(t)
            if a:
                roh.append((t["name"], a, n.location.lon, n.location.lat))

        def way(self, w):
            t = w.tags
            name = t.get("name")
            if not name:
                return
            hw, ww = t.get("highway"), t.get("waterway")
            if hw not in STRASSEN and ww not in ("river", "canal", "stream"):
                return
            try:
                pts = [(n.location.lon, n.location.lat) for n in w.nodes]
            except osmium.InvalidLocationError:
                return
            if len(pts) < 2:
                return
            (strassen if hw in STRASSEN else gewaesser)[name].append(LineString(pts))

        def area(self, a):
            t = a.tags
            nonlocal stadt
            if t.get("boundary") == "administrative" and t.get("name"):
                lvl = t.get("admin_level")
                if lvl in ("6", "9"):
                    try:
                        g = wkb.loads(fab.create_multipolygon(a), hex=True)
                    except Exception:
                        return
                    if lvl == "6" and t["name"] == "Hamm":
                        stadt = g
                    elif lvl == "9":
                        bezirke.append((t["name"].removeprefix("Hamm-"), g))
                return
            if not t.get("name") or t.get("highway") or t.get("building") and not (t.get("amenity") or t.get("shop") or t.get("tourism")):
                return
            art = art_von(t)
            if not art or art in ("Stadtteil", "Ortsteil"):
                return
            try:
                g = wkb.loads(fab.create_multipolygon(a), hex=True)
            except Exception:
                return
            p = g.representative_point()
            roh.append((t["name"], art, p.x, p.y))

    H().apply_file(SRC, locations=True)

    for name, ls in strassen.items():
        m = linemerge(ls) if len(ls) > 1 else ls[0]
        for l in getattr(m, "geoms", [m]):
            p = l.interpolate(0.5, normalized=True)
            roh.append((name, "Straße", p.x, p.y))
    for name, ls in gewaesser.items():
        m = linemerge(ls) if len(ls) > 1 else ls[0]
        for l in getattr(m, "geoms", [m]):
            p = l.interpolate(0.5, normalized=True)
            roh.append((name, "Gewässer", p.x, p.y))

    pstadt = prep(stadt)
    pbez = [(n, prep(g)) for n, g in bezirke if pstadt.contains(g.representative_point())]
    roh = [r for r in roh if pstadt.contains(Point(r[2], r[3]))]

    def bezirk(lon, lat):
        p = Point(lon, lat)
        for n, g in pbez:
            if g.contains(p):
                return n
        return ""

    kx = math.cos(math.radians(51.68)) * 111320
    ky = 111320

    def dist(a, b):
        return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * ky)

    # Dubletten: gleicher Name und gleiche Art innerhalb 300 m (Straßen: 1500 m, Haltestellen-Steige zusammen)
    gruppen = defaultdict(list)
    for name, art, lon, lat in roh:
        gruppen[(name, art)].append((lon, lat))
    orte = []
    for (name, art), pts in gruppen.items():
        grenze = 1500 if art in ("Straße", "Gewässer") else 300
        cluster = []
        for p in pts:
            for c in cluster:
                if dist(c[0], p) < grenze:
                    c[1].append(p)
                    break
            else:
                cluster.append([p, [p]])
        for _, mitglieder in cluster:
            lon = sum(p[0] for p in mitglieder) / len(mitglieder)
            lat = sum(p[1] for p in mitglieder) / len(mitglieder)
            orte.append([name, art, lon, lat])

    # Stadtteil: nächster Ort (suburb/village) im selben Bezirk, höchstens 3 km
    zentren = [(o[0], (o[2], o[3]), bezirk(o[2], o[3])) for o in orte if o[1] == "Stadtteil"]
    for o in orte:
        b = bezirk(o[2], o[3])
        if o[1] == "Stadtteil":
            o.append(b if b != o[0] else "")
            continue
        best, bd = None, 3000
        for n, p, zb in zentren:
            if zb == b:
                d = dist(p, (o[2], o[3]))
                if d < bd:
                    best, bd = n, d
        o.append(best or b)

    # Sortierung: große Orte zuerst, dann alphabetisch (die Suche ordnet ohnehin neu)
    orte.sort(key=lambda o: (o[1] not in GROSS, o[1] == "Straße", o[0].lower()))
    arten = sorted({o[1] for o in orte})
    teile = sorted({o[4] for o in orte})
    ai = {a: i for i, a in enumerate(arten)}
    ti = {t: i for i, t in enumerate(teile)}
    kompakt = [[o[0], ai[o[1]], round(o[2], 5), round(o[3], 5), ti[o[4]]] for o in orte]

    d = Path(__file__).resolve().parents[1] / "web" / "public" / "daten"
    d.mkdir(parents=True, exist_ok=True)
    f = d / "orte.json"
    f.write_text(json.dumps({"quelle": Path(SRC).name, "lizenz": "OpenStreetMap-Mitwirkende, ODbL", "arten": arten,
                             "stadtteile": teile, "orte": kompakt}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    zaehl = defaultdict(int)
    for o in orte:
        zaehl[o[1]] += 1
    print(len(kompakt), "Orte,", f"{f.stat().st_size / 1e6:.2f} MB")
    print(", ".join(f"{a} {n}" for a, n in sorted(zaehl.items(), key=lambda x: -x[1])))


if __name__ == "__main__":
    main()

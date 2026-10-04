"""Zugfahrplan Raum Hamm (GTFS Deutschland, gtfs.de, CC BY 4.0) mit Gleiswegen aus OSM (ODbL) für die Karte.

Aufruf: python daten/zugfahrplan.py   (nur Standardbibliothek)
Eingaben (neueste Datei je Muster in $HAM_ROHDATEN/):
  gtfs/gtfs-de-rv-*.zip   Regionalverkehr (RE, RB, S, FLX), https://download.gtfs.de/germany/rv_free/latest.zip
  gtfs/gtfs-de-fv-*.zip   Fernverkehr (ICE, IC, EC),        https://download.gtfs.de/germany/fv_free/latest.zip
  osm/gleise_overpass_*.json  OSM-Gleise (ODbL) im Umkreis, einmalig über Overpass geholt:
      [out:json];way["railway"~"^(rail|light_rail)$"](51.45,7.40,51.95,8.25);out body;>;out skel qt;
Der Nahverkehrsfeed (de-nv) enthält in Hamm keine Züge, nur Busse – deshalb rv und fv.
Ausgabe: web/public/daten/zuege.json
  stops:    [[name, lat, lon], …]
  routes:   {route_id: kurzname}        (route_id mit Feed-Präfix r/f)
  services: wie fahrplan.json           (service_id mit Feed-Präfix)
  trips:    [[route_id, ziel, service_id, [stopIndex, ankunft, abfahrt, …], hbfPos], …]  hbfPos = Index des Halts Hamm Hbf in der Folge oder -1
  wege:     {"a-b": [lon, lat, lon, lat, …]}  Gleisweg zwischen zwei aufeinanderfolgenden Halten (kürzester Weg im OSM-Gleisgraphen)
Nur Fahrten mit mindestens einem Halt im Raum Hamm. Liegt ein Halt außerhalb des Gleisauszugs, führt der Weg auf dem Gleis
bis zum Knoten, der dem Halt am nächsten liegt, und von dort als Luftlinie weiter. Ganz ohne Gleisweg zeichnet die Karte Luftlinie.
"""

import csv
import glob
import heapq
import io
import json
import math
import re
import zipfile
from pathlib import Path


import os as _os
# Rohdaten (OSM-Auszüge, GTFS, ALKIS, Zensus): Umgebungsvariable HAM_ROHDATEN, sonst Nachbarprojekt ../HAM1226/pipeline/raw
ROH = _os.environ.get("HAM_ROHDATEN", str(Path(__file__).resolve().parents[2] / "HAM1226" / "pipeline" / "raw"))

RAW = Path(ROH)
BBOX = (7.62, 51.58, 8.05, 51.78)
HBF = re.compile(r"^Hamm ?\(Westf\),? ?(Hbf|Hauptbahnhof|Central Station)", re.I)


def neueste(muster: str) -> str:
    return sorted(glob.glob(str(RAW / muster)))[-1]


def sek(t: str) -> int:
    h, m, s = (int(x) for x in t.split(":"))
    return h * 3600 + m * 60 + s


def in_bbox(lat: float, lon: float, rand=0.0) -> bool:
    return BBOX[0] - rand <= lon <= BBOX[2] + rand and BBOX[1] - rand <= lat <= BBOX[3] + rand


stops_out: list = []
stop_index: dict[tuple, int] = {}
routes_out: dict[str, str] = {}
services: dict[str, dict] = {}
trips_out: list = []
quellen = []

for praefix, muster in (("r", "gtfs/gtfs-de-rv-*.zip"), ("f", "gtfs/gtfs-de-fv-*.zip")):
    src = neueste(muster)
    quellen.append(Path(src).name)
    z = zipfile.ZipFile(src)
    rd = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8-sig"))
    stops_raw = {r["stop_id"]: r for r in rd("stops.txt")}
    hamm_ids = {k for k, r in stops_raw.items() if in_bbox(float(r["stop_lat"]), float(r["stop_lon"]))}
    # erst die Fahrten finden, die im Raum Hamm halten, dann nur deren Zeiten sammeln (zeilenweise, wenig Speicher)
    treffer = {r["trip_id"] for r in rd("stop_times.txt") if r["stop_id"] in hamm_ids}
    st: dict[str, list] = {}
    for r in rd("stop_times.txt"):
        if r["trip_id"] in treffer:
            an = sek(r["arrival_time"] or r["departure_time"])
            ab = sek(r["departure_time"] or r["arrival_time"])
            st.setdefault(r["trip_id"], []).append((int(r["stop_sequence"]), r["stop_id"], an, ab))
    routes = {r["route_id"]: r["route_short_name"] or r["route_long_name"] for r in rd("routes.txt")}
    used = set()
    for t in rd("trips.txt"):
        rows = st.get(t["trip_id"])
        if not rows:
            continue
        rows.sort()
        seq, hbf = [], -1
        for _, sid, an, ab in rows:
            s = stops_raw[sid]
            name = s["stop_name"]
            if HBF.match(name):
                name = "Hamm (Westf) Hbf"
                if hbf < 0:
                    hbf = len(seq) // 3
            key = (name, round(float(s["stop_lat"]), 3), round(float(s["stop_lon"]), 3))
            if key not in stop_index:
                stop_index[key] = len(stops_out)
                stops_out.append([name, round(float(s["stop_lat"]), 6), round(float(s["stop_lon"]), 6)])
            i = stop_index[key]
            if seq and seq[-3] == i:  # doppelter Halt (zwei Steig-IDs)
                seq[-1] = ab
                continue
            seq += [i, an, ab]
        if len(seq) < 6:
            continue
        rid, sid = praefix + t["route_id"], praefix + t["service_id"]
        routes_out[rid] = routes.get(t["route_id"], "?")
        ziel = stops_out[seq[-3]][0]
        trips_out.append([rid, ziel, sid, seq, hbf])
        used.add(t["service_id"])
    for r in rd("calendar.txt"):
        if r["service_id"] in used:
            services[praefix + r["service_id"]] = {"tage": "".join(r[d] for d in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")),
                                                   "von": r["start_date"], "bis": r["end_date"], "plus": [], "minus": []}
    for r in rd("calendar_dates.txt"):
        if r["service_id"] not in used:
            continue
        s = services.setdefault(praefix + r["service_id"], {"tage": "0000000", "von": "0", "bis": "0", "plus": [], "minus": []})
        (s["plus"] if r["exception_type"] == "1" else s["minus"]).append(r["date"])
    print(f"{Path(src).name}: {sum(1 for t in trips_out if t[0].startswith(praefix))} Fahrten")

# ---------------------------------------------------------------- Gleisgraph aus OSM


def dist(lat0, lon0, lat1, lon1) -> float:
    k = math.cos(math.radians((lat0 + lat1) / 2))
    return math.hypot((lon1 - lon0) * k, lat1 - lat0) * 111320


class Gleise:
    def __init__(self, pfad: str):
        d = json.loads(Path(pfad).read_text(encoding="utf-8"))
        self.pos: dict[int, tuple[float, float]] = {e["id"]: (e["lon"], e["lat"]) for e in d["elements"] if e["type"] == "node"}
        self.kanten: dict[int, list[tuple[int, float]]] = {}
        self.haupt: set[int] = set()
        for w in (e for e in d["elements"] if e["type"] == "way"):
            t = w.get("tags", {})
            neben = "service" in t or t.get("usage") in ("industrial", "military", "test")
            faktor = 4.0 if neben else 1.0
            nds = [n for n in w["nodes"] if n in self.pos]
            for a, b in zip(nds, nds[1:]):
                (x0, y0), (x1, y1) = self.pos[a], self.pos[b]
                dd = dist(y0, x0, y1, x1) * faktor
                self.kanten.setdefault(a, []).append((b, dd))
                self.kanten.setdefault(b, []).append((a, dd))
                if not neben:
                    self.haupt.update((a, b))


def vereinfachen(pts: list[tuple[float, float]], tol=0.00004) -> list[tuple[float, float]]:
    """Douglas-Peucker in Grad (tol ≈ 3–4 m)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stapel = [(0, len(pts) - 1)]
    while stapel:
        i, j = stapel.pop()
        (x0, y0), (x1, y1) = pts[i], pts[j]
        dx, dy = x1 - x0, y1 - y0
        ll = dx * dx + dy * dy or 1e-18
        best, bk = -1.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            f = max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / ll))
            d = math.hypot(px - x0 - f * dx, py - y0 - f * dy)
            if d > best:
                best, bk = d, k
        if best > tol:
            keep[bk] = True
            stapel += [(i, bk), (bk, j)]
    return [p for p, k in zip(pts, keep) if k]


gleisdatei = neueste("osm/gleise_overpass_*.json")
quellen.append(Path(gleisdatei).name)
g = Gleise(gleisdatei)
print(f"Gleisgraph: {len(g.pos)} Knoten")

# Rasterindex für die Suche nach dem nächsten Hauptgleis-Knoten
raster: dict[tuple[int, int], list[int]] = {}
for n in g.haupt:
    x, y = g.pos[n]
    raster.setdefault((int(x * 200), int(y * 200)), []).append(n)


def naechster(lat, lon, maxd=400.0):
    cx, cy = int(lon * 200), int(lat * 200)
    best, bd = None, maxd
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for n in raster.get((cx + dx, cy + dy), []):
                x, y = g.pos[n]
                d = dist(lat, lon, y, x)
                if d < bd:
                    best, bd = n, d
    return best


def suche(start: int, ziel: int | None = None, grenze=math.inf):
    """Dijkstra (mit Ziel: A*) im Gleisgraphen. Liefert Entfernungen und Vorgänger."""
    zp = g.pos[ziel] if ziel is not None else None
    dd = {start: 0.0}
    vor: dict[int, int] = {}
    h = [(0.0, 0.0, start)]
    while h:
        _, d, n = heapq.heappop(h)
        if n == ziel:
            break
        if d > dd.get(n, math.inf) or d > grenze:
            continue
        for m, w in g.kanten.get(n, ()):
            nd = d + w
            if nd < dd.get(m, math.inf):
                dd[m] = nd
                vor[m] = n
                x, y = g.pos[m]
                heapq.heappush(h, (nd + (dist(y, x, zp[1], zp[0]) if zp else 0.0), nd, m))
    return dd, vor


def pfad(vor: dict[int, int], start: int, ende: int) -> list[int]:
    p = [ende]
    while p[-1] != start:
        p.append(vor[p[-1]])
    return p[::-1]


def knotendist(n: int, m: int) -> float:
    return dist(g.pos[n][1], g.pos[n][0], g.pos[m][1], g.pos[m][0])


def zum_rand(na: int, lat: float, lon: float) -> list[int] | None:
    """Gleisweg von na in Richtung eines Halts außerhalb des Auszugs: bis zum erreichbaren Knoten, der dem Halt am nächsten liegt,
    solange der Weg dorthin nicht viel länger als die Luftlinie ist (sonst wäre es ein Umweg über eine andere Strecke)."""
    dd, vor = suche(na, grenze=120000)
    best, bd = None, dist(lat, lon, g.pos[na][1], g.pos[na][0]) - 500
    for n, d in dd.items():
        if n not in g.haupt or d > 1.3 * knotendist(na, n) + 800:
            continue
        x, y = g.pos[n]
        e = dist(lat, lon, y, x)
        if e < bd:
            best, bd = n, e
    return pfad(vor, na, best) if best is not None else None


def weg(a: int, b: int):
    sa, sb = stops_out[a], stops_out[b]
    na, nb = naechster(sa[1], sa[2]), naechster(sb[1], sb[2])
    if na is None and nb is None:
        return None
    if na is not None and nb is not None:
        if na == nb:
            return None
        luft = knotendist(na, nb)
        dd, vor = suche(na, nb, grenze=luft * 2 + 2000)
        if nb not in vor or dd[nb] > luft * 1.45 + 1000:
            return None
        knoten = pfad(vor, na, nb)
    elif na is not None:
        knoten = zum_rand(na, sb[1], sb[2])
    else:
        r = zum_rand(nb, sa[1], sa[2])  # type: ignore[arg-type]
        knoten = r[::-1] if r else None
    if not knoten:
        return None
    pts = [(sa[2], sa[1])] + [g.pos[n] for n in knoten] + [(sb[2], sb[1])]
    return [round(v, 5) for c in vereinfachen(pts) for v in c]


wege: dict[str, list[float]] = {}
paare = {(t[3][i], t[3][i + 3]) for t in trips_out for i in range(0, len(t[3]) - 3, 3)}
ohne = 0
for a, b in sorted(paare):
    sa, sb = stops_out[a], stops_out[b]
    if not (in_bbox(sa[1], sa[2], 0.05) or in_bbox(sb[1], sb[2], 0.05)):
        continue
    k, rk = f"{a}-{b}", f"{b}-{a}"
    if rk in wege:
        continue  # Rückrichtung: Client dreht den Weg um
    w = weg(a, b)
    if w:
        wege[k] = w
    else:
        ohne += 1
print(f"Gleiswege: {len(wege)}, ohne Gleisweg (Luftlinie): {ohne}")

out = Path(__file__).resolve().parents[1] / "web" / "public" / "daten" / "zuege.json"
out.write_text(json.dumps({"quelle": ", ".join(quellen), "stops": stops_out, "routes": routes_out, "services": services,
                           "trips": trips_out, "wege": wege}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{len(trips_out)} Fahrten, {len(stops_out)} Halte, {out.stat().st_size / 1e6:.1f} MB")

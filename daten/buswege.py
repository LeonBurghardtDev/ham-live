"""Buswege zwischen aufeinanderfolgenden Halten entlang der Straßen (OSM, ODbL).

GTFS (gtfs.de) hat keine shapes.txt, deshalb legt dieses Skript jedes im Fahrplan vorkommende Haltepaar auf das Straßennetz:
  1. Vorrang: OSM-Linienrelationen route=bus mit ref = Linienkurzname. Die Relation wird zu einer Linie zusammengesetzt
     (Ways in Reihenfolge, Lücken tolerant), beide Halte werden auf die Linie projiziert (höchstens 60 m), das Teilstück
     dazwischen ist der Weg (Richtung: Halt a muss vor Halt b liegen).
  2. Rückfall: kürzester Weg (A*) im Straßengraphen für Busse (oneway, psv/bus-Zugang), Kosten nach Straßenklasse gewichtet.
  3. Sonst kein Eintrag: die Karte fährt dann geradlinig.
Jeder Weg muss plausibel sein: Länge ≤ 2,5 × Luftlinie + 150 m.

Aufruf in einer Python-Umgebung mit den Paketen (pyosmium, shapely), nach daten/fahrplan.py:
  uv run python daten/buswege.py   (Rohdaten in $HAM_ROHDATEN)
Ausgabe: HAM-LAGE/web/public/daten/buswege.json  {"a-b": [lon, lat, lon, lat, …]}  (a, b = Stop-Indizes aus fahrplan.json)
Deterministisch: feste Reihenfolgen, keine Zufallswerte.
"""

import glob
import heapq
import json
import math
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import osmium
from shapely.geometry import LineString

T0 = time.time()
import os as _os
# Rohdaten (OSM-Auszüge, GTFS, ALKIS, Zensus): Umgebungsvariable HAM_ROHDATEN, sonst Nachbarprojekt ../HAM1226/pipeline/raw
ROH = _os.environ.get("HAM_ROHDATEN", str(Path(__file__).resolve().parents[2] / "HAM1226" / "pipeline" / "raw"))

OSM = ROH + "/osm/"
# Regierungsbezirk Arnsberg (enthält Hamm und das Umland im Kreis Unna/Soest), sonst nur der Auszug Hamm
SRC = (sorted(glob.glob(OSM + "arnsberg-regbez-*.osm.pbf")) or sorted(glob.glob(OSM + "hamm_*.osm.pbf")))[-1]
WEB = Path(__file__).resolve().parents[1] / "web" / "public" / "daten"
FAHRPLAN = WEB / "fahrplan.json"
OUT = WEB / "buswege.json"

MAX_REL = 60.0      # m, Halt → Relationslinie
MAX_SNAP = 80.0     # m, Halt → Straßenkante
MAX_LUECKE = 80.0   # m, größte geduldete Lücke in einer Relationslinie innerhalb des Teilstücks
TOLERANZ = 3.0      # m, Douglas-Peucker

# Lokale Meterprojektion um den Hammer Marktplatz (für Abstände im Stadtgebiet genau genug, exakt umkehrbar)
LON0, LAT0 = 7.8167, 51.6806
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110574.0


def xy(lon, lat):
    return ((lon - LON0) * KX, (lat - LAT0) * KY)


def lonlat(x, y):
    return (x / KX + LON0, y / KY + LAT0)


def plausibel(laenge, luft):
    return laenge <= 2.5 * luft + 150.0


# ---------------------------------------------------------------- Fahrplan

fp = json.loads(FAHRPLAN.read_text(encoding="utf-8"))
stops = fp["stops"]
stop_xy = [xy(s[2], s[1]) for s in stops]
paare: dict[tuple[int, int], set[str]] = defaultdict(set)
for route, _ziel, _service, seq in fp["trips"]:
    linie = fp["routes"].get(route, "")
    for i in range(0, len(seq) - 2, 2):
        a, b = seq[i], seq[i + 2]
        if a != b:
            paare[(a, b)].add(linie)
print(f"{len(paare)} Haltepaare aus {len(fp['trips'])} Fahrten, OSM {Path(SRC).name}")


def norm(ref):
    """Linienkurzname vergleichbar machen: GTFS „E-57“, „E - 37“ = OSM „E57“."""
    return ref.replace(" ", "").replace("-", "").upper()


REFS = {norm(l) for ls in paare.values() for l in ls}
# Nur Ways im Raum Hamm und Umland (wie bei den Gleisen: 51,45–51,95 N, 7,40–8,25 O)
RAHMEN = (*xy(7.40, 51.45), *xy(8.25, 51.95))

# ---------------------------------------------------------------- OSM lesen

BUS_JA = {"yes", "designated", "permissive"}
NEIN = {"no", "private"}
FAKTOR = {
    "motorway": 1.0, "trunk": 1.0, "primary": 1.0, "secondary": 1.0, "busway": 1.0, "bus_guideway": 1.0,
    "tertiary": 1.2, "unclassified": 1.5, "road": 2.0, "residential": 2.5, "living_street": 4.0, "service": 4.0,
}


class Relationen(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.rel: list[tuple[int, str, list[int]]] = []
        self.wayids: set[int] = set()

    def relation(self, r):
        if r.tags.get("route") != "bus" or norm(r.tags.get("ref", "")) not in REFS:
            return
        ways = [m.ref for m in r.members if m.type == "w" and m.role in ("", "forward", "backward")]
        if ways:
            self.rel.append((r.id, r.tags.get("ref"), ways))
            self.wayids.update(ways)


class Wege(osmium.SimpleHandler):
    def __init__(self, relways):
        super().__init__()
        self.relways = relways
        self.ways: dict[int, list[int]] = {}
        self.kanten: list[tuple[list[int], float, int]] = []  # Knoten, Faktor, Richtung (1 vor, -1 rück, 0 beide)
        self.nk: dict[int, tuple[float, float]] = {}

    def way(self, w):
        hw = w.tags.get("highway")
        imrel = w.id in self.relways
        if not hw and not imrel:
            return
        try:
            nds = [(n.ref, n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError:
            nds = [(n.ref, n.lon, n.lat) for n in w.nodes if n.location.valid()]
        if len(nds) < 2:
            return
        x0, y0 = xy(nds[0][1], nds[0][2])
        x1, y1 = xy(nds[-1][1], nds[-1][2])
        if not (RAHMEN[0] <= x0 <= RAHMEN[2] and RAHMEN[1] <= y0 <= RAHMEN[3]) and not (RAHMEN[0] <= x1 <= RAHMEN[2] and RAHMEN[1] <= y1 <= RAHMEN[3]):
            return
        for ref, lon, lat in nds:
            if ref not in self.nk:
                self.nk[ref] = xy(lon, lat)
        ids = [n[0] for n in nds]
        if imrel:
            self.ways[w.id] = ids
        if not hw:
            return
        t = w.tags
        bus = t.get("bus") or t.get("psv")
        if bus not in BUS_JA and t.get("bus") != "no" and t.get("psv") in BUS_JA:
            bus = t.get("psv")
        if bus == "no":
            return
        basis = hw[:-5] if hw.endswith("_link") else hw
        if hw == "platform" or t.get("public_transport") == "platform" or t.get("area") == "yes":
            return
        f = FAKTOR.get(basis)
        if f is None:
            if bus in BUS_JA and hw in ("pedestrian", "track", "footway", "cycleway", "path"):
                f = 1.5  # Fußgängerzone o. Ä. mit Busfreigabe
            else:
                return
        if bus not in BUS_JA and any(t.get(k) in NEIN for k in ("access", "vehicle", "motor_vehicle")):
            return
        if basis == "service" and t.get("service") in ("parking_aisle", "drive-through", "driveway"):
            f = 8.0
        if bus in BUS_JA and f > 1.5:
            f = 1.5
        ow = t.get("oneway")
        richtung = 0
        if ow in ("yes", "1", "true") or t.get("junction") in ("roundabout", "circular") or hw == "motorway":
            richtung = 1
        elif ow == "-1":
            richtung = -1
        if (t.get("oneway:bus") or t.get("oneway:psv")) == "no" or hw == "busway":
            richtung = 0
        self.kanten.append((ids, f, richtung))


rh = Relationen()
rh.apply_file(SRC)
wh = Wege(rh.wayids)
wh.apply_file(SRC, locations=True, idx="sparse_mem_array")
node = wh.nk
print(f"OSM gelesen: {len(rh.rel)} Busrelationen, {len(wh.kanten)} befahrbare Ways, {time.time() - T0:.0f} s")

# ---------------------------------------------------------------- Relationslinien


def zusammensetzen(wayids):
    """Ways einer Relation in Reihenfolge zu einer Knotenfolge; Lücken bleiben als Sprung erhalten (Indizes in `spruenge`)."""
    linie: list[int] = []
    spruenge: list[int] = []
    for wid in wayids:
        n = wh.ways.get(wid)
        if not n:
            continue
        if not linie:
            linie = list(n)
            continue
        ende = linie[-1]
        if n[0] == ende:
            linie += n[1:]
        elif n[-1] == ende:
            linie += n[::-1][1:]
        elif len(linie) and (linie[0] == n[0] or linie[0] == n[-1]) and len(linie) == len(wh.ways.get(wayids[0], [])):
            # erster Way war falsch herum
            linie.reverse()
            linie += n[1:] if n[0] == linie[-1] else n[::-1][1:]
        else:
            # Rücksprung suchen (z. B. ganzer Kreisverkehr als ein Way): Linie dort kürzen
            treffer = None
            for k in range(len(linie) - 1, max(-1, len(linie) - 60), -1):
                if linie[k] in (n[0], n[-1]):
                    treffer = k
                    break
            if treffer is not None:
                del linie[treffer + 1:]
                linie += n[1:] if n[0] == linie[-1] else n[::-1][1:]
            elif n[0] == n[-1] and ende in n:
                # geschlossener Way (Kreisverkehr): ab dem Anschlussknoten in Wegrichtung einmal herum
                k = n.index(ende)
                linie += n[k + 1:] + n[1:k + 1]
            else:
                ex, ey = node[ende]
                d0 = math.dist((ex, ey), node[n[0]])
                d1 = math.dist((ex, ey), node[n[-1]])
                spruenge.append(len(linie) - 1)
                linie += n if d0 <= d1 else n[::-1]
    return linie, spruenge


class RelLinie:
    def __init__(self, knoten, spruenge):
        self.p = np.array([node[k] for k in knoten], dtype=float)
        d = np.hypot(*(self.p[1:] - self.p[:-1]).T)
        self.cum = np.concatenate([[0.0], np.cumsum(d)])
        self.d = d
        self.luecke = np.zeros(len(d))
        for j in spruenge:
            self.luecke[j] = d[j]
        self.lo = self.p.min(axis=0) - MAX_REL
        self.hi = self.p.max(axis=0) + MAX_REL
        self.cache: dict[int, list[tuple[float, int, float, float]]] = {}

    def projektionen(self, si):
        """Alle Vorkommen eines Halts auf der Linie: (Länge entlang, Segment, x, y), je zusammenhängendem Abschnitt das nächste."""
        if si in self.cache:
            return self.cache[si]
        x, y = stop_xy[si]
        res = []
        if self.lo[0] <= x <= self.hi[0] and self.lo[1] <= y <= self.hi[1] and len(self.p) > 1:
            a, b = self.p[:-1], self.p[1:]
            ab = b - a
            l2 = (ab ** 2).sum(axis=1)
            t = np.clip(((np.array([x, y]) - a) * ab).sum(axis=1) / np.where(l2 > 0, l2, 1), 0, 1)
            q = a + ab * t[:, None]
            dist = np.hypot(q[:, 0] - x, q[:, 1] - y)
            nah = np.nonzero(dist <= MAX_REL)[0]
            gruppe: list[int] = []
            for i in list(nah) + [None]:
                if gruppe and (i is None or self.cum[i] - self.cum[gruppe[-1] + 1] > 150):
                    j = min(gruppe, key=lambda g: (dist[g], g))
                    res.append((float(self.cum[j] + self.d[j] * t[j]), int(j), float(q[j, 0]), float(q[j, 1])))
                    gruppe = []
                if i is not None:
                    gruppe.append(int(i))
        self.cache[si] = res
        return res

    def stueck(self, pa, pb):
        (sa, ja, xa, ya), (sb, jb, xb, yb) = pa, pb
        if self.luecke[ja:jb + 1].max() > MAX_LUECKE:
            return None
        pts = [(xa, ya)] + [tuple(v) for v in self.p[ja + 1:jb + 1]] + [(xb, yb)]
        return pts, sb - sa


rel_nach_ref: dict[str, list[RelLinie]] = defaultdict(list)
for rid, ref, ways in sorted(rh.rel, key=lambda r: r[0]):
    kn, sp = zusammensetzen(ways)
    if len(kn) >= 2:
        rel_nach_ref[norm(ref)].append(RelLinie(kn, sp))
print(f"Relationslinien: {sum(len(v) for v in rel_nach_ref.values())} für {len(rel_nach_ref)} Linien")


def per_relation(a, b, linien):
    luft = math.dist(stop_xy[a], stop_xy[b])
    best = None
    for ref in sorted(linien):
        for rl in rel_nach_ref.get(norm(ref), []):
            pa_l = rl.projektionen(a)
            if not pa_l:
                continue
            for pa in pa_l:
                for pb in rl.projektionen(b):
                    if pb[0] <= pa[0] or pb[1] < pa[1]:
                        continue
                    L = pb[0] - pa[0]
                    if not plausibel(L, luft) or (best and L >= best[1]):
                        continue
                    st = rl.stueck(pa, pb)
                    if st:
                        best = st
    return best


# ---------------------------------------------------------------- Straßengraph

adj: dict[int, list[tuple[int, float]]] = defaultdict(list)
segmente: list[tuple[int, int, float, bool, bool]] = []  # u, v, Faktor, u→v erlaubt, v→u erlaubt
for ids, f, r in wh.kanten:
    for u, v in zip(ids[:-1], ids[1:]):
        if u == v:
            continue
        L = math.dist(node[u], node[v])
        vor, rueck = r >= 0, r <= 0
        if vor:
            adj[u].append((v, L * f))
        if rueck:
            adj[v].append((u, L * f))
        segmente.append((u, v, f, vor, rueck))

ZELLE = 100.0
gitter: dict[tuple[int, int], list[int]] = defaultdict(list)
for si, (u, v, *_r) in enumerate(segmente):
    (x0, y0), (x1, y1) = node[u], node[v]
    for gx in range(int(math.floor(min(x0, x1) / ZELLE)), int(math.floor(max(x0, x1) / ZELLE)) + 1):
        for gy in range(int(math.floor(min(y0, y1) / ZELLE)), int(math.floor(max(y0, y1) / ZELLE)) + 1):
            gitter[(gx, gy)].append(si)
print(f"Straßengraph: {len(adj)} Knoten, {len(segmente)} Segmente, {time.time() - T0:.0f} s")

snap_cache: dict[int, tuple | None] = {}


def einrasten(si):
    """Nächste Straßenkante (Hauptstraßen leicht bevorzugt): (Segment, t, x, y) oder None."""
    if si in snap_cache:
        return snap_cache[si]
    x, y = stop_xy[si]
    best, bs = None, math.inf
    gx, gy = int(math.floor(x / ZELLE)), int(math.floor(y / ZELLE))
    gesehen = set()
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for s in gitter.get((gx + dx, gy + dy), ()):
                if s in gesehen:
                    continue
                gesehen.add(s)
                u, v, f, _vo, _ru = segmente[s]
                (x0, y0), (x1, y1) = node[u], node[v]
                vx, vy = x1 - x0, y1 - y0
                l2 = vx * vx + vy * vy
                t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((x - x0) * vx + (y - y0) * vy) / l2))
                qx, qy = x0 + vx * t, y0 + vy * t
                d = math.hypot(qx - x, qy - y)
                if d > MAX_SNAP:
                    continue
                score = d * (1 + 0.15 * (f - 1))
                if score < bs:
                    bs, best = score, (s, t, qx, qy)
    snap_cache[si] = best
    return best


def per_wegsuche(a, b):
    sa, sb = einrasten(a), einrasten(b)
    if not sa or not sb:
        return None
    luft = math.dist(stop_xy[a], stop_xy[b])
    grenze = 2.5 * luft + 150.0
    S, T = -1, -2
    extra: dict[int, list[tuple[int, float]]] = defaultdict(list)
    seg_a, ta, xa, ya = sa
    u, v, f, vor, rueck = segmente[seg_a]
    L = math.dist(node[u], node[v])
    if vor:
        extra[S].append((v, (1 - ta) * L * f))
    if rueck:
        extra[S].append((u, ta * L * f))
    seg_b, tb, xb, yb = sb
    u2, v2, f2, vor2, rueck2 = segmente[seg_b]
    L2 = math.dist(node[u2], node[v2])
    if vor2:
        extra[u2].append((T, tb * L2 * f2))
    if rueck2:
        extra[v2].append((T, (1 - tb) * L2 * f2))
    if seg_a == seg_b and ((vor and tb >= ta) or (rueck and tb <= ta)):
        extra[S].append((T, abs(tb - ta) * L * f))
    pos = {S: (xa, ya), T: (xb, yb)}

    def p(n):
        return pos[n] if n < 0 else node[n]

    h = lambda n: math.dist(p(n), (xb, yb))
    dist = {S: 0.0}
    vor_k: dict[int, int] = {}
    heap = [(h(S), 0.0, S)]
    schritte = 0
    while heap:
        _, g, n = heapq.heappop(heap)
        if n == T:
            break
        if g > dist.get(n, math.inf):
            continue
        schritte += 1
        if schritte > 200000 or g > grenze * 4:
            return None
        for m, c in adj.get(n, []) + extra.get(n, []):
            ng = g + c
            if ng < dist.get(m, math.inf):
                dist[m] = ng
                vor_k[m] = n
                heapq.heappush(heap, (ng + h(m), ng, m))
    if T not in vor_k:
        return None
    pfad = [T]
    while pfad[-1] != S:
        pfad.append(vor_k[pfad[-1]])
    pts = [p(n) for n in reversed(pfad)]
    laenge = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
    if not plausibel(laenge, luft):
        return None
    return pts, laenge


# ---------------------------------------------------------------- Export


def ausgabe(pts):
    ls = LineString(pts).simplify(TOLERANZ, preserve_topology=False)
    flach = []
    for x, y in ls.coords:
        lon, lat = lonlat(x, y)
        flach += [round(lon, 5), round(lat, 5)]
    return flach


wege: dict[str, list[float]] = {}
zahl = {"relation": 0, "wegsuche": 0, "gerade": 0}
for (a, b) in sorted(paare):
    w = per_relation(a, b, paare[(a, b)])
    art = "relation"
    if not w:
        w = per_wegsuche(a, b)
        art = "wegsuche"
    if not w:
        zahl["gerade"] += 1
        continue
    zahl[art] += 1
    wege[f"{a}-{b}"] = ausgabe(w[0])

OUT.write_text(json.dumps(wege, separators=(",", ":")), encoding="utf-8")
n = len(paare)
print(f"{n} Paare: Relation {zahl['relation']} ({zahl['relation'] / n:.0%}), Wegsuche {zahl['wegsuche']} ({zahl['wegsuche'] / n:.0%}), "
      f"gerade {zahl['gerade']} ({zahl['gerade'] / n:.0%})")
print(f"{OUT.name}: {OUT.stat().st_size / 1e6:.2f} MB, {time.time() - T0:.0f} s")

"""Einrichtungen für den Tab „Wegweiser“: Notfall, Gesundheit, Bildung, Alltag.

Quellen:
- OpenStreetMap (ODbL), lokaler Auszug $HAM_ROHDATEN/osm/hamm_*.osm.pbf
- Stadt Hamm, WFS od_bildung_kitas.qgs (Schulen, Kindertagesstaette, Kinderaerzte, Spiel_und_Bewegungsflaechen),
  Datenlizenz Deutschland Namensnennung 2.0 (opendata.ruhr, Organisation hamm). Rohdaten mit Abrufdatum nach
  daten/raw/einrichtungen/<datum>/ (--offline nimmt den letzten Abruf).
- Ärztliche Notdienstpraxen (KVWL) von Hand, Quelle in den Properties.

Aufruf in einer Python-Umgebung mit den Paketen (pyosmium, shapely):
  uv run python daten/einrichtungen.py   (Rohdaten in $HAM_ROHDATEN)
Ausgabe: HAM-LAGE/web/public/daten/einrichtungen.geojson, Punkte mit {kat, typ, art, name, sub, quelle[, notaufnahme]}.
Nur innerhalb der Stadtgrenze (grenzen.geojson, ebene 'stadt'). Dubletten (gleicher Typ, ähnlicher oder fehlender Name
< 80 m, gleicher Name < 250 m) werden zusammengeführt, amtliche Daten haben Vorrang. Reihenfolge stabil (Kategorie, Typ, Art, Name, Lage).
"""

import datetime
import glob
import json
import math
import re
import sys
import urllib.request
from pathlib import Path

import osmium
from shapely import wkb
from shapely.geometry import Point, shape
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parents[1]
import os as _os
# Rohdaten (OSM-Auszüge, GTFS, ALKIS, Zensus): Umgebungsvariable HAM_ROHDATEN, sonst Nachbarprojekt ../HAM1226/pipeline/raw
ROH = _os.environ.get("HAM_ROHDATEN", str(Path(__file__).resolve().parents[2] / "HAM1226" / "pipeline" / "raw"))

SRC = sorted(glob.glob(ROH + "/osm/hamm_*.osm.pbf"))[-1]
WFS = "https://www.hamm.de/wmsserver/qgisserver/qgis_mapserv.fcgi.exe?MAP=C:/qgis_server_daten/od_bildung_kitas.qgs"
WFS_EBENEN = ["Schulen", "Kindertagesstaette", "Kinderaerzte", "Spiel_und_Bewegungsflaechen"]
Q_OSM = "OpenStreetMap (ODbL)"
Q_HAMM = "Stadt Hamm (dl-de/by-2-0)"
KATS = ["notfall", "gesundheit", "bildung", "alltag"]
TYPEN = {  # typ: (kat, Vorgabe-Art)
    "krankenhaus": ("notfall", "Krankenhaus"), "notdienstpraxis": ("notfall", "Notdienstpraxis"),
    "defi": ("notfall", "Defibrillator"), "feuerwehr": ("notfall", "Feuerwehr"), "polizei": ("notfall", "Polizei"),
    "apotheke": ("gesundheit", "Apotheke"), "arzt": ("gesundheit", "Arztpraxis"), "zahnarzt": ("gesundheit", "Zahnarzt"),
    "schule": ("bildung", "Schule"), "kita": ("bildung", "Kita"), "hochschule": ("bildung", "Hochschule"),
    "rathaus": ("alltag", "Rathaus"), "recyclinghof": ("alltag", "Recyclinghof"), "spielplatz": ("alltag", "Spielplatz"),
    "wc": ("alltag", "Toilette"), "post": ("alltag", "Postfiliale"), "packstation": ("alltag", "Packstation"),
    "bibliothek": ("alltag", "Bibliothek"),
}
FACH = {
    "general": "Hausarzt", "family": "Hausarzt", "internal": "Internist", "paediatrics": "Kinderarzt",
    "gynaecology": "Frauenarzt", "obstetrics": "Frauenarzt", "ophthalmology": "Augenarzt", "orthopaedics": "Orthopäde",
    "dermatology": "Hautarzt", "otolaryngology": "HNO-Arzt", "urology": "Urologe", "neurology": "Neurologe",
    "psychiatry": "Psychiater", "child_psychiatry": "Kinderpsychiater", "cardiology": "Kardiologe", "radiology": "Radiologie",
    "surgery": "Chirurg", "general_surgery": "Chirurg", "trauma": "Unfallchirurg", "gastroenterology": "Gastroenterologe",
    "pulmonology": "Lungenarzt", "anaesthetics": "Anästhesie", "oncology": "Onkologie", "nephrology": "Nephrologe",
    "rheumatology": "Rheumatologe", "psychotherapy": "Psychotherapie", "endocrinology": "Endokrinologe",
    "nuclear": "Nuklearmedizin", "nuclear_medicine": "Nuklearmedizin", "diabetology": "Diabetologe", "angiology": "Angiologe",
    "neurosurgery": "Neurochirurg", "plastic_surgery": "Plastische Chirurgie", "dialysis": "Dialyse",
    "occupational": "Arbeitsmedizin", "pathology": "Pathologie", "laboratory_medicine": "Labor", "hematology": "Hämatologe",
    "vascular_surgery": "Gefäßchirurg", "oral_surgery": "Kieferchirurg", "maxillofacial_surgery": "Kieferchirurg",
    "physiatry": "Physikalische Medizin", "sports": "Sportmedizin", "naturopathy": "Naturheilkunde", "homeopathy": "Homöopathie",
    "geriatrics": "Geriatrie", "allergology": "Allergologe", "phoniatrics": "Phoniatrie", "proctology": "Proktologe",
    "pain": "Schmerztherapie", "psychosomatics": "Psychosomatik", "venereology": "Hautarzt", "infectiology": "Infektiologie",
}
SCHULART = [("berufskolleg", "Berufskolleg"), ("gymnasium", "Gymnasium"), ("gesamtschule", "Gesamtschule"),
            ("sekundarschule", "Sekundarschule"), ("realschule", "Realschule"), ("hauptschule", "Hauptschule"),
            ("förderschule", "Förderschule"), ("foerderschule", "Förderschule"), ("grundschule", "Grundschule"),
            ("musikschule", "Musikschule"), ("volkshochschule", "Volkshochschule"), ("weiterbildungskolleg", "Weiterbildungskolleg")]
# Notaufnahmen von Hand (OSM hat in Hamm kein emergency=yes): Lage des OSM-Krankenhauses innerhalb 300 m
# Quelle: Websites der Johanniter-Kliniken Hamm und der St. Barbara-Klinik, Stand 2026-10-01
NOTAUFNAHMEN = [
    {"lon": 7.8183, "lat": 51.6791, "adresse": "Nassauerstraße 13–19", "text": "Zentrale Notaufnahme"},
    {"lon": 7.8265, "lat": 51.6698, "adresse": "Werler Straße 110", "text": "Zentrale Notaufnahme"},
    {"lon": 7.8290, "lat": 51.6691, "adresse": "Werler Straße 110", "text": "Kinder-Notaufnahme"},
    {"lon": 7.8412, "lat": 51.7083, "adresse": "Am Heessener Wald 1", "text": "Zentrale Notaufnahme"},
]
# Ärztliche Notdienstpraxen der KVWL in Hamm (Stand 2026-10-01). Lage am Krankenhaus aus OSM (Namensmuster).
NOTDIENSTPRAXEN = [
    {"name": "Notfalldienstpraxis Hamm", "haus": r"Barbara", "adresse": "Am Heessener Wald 1",
     "zeiten": "Mo, Di, Do 18–22, Mi, Fr 13–22, Sa, So, Feiertag 8–22 Uhr",
     "quelle": "KVWL (kvwl.de, Pressemitteilung Notfalldienstpraxis Hamm), von Hand"},
    {"name": "Kinder-Notfalldienstpraxis", "haus": r"Kinder- und Jugendmedizin", "adresse": "Werler Straße 110",
     "zeiten": "Mo, Di, Do 18–20:30, Mi, Fr 17–20:30, Sa, So, Feiertag 9–13 und 17–20:30 Uhr",
     "quelle": "KVWL / Johanniter-Kliniken Hamm (johanniter.de), von Hand"},
]


def adresse(t):
    s = t.get("addr:street", "")
    if s and t.get("addr:housenumber"):
        s += " " + t["addr:housenumber"]
    return s


def kurz(*teile, n=90):
    return " · ".join(p for p in teile if p)[:n]


def osm_typ(t):
    """(typ, art, sub, extra) oder None"""
    a, hc = t.get("amenity"), t.get("healthcare")
    adr = adresse(t)
    oz = (t.get("opening_hours") or "")[:40]
    if a == "hospital" or hc == "hospital":
        na = t.get("emergency") == "yes"
        return "krankenhaus", "Krankenhaus", kurz("Notaufnahme" if na else "", adr), {"notaufnahme": na}
    if t.get("emergency") == "defibrillator":
        ort = t.get("defibrillator:location") or t.get("defibrillator:location:de") or t.get("description") or ""
        return "defi", "Defibrillator", kurz(ort, "innen" if t.get("indoor") == "yes" else "", oz), {}
    if a == "fire_station":
        return "feuerwehr", "Feuerwehr", kurz(adr, t.get("operator", "")), {}
    if a == "police":
        return "polizei", "Polizei", kurz(adr, oz), {}
    if a == "pharmacy" or hc == "pharmacy":
        return "apotheke", "Apotheke", kurz(adr, oz), {}
    if a == "dentist" or hc == "dentist":
        return "zahnarzt", "Zahnarzt", kurz(adr, oz), {}
    if a == "doctors" or hc == "doctor":
        sp = [x.strip() for x in (t.get("healthcare:speciality") or "").split(";") if x.strip()]
        art = next((FACH[x] for x in sp if x in FACH), None) or ("Arztpraxis" if not sp else "Facharzt")
        return "arzt", art, kurz(adr, oz), {}
    if a == "school":
        return "schule", schulart(t.get("name", "") + " " + t.get("school:de", "") + " " + t.get("school", "")), kurz(adr, t.get("operator", "")), {}
    if a == "kindergarten":
        return "kita", "Kita", kurz(adr, t.get("operator", "")), {}
    if a in ("university", "college"):
        return "hochschule", "Hochschule", kurz(adr), {}
    if a == "townhall" and t.get("townhall:type") not in ("community_centre",):
        n = t.get("name", "")
        return "rathaus", "Bürgeramt" if re.search(r"(?i)bürger", n) else "Rathaus", kurz(adr, oz), {}
    if (t.get("office") == "government" or not (t.get("highway") or t.get("public_transport") or a)) and re.search(r"(?i)^(bürgeramt|bürgerbüro|bürgerservice)", t.get("name", "")):
        return "rathaus", "Bürgeramt", kurz(adr, oz), {}
    if (a == "recycling" and (t.get("recycling_type") == "centre" or re.search(r"(?i)recyclinghof|wertstoffhof", t.get("name", "")))) or a == "waste_transfer_station":
        return "recyclinghof", "Recyclinghof", kurz(adr, oz, t.get("operator", "")), {}
    if t.get("leisure") == "playground":
        return "spielplatz", "Spielplatz", kurz(adr), {}
    if a == "toilets" and t.get("access") not in ("private", "no", "customers"):
        return "wc", "Toilette", kurz("Gebühr" if t.get("fee") == "yes" else "", "barrierefrei" if t.get("wheelchair") == "yes" else "", oz), {}
    if a == "post_office":
        return "post", "Postfiliale", kurz(adr, oz), {}
    if a == "parcel_locker" or (a == "vending_machine" and t.get("vending") in ("parcel_pickup", "parcel_mail_in", "parcel_pickup;parcel_mail_in")):
        b = t.get("brand") or t.get("operator") or ""
        return "packstation", "Packstation" if re.search(r"(?i)dhl|deutsche post", b) else "Paketstation", kurz(b, adr), {}
    if a == "library":
        return "bibliothek", "Bibliothek", kurz(adr, oz), {}
    return None


def schulart(text):
    lo = text.lower()
    for k, v in SCHULART:
        if k in lo:
            return v
    return "Schule"


def wfs_holen(offline):
    basis = ROOT / "daten" / "raw" / "einrichtungen"
    if offline:
        d = sorted(basis.glob("*"))[-1]
    else:
        d = basis / datetime.date.today().isoformat()
        d.mkdir(parents=True, exist_ok=True)
        for e in WFS_EBENEN:
            u = f"{WFS}&SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature&TYPENAME={e}&OUTPUTFORMAT=application/vnd.geo%2Bjson&SRSNAME=EPSG:4326"
            req = urllib.request.Request(u, headers={"user-agent": "HAM-LAGE/0.1 (privat)"})
            (d / f"{e}.json").write_bytes(urllib.request.urlopen(req, timeout=90).read())
    return {e: json.loads((d / f"{e}.json").read_text(encoding="utf-8"))["features"] for e in WFS_EBENEN}, d.name


def wfs_punkte(wfs):
    out = []
    for f in wfs["Schulen"]:
        p = f["properties"]
        typ = p.get("schultyp") or "Schule"
        art = {"Gemeinschaftsgrundschule": "Grundschule", "Konfessionelle Grundschule": "Grundschule", "sonstige Schule": "Schule"}.get(typ, typ)
        sub = kurz(p.get("anschrift"), "Bekenntnisschule" if typ.startswith("Konfess") else "", f"{p['anzahl_schueler']} Schüler" if p.get("anzahl_schueler") else "")
        out.append(("schule", art, p.get("schule") or art, sub, f["geometry"]["coordinates"], Q_HAMM, {}))
    for f in wfs["Kindertagesstaette"]:
        p = f["properties"]
        if p.get("inaktiv_seit"):
            continue
        zeit = f"{p['oeffnungszeit_von']}–{p['oeffnungszeit_bis']} Uhr" if p.get("oeffnungszeit_von") and p.get("oeffnungszeit_bis") else ""
        out.append(("kita", "Kita", p.get("kitaname") or "Kita", kurz(p.get("adresse"), zeit, p.get("traeger")), f["geometry"]["coordinates"], Q_HAMM, {}))
    for f in wfs["Kinderaerzte"]:
        p = f["properties"]
        out.append(("arzt", "Kinderarzt", p.get("praxis") or "Kinderarzt", kurz(p.get("adresse"), p.get("tel")), f["geometry"]["coordinates"], Q_HAMM, {}))
    for f in wfs["Spiel_und_Bewegungsflaechen"]:
        p = f["properties"]
        art = p.get("art_der_flaeche") or "Spielplatz"
        if len(art) > 24:
            art = "Spielplatz"
        sub = kurz(p.get("standort_adresse"), ("Alter " + p["zielgruppe"]) if p.get("zielgruppe") else "", "gesperrt" if p.get("sperrung") else "")
        out.append(("spielplatz", art, p.get("name_spielplatz") or p.get("name") or art, sub, f["geometry"]["coordinates"], Q_HAMM, {}))
    return out


def norm(n):
    n = n.lower().replace("ß", "ss").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
    n = re.sub(r"\b(st|sankt)\b\.?", "st", n)
    return set(w for w in re.findall(r"[a-z0-9]+", n) if len(w) > 2 and w not in ("hamm", "der", "die", "das", "und", "fuer", "von", "kita", "schule", "kindertageseinrichtung", "kindertagesstaette", "kindergarten", "praxis", "spielplatz"))


def gleicher_name(a, b):
    if not a or not b:
        return True  # unbenannt: Nähe genügt
    na, nb = norm(a), norm(b)
    if not na or not nb:
        return a.lower() == b.lower()
    return len(na & nb) / min(len(na), len(nb)) >= 0.5


def meter(a, b):
    dx = (a[0] - b[0]) * 111320 * math.cos(math.radians(a[1]))
    dy = (a[1] - b[1]) * 110540
    return math.hypot(dx, dy)


def main():
    offline = "--offline" in sys.argv
    grenzen = json.loads((ROOT / "web/public/daten/grenzen.geojson").read_text(encoding="utf-8"))
    stadt = prep(shape(next(f for f in grenzen["features"] if f["properties"]["ebene"] == "stadt")["geometry"]))

    osm = []
    krankenhaeuser = []
    fab = osmium.geom.WKBFactory()

    class H(osmium.SimpleHandler):
        def _add(self, tags, lon, lat):
            t = {k: v for k, v in tags}
            r = osm_typ(t)
            if not r:
                return
            typ, art, sub, extra = r
            name = t.get("name") or t.get("official_name") or ""
            if typ == "defi" and not name:
                name = t.get("operator", "")
            osm.append((typ, art, name, sub, [round(lon, 6), round(lat, 6)], Q_OSM, extra))
            if typ == "krankenhaus":
                krankenhaeuser.append((name, lon, lat))

        def node(self, n):
            if n.tags:
                self._add(n.tags, n.location.lon, n.location.lat)

        def area(self, a):
            if not a.tags or not osm_typ({k: v for k, v in a.tags}):
                return
            try:
                g = wkb.loads(fab.create_multipolygon(a), hex=True)
                p = g.representative_point()
                self._add(a.tags, p.x, p.y)
            except Exception:
                pass

    H().apply_file(SRC, locations=True)
    wfs, abruf = wfs_holen(offline)
    amtlich = wfs_punkte(wfs)

    hand = []
    for np in NOTDIENSTPRAXEN:
        haus = next((k for k in krankenhaeuser if re.search(np["haus"], k[0])), None)
        if not haus:
            print("Krankenhaus für", np["name"], "nicht gefunden")
            continue
        hand.append(("notdienstpraxis", "Notdienstpraxis", np["name"], kurz(np["adresse"], np["zeiten"], n=120),
                     [round(haus[1] + 0.0003, 6), round(haus[2] + 0.0002, 6)], np["quelle"], {}))

    # amtlich und von Hand zuerst, OSM ergänzt; Dubletten (gleicher Typ, ähnlicher Name, < 80 m) zusammenführen
    behalten = []
    roh = sorted(hand, key=lambda r: r[2]) + sorted(amtlich, key=lambda r: (r[0], r[2], r[4])) + sorted(osm, key=lambda r: (r[0], r[2], r[4]))
    for r in roh:
        if not stadt.contains(Point(*r[4])):
            continue
        dop = next((b for b in behalten if b[0] == r[0] and ((meter(b[4], r[4]) < 80 and gleicher_name(b[2], r[2]))
                                                        or (meter(b[4], r[4]) < 250 and b[2] and r[2] and norm(b[2]) == norm(r[2]) and norm(r[2])))), None)
        if dop:
            # fehlende Angaben ergänzen (z. B. Notaufnahme, Öffnungszeiten)
            if r[6].get("notaufnahme"):
                dop[6]["notaufnahme"] = True
            if not dop[2] and r[2]:
                behalten[behalten.index(dop)] = (dop[0], dop[1], r[2], dop[3] or r[3], dop[4], dop[5], dop[6])
            continue
        behalten.append(r)

    for na in NOTAUFNAHMEN:
        i = min((i for i, b in enumerate(behalten) if b[0] == "krankenhaus"), key=lambda i: meter(behalten[i][4], (na["lon"], na["lat"])), default=None)
        if i is None or meter(behalten[i][4], (na["lon"], na["lat"])) > 300:
            print("Notaufnahme ohne Krankenhaus:", na)
            continue
        b = behalten[i]
        b[6]["notaufnahme"] = True
        rest = b[3] if b[3] and not b[3].startswith(na["adresse"].split()[0]) else ""
        behalten[i] = (b[0], b[1], b[2], kurz(na["text"], na["adresse"], rest), b[4], b[5] + "; Notaufnahme von Hand (Klinik-Websites)", b[6])

    behalten.sort(key=lambda r: (KATS.index(TYPEN[r[0]][0]), list(TYPEN).index(r[0]), r[1], r[2], r[4]))
    feats = []
    for typ, art, name, sub, (lon, lat), quelle, extra in behalten:
        props = {"kat": TYPEN[typ][0], "typ": typ, "art": art, "name": name or art, "sub": sub, "quelle": quelle}
        if extra.get("notaufnahme"):
            props["notaufnahme"] = True
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props})
    out = ROOT / "web/public/daten/einrichtungen.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "quelle": f"{Path(SRC).name}; WFS Stadt Hamm od_bildung_kitas Abruf {abruf}",
                               "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    from collections import Counter
    print(len(feats), "Einrichtungen,", out.stat().st_size // 1024, "KB")
    for k in KATS:
        c = Counter((f["properties"]["typ"], f["properties"]["art"]) for f in feats if f["properties"]["kat"] == k)
        print(k, sum(c.values()), dict(sorted(c.items())))
    print("Notaufnahmen:", [f["properties"]["name"] for f in feats if f["properties"].get("notaufnahme")])
    print("Krankenhäuser:", [f["properties"]["name"] for f in feats if f["properties"]["typ"] == "krankenhaus"])


if __name__ == "__main__":
    main()

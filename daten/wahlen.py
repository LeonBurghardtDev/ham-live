"""Wahlergebnisse der Stadt Hamm je Stimmbezirk und Kommunalwahlbezirk für den Tab „Politik“.

Aufruf (nur Standardbibliothek):  python daten/wahlen.py   (--offline: nur vorhandene Rohdaten)
Quellen:
  Ergebnisse  votemanager der Stadt Hamm (citeq), Open-Data-CSV je Wahl:
              https://wahlen.citeq.de/<termin>/05915000/daten/opendata/Open-Data-05915000-*.csv
  Geometrie   QGIS-WFS der Stadt Hamm, od_wahlen.qgs, Ebenen „Stimmbezirke“ (137 Urnenbezirke)
              und „Kommunalwahlbezirke“ (29), Datensatz kommunalwahlbezirke-2025-in-der-stadt-hamm
              auf hamm.opendata.ruhr, Datenlizenz Deutschland Namensnennung 2.0
Rohdaten:  daten/raw/wahlen/<AAAA-MM-TT>/ (Abrufdatum), es wird der jüngste Abruf verwendet.
Ausgabe:   web/public/daten/wahlen.json

Besonderheiten:
  - Die Stimmbezirksgeometrie gilt für 2025 (Kommunalwahl und Bundestagswahl). Die Europawahl 2024
    nutzte eine ältere Einteilung: nur gleich nummerierte Bezirke werden zugeordnet (Hinweis in der Ausgabe).
  - Briefwahl wird je Briefwahlbezirk gezählt (Nummern 001–029, a/b). Briefwahlbezirk NNN gehört zu
    Kommunalwahlbezirk NNN; die Kommunalwahlbezirke enthalten daher Urne + Brief (2025er Wahlen).
  - Stimmenanteile je Stimmbezirk sind nur Urnenstimmen. Die Beteiligung je Stimmbezirk ist geschätzt:
    (Urnenwähler + Wahlscheininhaber × Rücklaufquote des Kommunalwahlbezirks) / Wahlberechtigte.
"""

import csv
import datetime as dt
import io
import json
import re
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

WURZEL = Path(__file__).resolve().parents[1]
RAW = WURZEL / "daten" / "raw" / "wahlen"
AUS = WURZEL / "web" / "public" / "daten" / "wahlen.json"
VM = "https://wahlen.citeq.de/{t}/05915000/daten/opendata/"
WFS = ("https://www.hamm.de/wmsserver/qgisserver/qgis_mapserv.fcgi.exe?MAP=C:/qgis_server_daten/od_wahlen.qgs"
       "&SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature&TYPENAME={n}&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326")

STADTBEZIRKE = {1: "Mitte", 2: "Uentrop", 3: "Rhynern", 4: "Pelkum", 5: "Herringen", 6: "Bockum-Hövel", 7: "Heessen"}
BV_DATEI = {1: "Mitte", 2: "Uentrop", 3: "Rhynern", 4: "Pelkum", 5: "Herringen", 6: "Bockum-Hoevel", 7: "Heessen"}

# id, Name, Datum, Stimmart, Termin, CSV-Dateien, Präfix der Stimmenfelder, Name im open_data.json (Anfang)
WAHLEN = [
    ("kw25-rat", "Ratswahl 2025", "2025-09-14", "Stimme", "20250914", ["Ratswahl-Stimmbezirk"], "D", "Ratswahl"),
    ("kw25-ob", "Oberbürgermeisterwahl 2025", "2025-09-14", "Stimme", "20250914",
     ["Wahl-des-der-Oberbuergermeisters-in-Stimmbezirk"], "D", "Wahl des/der Oberb"),
    ("kw25-bv", "Bezirksvertretungen 2025", "2025-09-14", "Stimme", "20250914",
     [f"Bezirksvertretungswahl-{n}" for n in BV_DATEI.values()], "D", "Bezirksvertretungswahl"),
    ("kw25-rvr", "Ruhrparlament (RVR) 2025", "2025-09-14", "Stimme", "20250914", ["RVR-Wahl-Stimmbezirk"], "D", "RVR-Wahl"),
    ("btw25-erst", "Bundestagswahl 2025", "2025-02-23", "Erststimme", "20250223", ["Wahl-zum-Deutschen-Bundestag-Wahlbezirk"], "D", "Wahl zum Deutschen Bundestag"),
    ("btw25-zweit", "Bundestagswahl 2025", "2025-02-23", "Zweitstimme", "20250223", ["Wahl-zum-Deutschen-Bundestag-Wahlbezirk"], "F", "Wahl zum Deutschen Bundestag"),
    ("ew24", "Europawahl 2024", "2024-06-09", "Stimme", "20240609", ["Europawahl-Wahlbezirk"], "D", "Europawahl"),
]
GEMEINDE = {"kw25-rat": "Ratswahl-Gemeinde", "kw25-ob": "Wahl-des-der-Oberbuergermeisters-in-Gemeinde",
            "kw25-rvr": "RVR-Wahl-Gemeinde", "btw25-erst": "Wahl-zum-Deutschen-Bundestag-Gemeinde",
            "btw25-zweit": "Wahl-zum-Deutschen-Bundestag-Gemeinde", "ew24": "Europawahl-Gemeinde"}

# Langname (Anfang, ohne Groß/Klein) → Kurzname, Farbe
PARTEIEN = [
    ("christlich demokratische union", "CDU", "#1A1A1A"),
    ("sozialdemokratische partei", "SPD", "#E3000F"),
    ("bündnis 90/die grünen", "GRÜNE", "#1AA037"),
    ("freie demokratische partei", "FDP", "#FFE500"),
    ("alternative für deutschland", "AfD", "#009EE0"),
    ("die linke", "LINKE", "#BE3075"),
    ("bündnis sahra wagenknecht", "BSW", "#792351"),
    ("wählergruppe pro hamm", "Pro Hamm", "#E36C0A"),
    ("volt deutschland", "Volt", "#502379"),
    ("freie wähler", "FREIE WÄHLER", "#F29200"),
    ("partei für arbeit, rechtsstaat", "Die PARTEI", "#B5152B"),
    ("partei mensch umwelt tierschutz", "Tierschutzpartei", "#006A4E"),
    ("partei für tierschutz", "Tierschutz hier!", "#4F8A3C"),
    ("aktion partei für tierschutz", "Tierschutz hier!", "#4F8A3C"),
    ("familien-partei", "FAMILIE", "#FF6600"),
    ("ökologisch-demokratische partei", "ÖDP", "#FF6A00"),
    ("piratenpartei", "PIRATEN", "#FF8800"),
    ("basisdemokratische partei", "dieBasis", "#4A90A4"),
    ("partei der humanisten", "PdH", "#2A5BA0"),
    ("marxistisch-leninistische", "MLPD", "#C00000"),
    ("die heimat", "HEIMAT", "#8B4513"),
    ("die gerechtigkeitspartei", "Team Todenhöfer", "#4B9C8E"),
    ("bündnis deutschland", "BÜNDNIS DEUTSCHLAND", "#0B3D91"),
    ("werteunion", "WerteUnion", "#1F3A68"),
    ("mera25", "MERA25", "#E2231A"),
    ("partei des fortschritts", "PdF", "#7F7F7F"),
    ("bündnis für innovation", "BIG", "#7F7F7F"),
    ("bündnis c", "Bündnis C", "#7F7F7F"),
]
GRAU = "#8C8C8C"


def holen(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "HAM-LAGE (privat)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def rohdaten(offline: bool) -> Path:
    vorhanden = sorted(p for p in RAW.glob("20*") if p.is_dir())
    if offline:
        return vorhanden[-1]
    ziel = RAW / dt.date.today().isoformat()
    ziel.mkdir(parents=True, exist_ok=True)
    dateien: dict[str, str] = {}
    for t in sorted({w[4] for w in WAHLEN}):
        dateien[f"{t}-open_data.json"] = VM.format(t=t) + "open_data.json"
    for w in WAHLEN:
        for f in w[5]:
            dateien[f"{w[4]}-{f}.csv"] = VM.format(t=w[4]) + f"Open-Data-05915000-{f}.csv"
        if w[0] in GEMEINDE:
            dateien[f"{w[4]}-{GEMEINDE[w[0]]}.csv"] = VM.format(t=w[4]) + f"Open-Data-05915000-{GEMEINDE[w[0]]}.csv"
    # amtliche Übersicht je Kommunalwahlbezirk (Urne + Brief), nur zur Prüfung in wahlen_test.py
    dateien["20250914-Ratswahl-Wahlbezirk.csv"] = VM.format(t="20250914") + "Open-Data-05915000-Ratswahl-Wahlbezirk.csv"
    dateien["wfs-Stimmbezirke.json"] = WFS.format(n="Stimmbezirke")
    dateien["wfs-Kommunalwahlbezirke.json"] = WFS.format(n="Kommunalwahlbezirke")
    for name, url in dateien.items():
        p = ziel / name
        if not p.exists():
            p.write_bytes(holen(url))
    (ziel / "quellen.json").write_text(json.dumps(dateien, ensure_ascii=False, indent=1), encoding="utf-8")
    return ziel


def zahl(s: str) -> int:
    s = (s or "").strip()
    return int(s) if s.isdigit() else 0


def lies_csv(p: Path) -> list[dict]:
    return list(csv.DictReader(io.StringIO(p.read_text(encoding="utf-8-sig")), delimiter=";"))


def partei(lang: str) -> tuple[str, str]:
    l = lang.lower()
    for anf, kurz, farbe in PARTEIEN:
        if l.startswith(anf) or anf in l[:60]:
            return kurz, farbe
    return (lang if len(lang) <= 24 else lang[:22] + "…"), GRAU


def ist_brief(nr: str, name: str) -> bool:
    # Urnenbezirke sind dreistellig 101–799; Briefwahlbezirke 1–29 mit a/b (Quelle schreibt einmal „Birefwahlbezirk“)
    return not re.fullmatch(r"[1-7]\d\d", nr.strip())


def brief_kwb(nr: str) -> int:
    return int(re.match(r"0*(\d+)", nr).group(1))


def nr_norm(nr: str) -> str:
    return nr.strip()


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    raw = rohdaten("--offline" in sys.argv)
    sb = json.loads((raw / "wfs-Stimmbezirke.json").read_text(encoding="utf-8"))["features"]
    kwb_geo = json.loads((raw / "wfs-Kommunalwahlbezirke.json").read_text(encoding="utf-8"))["features"]
    geo: dict[str, dict] = {}
    for f in sb:
        p = f["properties"]
        geo[str(p["bezirk"]).strip()] = {"kwb": int(p["wahlbere_1"]), "sbz": int(p["wahlberech"]), "geometry": f["geometry"]}

    wahlen_aus = []
    je_sb: dict[str, dict] = defaultdict(dict)       # nr → wahlId → Werte
    je_kwb: dict[int, dict] = defaultdict(dict)
    brief_aus: dict[str, list] = {}
    namen: dict[str, str] = {}
    hinweise: dict[str, str] = {}

    for wid, name, datum, stimmart, termin, csvs, pf, odname in WAHLEN:
        od = json.loads((raw / f"{termin}-open_data.json").read_text(encoding="utf-8"))
        # Spaltenzuordnung Feld → Kurzname (bei BV je Stadtbezirk verschieden)
        zuordnungen: dict[str, dict[str, str]] = {}
        parteien: dict[str, dict] = {}
        for df in od["dateifelder"]:
            if not df["name"].startswith(odname):
                continue
            m = {}
            for pp in df.get("parteien", []):
                feld = pp["feld"].split("/")[0].strip()  # „D1 / F1“ → D1
                kurz, farbe = partei(pp["wert"])
                m[pf + feld[1:]] = kurz
                parteien.setdefault(kurz, {"kurz": kurz, "name": pp["wert"], "farbe": farbe})
            bv = re.search(r"\(([^)]+)\)", df["name"])
            zuordnungen[bv.group(1) if bv and wid == "kw25-bv" else "*"] = m
        zeilen = []
        for i, f in enumerate(csvs):
            sbname = list(STADTBEZIRKE.values())[i] if wid == "kw25-bv" else "*"
            for z in lies_csv(raw / f"{termin}-{f}.csv"):
                z["_map"] = zuordnungen.get(sbname) or zuordnungen.get("*") or next(iter(zuordnungen.values()))
                z["_sbz"] = sbname
                zeilen.append(z)

        gueltig_feld = "F" if pf == "F" else "D"
        ungueltig_feld = "E" if pf == "F" else "C"

        def werte(zs: list[dict]) -> dict:
            A = sum(zahl(z["A"]) for z in zs)
            A2 = sum(zahl(z["A2"]) for z in zs)
            B = sum(zahl(z["B"]) for z in zs)
            G = sum(zahl(z[gueltig_feld]) for z in zs)
            st: dict[str, int] = defaultdict(int)
            for z in zs:
                for feld, kurz in z["_map"].items():
                    st[kurz] += zahl(z.get(feld, ""))
            return {"A": A, "A2": A2, "B": B, "G": G, "U": sum(zahl(z[ungueltig_feld]) for z in zs), "st": dict(st)}

        def anteile(w: dict) -> dict:
            st = {k: round(100 * v / w["G"], 1) for k, v in sorted(w["st"].items(), key=lambda kv: -kv[1]) if v > 0} if w["G"] else {}
            return {"stimmen": st, "staerkste": next(iter(st), None)}

        urne = [z for z in zeilen if not ist_brief(z["gebiet-nr"], z["gebiet-name"])]
        brief = [z for z in zeilen if ist_brief(z["gebiet-nr"], z["gebiet-name"])]
        alle = werte(zeilen)
        gesamt = {"wahlberechtigte": alle["A"], "waehler": alle["B"], "gueltig": alle["G"], "ungueltig": alle["U"],
                  "beteiligung": round(100 * alle["B"] / alle["A"], 1) if alle["A"] else None,
                  "briefwaehler": werte(brief)["B"], **anteile(alle)}
        rueck_stadt = werte(brief)["B"] / max(1, werte(urne)["A2"])
        kwb_bezug = wid != "ew24"  # Briefwahlbezirke 2024 passen nicht zu den Kommunalwahlbezirken 2025

        # Kommunalwahlbezirke: Urne (über Geometrie) + Brief (über Nummer)
        kwb_zeilen: dict[int, list] = defaultdict(list)
        kwb_urne: dict[int, list] = defaultdict(list)
        kwb_brief: dict[int, list] = defaultdict(list)
        if kwb_bezug:
            for z in urne:
                g = geo.get(nr_norm(z["gebiet-nr"]))
                if g:
                    kwb_zeilen[g["kwb"]].append(z); kwb_urne[g["kwb"]].append(z)
            for z in brief:
                k = brief_kwb(z["gebiet-nr"])
                kwb_zeilen[k].append(z); kwb_brief[k].append(z)
            for k, zs in kwb_zeilen.items():
                w = werte(zs)
                je_kwb[k][wid] = {"wahlberechtigte": w["A"], "waehler": w["B"],
                                  "beteiligung": round(100 * w["B"] / w["A"], 1) if w["A"] else None, **anteile(w)}

        treffer = 0
        for z in urne:
            nr = nr_norm(z["gebiet-nr"])
            namen.setdefault(nr, re.sub(r"^\S+\s+", "", z["gebiet-name"]))
            g = geo.get(nr)
            if not g:
                continue
            treffer += 1
            w = werte([z])
            if kwb_bezug and kwb_brief.get(g["kwb"]):
                q = werte(kwb_brief[g["kwb"]])["B"] / max(1, werte(kwb_urne[g["kwb"]])["A2"])
            else:
                q = rueck_stadt
            bet = round(100 * min(w["A"], w["B"] + w["A2"] * min(q, 1.0)) / w["A"], 1) if w["A"] else None
            je_sb[nr][wid] = {"wahlberechtigte": w["A"], "urnenwaehler": w["B"], "wahlscheine": w["A2"],
                              "beteiligung": bet, "beteiligungUrne": round(100 * w["B"] / w["A"], 1) if w["A"] else None,
                              **anteile(w)}
        brief_aus[wid] = [{"nr": z["gebiet-nr"], "kwb": brief_kwb(z["gebiet-nr"]) if kwb_bezug else None,
                           "waehler": zahl(z["B"]), **anteile(werte([z]))} for z in brief]
        if treffer < len(geo):
            hinweise[wid] = f"Stimmbezirke {len(urne)} Urnenbezirke, davon {treffer} mit Geometrie 2025 zugeordnet (Einteilung 2024 abweichend)"
        reihenfolge = sorted(parteien, key=lambda k: -alle["st"].get(k, 0))
        wahlen_aus.append({"id": wid, "name": name, "datum": datum, "stimmart": stimmart,
                           "parteien": [parteien[k] for k in reihenfolge], "gesamt": gesamt,
                           "stimmbezirke": len(urne), "briefwahlbezirke": len(brief), "zugeordnet": treffer,
                           "quelle": VM.format(t=termin) + f"Open-Data-05915000-{csvs[0]}.csv",
                           **({"hinweis": hinweise[wid]} if wid in hinweise else {})})

    def rund(geom: dict) -> dict:
        def r(c):
            return [round(c[0], 6), round(c[1], 6)] if isinstance(c[0], (int, float)) else [r(x) for x in c]
        return {"type": geom["type"], "coordinates": r(geom["coordinates"])}

    bezirke = [{"type": "Feature", "geometry": rund(g["geometry"]),
                "properties": {"nr": nr, "name": namen.get(nr, nr), "kwb": g["kwb"], "stadtbezirk": STADTBEZIRKE.get(g["sbz"]),
                               **je_sb.get(nr, {})}}
               for nr, g in sorted(geo.items())]
    wahlbezirke = [{"type": "Feature", "geometry": rund(f["geometry"]),
                    "properties": {"nr": str(f["properties"]["kwahlbez"]), "name": f"Kommunalwahlbezirk {f['properties']['kwahlbez']}",
                                   **je_kwb.get(int(f["properties"]["kwahlbez"]), {})}}
                   for f in sorted(kwb_geo, key=lambda f: f["properties"]["kwahlbez"])]
    aus = {
        "stand": raw.name,
        "quelle": "Stadt Hamm, Wahlergebnisse (votemanager, wahlen.citeq.de) und Stimmbezirke/Kommunalwahlbezirke (WFS od_wahlen), Datenlizenz Deutschland Namensnennung 2.0",
        "hinweis": "Stimmenanteile je Stimmbezirk nur Urnenwahl; Beteiligung je Stimmbezirk geschätzt (Wahlscheininhaber × Rücklaufquote des Kommunalwahlbezirks). Kommunalwahlbezirke mit Briefwahl.",
        "wahlen": wahlen_aus,
        "bezirke": {"type": "FeatureCollection", "features": bezirke},
        "wahlbezirke": {"type": "FeatureCollection", "features": wahlbezirke},
        "briefwahl": brief_aus,
    }
    AUS.write_text(json.dumps(aus, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for w in wahlen_aus:
        g = w["gesamt"]
        top = ", ".join(f"{k} {v}" for k, v in list(g["stimmen"].items())[:4])
        print(f"{w['id']:12} {w['stimmbezirke']:3} Urne + {w['briefwahlbezirke']:2} Brief, {w['zugeordnet']:3} zugeordnet, Beteiligung {g['beteiligung']} %, {top}")
    print(f"{len(bezirke)} Stimmbezirke, {len(wahlbezirke)} Kommunalwahlbezirke → {AUS} ({AUS.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()

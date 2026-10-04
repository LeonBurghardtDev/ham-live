"""Stromerzeugung und Speicher in Hamm aus dem Marktstammdatenregister (Bundesnetzagentur, dl-de/by-2-0).

Aufruf: python daten/mastr.py [--offline]
Holt die öffentliche erweiterte Einheitenübersicht für Gemeindeschlüssel 05915000 seitenweise (5000 je Seite,
Pause zwischen den Seiten) nach daten/raw/mastr/<datum>/seite-<n>.json. --offline nimmt den neuesten Abruf.
Ausgabe: web/public/daten/energie-hamm.json
"""

import datetime as dt
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "daten" / "raw" / "mastr"
OUT = ROOT / "web" / "public" / "daten" / "energie-hamm.json"
BASIS = "https://www.marktstammdatenregister.de/MaStR/Einheit/EinheitJson/GetErweiterteOeffentlicheEinheitStromerzeugung"
FILTER = "Gemeindeschlüssel~eq~'05915000'"
# Großkraftwerke haben keinen Gemeindeschlüssel, nur den Landkreis; deshalb zusätzlich alle Einheiten ab 1 MW im Landkreis Hamm
FILTER_GROSS = "Landkreis~eq~'Hamm'~and~Bruttoleistung der Einheit~gt~'999'"
SEITE = 5000
OFFLINE = "--offline" in sys.argv


def abrufen() -> Path:
    ordner = RAW / dt.date.today().isoformat()
    ordner.mkdir(parents=True, exist_ok=True)
    holen(ordner / "gross.json", FILTER_GROSS, 1)
    seite, gesamt = 1, None
    while gesamt is None or (seite - 1) * SEITE < gesamt:
        datei = ordner / f"seite-{seite}.json"
        holen(datei, FILTER, seite)
        gesamt = json.loads(datei.read_text(encoding="utf-8"))["Total"]
        seite += 1
    return ordner


def holen(datei: Path, filt: str, seite: int):
    if not datei.exists():
        q = urllib.parse.urlencode({"sort": "", "page": seite, "pageSize": SEITE, "group": "", "filter": filt})
        req = urllib.request.Request(f"{BASIS}?{q}", headers={"User-Agent": "HAM-LIVE/0.1 (privat, Hamm in Echtzeit)"})
        for versuch in range(4):
            try:
                with urllib.request.urlopen(req, timeout=180) as r:
                    datei.write_bytes(r.read())
                break
            except OSError as fehler:
                if versuch == 3:
                    raise
                print(f"Seite {seite}: {fehler}, neuer Versuch", flush=True)
                time.sleep(20 * (versuch + 1))
        print(f"{datei.name} geholt", flush=True)
        time.sleep(4)


def neuester() -> Path:
    ordner = sorted(p for p in RAW.iterdir() if p.is_dir() and any(p.glob("seite-*.json")))
    if not ordner:
        sys.exit("Kein Rohabruf vorhanden, erst ohne --offline laufen lassen")
    return ordner[-1]


def datum(v):
    m = re.match(r"/Date\((-?\d+)\)/", v or "")
    return (dt.datetime(1970, 1, 1) + dt.timedelta(milliseconds=int(m.group(1)) + 2 * 3600 * 1000)).date() if m else None


TRAEGER = {
    "Solare Strahlungsenergie": "Solar", "Wind": "Wind", "Biomasse": "Biomasse", "Wasser": "Wasser",
    "Erdgas": "Erdgas", "Steinkohle": "Steinkohle", "Braunkohle": "Braunkohle", "Speicher": "Speicher",
    "Mineralölprodukte": "Mineralöl", "Klärschlamm": "Klärschlamm", "Deponiegas": "Deponiegas", "Klärgas": "Klärgas",
    "Grubengas": "Grubengas", "Geothermie": "Geothermie", "Wasserstoff": "Wasserstoff",
    "andere Gase": "Andere Gase", "Andere Gase": "Andere Gase", "nicht biogener Abfall": "Abfall", "Wärme": "Wärme",
}
KLASSEN = [(0.8, "bis 0,8 kW"), (10, "0,8–10 kW"), (30, "10–30 kW"), (100, "30–100 kW"), (750, "100–750 kW"), (1e12, "über 750 kW")]


def main():
    ordner = neuester() if OFFLINE else abrufen()
    einheiten = []
    for f in sorted(ordner.glob("seite-*.json"), key=lambda p: int(p.stem.split("-")[1])):
        einheiten += json.loads(f.read_text(encoding="utf-8"))["Data"]
    bekannt = {e.get("MaStRNummer") for e in einheiten}
    if (ordner / "gross.json").exists():
        einheiten += [e for e in json.loads((ordner / "gross.json").read_text(encoding="utf-8"))["Data"] if e.get("MaStRNummer") not in bekannt]
    heute = dt.date.today()
    r1 = lambda x: round(x or 0, 1)

    status = defaultdict(int)
    traeger = defaultdict(lambda: {"anzahl": 0, "bruttoKW": 0.0, "nettoKW": 0.0})
    solarArt = defaultdict(lambda: {"anzahl": 0, "kW": 0.0})
    klassen = {n: {"anzahl": 0, "kW": 0.0} for _, n in KLASSEN}
    zubau = defaultdict(lambda: {"anzahl": 0, "kW": 0.0})
    zubauJahr = {"anzahl": 0, "kW": 0.0}
    speicher = {"anzahl": 0, "kW": 0.0, "kWh": 0.0, "mitKapazitaet": 0}
    gross = []
    geplant = []
    # Monatsfenster der letzten 24 Monate einschließlich des laufenden
    monate = []
    j, m = heute.year, heute.month
    for _ in range(24):
        monate.append(f"{j:04d}-{m:02d}")
        j, m = (j, m - 1) if m > 1 else (j - 1, 12)
    monate.reverse()

    for e in einheiten:
        status[e.get("BetriebsStatusName") or "unbekannt"] += 1
        if e.get("BetriebsStatusName") == "In Planung" and (e.get("Bruttoleistung") or 0) >= 1000:
            geplant.append({"id": e.get("MaStRNummer"), "name": e.get("EinheitName"), "traeger": TRAEGER.get(e.get("EnergietraegerName") or "", e.get("EnergietraegerName")),
                            "bruttoKW": round(e.get("Bruttoleistung") or 0, 1), "geplant": (datum(e.get("GeplantesInbetriebsnahmeDatum")) or "") and datum(e.get("GeplantesInbetriebsnahmeDatum")).isoformat(),
                            "betreiber": e.get("AnlagenbetreiberName"), "lat": e.get("Breitengrad"), "lon": e.get("Laengengrad")})
        if e.get("BetriebsStatusName") != "In Betrieb":
            continue
        t = TRAEGER.get(e.get("EnergietraegerName") or "", e.get("EnergietraegerName") or "Sonstige")
        brutto, netto = e.get("Bruttoleistung") or 0.0, e.get("Nettonennleistung") or 0.0
        tr = traeger[t]
        tr["anzahl"] += 1; tr["bruttoKW"] += brutto; tr["nettoKW"] += netto
        ib = datum(e.get("InbetriebnahmeDatum"))
        if t == "Solar":
            art = e.get("ArtDerSolaranlageBezeichnung") or ""
            if "Steckerfertig" in art or brutto <= 0.8:
                a = "Balkonkraftwerk"
            elif "Gebäude" in art:
                a = "Dach"
            elif "Freifläche" in art:
                a = "Freifläche"
            else:
                a = art or "Sonstige"
            solarArt[a]["anzahl"] += 1; solarArt[a]["kW"] += brutto
            for grenze, name in KLASSEN:
                if brutto <= grenze:
                    klassen[name]["anzahl"] += 1; klassen[name]["kW"] += brutto
                    break
            if ib:
                k = f"{ib.year:04d}-{ib.month:02d}"
                if k in monate:
                    zubau[k]["anzahl"] += 1; zubau[k]["kW"] += brutto
                if ib.year == heute.year:
                    zubauJahr["anzahl"] += 1; zubauJahr["kW"] += brutto
        if t == "Speicher":
            speicher["anzahl"] += 1; speicher["kW"] += brutto
            if e.get("NutzbareSpeicherkapazitaet"):
                speicher["kWh"] += e["NutzbareSpeicherkapazitaet"]; speicher["mitKapazitaet"] += 1
        if brutto >= 1000:
            lat, lon = e.get("Breitengrad"), e.get("Laengengrad")
            name = " ".join(x for x in [e.get("KraftwerkName"), e.get("KraftwerkBlockName")] if x) or e.get("WindparkName") or e.get("SolarparkName") or e.get("EinheitName") or ""
            gross.append({
                "id": e.get("MaStRNummer"), "name": name, "einheit": e.get("EinheitName"), "traeger": t,
                "bruttoKW": r1(brutto), "nettoKW": r1(netto), "inbetriebnahme": ib.isoformat() if ib else None,
                "lat": lat, "lon": lon, "betreiber": e.get("AnlagenbetreiberName"),
                "brennstoff": e.get("HauptbrennstoffNamen"), "technik": e.get("TechnologieStromerzeugung"),
                "speicherKWh": e.get("NutzbareSpeicherkapazitaet"), "ort": e.get("StandortAnonymisiert") or e.get("Ort"),
            })

    rund = lambda d: {k: (r1(v) if isinstance(v, float) else v) for k, v in d.items()}
    gross.sort(key=lambda g: -g["bruttoKW"])
    aus = {
        "quelle": "Marktstammdatenregister der Bundesnetzagentur, öffentliche Einheitenübersicht",
        "lizenz": "Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0), © Bundesnetzagentur",
        "abruf": ordner.name, "erzeugt": dt.datetime.now().isoformat(timespec="seconds"),
        "einheitenGesamt": len(einheiten), "status": dict(sorted(status.items(), key=lambda x: -x[1])),
        "traeger": {k: rund(v) for k, v in sorted(traeger.items(), key=lambda x: -x[1]["bruttoKW"])},
        "solar": {
            "art": {k: rund(v) for k, v in sorted(solarArt.items(), key=lambda x: -x[1]["kW"])},
            "klassen": {k: rund(v) for k, v in klassen.items()},
            "zubauMonate": [{"monat": k, **rund(zubau[k])} for k in monate],
            "zubauJahr": {"jahr": heute.year, **rund(zubauJahr)},
        },
        "speicher": rund(speicher),
        "grossanlagen": gross,
        "geplant": sorted(geplant, key=lambda g: -g["bruttoKW"]),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(aus, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(einheiten)} Einheiten, {sum(v['anzahl'] for v in traeger.values())} in Betrieb, {len(gross)} Großanlagen -> {OUT}")
    for k, v in aus["traeger"].items():
        print(f"  {k}: {v['anzahl']} Einheiten, {v['bruttoKW']/1000:.1f} MW brutto")


if __name__ == "__main__":
    main()

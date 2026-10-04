"""Zensus 2022 im 100-m- und 1-km-Gitter für Hamm, dazu Kennzahlen je Stadtbezirk (Seite „Bevölkerung“).

Aufruf in einer Python-Umgebung mit den Paketen (pyproj, shapely, numpy):
  uv run --with openpyxl python daten/zensus.py   (Rohdaten in $HAM_ROHDATEN)
  (openpyxl nur zum ersten Lesen der Regionaltabellen, danach Zwischenspeicher hamm-regional.json)
  --offline   nichts herunterladen, nur vorhandene Rohdaten
  --neu       neuen Abrufordner mit heutigem Datum anlegen und alles neu laden

Quellen:
  Zensus 2022, Ergebnisse in Gitterzellen, Statistische Ämter des Bundes und der Länder,
    https://www.zensus2022.de/DE/Ergebnisse-des-Zensus/gitterzellen.html (CSV in ZIP, Stichtag 15.05.2022),
    Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0).
  Zensus 2022, Regionaltabellen (XLSX, gleiche Seite), amtliche Gemeindewerte für Hamm (ARS 05915), dl-de/by-2-0.
  Strukturatlas der Stadt Hamm (InstantAtlas, https://www.hamm.de/apps/strukturatlas/), Stand 2017,
    Einwohnermeldedaten je Stadtbezirk. Keine offene Lizenz („Geodaten Stadt Hamm, Ordnungs- und Wahlamt“
    als Quelle angeben) → nur privat.
  Stadtgrenze und Stadtbezirke: web/public/daten/grenzen.geojson (OSM, ODbL, aus daten/grenzen.py).
Rohdaten:  daten/raw/zensus/<AAAA-MM-TT>/ (Abrufdatum). Die ZIPs werden nicht entpackt, sondern direkt
           gelesen; der Ausschnitt für Hamm wird als hamm-auszug.json zwischengespeichert.
Ausgabe:   web/public/daten/zensus.json

Zeichen in den CSV: „–“ heißt „genau null oder auf null geändert“ (Geheimhaltung, Cell-Key-Methode).
In Zähl- und Anteilsspalten wird es 0, in Mittelwerten (Alter, Haushaltsgröße, Miete, Flächen) null.
„KLAMMERN“ (Aussagewert eingeschränkt) wird gezählt, der Wert bleibt.
Zellen ohne Einwohner bzw. ohne Wohnungen fehlen in den Dateien.

Gitter-IDs: INSPIRE „CRS3035RES100mN3172400E4167300“ (Südwest-Ecke in EPSG:3035). In zensus.json kurz als
„<N/100>_<E/100>“ (100 m) bzw. „<N/1000>_<E/1000>“ (1 km). Für die Umrechnung ins WGS84 enthält die
Ausgabe quadratische Näherungen (Abweichung im Stadtgebiet unter 0,1 m, siehe geo.fehler_m).
"""

import datetime as dt
import io
import json
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import pyproj
import shapely
from shapely.geometry import shape
from shapely.ops import transform

WURZEL = Path(__file__).resolve().parents[1]
RAW = WURZEL / "daten" / "raw" / "zensus"
AUS = WURZEL / "web" / "public" / "daten" / "zensus.json"
GRENZEN = WURZEL / "web" / "public" / "daten" / "grenzen.geojson"
BASIS = "https://www.destatis.de/static/DE/zensus/gitterdaten/"
ATLAS = "https://www.hamm.de/apps/strukturatlas/Einzelkarte/"
STRICH = "–"

# Kurzname → ZIP-Datei bei Destatis
DATEIEN = {
    "bev": "Zensus2022_Bevoelkerungszahl",
    "alter": "Durchschnittsalter_in_Gitterzellen",
    "u18": "Anteil_unter_18-jaehrige_in_Gitterzellen",
    "ab65": "Anteil_ab_65-jaehrige_in_Gitterzellen",
    "ausl": "Auslaenderanteil_in_Gitterzellen",
    "ak5": "Alter_in_5_Altersklassen",
    "hhg": "Durchschnittliche_Haushaltsgroesse_in_Gitterzellen",
    "hhz": "Zensus2022_Groesse_des_privaten_Haushalts_in_Gitterzellen",
    "sen": "Seniorenstatus_eines_privaten_Haushalts",
    "leer": "Leerstandsquote_in_Gitterzellen",
    "miete": "Durchschnittliche_Nettokaltmiete_und_Anzahl_der_Wohnungen",
    "fwhg": "Durchschnittliche_Flaeche_je_Wohnung_in_Gitterzellen",
    "fbew": "Durchschnittliche_Wohnflaeche_je_Bewohner_in_Gitterzellen",
    "eig": "Eigentuemerquote_in_Gitterzellen",
    "whg": "Wohnungen_nach_Gebaeudetyp_Groesse",
    "bj": "Gebaeude_nach_Baujahr_in_Mikrozensus_Klassen",
    "hz": "Gebaeude_mit_Wohnraum_nach_ueberwiegender_Heizungsart",
    "et": "Gebaeude_mit_Wohnraum_nach_Energietraeger_der_Heizung",
    "gw": "Gebaeude_nach_Anzahl_der_Wohnungen_im_Gebaeude",
    "bte": "Zensus2022_Gebaeude_nach_Baujahr_Typ_Energie_1km_Gitterzellen",
}
# Spalten mit Destatis-Mittelwerten: „–“ → null. In Zähl- und Anteilsspalten heißt „–“ genau null
# (oder durch die Geheimhaltung auf null gesetzt) und wird 0; sonst wären Quoten im Mittel zu hoch.
KENNZAHL = {"Durchschnittsalter", "DurchschnHHGroesse", "durchschnMieteQM", "durchschnFlaechejeWohn", "durchschnFlaechejeBew"}

# Merkmale. art: anzahl (Summe), anteil (Zähler/Nenner aus Zählspalten), kennzahl (Wert von Destatis,
# gewichtetes Mittel mit „gewicht“), bte (aus der 1-km-Kreuztabelle Baujahr × Typ × Energieträger).
M = [
    # Bevölkerung
    dict(id="einwohner", name="Einwohner", einheit="", gruppe="Bevölkerung", art="anzahl", q=("bev", "Einwohner"),
         beschreibung="Einwohner am 15.05.2022 (Hauptwohnsitz)."),
    dict(id="alter", name="Durchschnittsalter", einheit="Jahre", gruppe="Bevölkerung", art="kennzahl", q=("alter", "Durchschnittsalter"),
         gewicht=("bev", "Einwohner"), stellen=1, beschreibung="Mittleres Alter der Einwohner."),
    dict(id="u18", name="Unter 18 Jahre", einheit="%", gruppe="Bevölkerung", art="kennzahl", q=("u18", "AnteilUnter18"),
         gewicht=("bev", "Einwohner"), beschreibung="Anteil der Einwohner unter 18 Jahren."),
    dict(id="a18_29", name="18 bis 29 Jahre", einheit="%", gruppe="Bevölkerung", art="anteil", z=[("ak5", "a18bis29")],
         n=("ak5", "Insgesamt_Bevoelkerung"), beschreibung="Anteil der Einwohner von 18 bis 29 Jahren."),
    dict(id="a30_49", name="30 bis 49 Jahre", einheit="%", gruppe="Bevölkerung", art="anteil", z=[("ak5", "a30bis49")],
         n=("ak5", "Insgesamt_Bevoelkerung"), beschreibung="Anteil der Einwohner von 30 bis 49 Jahren."),
    dict(id="a50_64", name="50 bis 64 Jahre", einheit="%", gruppe="Bevölkerung", art="anteil", z=[("ak5", "a50bis64")],
         n=("ak5", "Insgesamt_Bevoelkerung"), beschreibung="Anteil der Einwohner von 50 bis 64 Jahren."),
    dict(id="ab65", name="65 Jahre und älter", einheit="%", gruppe="Bevölkerung", art="kennzahl", q=("ab65", "AnteilUeber65"),
         gewicht=("bev", "Einwohner"), beschreibung="Anteil der Einwohner ab 65 Jahren."),
    dict(id="auslaender", name="Ausländeranteil", einheit="%", gruppe="Bevölkerung", art="kennzahl", q=("ausl", "AnteilAuslaender"),
         gewicht=("bev", "Einwohner"), beschreibung="Anteil der Einwohner ohne deutsche Staatsangehörigkeit."),
    # Haushalte
    dict(id="haushalte", name="Private Haushalte", einheit="", gruppe="Haushalte", art="anzahl", q=("hhz", "Insgesamt_Haushalte"),
         beschreibung="Anzahl der privaten Haushalte."),
    dict(id="hhgroesse", name="Haushaltsgröße", einheit="Personen", gruppe="Haushalte", art="kennzahl", q=("hhg", "DurchschnHHGroesse"),
         gewicht=("hhz", "Insgesamt_Haushalte"), beschreibung="Durchschnittliche Zahl der Personen je privatem Haushalt."),
    dict(id="hh1", name="Einpersonenhaushalte", einheit="%", gruppe="Haushalte", art="anteil", z=[("hhz", "1_Person")],
         n=("hhz", "Insgesamt_Haushalte"), beschreibung="Anteil der Haushalte mit einer Person."),
    dict(id="hh2", name="Zweipersonenhaushalte", einheit="%", gruppe="Haushalte", art="anteil", z=[("hhz", "2_Personen")],
         n=("hhz", "Insgesamt_Haushalte"), beschreibung="Anteil der Haushalte mit zwei Personen."),
    dict(id="hh4plus", name="Haushalte ab 4 Personen", einheit="%", gruppe="Haushalte", art="anteil",
         z=[("hhz", "4_Personen"), ("hhz", "5_Personen"), ("hhz", "6_Personen_und_mehr")], n=("hhz", "Insgesamt_Haushalte"),
         beschreibung="Anteil der Haushalte mit vier und mehr Personen."),
    dict(id="hhsenioren", name="Nur Senioren", einheit="%", gruppe="Haushalte", art="anteil", z=[("sen", "HH_nurSenioren")],
         n=("sen", "Insgesamt_Haushalte"), beschreibung="Anteil der Haushalte, in denen nur Personen ab 65 Jahren leben."),
    # Wohnen
    dict(id="wohnungen", name="Wohnungen", einheit="", gruppe="Wohnen", art="anzahl", q=("whg", "Insgesamt_Wohnungen"),
         beschreibung="Wohnungen in Gebäuden mit Wohnraum."),
    dict(id="miete", name="Nettokaltmiete", einheit="€/m²", gruppe="Wohnen", art="kennzahl", q=("miete", "durchschnMieteQM"),
         gewicht=("miete", "AnzahlWohnungen"), stellen=2, beschreibung="Durchschnittliche Nettokaltmiete je m² der vermieteten Wohnungen."),
    dict(id="leerstand", name="Leerstandsquote", einheit="%", gruppe="Wohnen", art="kennzahl", q=("leer", "Leerstandsquote"),
         gewicht=("whg", "Insgesamt_Wohnungen"), beschreibung="Anteil leer stehender Wohnungen (ohne Ferien- und Freizeitwohnungen). "
         "In kleinen Zellen setzt die Geheimhaltung wenige Leerstände auf null; Summen aus Zellen liegen daher unter dem amtlichen Wert."),
    dict(id="wohnflaeche", name="Fläche je Wohnung", einheit="m²", gruppe="Wohnen", art="kennzahl", q=("fwhg", "durchschnFlaechejeWohn"),
         gewicht=("whg", "Insgesamt_Wohnungen"), beschreibung="Durchschnittliche Wohnfläche je Wohnung."),
    dict(id="flaeche_bew", name="Fläche je Bewohner", einheit="m²", gruppe="Wohnen", art="kennzahl", q=("fbew", "durchschnFlaechejeBew"),
         gewicht=("bev", "Einwohner"), beschreibung="Durchschnittliche Wohnfläche je Bewohner."),
    dict(id="eigentum", name="Eigentümerquote", einheit="%", gruppe="Wohnen", art="kennzahl", q=("eig", "Eigentuemerquote"),
         gewicht=("hhz", "Insgesamt_Haushalte"), beschreibung="Anteil der bewohnten Wohnungen, die vom Eigentümer selbst bewohnt werden."),
    dict(id="w_efzh", name="Wohnungen in Ein- und Zweifamilienhäusern", einheit="%", gruppe="Wohnen", art="anteil",
         z=[("whg", s) for s in ("FreiEFH", "EFH_DHH", "EFH_Reihenhaus", "Freist_ZFH", "ZFH_DHH", "ZFH_Reihenhaus")],
         n=("whg", "Insgesamt_Wohnungen"), beschreibung="Anteil der Wohnungen in Ein- und Zweifamilienhäusern."),
    dict(id="w_mfh13", name="Wohnungen in großen Mehrfamilienhäusern", einheit="%", gruppe="Wohnen", art="anteil",
         z=[("whg", "MFH_13undmehrWohnungen")], n=("whg", "Insgesamt_Wohnungen"),
         beschreibung="Anteil der Wohnungen in Mehrfamilienhäusern mit 13 und mehr Wohnungen."),
    # Gebäude
    dict(id="gebaeude", name="Gebäude mit Wohnraum", einheit="", gruppe="Gebäude", art="anzahl", q=("gw", "Insgesamt_Gebaeude"),
         beschreibung="Anzahl der Gebäude mit Wohnraum."),
    dict(id="bj_vor1949", name="Baujahr vor 1949", einheit="%", gruppe="Gebäude", art="anteil",
         z=[("bj", "Vor1919"), ("bj", "a1919bis1948")], n=("bj", "Insgesamt_Gebaeude"), beschreibung="Anteil der Gebäude, gebaut vor 1949."),
    dict(id="bj_1949_78", name="Baujahr 1949 bis 1978", einheit="%", gruppe="Gebäude", art="anteil",
         z=[("bj", "a1949bis1978")], n=("bj", "Insgesamt_Gebaeude"), beschreibung="Anteil der Gebäude, gebaut 1949 bis 1978."),
    dict(id="bj_1979_2000", name="Baujahr 1979 bis 2000", einheit="%", gruppe="Gebäude", art="anteil",
         z=[("bj", "a1979bis1990"), ("bj", "a1991bis2000")], n=("bj", "Insgesamt_Gebaeude"), beschreibung="Anteil der Gebäude, gebaut 1979 bis 2000."),
    dict(id="bj_ab2001", name="Baujahr ab 2001", einheit="%", gruppe="Gebäude", art="anteil",
         z=[("bj", "a2001bis2010"), ("bj", "a2011bis2019"), ("bj", "a2020undspaeter")], n=("bj", "Insgesamt_Gebaeude"),
         beschreibung="Anteil der Gebäude, gebaut 2001 oder später."),
    dict(id="g_1whg", name="Gebäude mit 1 Wohnung", einheit="%", gruppe="Gebäude", art="anteil",
         z=[("gw", "1_Wohnung")], n=("gw", "Insgesamt_Gebaeude"), beschreibung="Anteil der Gebäude mit genau einer Wohnung."),
    dict(id="g_7plus", name="Gebäude ab 7 Wohnungen", einheit="%", gruppe="Gebäude", art="anteil",
         z=[("gw", "7bis12_Wohnungen"), ("gw", "13undmehr_Wohnungen")], n=("gw", "Insgesamt_Gebaeude"),
         beschreibung="Anteil der Gebäude mit sieben und mehr Wohnungen."),
    dict(id="et_gas", name="Heizen mit Gas", einheit="%", gruppe="Gebäude", art="anteil",
         z=[("et", "Gas")], n=("et", "Insgesamt_Energietraeger"), beschreibung="Anteil der Gebäude mit Gas als Energieträger der Heizung."),
    dict(id="et_oel", name="Heizen mit Heizöl", einheit="%", gruppe="Gebäude", art="anteil",
         z=[("et", "Heizoel")], n=("et", "Insgesamt_Energietraeger"), beschreibung="Anteil der Gebäude mit Heizöl als Energieträger der Heizung."),
    dict(id="et_wp", name="Wärmepumpe, Solar, Geothermie", einheit="%", gruppe="Gebäude", art="anteil",
         z=[("et", "Solar_Geothermie_Waermepumpen")], n=("et", "Insgesamt_Energietraeger"),
         beschreibung="Anteil der Gebäude, die mit Wärmepumpe, Solar- oder Geothermie heizen."),
    dict(id="et_fern", name="Fernwärme", einheit="%", gruppe="Gebäude", art="anteil",
         z=[("et", "Fernwaerme")], n=("et", "Insgesamt_Energietraeger"), beschreibung="Anteil der Gebäude mit Fernwärme."),
    dict(id="hz_ofen", name="Einzel- und Mehrraumöfen", einheit="%", gruppe="Gebäude", art="anteil",
         z=[("hz", "Einzel_Mehrraumoefen")], n=("hz", "Insgesamt_Heizungsart"),
         beschreibung="Anteil der Gebäude, die überwiegend mit Einzel- oder Mehrraumöfen beheizt werden."),
    # nur im 1-km-Gitter (Kreuztabelle Baujahr × Gebäudetyp × Energieträger)
    dict(id="alt_fossil", name="Vor 1980 gebaut, Gas oder Öl", einheit="%", gruppe="Gebäude", art="bte", gitter="1km",
         beschreibung="Anteil der Gebäude mit Wohnraum, die vor 1980 gebaut wurden und mit Gas oder Heizöl heizen. "
                      "Nur im 1-km-Gitter; Kombinationen unter 3 Gebäuden fehlen, der Wert ist daher eher zu niedrig."),
    dict(id="neu_wp", name="Neubau ab 2010 mit Wärmepumpe", einheit="%", gruppe="Gebäude", art="bte", gitter="1km",
         beschreibung="Anteil der seit 2010 gebauten Gebäude mit Wohnraum, die mit Wärmepumpe, Solar- oder Geothermie heizen. "
                      "Nur im 1-km-Gitter."),
]
ALT = {"vor 1919", "1919 - 1949", "1950 - 1959", "1960 - 1969", "1970 - 1979"}
NEU = {"2010 - 2015", "2016 und später"}

BEZIRK_ATLAS = ["Hamm-Mitte", "Uentrop", "Rhynern", "Pelkum", "Herringen", "Bockum-Hövel", "Heessen"]
# Strukturatlas: Datei, Name des Indikators, Schlüssel, Einheit, Stellen
ATLAS_WERTE = [
    (5, "Durchschnittsalter", "alter", "Jahre", 1),
    (6, "Anteil Einwohner mit Migrationshintergrund", "migration", "%", 1),
    (6, "Anteil Ausländer", "auslaender", "%", 1),
    (10, "Anteil der Haushalte mit Kindern gesamt", "hh_kinder", "%", 1),
    (10, "Anteil der Haushalte Alleinerziehender", "alleinerziehend", "%", 1),
    (11, "Geburtenrate", "geburten", "je 1.000 Einw.", 1),
    (11, "Sterbefallrate", "sterbefaelle", "je 1.000 Einw.", 1),
    (13, "Saldo Wanderungen", "wanderung", "Personen", 0),
    (18, "SGB II-Quote", "sgb2", "%", 1),
    (19, "Arbeitslosenanteil", "arbeitslos", "%", 1),
    (20, "durchschnittliche Wohndauer in Jahren", "wohndauer", "Jahre", 1),
]
ATLAS_NAMEN = {
    "alter": "Durchschnittsalter", "migration": "Mit Migrationshintergrund", "auslaender": "Ausländeranteil (Melderegister)",
    "hh_kinder": "Haushalte mit Kindern", "alleinerziehend": "Alleinerziehende", "geburten": "Geburten",
    "sterbefaelle": "Sterbefälle", "wanderung": "Wanderungssaldo", "sgb2": "SGB-II-Quote",
    "arbeitslos": "Arbeitslosenanteil", "wohndauer": "Wohndauer",
}


def holen(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "HAM-LIVE/1 (privat)"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def rohordner(neu: bool) -> Path:
    vorhanden = sorted(p for p in RAW.glob("20*") if p.is_dir())
    if vorhanden and not neu:
        return vorhanden[-1]
    ziel = RAW / dt.date.today().isoformat()
    ziel.mkdir(parents=True, exist_ok=True)
    return ziel


def laden(raw: Path, offline: bool) -> None:
    """Fehlende ZIPs nacheinander laden (je 10–35 MB), Strukturatlas-Dateien dazu."""
    for kurz, name in DATEIEN.items():
        p = raw / f"{name}.zip"
        if p.exists():
            continue
        if offline:
            sys.exit(f"Rohdatei fehlt: {p}")
        print("lade", name, flush=True)
        p.write_bytes(holen(BASIS + name + ".zip"))
        time.sleep(1)
    sa = raw / "strukturatlas"
    sa.mkdir(exist_ok=True)
    for t in sorted({0} | {w[0] for w in ATLAS_WERTE}):
        p = sa / f"Stadtbezirk-t{t}.js"
        if not p.exists() and not offline:
            p.write_bytes(holen(ATLAS + p.name))
            time.sleep(1)


def gitter_aus_id(gid: str) -> tuple[int, int]:
    """INSPIRE-ID → (N, E) der Südwest-Ecke in Metern."""
    n = gid.index("N")
    e = gid.index("E", n)
    return int(gid[n + 1:e]), int(gid[e + 1:])


def auszug(raw: Path, box: tuple[float, float, float, float]) -> dict:
    """Alle Zeilen im Rechteck um Hamm aus allen ZIPs; Ergebnis {gitter: {kurz: {id: {spalte: text}}}}."""
    cache = raw / "hamm-auszug.json"
    if cache.exists():
        a = json.loads(cache.read_text(encoding="utf-8"))
        if set(a.get("dateien", [])) >= set(DATEIEN):
            return a
    e0, n0, e1, n1 = box
    out: dict = {"dateien": list(DATEIEN), "100m": {}, "1km": {}}
    for kurz, name in DATEIEN.items():
        z = zipfile.ZipFile(raw / f"{name}.zip")
        for info in z.infolist():
            fn = info.filename
            if not fn.lower().endswith(".csv") or "10km" in fn:
                continue
            gitter = "100m" if "100m" in fn else "1km" if "1km" in fn else None
            if not gitter:
                continue
            t0 = time.time()
            ziel = out[gitter].setdefault(kurz, {})
            with io.TextIOWrapper(z.open(info), encoding="utf-8-sig", newline="") as f:
                kopf = f.readline().rstrip("\r\n").split(";")
                for zeile in f:
                    gid = zeile[:zeile.index(";")]
                    n, e = gitter_aus_id(gid)
                    if not (e0 <= e <= e1 and n0 <= n <= n1):
                        continue
                    teile = zeile.rstrip("\r\n").split(";")
                    if kurz == "bte":
                        ziel.setdefault(gid, []).append(teile[1:])
                    else:
                        ziel[gid] = dict(zip(kopf[3:], teile[3:]))
            print(f"  {fn.split('/')[-1]}: {len(ziel)} Zellen, {time.time() - t0:.0f} s", flush=True)
    cache.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return out


def zahl(s: str | None, kennzahl: bool) -> float | None:
    if s is None or s == "":
        return None
    if s == STRICH:
        return None if kennzahl else 0.0
    try:
        return float(s.replace(".", "").replace(",", ".")) if "," in s else float(s)
    except ValueError:
        return None


def bz(r: list) -> float:
    """Anzahl Gebäude einer Zeile der Kreuztabelle."""
    return zahl(r[4], False) or 0.0


class Zelle:
    """Rohwerte einer Gitterzelle über alle Dateien."""

    def __init__(self, gid: str, roh: dict, bte: list | None):
        self.gid, self.roh, self.bte = gid, roh, bte

    def wert(self, kurz: str, spalte: str) -> float | None:
        d = self.roh.get(kurz)
        if d is None:
            return None
        return zahl(d.get(spalte), spalte in KENNZAHL)

    def unsicher(self, kurz: str) -> bool:
        d = self.roh.get(kurz)
        return bool(d) and d.get("werterlaeuternde_Zeichen") == "KLAMMERN"

    def teile(self, m: dict) -> tuple[float | None, float | None]:
        """(Zähler, Nenner) für Aggregation; bei kennzahl (Wert × Gewicht, Gewicht)."""
        art = m["art"]
        if art == "anzahl":
            v = self.wert(*m["q"])
            return v, None
        if art == "kennzahl":
            v, g = self.wert(*m["q"]), self.wert(*m["gewicht"])
            if v is None or not g:
                return None, None
            return v * g, g
        if art == "anteil":
            nen = self.wert(*m["n"])
            if not nen:
                return None, None
            zs = [self.wert(*q) for q in m["z"]]
            return sum(x or 0 for x in zs), nen
        if art == "bte":
            if not self.bte:
                return None, None
            ges = sum(bz(r) for r in self.bte if r[0] == "Insgesamt")
            if m["id"] == "alt_fossil":
                z = sum(bz(r) for r in self.bte if r[0] in ALT and r[2] in ("Gas", "Heizöl"))
                return (z, ges) if ges else (None, None)
            if m["id"] == "neu_wp":
                alle = sum(bz(r) for r in self.bte if r[0] in NEU)
                z = sum(bz(r) for r in self.bte if r[0] in NEU and r[2].startswith("Solar"))
                return (z, alle) if alle >= 5 else (None, None)
        return None, None

    def merkmal(self, m: dict) -> float | None:
        art = m["art"]
        if art == "anzahl":
            return self.wert(*m["q"])
        if art == "kennzahl":
            return self.wert(*m["q"])
        z, n = self.teile(m)
        return None if z is None or not n else 100 * z / n


def runden(m: dict, v: float | None):
    if v is None:
        return None
    if m["art"] == "anzahl":
        return int(round(v))
    s = m.get("stellen", 2 if m["einheit"] in ("Personen", "€/m²") else 1)
    r = round(v, s)
    return int(r) if r == int(r) else r


def zusammen(m: dict, zellen: list[Zelle]) -> float | None:
    zs = nn = 0.0
    treffer = False
    for c in zellen:
        z, n = c.teile(m)
        if z is None:
            continue
        treffer = True
        zs += z
        nn += n or 0
    if not treffer:
        return None
    if m["art"] == "anzahl":
        return zs
    return None if not nn else (zs / nn if m["art"] == "kennzahl" else 100 * zs / nn)


def naeherung(fwd: pyproj.Transformer, box: tuple) -> dict:
    """Quadratische Näherung EPSG:3035 ↔ WGS84 im Rechteck um Hamm (u, v in km ab e0/n0)."""
    e0, n0, e1, n1 = box
    ee, nn = np.meshgrid(np.linspace(e0, e1, 41), np.linspace(n0, n1, 41))
    ee, nn = ee.ravel(), nn.ravel()
    lon, lat = fwd.transform(ee, nn)
    u, v = (ee - e0) / 1000, (nn - n0) / 1000
    A = np.column_stack([np.ones_like(u), u, v, u * u, u * v, v * v])
    clon = np.linalg.lstsq(A, lon, rcond=None)[0]
    clat = np.linalg.lstsq(A, lat, rcond=None)[0]
    # Rückweg: lon/lat (Abstand zum Bezugspunkt in Grad) → u, v in km
    lon0, lat0 = fwd.transform(e0, n0)
    p, q = lon - lon0, lat - lat0
    B = np.column_stack([np.ones_like(p), p, q, p * p, p * q, q * q])
    cu = np.linalg.lstsq(B, u, rcond=None)[0]
    cv = np.linalg.lstsq(B, v, rcond=None)[0]
    f_lon, f_lat = A @ clon - lon, A @ clat - lat
    fehler = float(np.max(np.hypot(f_lon * 111320 * np.cos(np.radians(lat)), f_lat * 111320)))
    f_u = float(np.max(np.hypot(B @ cu - u, B @ cv - v)) * 1000)
    return {
        "e0": int(e0), "n0": int(n0), "lon0": round(float(lon0), 7), "lat0": round(float(lat0), 7),
        "lon": [float(f"{c:.10g}") for c in clon], "lat": [float(f"{c:.10g}") for c in clat],
        "u": [float(f"{c:.10g}") for c in cu], "v": [float(f"{c:.10g}") for c in cv],
        "fehler_m": round(max(fehler, f_u), 3),
        "formel": "u=(E-e0)/1000, v=(N-n0)/1000 (km); lon = c0+c1u+c2v+c3u²+c4uv+c5v² (lat ebenso); "
                  "rückwärts p=lon-lon0, q=lat-lat0; u = c0+c1p+c2q+c3p²+c4pq+c5q² (v ebenso)",
    }


# Regionaltabellen des Zensus 2022 (amtliche Werte für die Gemeinde Hamm, ARS 05915), CSV-Blätter der XLSX
REGIONAL = ["Regionaltabelle_Bevoelkerung", "Regionaltabelle_Demografie", "Regionaltabelle_Haushalte",
            "Regionaltabelle_Bildung_Erwerbstaetigkeit", "Regionaltabelle_Gebaeude_Wohnungen"]
# Abschnitte: (id, Titel, Blatt, Bezugsspalte oder None, [(Bezeichnung, Spalte oder [Spalten])])
AMTLICH = [
    ("bevoelkerung", "Bevölkerung", "CSV-Demografie", "0_Insgesamt_", [
        ("Einwohner", "0_Insgesamt_"), ("Männlich", "GESCHLECHT__1"), ("Weiblich", "GESCHLECHT__2"),
        ("Deutsche", "Staatsange_kurz__1"), ("Ausländer", "Staatsange_kurz__2"),
        ("Mit Einwanderungsgeschichte", "Einwanderungserf_ausf__2"), ("davon selbst eingewandert", "Einwanderungserf_ausf__21"),
        ("davon Nachkommen von Eingewanderten", "Einwanderungserf_ausf__22"),
        ("Mit einseitiger Einwanderungsgeschichte", "Einwanderungserf_ausf__3"), ("Ohne Einwanderungsgeschichte", "Einwanderungserf_ausf__1")]),
    ("alter", "Altersgruppen", "CSV-Demografie", "0_Insgesamt_", [
        ("unter 3 Jahre", "Alter_infr__01"), ("3 bis 5 Jahre", "Alter_infr__02"), ("6 bis 9 Jahre", "Alter_infr__03"),
        ("10 bis 15 Jahre", "Alter_infr__04"), ("16 bis 18 Jahre", "Alter_infr__05"), ("19 bis 24 Jahre", "Alter_infr__06"),
        ("25 bis 39 Jahre", "Alter_infr__07"), ("40 bis 59 Jahre", "Alter_infr__08"), ("60 bis 66 Jahre", "Alter_infr__09"),
        ("67 bis 74 Jahre", "Alter_infr__10"), ("75 Jahre und älter", "Alter_infr__11")]),
    ("familienstand", "Familienstand", "CSV-Demografie", "0_Insgesamt_", [
        ("ledig", "FAMSTND_KURZ__1"), ("verheiratet, eingetragene Lebenspartnerschaft", "FAMSTND_KURZ__2"),
        ("verwitwet", "FAMSTND_KURZ__3"), ("geschieden", "FAMSTND_KURZ__4"), ("ohne Angabe", "FAMSTND_KURZ__5")]),
    ("haushalte", "Haushalte", "CSV-Haushalte", "0_Insgesamt_", [
        ("Private Haushalte", "0_Insgesamt_"), ("1 Person", "HH_SIZE_NAT__1"), ("2 Personen", "HH_SIZE_NAT__2"),
        ("3 Personen", "HH_SIZE_NAT__3"), ("4 Personen", "HH_SIZE_NAT__4"), ("5 Personen", "HH_SIZE_NAT__5"),
        ("6 und mehr Personen", "HH_SIZE_NAT__6"), ("Paare ohne Kind", "HHTYP_FAM__2"), ("Paare mit Kindern", "HHTYP_FAM__3"),
        ("Alleinerziehende", "HHTYP_FAM__4"), ("Nur Senioren", "HHTYP_SENIOR_HH__1"),
        ("Senioren und Jüngere", "HHTYP_SENIOR_HH__2"), ("Ohne Senioren", "HHTYP_SENIOR_HH__3")]),
    ("schule", "Höchster Schulabschluss (ab 15 Jahren)", "CSV-Hoechster_Schulabschluss", "SCHULABS_STP", [
        ("Personen ab 15 Jahren", "SCHULABS_STP"), ("noch in schulischer Ausbildung", "SCHULABS_STP__1"),
        ("Haupt- oder Volksschulabschluss", "SCHULABS_STP__21"), ("Polytechnische Oberschule", "SCHULABS_STP__22"),
        ("Realschulabschluss, Mittlere Reife", "SCHULABS_STP__23"), ("Fachhochschul- oder Hochschulreife", "SCHULABS_STP__24"),
        ("ohne allgemeinbildenden Abschluss", "SCHULABS_STP__3")]),
    ("beruf", "Höchster beruflicher Abschluss (ab 15 Jahren)", "CSV-Hoechster_berufl_Abschluss", "BERUFABS_AUSF_STP", [
        ("Personen ab 15 Jahren", "BERUFABS_AUSF_STP"), ("Lehre, duale Ausbildung", "BERUFABS_AUSF_STP__11"),
        ("Fachschulabschluss", ["BERUFABS_AUSF_STP__12", "BERUFABS_AUSF_STP__13"]), ("Bachelor", "BERUFABS_AUSF_STP__14"),
        ("Master", "BERUFABS_AUSF_STP__15"), ("Diplom", "BERUFABS_AUSF_STP__16"), ("Promotion", "BERUFABS_AUSF_STP__17"),
        ("ohne beruflichen Abschluss", "BERUFABS_AUSF_STP__2")]),
    ("erwerb", "Erwerbsstatus", "CSV-Erwerbsstatus", "ERWERBSTAT_KURZ_STP", [
        ("Personen", "ERWERBSTAT_KURZ_STP"), ("Erwerbspersonen", "ERWERBSTAT_KURZ_STP__1"), ("Erwerbstätige", "ERWERBSTAT_KURZ_STP__11"),
        ("Erwerbslose", "ERWERBSTAT_KURZ_STP__12"), ("Nichterwerbspersonen", "ERWERBSTAT_KURZ_STP__2")]),
    ("stellung", "Erwerbstätige nach Stellung im Beruf", "CSV-ET_Stellung_im_Beruf", "ET_STELLGBERF_STP", [
        ("Erwerbstätige", "ET_STELLGBERF_STP"), ("Angestellte, Arbeiter", "ET_STELLGBERF_STP__1"), ("Beamte", "ET_STELLGBERF_STP__2"),
        ("Selbstständige mit Beschäftigten", "ET_STELLGBERF_STP__3"), ("Selbstständige ohne Beschäftigte", "ET_STELLGBERF_STP__4"),
        ("Mithelfende Familienangehörige", "ET_STELLGBERF_STP__5")]),
    ("wirtschaft", "Erwerbstätige nach Wirtschaftszweig", "CSV-ET_Wirtschaftszweig", "ET_WIRTSZWG_STP", [
        ("Land- und Forstwirtschaft", "ET_WIRTSZWG_STP__1"), ("Bergbau, Verarbeitendes Gewerbe", "ET_WIRTSZWG_STP__21"),
        ("Energie, Wasser, Entsorgung", "ET_WIRTSZWG_STP__22"), ("Baugewerbe", "ET_WIRTSZWG_STP__23"),
        ("Handel, Kfz, Gastgewerbe", "ET_WIRTSZWG_STP__31"), ("Verkehr, Lagerei, Kommunikation", "ET_WIRTSZWG_STP__32"),
        ("Finanzen, Versicherungen", "ET_WIRTSZWG_STP__33"), ("Grundstücke, Wohnungen, Unternehmensdienste", "ET_WIRTSZWG_STP__34"),
        ("Öffentliche Verwaltung", "ET_WIRTSZWG_STP__35"), ("Öffentliche und private Dienstleistungen", "ET_WIRTSZWG_STP__36")]),
    ("berufsgruppe", "Erwerbstätige nach Beruf (ISCO-08)", "CSV-ET_Beruf_Hauptgr_ISCO08", "ET_BERUFSKLSS_HGISCO_STP", [
        ("Führungskräfte", "ET_BERUFSKLSS_HGISCO_STP__1"), ("Akademische Berufe", "ET_BERUFSKLSS_HGISCO_STP__2"),
        ("Techniker, gleichrangige Berufe", "ET_BERUFSKLSS_HGISCO_STP__3"), ("Bürokräfte", "ET_BERUFSKLSS_HGISCO_STP__4"),
        ("Dienstleistung, Verkauf", "ET_BERUFSKLSS_HGISCO_STP__5"), ("Land-, Forstwirtschaft, Fischerei", "ET_BERUFSKLSS_HGISCO_STP__6"),
        ("Handwerk", "ET_BERUFSKLSS_HGISCO_STP__7"), ("Anlagen, Maschinen, Montage", "ET_BERUFSKLSS_HGISCO_STP__8"),
        ("Hilfsarbeitskräfte", "ET_BERUFSKLSS_HGISCO_STP__9"), ("Streitkräfte", "ET_BERUFSKLSS_HGISCO_STP__0")]),
    ("wohnungen", "Wohnungen", "CSV-Wohnungen", "GEBAEUDEART_SYS_1", [
        ("Wohnungen", "GEBAEUDEART_SYS_1"), ("vom Eigentümer bewohnt", "NUTZUNG__01"), ("vermietet", "NUTZUNG__02"),
        ("Ferien- und Freizeitwohnungen", "NUTZUNG__03"), ("leer stehend", "NUTZUNG__04"),
        ("leer seit 12 Monaten oder länger", "LEERSTAND_DAUER__4")]),
    ("miete", "Vermietete Wohnungen nach Nettokaltmiete", "CSV-Wohnungen", None, [
        ("unter 4 €/m²", "MIETE_EURM2_2__01"), ("4 bis unter 6 €/m²", "MIETE_EURM2_2__02"), ("6 bis unter 8 €/m²", "MIETE_EURM2_2__03"),
        ("8 bis unter 10 €/m²", "MIETE_EURM2_2__04"), ("10 €/m² und mehr", [f"MIETE_EURM2_2__{i:02d}" for i in range(5, 11)])]),
    ("eigentum", "Wohnungen nach Eigentum des Gebäudes", "CSV-Wohnungen", "GEBAEUDEART_SYS_1", [
        ("Privatpersonen", "EIGENTUM__2"), ("Wohnungseigentümergemeinschaft", "EIGENTUM__1"),
        ("Privatwirtschaftliches Wohnungsunternehmen", "EIGENTUM__5"), ("Kommune, kommunales Unternehmen", "EIGENTUM__4"),
        ("Genossenschaft", "EIGENTUM__3"), ("Sonstige", ["EIGENTUM__6", "EIGENTUM__7", "EIGENTUM__8"])]),
    ("baujahr", "Gebäude mit Wohnraum nach Baujahr", "CSV-Gebäude", "GEBAEUDEART_SYS_1", [
        ("vor 1919", "BAUJAHR_10JA__01"), ("1919 bis 1949", "BAUJAHR_10JA__02"), ("1950 bis 1959", "BAUJAHR_10JA__03"),
        ("1960 bis 1969", "BAUJAHR_10JA__04"), ("1970 bis 1979", "BAUJAHR_10JA__05"), ("1980 bis 1989", "BAUJAHR_10JA__06"),
        ("1990 bis 1999", "BAUJAHR_10JA__07"), ("2000 bis 2009", "BAUJAHR_10JA__08"), ("2010 bis 2015", "BAUJAHR_10JA__09"),
        ("2016 und später", "BAUJAHR_10JA__10")]),
    ("energie", "Gebäude mit Wohnraum nach Energieträger der Heizung", "CSV-Gebäude", "GEBAEUDEART_SYS_1", [
        ("Gas", "ENERGIETRAEGER__1"), ("Heizöl", "ENERGIETRAEGER__2"), ("Fernwärme", "ENERGIETRAEGER__8"),
        ("Wärmepumpe, Solar, Geothermie", "ENERGIETRAEGER__5"), ("Strom (ohne Wärmepumpe)", "ENERGIETRAEGER__6"),
        ("Holz, Holzpellets", "ENERGIETRAEGER__3"), ("Kohle", "ENERGIETRAEGER__7"),
        ("Biomasse, Biogas", "ENERGIETRAEGER__4"), ("keine Heizung", "ENERGIETRAEGER__9")]),
    ("bauweise", "Gebäude mit Wohnraum nach Bauweise", "CSV-Gebäude", "GEBAEUDEART_SYS_1", [
        ("freistehendes Haus", "GEBTYPBAUWEISE__1"), ("Doppelhaushälfte", "GEBTYPBAUWEISE__2"),
        ("gereihtes Haus", "GEBTYPBAUWEISE__3"), ("anderer Gebäudetyp", "GEBTYPBAUWEISE__4")]),
]


def regionaltabellen(raw: Path, offline: bool) -> dict | None:
    """Hamm-Zeilen (ARS 05915) aus den CSV-Blättern der Regionaltabellen; Zwischenspeicher hamm-regional.json."""
    cache = raw / "hamm-regional.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    for name in REGIONAL:
        p = raw / f"{name}.xlsx"
        if not p.exists():
            if offline:
                return None
            print("lade", name, flush=True)
            p.write_bytes(holen(BASIS + name + ".xlsx"))
            time.sleep(1)
    try:
        import openpyxl
    except ImportError:
        sys.exit("openpyxl fehlt: mit „uv run --with openpyxl python …“ aufrufen")
    out = {}
    for name in REGIONAL:
        wb = openpyxl.load_workbook(raw / f"{name}.xlsx", read_only=True)
        for ws in wb.worksheets:
            if not ws.title.startswith("CSV"):
                continue
            it = ws.iter_rows(values_only=True)
            kopf = next(it)
            for r in it:
                if r[1] == "05915":
                    out[ws.title] = {str(k): v for k, v in zip(kopf, r) if k}
                    break
    cache.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


def regwert(reg: dict, blatt: str, sp) -> float | None:
    """Wert (oder Summe mehrerer Spalten) aus einer Hamm-Zeile; „/“, „–“ und Lücken → null."""
    d = reg.get(blatt, {})
    summe = 0.0
    for s in sp if isinstance(sp, list) else [sp]:
        try:
            summe += float(str(d.get(s)).replace(",", "."))
        except ValueError:
            return None
    return summe


def amtlich(reg: dict) -> dict:
    abschnitte = []
    for aid, titel, blatt, bezug, zeilen in AMTLICH:
        basis = regwert(reg, blatt, bezug) if bezug else None
        zs = [[lab, None if (v := regwert(reg, blatt, sp)) is None else int(round(v))] for lab, sp in zeilen]
        abschnitte.append({"id": aid, "titel": titel, "basis": None if basis is None else int(round(basis)), "zeilen": zs})
    kz = {
        "einwohner": regwert(reg, "CSV-Einwohnerzahl", "EWZ"),
        "fortschreibung_2022_06_30": regwert(reg, "CSV-Einwohnerzahl", "EWZ_BFS_20220630"),
        "miete": regwert(reg, "CSV-Wohnungen", "QMMIETE"), "leerstand": regwert(reg, "CSV-Wohnungen", "LEQ"),
        "eigentum": regwert(reg, "CSV-Wohnungen", "ETQ"), "wohnflaeche": regwert(reg, "CSV-Wohnungen", "FLAECHE"),
    }
    return {"quelle": "Zensus 2022, Regionaltabellen (Bevölkerung, Demografie, Haushalte, Bildung und Erwerbstätigkeit, "
                      "Gebäude und Wohnungen), Gemeinde Hamm (ARS 05915)",
            "lizenz": "dl-de/by-2-0",
            "hinweis": "Bildung und Erwerbstätigkeit aus der Haushaltsstichprobe, auf 10 gerundet.",
            "kennzahlen": kz, "abschnitte": abschnitte}


def amtlich_merkmale(reg: dict) -> list:
    """Amtliche Hamm-Werte je Merkmal (nur bei gleicher Abgrenzung wie im Gitter), sonst null."""
    v = lambda blatt, sp: regwert(reg, blatt, sp)
    q = lambda z, n: None if z is None or not n else 100 * z / n
    d, h, g, w = "CSV-Demografie", "CSV-Haushalte", "CSV-Gebäude", "CSV-Wohnungen"
    hh, geb, whg = v(h, "0_Insgesamt_"), v(g, "GEBAEUDEART_SYS_1"), v(w, "GEBAEUDEART_SYS_1")
    werte = {
        "einwohner": v("CSV-Einwohnerzahl", "EWZ"), "auslaender": q(v(d, "Staatsange_kurz__2"), v(d, "0_Insgesamt_")),
        "haushalte": hh, "hh1": q(v(h, "HH_SIZE_NAT__1"), hh), "hh2": q(v(h, "HH_SIZE_NAT__2"), hh),
        "hh4plus": q(v(h, ["HH_SIZE_NAT__4", "HH_SIZE_NAT__5", "HH_SIZE_NAT__6"]), hh),
        "hhsenioren": q(v(h, "HHTYP_SENIOR_HH__1"), hh),
        "wohnungen": whg, "miete": v(w, "QMMIETE"), "leerstand": v(w, "LEQ"),
        "wohnflaeche": v(w, "FLAECHE"), "eigentum": v(w, "ETQ"), "w_mfh13": q(v(w, "ZAHLWOHNGN_HHG__5"), whg),
        "gebaeude": geb, "g_1whg": q(v(g, "ZAHLWOHNGN_HHG__1"), geb),
        "g_7plus": q(v(g, ["ZAHLWOHNGN_HHG__4", "ZAHLWOHNGN_HHG__5"]), geb),
        "et_gas": q(v(g, "ENERGIETRAEGER__1"), geb), "et_oel": q(v(g, "ENERGIETRAEGER__2"), geb),
        "et_wp": q(v(g, "ENERGIETRAEGER__5"), geb), "et_fern": q(v(g, "ENERGIETRAEGER__8"), geb),
        "hz_ofen": q(v(g, "HEIZTYP__5"), geb),
    }
    return [runden(m, werte.get(m["id"])) for m in M]


def strukturatlas(raw: Path) -> dict | None:
    sa = raw / "strukturatlas"
    if not (sa / "Stadtbezirk-t0.js").exists():
        return None
    def lies(t):
        return json.loads((sa / f"Stadtbezirk-t{t}.js").read_text(encoding="utf-8-sig"))["indicators"]
    reihe = {i["date"]: (i["values"], i["comparisonValues"][0]) for i in lies(0) if i["name"] == "Einwohner gesamt"}
    jahre = sorted(reihe)
    zahlwert = lambda x: None if x in (None, "", "-") else float(x)
    werte, stand = {}, {}
    for t, name, key, einheit, st in ATLAS_WERTE:
        ind = [i for i in lies(t) if i["name"] == name]
        if not ind:
            continue
        i = ind[-1]
        werte[key] = ([zahlwert(x) for x in i["values"]], zahlwert(i["comparisonValues"][0]))
        stand[key] = i["date"]
    return {
        "quelle": "Strukturatlas der Stadt Hamm (Einwohnermeldedaten), www.hamm.de/apps/strukturatlas",
        "lizenz": "keine offene Lizenz, Quellenangabe „Geodaten Stadt Hamm, Ordnungs- und Wahlamt“ – nur privat",
        "privat": True,
        "stand": jahre[-1],
        "jahre": [int(j) for j in jahre],
        "kennzahlen": [{"id": k, "name": ATLAS_NAMEN[k], "einheit": e, "stand": stand[k]}
                       for _, n, k, e, _ in ATLAS_WERTE if k in werte],
        "bezirke": [{"name": b, "einwohner": [reihe[j][0][i] for j in jahre],
                     "werte": [werte[k][0][i] for _, n, k, e, _ in ATLAS_WERTE if k in werte]}
                    for i, b in enumerate(BEZIRK_ATLAS)],
        "hamm": {"einwohner": [reihe[j][1] for j in jahre],
                 "werte": [werte[k][1] for _, n, k, e, _ in ATLAS_WERTE if k in werte]},
    }


def main() -> None:
    offline, neu = "--offline" in sys.argv, "--neu" in sys.argv
    raw = rohordner(neu)
    laden(raw, offline)

    g = json.loads(GRENZEN.read_text(encoding="utf-8"))
    to3035 = pyproj.Transformer.from_crs(4326, 3035, always_xy=True)
    to4326 = pyproj.Transformer.from_crs(3035, 4326, always_xy=True)
    stadt = next(transform(to3035.transform, shape(f["geometry"])) for f in g["features"] if f["properties"]["ebene"] == "stadt")
    bezirke = [(f["properties"]["name"], transform(to3035.transform, shape(f["geometry"])))
               for f in g["features"] if f["properties"]["ebene"] == "bezirk"]
    bezirke.sort(key=lambda b: BEZIRK_ATLAS.index(b[0]) if b[0] in BEZIRK_ATLAS else 99)
    for _, p in [("", stadt)] + bezirke:
        shapely.prepare(p)
    b = stadt.bounds
    box = (b[0] // 1000 * 1000 - 1000, b[1] // 1000 * 1000 - 1000, b[2] // 1000 * 1000 + 2000, b[3] // 1000 * 1000 + 2000)
    roh = auszug(raw, box)

    def zellen(gitter: str) -> list[Zelle]:
        ids = set()
        for kurz, d in roh[gitter].items():
            ids |= set(d)
        bte = roh["1km"].get("bte", {}) if gitter == "1km" else {}
        return [Zelle(i, {k: d.get(i) for k, d in roh[gitter].items() if k != "bte"}, bte.get(i)) for i in sorted(ids)]

    seite = {"100m": 100, "1km": 1000}
    ausgabe_zellen, mitte_in = {}, {}
    for gitter in ("100m", "1km"):
        cs = zellen(gitter)
        s = seite[gitter]
        ne = np.array([gitter_aus_id(c.gid) for c in cs], dtype=float)
        mx, my = ne[:, 1] + s / 2, ne[:, 0] + s / 2
        drin = shapely.contains_xy(stadt, mx, my)
        if gitter == "1km":
            # 1-km-Zellen: auch angeschnittene am Rand behalten (Anzeige), Kennzahlen nur aus Zellmitte im Stadtgebiet
            nah = shapely.intersects_xy(stadt.buffer(500), mx, my)
            behalten = [c for c, a in zip(cs, nah) if a]
        else:
            behalten = [c for c, a in zip(cs, drin) if a]
        bz = {}
        for name, poly in bezirke:
            treffer = shapely.contains_xy(poly, mx, my)
            bz[name] = [c for c, t in zip(cs, treffer) if t]
        mitte_in[gitter] = {"hamm": [c for c, a in zip(cs, drin) if a], **bz}
        ms = [m for m in M if m.get("gitter", "100m") == gitter or gitter == "1km"]
        out = {}
        for c in behalten:
            n, e = gitter_aus_id(c.gid)
            kurz = f"{n // s}_{e // s}"
            werte = [runden(m, c.merkmal(m)) for m in ms]
            while werte and werte[-1] is None:
                werte.pop()
            if werte:
                out[kurz] = werte
        ausgabe_zellen[gitter] = out
        print(gitter, "Zellen", len(cs), "im Ausschnitt,", len(out), "ausgegeben", flush=True)

    # Merkmale: 100-m-Merkmale vorn (Reihenfolge der Arrays in „zellen“), 1-km-Merkmale hinten
    for m in M:
        m.setdefault("gitter", "100m")
    def aggregat(c_100: list[Zelle], c_1km: list[Zelle]) -> list:
        return [runden(m, zusammen(m, c_100 if m["gitter"] == "100m" else c_1km)) for m in M]

    hamm = aggregat(mitte_in["100m"]["hamm"], mitte_in["1km"]["hamm"])
    reg = regionaltabellen(raw, offline) or {}
    bez = [{"name": name, "zellen": len(mitte_in["100m"][name]),
            "werte": aggregat(mitte_in["100m"][name], mitte_in["1km"][name])} for name, _ in bezirke]
    unsicher = {}
    for m in M:
        if m["art"] == "kennzahl":
            unsicher[m["id"]] = sum(1 for c in mitte_in["100m"]["hamm"] if c.unsicher(m["q"][0]) and c.wert(*m["q"]) is not None)

    stand = raw.name
    daten = {
        "quelle": "Zensus 2022, Ergebnisse in Gitterzellen, © Statistische Ämter des Bundes und der Länder",
        "quelle_url": "https://www.zensus2022.de/DE/Ergebnisse-des-Zensus/gitterzellen.html",
        "lizenz": "Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0)",
        "stichtag": "2022-05-15",
        "stand": stand,
        "hinweis": "Werte durch Geheimhaltung (Cell-Key-Methode) leicht verändert; „–“ in Kennzahlen = kein Wert. "
                   "Bezirke und Hamm aus den 100-m-Zellen mit Mittelpunkt im Gebiet, Mittelwerte gewichtet.",
        "merkmale": [{k: m[k] for k in ("id", "name", "einheit", "gitter", "gruppe", "beschreibung")}
                     | ({"art": "anzahl"} if m["art"] == "anzahl" else {}) for m in M],
        "gitter": {"100m": {"seite": 100, "id": "<N/100>_<E/100>, Südwest-Ecke EPSG:3035",
                            "merkmale": [m["id"] for m in M if m["gitter"] == "100m"]},
                   "1km": {"seite": 1000, "id": "<N/1000>_<E/1000>, Südwest-Ecke EPSG:3035",
                           "merkmale": [m["id"] for m in M]}},
        "geo": naeherung(to4326, box),
        "hamm": hamm,
        "hamm_amtlich": amtlich_merkmale(reg) if reg else None,
        "amtlich": amtlich(reg) if reg else None,
        "bezirke": bez,
        "unsicher": unsicher,
        "zellen": ausgabe_zellen["100m"],
        "zellen1km": ausgabe_zellen["1km"],
        "stadtstatistik": strukturatlas(raw),
    }
    AUS.write_text(json.dumps(daten, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("geschrieben", AUS, f"{AUS.stat().st_size / 1024:.0f} KB, Näherung {daten['geo']['fehler_m']} m")
    ix = {m["id"]: i for i, m in enumerate(M)}
    for name, w in [("Hamm", hamm)] + [(x["name"], x["werte"]) for x in bez]:
        print(f"  {name:14} Einw. {w[ix['einwohner']]:>7}  Alter {w[ix['alter']]}  ab65 {w[ix['ab65']]} %  "
              f"Ausl. {w[ix['auslaender']]} %  Miete {w[ix['miete']]}  Leer {w[ix['leerstand']]} %  alt_fossil {w[ix['alt_fossil']]} %")
    print("  amtlich", {m["id"]: v for m, v in zip(M, daten["hamm_amtlich"] or []) if v is not None})
    print("  Summe Bezirke", sum(x["werte"][ix["einwohner"]] or 0 for x in bez))


if __name__ == "__main__":
    main()

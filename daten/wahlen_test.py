"""Prüft web/public/daten/wahlen.json gegen die amtlichen Gesamtergebnisse (Gemeinde- und Wahlbezirks-CSV).

Aufruf: python daten/wahlen_test.py   (nach python daten/wahlen.py)
"""

import csv
import io
import json
import sys
from pathlib import Path

W = Path(__file__).resolve().parents[1]
d = json.loads((W / "web/public/daten/wahlen.json").read_text(encoding="utf-8"))
raw = W / "daten/raw/wahlen" / d["stand"]
fehler = []


def pruefe(bed: bool, text: str) -> None:
    if not bed:
        fehler.append(text)


def csv_zeilen(name: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO((raw / name).read_text(encoding="utf-8-sig")), delimiter=";"))


pruefe(len(d["bezirke"]["features"]) == 137, "137 Stimmbezirke erwartet")
pruefe(len(d["wahlbezirke"]["features"]) == 29, "29 Kommunalwahlbezirke erwartet")
ids = {w["id"] for w in d["wahlen"]}
pruefe({"kw25-rat", "kw25-ob", "btw25-zweit", "ew24"} <= ids, "Wahlen fehlen")

termin = {"kw25": "20250914", "btw25": "20250223", "ew24": "20240609"}
gemeinde = {"kw25-rat": "Ratswahl", "kw25-ob": "Wahl-des-der-Oberbuergermeisters-in", "kw25-rvr": "RVR-Wahl",
            "btw25-erst": "Wahl-zum-Deutschen-Bundestag", "btw25-zweit": "Wahl-zum-Deutschen-Bundestag", "ew24": "Europawahl"}
for w in d["wahlen"]:
    g = w["gesamt"]
    pruefe(30 < g["beteiligung"] < 95, f"{w['id']}: Beteiligung {g['beteiligung']}")
    pruefe(abs(sum(g["stimmen"].values()) - 100) < 0.6, f"{w['id']}: Anteile summieren nicht auf 100")
    pruefe(all(p["farbe"].startswith("#") and len(p["farbe"]) == 7 for p in w["parteien"]), f"{w['id']}: Farbe")
    if w["id"] in gemeinde:
        t = termin[w["id"].split("-")[0]]
        amtl = csv_zeilen(f"{t}-{gemeinde[w['id']]}-Gemeinde.csv")[0]
        pruefe(int(amtl["A"]) == g["wahlberechtigte"], f"{w['id']}: Wahlberechtigte {g['wahlberechtigte']} ≠ {amtl['A']}")
        pruefe(int(amtl["B"]) == g["waehler"], f"{w['id']}: Wähler {g['waehler']} ≠ {amtl['B']}")
        gf = "F" if w["stimmart"] == "Zweitstimme" else "D"
        pruefe(int(amtl[gf]) == g["gueltig"], f"{w['id']}: gültig {g['gueltig']} ≠ {amtl[gf]}")
    n = sum(1 for f in d["bezirke"]["features"] if w["id"] in f["properties"])
    pruefe(n == w["zugeordnet"], f"{w['id']}: {n} Flächen mit Ergebnis")

# Kommunalwahlbezirke (Urne + Brief) gegen die amtliche Wahlbezirks-Übersicht der Ratswahl
amtl = {r["gebiet-nr"]: r for r in csv_zeilen("20250914-Ratswahl-Wahlbezirk.csv")}
for f in d["wahlbezirke"]["features"]:
    p = f["properties"]
    a = amtl.get(p["nr"])
    pruefe(a is not None and int(a["B"]) == p["kw25-rat"]["waehler"], f"KWB {p['nr']}: Wähler weichen ab")

if fehler:
    print("FEHLER:\n  " + "\n  ".join(fehler))
    sys.exit(1)
print(f"wahlen.json gültig: {len(d['wahlen'])} Wahlen, {len(d['bezirke']['features'])} Stimmbezirke, {len(d['wahlbezirke']['features'])} Kommunalwahlbezirke")

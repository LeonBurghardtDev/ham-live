# HAM:LIVE

Privates Lagebild von Hamm als Web-Karte: so viele offene Daten wie möglich auf einer Karte, Echtzeit (Wetter, Radar, Busse, Verkehr, Pegel, Blaulicht) und Kartendaten (aktuell, historisch, Kataster, Umwelt). Leichtgewichtig: keine Vorberechnung großer Welten, Karten kommen direkt von den Diensten, ein kleiner Proxy im Entwicklungsserver hält Echtzeitdaten zwischen.

## Regeln

- Nur offene Dienste ohne Anmeldung und ohne API-Schlüssel. Lizenz jeder Quelle steht im Ebenenkatalog bzw. bei der Quelle und erscheint in der Namensnennung.
- Quellen ohne offene Lizenz (Westfalenfahrplan-EFA, Presseportal, OpenSky, DB IRIS, Verkehr.NRW-Verkehrslage (teils TomTom), presse-service.de/Stadt Hamm für Blitzer-Schwerpunkte und Baustellen, Veranstaltungskalender veranstaltungen.hamm.de, Lkw-Parken live von Toll Collect über die ParkAPI von MobiData BW, Notdienst-Apotheken von aponet.de, Live-Bilder aus Kamen-Heeren und von YouTube) nur privat; vor einer Veröffentlichung abschalten (IRIS: `IRIS_AN` in `web/src/zuege.ts`).
- Oberfläche im Erscheinungsbild der Stadt Hamm (wie hamm.de): Petrol #005468 für Marke und Auswahl, Hamm-Grün #95c11e als Akzent, Grau #505050, Schrift Fira Sans, Überschriften Poppins (beide OFL 1.1, lokal über @fontsource). Rot-silberner Schachbalken aus dem Wappen nur als Zierde im Ladebildschirm, kein Wappen und kein Stadtlogo. Gelb nur für „dicht/Hinweis“, Rot nur für Gefahr. Rechte Winkel, 8-px-Raster, keine Emojis, keine Verläufe. Alles auf Deutsch.

## Aufbau

```
web/                 Vite + TypeScript + MapLibre GL JS (kein UI-Framework)
  vite.config.ts     Entwicklungsserver: hängt die Schnittstellen aus web/server/ als Middleware ein
  src/ebenen.ts      Ebenenkatalog (WMS/XYZ) mit Gruppen und Lizenzen
  src/live.ts        Echtzeitquellen (Panel rechts, Punkte auf der Karte)
  src/busse.ts       Busse nach Sollfahrplan (GTFS), Abfahrten
  src/zuege.ts       Züge nach GTFS (Regional- und Fernverkehr) entlang der OSM-Gleise, Verspätungen/Ausfälle aus DB IRIS Hamm Hbf
  src/quellen-hamm.ts Verkehrslage (Verkehr.NRW), Bus-Störungen (EFA), Blitzer-Schwerpunkte der Woche, Ladesäulen-Belegung (Stadt Hamm, dl-de/by-2-0)
  src/quellen-stadt.ts Baustellen und Sperrungen (Pressemitteilungen Stadt Hamm, Straßen aus strassen.json), Veranstaltungen 14 Tage (iCal veranstaltungen.hamm.de, Orte aus orte.json)
  src/quellen-park.ts Parken (`parken`): Parkhäuser/große Parkplätze aus OSM (ohne Live-Belegung), Lkw-Parken Autobahn live
  src/muell.ts       Abfuhrtermine der ASH Hamm je Adresse (Müllmax, Formular-POST über /api/post aus web/server/post.ts)
  src/ortssuche.ts   Ortssuche im Browser über public/daten/orte.json
  src/politik.ts    Wahlergebnisse (Tab Politik): wahlenLaden, wahlFarbausdruck, bezirkHtml, wahlLegende
  src/bevoelkerung.ts Bevölkerung (Zensus 2022 im Gitter): bevoelkerungLaden, bevoelkerungKarte, bevoelkerungPanelHtml, bevoelkerungZelleHtml (CSS bevoelkerung.css, Präfix .bv-)
  src/einrichtungen.ts Tab Wegweiser: Einrichtungen je Kategorie, Symbole `ew:*`, Notdienst-Apotheken, Notaufnahmen
  src/sonne.ts       Sonnenstand, Schattenwurf aus LoD2-Höhen
  src/webcams.ts     Live-Bilder (Webcams): Liste, Leseseite, Großansicht, Kartenebene (CSS webcams.css, Präfix .wc-); Bilder über /api/bild (web/server/bild.ts)
  src/main.ts        Karte, Panels, Zeitreise, Radar-Zeitachse, Akte (Klick)
  public/daten/      gebaeude.geojson (LoD2), fahrplan.json (GTFS), buswege.json (Buswege OSM), zuege.json (GTFS + Gleiswege) – erzeugt
daten/               Python-Exporte (Rohdaten in $HAM_ROHDATEN)
recherche/           geprüfte Quellenlisten (karten.json, echtzeit.json)
```

## Server (`web/server/`)
- Alle Schnittstellen sind Node-Module ohne Abhängigkeiten: `proxy.ts` (/api/proxy), `post.ts` (/api/post), `bild.ts` (/api/bild), `tanken.ts` (/api/tanken), `kacheln.ts` (/api/kachel, Vorladen), `aufzeichnung.ts` (/api/aufzeichnung, /api/verkehr-stand, /api/statistik, Aufzeichnung alle 5 min), `/api/gesund`. `routen.ts` fasst sie zusammen, `konfig.ts` liest Pfade aus Umgebungsvariablen.
- Entwicklung: `vite.config.ts` hängt die Routen als Middleware ein. Betrieb: `server/start.ts` liefert zusätzlich `dist/` und `/daten/` aus (gzip, ETag, Pfade gegen Ausbruch geprüft). Node 24 führt die `.ts`-Dateien direkt aus, deshalb nur löschbare TypeScript-Syntax und Importe mit Endung `.ts`.
- Container: `Dockerfile` (Build-Stufe mit `npm ci && npm run build`, Laufzeit `node:24-alpine` als Benutzer `node`), `compose.yaml`, Anleitung `docs/betrieb.md`.

## Befehle

| Zweck | Befehl |
|---|---|
| Entwicklungsserver | `cd web && npm run dev` → http://localhost:5300 |
| Typen prüfen (Frontend und Server) | `cd web && npm run typen` |
| Container bauen und starten (Betrieb, Volumes für Daten, Aufzeichnung, local) | `docker compose up -d --build` → http://localhost:5300, Anleitung `docs/betrieb.md` |
| Betriebsserver ohne Container (nach `npm run build`) | `cd web && PORT=5300 npm start` |
| Gebäude (LoD2, Radius km) exportieren | `uv run python daten/gebaeude.py 3` |
| Straßengeometrie je Name und Bezirk (`public/daten/strassen.json`) | `uv run python daten/strassen.py` |
| Ortssuche-Index (`public/daten/orte.json`) | `uv run python daten/orte.py` |
| Parkhäuser und große Parkplätze (`public/daten/parken.geojson`) | `uv run python daten/parken.py` |
| Wegweiser-Einrichtungen (`public/daten/einrichtungen.geojson`, WFS-Rohdaten `daten/raw/einrichtungen/<Abrufdatum>/`, `--offline`) | `uv run python daten/einrichtungen.py` |
| Busfahrplan exportieren | `python daten/fahrplan.py` |
| Buswege zwischen den Halten entlang der Straßen (`public/daten/buswege.json`, nach dem Busfahrplan; OSM-Linienrelationen `route=bus`, sonst Wegsuche im Straßengraphen, sonst gerade; OSM `raw/osm/arnsberg-regbez-*.osm.pbf`, sonst `hamm_*`) | `uv run python daten/buswege.py` |
| Zugfahrplan mit Gleiswegen exportieren (gtfs-de-rv/fv aus `$HAM_ROHDATEN/gtfs/`, Gleise `raw/osm/gleise_overpass_*.json`) | `python daten/zugfahrplan.py` |
| Wahlergebnisse je Stimmbezirk/Kommunalwahlbezirk (`public/daten/wahlen.json`, Rohdaten `daten/raw/wahlen/<Abrufdatum>/`, `--offline`) und Prüfung | `python daten/wahlen.py && python daten/wahlen_test.py` |
| Strom-Anlagen in Hamm aus dem Marktstammdatenregister (`public/daten/energie-hamm.json`, Rohdaten `daten/raw/mastr/<Abrufdatum>/`, `--offline`) | `python daten/mastr.py` |
| Zensus 2022 im 100-m- und 1-km-Gitter, Bezirke, amtliche Gemeindewerte, Stadtstatistik 2001–2017 (`public/daten/zensus.json`, Rohdaten `daten/raw/zensus/<Abrufdatum>/`, `--offline`, `--neu`) | `uv run --with openpyxl python daten/zensus.py` |

In der Konsole: `hamLage.map`, `hamLage.zustand`.

## Züge

- Fahrplan: GTFS Deutschland (gtfs.de, CC BY 4.0), Feeds `rv_free` (Regionalverkehr) und `fv_free` (Fernverkehr), Abruf 2026-10-01 nach `$HAM_ROHDATEN/gtfs/gtfs-de-{rv,fv}-2026-10-01.zip`. Der Nahverkehrsfeed `nv` enthält in Hamm keine Züge.
- Gleise: OpenStreetMap (ODbL), einmalig per Overpass (`way[railway~rail|light_rail]` in 51,45–51,95 N / 7,40–8,25 O) nach `$HAM_ROHDATEN/osm/gleise_overpass_2026-10-01.json`. Je Bahnhofspaar kürzester Weg im Gleisgraphen (Nebengleise ×4 gewichtet); liegt ein Halt außerhalb, Gleisweg bis zum Rand, dann Luftlinie.
- Echtzeit: DB IRIS (`iris.noncd.db.de`, plan + fchg für EVA 8000149), ohne Schlüssel, Lizenz nicht veröffentlicht → nur privat. Zuordnung über Linie bzw. Gattung und Sollzeit in Hamm Hbf; die dort gemeldete Verspätung gilt vereinfacht für die ganze Fahrt.

## Wahlen

- Ergebnisse: Stadt Hamm, votemanager (`wahlen.citeq.de/<Termin>/05915000/daten/opendata/`), Open-Data-CSV je Stimmbezirk, Datenlizenz Deutschland Namensnennung 2.0. Enthalten: Kommunalwahl 14.09.2025 (Rat, Oberbürgermeister, Bezirksvertretungen der 7 Stadtbezirke zusammengeführt, RVR), Bundestagswahl 23.02.2025 (Erst- und Zweitstimme), Europawahl 09.06.2024. Landtagswahl 2022 nicht aufgenommen (ältere votemanager-Fassung mit anderer Pfadstruktur, Einteilung vor 2025).
- Geometrie: WFS der Stadt Hamm `od_wahlen.qgs`, Ebenen `Stimmbezirke` (137 Urnenbezirke) und `Kommunalwahlbezirke` (29), Einteilung 2025. Europawahl 2024: nur 123 Bezirke gleich nummeriert, Rest ohne Ergebnis; keine Kommunalwahlbezirks-Werte.
- Briefwahl: 50 Briefwahlbezirke (001–029, a/b) gehören je zu einem Kommunalwahlbezirk. Stimmbezirke zeigen nur Urnenstimmen, ihre Beteiligung ist geschätzt (Wahlscheine × Rücklaufquote des Kommunalwahlbezirks); Kommunalwahlbezirke enthalten Urne + Brief und stimmen mit der amtlichen Übersicht überein.
- MapLibre: `wahlenLaden()` schreibt flache Properties `w:<wahlId>:beteiligung|staerkste|<Partei>`.

## Stadtquellen (`web/src/quellen-stadt.ts`)

- Baustellen (`baustellen`): RSS der Stadt Hamm auf presse-service.de (`rss.aspx?p=1256`, plus Volltextsuche `&s=Sperrung|gesperrt|Umleitung|…`), Volltext von der Meldungsseite. Straßen per Namensabgleich mit `strassen.json` (Titel, sonst erster Satz, plus Sperr-Sätze), Grenzstraßen nach „zwischen … und …“ kürzen die Linie, Straßen aus Umleitungssätzen nur im Text. Zeitraum per Regex („ab“, „bis“, „Ende Oktober“, „Jahresende“), abgelaufene und Meldungen ohne Ende älter als 6 Wochen fallen weg. Lizenz: Pressetexte „unter Angabe der Quelle frei“, keine offene Lizenz → nur Fakten, nur privat.
- Veranstaltungen (`veranstaltungen`): Veranstaltungskalender der Stadt Hamm (RCE Event), iCal `https://veranstaltungen.hamm.de/output.php?id=1282&mode=ics` (ohne Schlüssel, rund 250 Termine / 3 Wochen, keine Koordinaten, keine Einzel-Links). Kategorie aus dem Titelpräfix, Ort per Namensabgleich mit `orte.json` (OSM, ODbL). Keine Lizenz angegeben → nur privat.
- Geprüft und verworfen: Ruhr Tourismus Open Data Finder (CC BY-SA 4.0, Datensatz „veranstaltungen-in-hamm“ auf opendata.ruhr) braucht Registrierung und Lizenzschlüssel; hamm.opendata.ruhr hat keinen eigenen Veranstaltungsdatensatz.

## Abfuhrtermine (`web/src/muell.ts`)

- Quelle: ASH Hamm, Abfuhrkalender von Müllmax (Grafik-Partner GmbH), eingebettet auf hamm.de/ash/abfuhrkalender: `https://www.muellmax.de/abfallkalender/ash/res/AshStart.php`. Ohne Anmeldung, aber nur per Formular-POST mit Sitzungsfeld `mm_ses` (Start → Straße suchen → ggf. Straße wählen → Hausnummer `PLZ;Ortsteil;Nr;` → iCal-Auswahl → iCal mit allen Fraktionen außer Umweltmobil). Dieselbe Quelle nutzt Home Assistant `waste_collection_schedule` (`muellmax_de`, Dienst `Ash`). Andere Wege (AbfallNavi, abfall.io, Open Data Ruhr) haben für Hamm nichts.
- Weil `/api/proxy` nur GET kann, läuft der Abruf über `/api/post` (`web/server/post.ts`, nur Host `www.muellmax.de`).
- `muellTermine(strasse, hausnummer)` → nächste 8 Wochen, Arten rest/papier/gelb/bio/sonstig (Grünabfälle). Straßen werden tolerant verglichen (ß/ss, „Str.“), fehlt die Hausnummer, nimmt es die nächste gleicher Seite (höchstens 20 daneben). Zwischenspeicher im Speicher 6 h je Adresse. Müllmax sperrt bei zu vielen Abfragen 24 h (Meldung „Abfragelimit“), daher nur auf Klick abfragen. Biotonne kam in den Proben nicht vor.
- Lizenz: keine angegeben → nur privat.

## Tanken und Laden (`web/src/tanken.ts`)

- Spritpreise: Tankerkönig (`creativecommons.tankerkoenig.de/json/list.php`, Umkreis 15 km um den Marktplatz, CC BY 4.0). Braucht einen privaten Schlüssel in `local/tankerkoenig.json` oder `web/local/tankerkoenig.json` (`{"key": "…"}`, beide gitignored). Der Entwicklungsserver hängt ihn unter `/api/tanken` an, der Browser sieht ihn nie. Höchstens alle 5 Minuten eine Abfrage. Ohne Schlüssel zeigt die Karte „Schlüssel fehlt“. Zum Testen der Oberfläche gibt es den Demo-Schlüssel `00000000-0000-0000-0000-000000000002` (echte Stationen, Platzhalterpreise), nie dauerhaft eintragen.
- Rechner „Tanken für x Liter“: Sorte und Liter im Panel, Liste günstigste geöffnete zuerst, Plakette auf der Karte grün/schwarz/rot nach Preisdrittel, grau geschlossen.
- Ladesäulen: BNetzA-Ladesäulenregister (`ladesaeulen.geojson`) und Live-Belegung aus dem WFS der Stadt Hamm.

## Politik

- Tab „Politik“ in `main.ts` (`politik*`-Funktionen) auf Basis von `web/src/politik.ts`: Wahl, Färbung (stärkste Partei, Beteiligung, eine Partei), Einteilung Stimmbezirke oder Kommunalwahlbezirke mit Briefwahl. Klick auf einen Bezirk öffnet `bezirkHtml()` im Blatt.

## Verkehr (`web/src/verkehr-seite.ts`, Entwurf V1 + V3 + V5)
- Überblick im Panel: Stau und zäh in km (nur Abschnitte mit Mitte im Stadtgebiet, beide Richtungen), Bahn Hamm Hbf, Baustellen; Hauptachsen (`ACHSEN`, Straßenverläufe aus `strassen.json`) mit geschätztem Zeitverlust je Richtung; Störungen mit Bezug zu Hamm.
- Zuordnung: Abschnitt von Verkehr.NRW gehört zur Achse, wenn seine Mitte höchstens 35 m von ihr entfernt ist. Zeitverlust aus angenommenen Geschwindigkeiten (`GESCHW`: dicht 70 %, zäh 45 %, Stau 20 % der freien; frei innerorts 45 km/h, Autobahn 110 km/h). Verkehr.NRW liefert jede Richtung einzeln, daher Achsenwerte / 2.
- Belastbarkeit: Autobahnwerte decken sich meist mit ADAC und Autobahn GmbH. Auf Stadtstraßen meldet Verkehr.NRW auch abends viel „zäh“/„Stau“ (z. B. Werler Straße), vermutlich wegen Ampeln und weniger Messfahrzeugen; dort ist es eine Tendenz, kein Messwert.
- Eingefrorene Daten: Verkehr.NRW liefert zeitweise stundenlang dieselbe Verkehrslage (am 01.10.2026 ab 21:17 Uhr identisch bis auf zwei Nachkommastellen). `/api/verkehr-stand` vergleicht die Aufzeichnungen (km je Lage); sind sie 20 min oder länger unverändert, werden die Farben aus den Staumeldungen abgeleitet (grün ohne Meldung, zäh bis 400 m um eine Meldung; nur ohne Staumeldungen grau „veraltet“), Hauptachsen, Stau-km und die Lagezeile auf Aktuell entfallen, die Tagesleiste endet dort.
- Staumeldungen: `vipnrw:traffic_abnormal_travel_time_loss_feature` (TomTom-Meldungen mit Zeitverlust und Trend, laufend aktualisiert), Quelle `staumeldungen` in `quellen-hamm.ts`, alle 2 min.
- Tagesleiste: die Aufzeichnung (`web/server/aufzeichnung.ts`) speichert alle 5 Minuten die km je Lage im Stadtgebiet (`verkehr`), `/api/aufzeichnung` liefert `stau` (zäh + Stau). Auf dem Handy steht die Leiste im Blatt.

## Wetter (`web/src/wetter-seite.ts`, CSS `web/src/wetter.css`, Entwurf W1)

- `stadtwetter` (Takt 900 s): Temperatur je Stadtbezirk (Mittelpunkte aus `grenzen.geojson`, `ebene: 'bezirk'`) über Open-Meteo, alle sieben in einer Anfrage (`api.open-meteo.com/v1/forecast?latitude=…,…&longitude=…,…&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m`, CC BY 4.0, Modellwerte). Dazu die drei Messstationen der Stadt Hamm (106111–106113) aus dem WFS `od_natur_umwelt.qgs`, Typ `Wetterstationen` (Zeitreihe, je `stations_id` der neueste Datensatz; Feld heißt `relative_luftfeutigkeit`; Lizenz dl-de/by-2-0 laut open.nrw). Symbole `temp:<°C>:bezirk:<Name>` (Schild nach Temperatur getönt) und `temp:<°C>:station` (weiß mit Petrol-Rahmen) über `stadtwetterSymbole(map)`.
- `wetterbericht` (Takt 900 s): DWD über Bright Sky (CC BY 4.0), `current_weather` und `weather` für acht Tage; Rohwerte über `wetterDaten()`, Seite über `wetterberichtHtml()` (Jetzt, 24 h im 3-h-Takt, 7 Tage). Bright Sky hat keine gefühlte Temperatur, sie kommt von Open-Meteo (Hamm-Mitte), sobald `stadtwetter` geladen ist.

## Luft und Heute

- Luft (`web/src/quellen-luft.ts`, Tab Wetter, Chip „Luft“): Feinstaubsensoren von sensor.community (`data.sensor.community/airrohr/v1/filter/area=…,12`, ODbL, unkalibriert, Fehlwerte 999,9 verworfen) und die nächsten amtlichen Stationen des UBA (Unna-Königsborn, Lünen; Hamm Münsterstraße ist seit 2020 außer Betrieb), Luftqualitätsindex dl-de/by-2-0. Plaketten mit PM2,5-Wert, Farbe nach UBA-Index.
- Heute in Hamm (`web/src/heute.ts`): Überblick oben im Tab Aktuell aus den geladenen Quellen plus Tagesvorhersage (Bright Sky `weather`, CC BY 4.0).

## Parken (`web/src/quellen-park.ts`)

- Parkhäuser, Tiefgaragen, Parkdecks und Parkplätze ab 50 Plätzen (bzw. mit Namen ab 20) aus OSM (ODbL), `daten/parken.py` → `public/daten/parken.geojson` (61 Anlagen, davon 18 Parkhäuser/Tiefgaragen; Kapazität oft nicht erfasst, z. B. Allee-Center 1.300). Panel nach Nähe zum Marktplatz, Hinweis „keine Live-Belegung verfügbar“.
- Live nur Lkw-Parken an A1/A2 um Hamm (12 Anlagen, z. B. Rhynern Nord/Süd): ParkAPI v3 von MobiData BW (`api.mobidata-bw.de/park-api/api/public/v3/parking-sites?lat&lon&radius`, ohne Schlüssel), Quelle Toll Collect, `attribution_license` leer → nur privat. Unter 10 % frei: Stufe Warnung und Symbol `parken-voll`.
- Geprüft und verworfen: Parkleitsystem der Stadt Hamm (13 Anlagen) – `hamm.de/apps/parkleitsystem/` 403, Belegung nur in mobilitaetsplan-hamm.de (`/api/v1/swarco/…`, alle Endpunkte 401, Anmeldung über login.mobilitaetsplan-hamm.de); ParkenDD (`api.parkendd.de`, keine Stadt Hamm); hamm.opendata.ruhr, opendata.ruhr, open.nrw (kein Parkdatensatz); Verkehr.NRW `parking_feature` (nur Lage von Lkw- und Pendlerparkplätzen, keine Belegung); QGIS-Server der Stadt (kein Parken-Projekt). Mobilithek-Parkdaten brauchen ein Abo mit Anmeldung.

## Stadtbild (`web/src/stadtbild.ts`)

- Stadtgrenze und 7 Stadtbezirke aus OSM (`daten/grenzen.py` → `grenzen.geojson`, `umland.geojson`, ODbL), Umland leicht ausgegraut (nicht im Tab Historisch). Stadtteilflächen gibt es weder bei der Stadt noch in OSM; Stadtteile erscheinen als Namen (Punkte aus `orte.json`).
- Sehenswertes: 15 Wahrzeichen mit eigener Kurzbeschreibung (Chip „Sehenswertes“ in Aktuell), Lage aus OSM. Ladebildschirm mit eigenen Silhouetten (Förderturm, Pauluskirche, Gradierwerk, Glaselefant, Tempel).
- Quell- und Ebenen-IDs mit Präfix `sb-` (die ID `grenzen` gehört der WMS-Ebene Verwaltungsgrenzen).

## Simulation (`web/src/simulation.ts`)

- Tab „Simulation“ mit drei Modi: Hochwasser Lippe (Gefahrenkarte MUNV NRW `HW_Gefahrenkarte`, Stufen häufig `_hw`, HQ100 `_mw`, extrem `_nw`, Schalter „ohne Deiche“ = `Grenzen_ueberflutete_Gebiete_ohne_technischen_Hochwasserschutz_*`), Starkregen (BKG `sgx.geodatenzentrum.de/wms_starkregen`, `nw_tiefe_agw` und `nw_tiefe_extrem`, dl-de/by-2-0), Sonne und Schatten (3D-Gebäude mit Uhrzeitregler).
- Lippe-Pegel live: Hochwasserportal NRW (LANUK) `data/internet/stations/100/<nr>/S/week.json`, Kesseler (2785790000300) und Hovestadt (2785710000100), dl-de/zero-2-0. In Hamm selbst betreibt der Lippeverband die Pegel, dort keine offene Schnittstelle.

## Kachelspeicher

- Unveränderliche Karten (`fest: true` in `ebenen.ts`: historische Luftbilder, Ur- und Neuaufnahme, TK25 1936–1945) laufen über `/api/kachel` (`web/server/kacheln.ts`) und landen beim ersten Abruf in `local/kacheln/` (gitignored). Sie werden als 512-px-Kacheln angefordert (weniger Anfragen an den langsamen WMS). Die Zeitreise lädt die Nachbarjahre unsichtbar mit. Ordner löschen leert den Speicher.

## Wegweiser (`web/src/einrichtungen.ts`)

- Daten: `daten/einrichtungen.py` → `einrichtungen.geojson` (809 Punkte, Flächen als repräsentativer Punkt, nur innerhalb der Stadtgrenze). Properties `kat` (notfall, gesundheit, bildung, alltag), `typ` (Symbol `ew:<typ>`), `art`, `name`, `sub`, `quelle`, `notaufnahme`. Dubletten: gleicher Typ und ähnlicher oder fehlender Name < 80 m bzw. gleicher Name < 250 m, amtlich vor OSM.
- Quellen: OpenStreetMap (ODbL) für Krankenhäuser, Defibrillatoren, Feuerwehr, Polizei, Apotheken, Ärzte (Fachrichtung aus `healthcare:speciality`), Zahnärzte, Bürgerämter, Recyclinghöfe, Toiletten, Post, Packstationen, Bibliotheken. Stadt Hamm WFS `od_bildung_kitas.qgs` (Ebenen `Schulen` 67, `Kindertagesstaette` 108 mit Träger und Öffnungszeit, `Kinderaerzte` 10, `Spiel_und_Bewegungsflaechen` 280), dl-de/by-2-0 laut opendata.ruhr (Organisation hamm); weitere `od_bildung_*`-Projekte gibt es nicht. OSM ergänzt nichtstädtische Schulen und Kitas.
- Von Hand (Stand 2026-10-01): Notaufnahmen (OSM hat in Hamm kein `emergency=yes`): Johanniter-Kliniken Nassauerstraße und Werler Straße, Kinder-Notaufnahme Werler Straße, St. Barbara-Klinik Heessen. KVWL-Notdienstpraxen: Notfalldienstpraxis an der St. Barbara-Klinik (Am Heessener Wald 1), Kinder-Notfalldienstpraxis an den Johanniter-Kliniken (Werler Straße 110), mit Öffnungszeiten.
- Live `notdienst`: aponet.de (`/notdienstsuche/59065-Hamm`, HTML mit `data-latitude/-longitude`, Daten der Bundesapothekerkammer), 7 Apotheken im Umkreis 25 km, Wechsel 9 Uhr. Keine offene Lizenz → nur privat. `notaufnahmen`: aus den geladenen Daten, erste Zeile 116117.
- Lücken: OSM in Hamm dünn bei Ärzten (73 Praxen) und Defibrillatoren (3); Bürgeramt Rhynern und Pelkum fehlen in OSM.

## Kartenart und Regenradar

- Kartenart unten links in jeder Karte (wie Google Maps): Schnellknopf Karte/Satellit, „Ebenen“ öffnet Karte, Grau, Satellit (DOP), Gelände (TopPlus) und den Schalter Verkehr (Verkehrslage NRW). Die Wahl gilt für alle Tabs außer Historisch; im Tab Eigene Karte setzt sie die eigene Grundkarte.
- Regenradar: Bilder über den Proxy (`maps.dwd.de`, vergangene Zeitpunkte 24 h gespeichert) als Blob im Speicher; Abspielen wartet auf das nächste Bild. Der DWD-Dienst `dwd:Niederschlagsradar` hat nur Messungen (5-Minuten-Takt, rund 3 Tage zurück), keine Vorhersage.
- Entwürfe für den Tab Aktuell: `docs/mockups/aktuell.html`.

## Energie (`web/src/energie.ts`)

- Anlagen in Hamm: Marktstammdatenregister der Bundesnetzagentur (dl-de/by-2-0), öffentliche Einheitenübersicht `GetErweiterteOeffentlicheEinheitStromerzeugung` ohne Anmeldung, Filter Gemeindeschlüssel 05915000 (4 Seiten à 5000, Pause zwischen den Seiten) plus alle Einheiten ab 1 MW im Landkreis Hamm, weil Großkraftwerke (Trianel GuD Hamm-Uentrop) keinen Gemeindeschlüssel tragen. `daten/mastr.py` zählt je Träger, Solar nach Dach/Freifläche/Balkonkraftwerk (steckerfertig oder ≤ 0,8 kW) und Größenklassen, Solar-Zubau je Monat (24 Monate) und im Jahr, Speicher mit kWh, Großanlagen ≥ 1 MW und geplante Anlagen ≥ 1 MW. Stand 2026-10-01: 16 223 Einheiten, 15 828 in Betrieb.
- Live Deutschland über den Proxy (`api.energy-charts.info`, Fraunhofer ISE, CC BY 4.0): `public_power?country=de` (Erzeugung je Art, Last, Anteil erneuerbar, 15-Minuten-Werte, rund 2 h Verzug), `price?bzn=DE-LU&start&end` (Day-Ahead, Bundesnetzagentur | SMARD.de, CC BY 4.0, morgen ab etwa 13 Uhr), `signal?country=de&postal_code=59065` (Stromampel −1 Netzengpass, 0 rot, 1 gelb, 2 grün).
- Schätzungen Hamm: Solar = installierte PV-Leistung × Globalstrahlung (Bright Sky `solar_10`/Stundenwerte `solar`) / 1000 W/m² × 0,8; Wind = installierte Leistung × Leistungskurve (Anlauf 3 m/s, Nenn 12 m/s, Höhe 120 m mit Exponent 0,2 aus `wind_speed_10`). Immer als „geschätzt“ ausgewiesen.
- Nicht offen verfügbar: Live-Leistung je Kraftwerksblock (Energy-Charts-API liefert nur Summen je Art, ENTSO-E und EEX-Transparenz brauchen Anmeldung); Großanlagen deshalb nur mit Stammdaten.
- Exporte: Quellen `stromDe`, `strompreis`, `stromampel`, `solarHamm`, `windHamm`, `kraftwerkeHamm` (Liste `ENERGIE_QUELLEN`), `energieDaten()` (Rohwerte und Diagrammreihen), `energieHamm()`, `verdichte(kurve, min)`, `kurveSvg(kurve, opt)`, `balkenHtml(reihen)`, `kennzahlSolar()`, `energieSymbole(map)` (Symbol `kraftwerk`), Farben `FARBE`.

## Bevölkerung (`web/src/bevoelkerung.ts`, CSS `web/src/bevoelkerung.css`)

- Quelle Gitter: Zensus 2022, Ergebnisse in Gitterzellen (zensus2022.de → Ergebnisse → Gitterzellen, CSV in ZIP von `destatis.de/static/DE/zensus/gitterdaten/`), Stichtag 15.05.2022, Datenlizenz Deutschland Namensnennung 2.0. 20 ZIPs (je 10–35 MB, zusammen rund 400 MB) liegen in `daten/raw/zensus/2026-10-01/` und werden nicht entpackt, sondern direkt gelesen; der Hamm-Ausschnitt steht danach in `hamm-auszug.json` (Zweitlauf rund 5 s). Größen vorher per ETag geprüft (Server liefert keine Content-Length), Downloads nacheinander.
- Quelle Hamm gesamt: Zensus-Regionaltabellen (`Regionaltabelle_*.xlsx`, gleiche Seite, dl-de/by-2-0), Zeile ARS 05915. Liefert, was es im Gitter nicht gibt: Bildung, Erwerbsstatus, Wirtschaftszweige, Berufe (Haushaltsstichprobe, auf 10 gerundet), Einwanderungsgeschichte, Familienstand, Eigentumsform, Leerstandsdauer. `openpyxl` wird nur dafür mit `uv run --with openpyxl` geladen (nicht im HAM1226-Projekt eingetragen), danach Zwischenspeicher `hamm-regional.json`.
- Quelle Entwicklung: Strukturatlas der Stadt Hamm (InstantAtlas, `hamm.de/apps/strukturatlas/Einzelkarte/Stadtbezirk-t<n>.js`), Melderegister je Stadtbezirk 2001–2017 (Einwohner, Alter, Migrationshintergrund, Haushalte, Geburten, Wanderung, SGB II, Arbeitslose, Wohndauer). Keine offene Lizenz (Metadaten: Urheberrecht, Quellenangabe „Geodaten Stadt Hamm, Ordnungs- und Wahlamt“) → nur privat. Neuere Jahre gibt es dort nicht.
- Merkmale (36: 34 im 100-m-Gitter, 2 nur im 1-km-Gitter): Einwohner, Durchschnittsalter, unter 18, 18–29, 30–49, 50–64, ab 65, Ausländeranteil; Haushalte, Haushaltsgröße, Ein-, Zweipersonen-, Haushalte ab 4 Personen, nur Senioren; Wohnungen, Nettokaltmiete €/m², Leerstandsquote, Fläche je Wohnung, Fläche je Bewohner, Eigentümerquote, Wohnungen in Ein-/Zweifamilienhäusern, in Häusern ab 13 Wohnungen; Gebäude mit Wohnraum, Baujahr vor 1949 / 1949–78 / 1979–2000 / ab 2001, Gebäude mit 1 Wohnung, ab 7 Wohnungen, Gas, Heizöl, Wärmepumpe/Solar/Geothermie, Fernwärme, Einzel-/Mehrraumöfen. Nur im 1-km-Gitter (Kreuztabelle Baujahr × Typ × Energieträger): vor 1980 gebaut mit Gas oder Öl, Neubau ab 2010 mit Wärmepumpe.
- Ausgabe `zensus.json` (rund 630 KB, gzip 190 KB): `merkmale`, `zellen` (5 109 Zellen 100 m, ID `<N/100>_<E/100>` = Südwest-Ecke EPSG:3035, Werte in Merkmalsreihenfolge, hinten gekürzt), `zellen1km` (261, auch angeschnittene am Rand), `geo` (quadratische Näherung EPSG:3035 ↔ WGS84, Fehler 0,04 m), `hamm` und `bezirke` (aus Zellen mit Mittelpunkt im Gebiet, Mittel gewichtet mit Einwohnern, Haushalten oder Wohnungen), `hamm_amtlich` (Regionaltabelle, nur bei gleicher Abgrenzung), `amtlich.abschnitte`, `stadtstatistik`.
- Geheimhaltung: „–“ heißt genau null oder auf null gesetzt (Cell-Key-Methode). In Zähl- und Anteilsspalten wird es 0, in Mittelwerten null; „KLAMMERN“ (unsicher) bleibt als Wert. Folge: Leerstand aus Zellen 1,8 %, amtlich 2,8 %; Eigentümerquote 38,3 statt 39,4 %. Das Panel zeigt für Hamm den amtlichen Wert, die Bezirkstabelle nennt die Abweichung.
- Plausibilität: Summe der 100-m-Zellen 178 789 Einwohner, amtlich 179 070 (Fortschreibung 30.06.2022: 180 361). Bezirke: Mitte 36 260, Uentrop 27 113, Rhynern 18 270, Pelkum 18 999, Herringen 19 516, Bockum-Hövel 34 764, Heessen 23 878.
- Karte: Ebenen `bv-1km-flaeche`, `bv-1km-rand` (unter Zoom 12) und `bv-100m-flaeche` (ab Zoom 12), unter `anker-live`. 5 Klassen nach Quantilen, Skala Hamm-Grün hell bis Petrol (`BV_FARBEN`); bei vielen Nullen eigene Klasse „0“. Anzahlen im 1-km-Gitter je Hektar, damit die Klassen passen.
- Nicht verfügbar ohne Anmeldung: GENESIS-API von IT.NRW (Landesdatenbank) und Destatis/Regionalstatistik (Kennung nötig, auch Gast); Open Data der Stadt Hamm (hamm.opendata.ruhr, geoportal.ruhr) hat keine Einwohnertabellen, „Sozialräume“ nur Flächen. Zensus-Gitter für Bildung und Erwerb gibt es nicht (nur Gemeinde).

## Aktuell und Termine

- Tab Aktuell ist ein Magazin (`web/src/magazin.ts`): Überschriften aus WA, Stadt Hamm (presse-service.de) und Polizei (Presseportal), gleiche Ereignisse aus mehreren Quellen zusammengefasst, Aufmacher = meiste Quellen der letzten 72 h (ohne Blaulicht), sonst neueste Stadt-Meldung; Ressorts Stadt, Blaulicht, Kultur und Sport (Schlüsselwörter), leere fallen weg. Rechts Termine heute und morgen aus dem iCal der Stadt. Oben Kennzahlen: Wetter, Warnungen und Störungen nur bei Abweichung, Solarstrom aus Hamm (sobald `energie.ts` da ist). Alle Quellen nur Überschrift und Link, nur privat.
- Tab Termine (`web/src/kalender.ts`): Monatskalender ohne Karte, Filter nach Art, rechts der gewählte Tag; Serien (Ausstellungen) unter „Läuft an diesem Tag“. Quelle iCal der Stadt (rund drei Wochen voraus).
- Alle Karten-Tabs außer Wetter und Historisch passen beim Wechsel das ganze Stadtgebiet ein (`kamera.ganz`).

## Bus-Echtzeit (`web/src/busse-echtzeit.ts`)
- Alle 90 s Abfahrten mit Echtzeit an 10 großen Haltestellen (Westfalenfahrplan/EFA, `HALTE`), nacheinander abgefragt. `verspaetungSetzen` in `busse.ts` ordnet sie den GTFS-Fahrten zu (gleiche Linie, Halt ≤ 300 m vom Steig, Sollzeit ±60 s, Fahrt verkehrt heute) und verschiebt die Busposition um die Verspätung. Die letzte Verspätung bleibt bis Fahrtende erhalten; Fahrten ohne Messung fahren nach Sollzeit.
- Echtzeit liefert EFA nur für die nächsten etwa 30 Minuten je Haltestelle, daher hat nicht jeder Bus eine Messung. Das Detailblatt eines Busses nennt, ob er pünktlich, verspätet oder nur nach Sollfahrplan fährt.

## Statistik aus der Aufzeichnung (`web/src/statistik.ts`, `/api/statistik`)
- Die Aufzeichnung (alle 5 min) speichert zusätzlich `bus` (je Linie: Abfahrten, Summe Verspätung in s, davon pünktlich unter 3 min; nur Abfahrten der nächsten 5 min an den 10 Haltestellen, damit jede einmal zählt) und `sprit` (Preise E5/E10/Diesel aller geöffneten Tankstellen in Hamm über `/api/tanken`, kein zusätzlicher Tankerkönig-Abruf).
- `/api/statistik`: Pünktlichkeit je Linie heute und 7 Tage, Pünktlichkeit je Stunde, günstigster Preis je Stunde (Mittel 7 Tage) und Verlauf heute.
- Verkehr: Liste „Pünktlichkeit Bus“; verspätete Busse (ab 2 min) tragen auf der Karte ein gelbes Feld „+n“ wie die Züge. Tanken: Tagesverlauf mit günstigster Stunde, erscheint ab 6 erfassten Stunden.

## Radio (`web/src/radio.ts`)
- Livestream Radio Lippe Welle Hamm oben rechts (`https://stream.lokalradio.nrw/4454253`), nur privat. Startet pausiert, Stream erst beim Klick, beim Anhalten wird die Verbindung getrennt.
- Titel: `https://www.lippewelle.de/playlist/current?station=17` (JSON, CDN-Cache, daher Zeitstempel-Parameter), alle 30 s über `/api/proxy`. Länger als 4 min nach Titelende steht nur „live“.

## Live-Bilder (`web/src/webcams.ts`, CSS `web/src/webcams.css`, Bild-Proxy `web/server/bild.ts`)
- Statische Liste `WEBCAMS` (Recherche 2026-10-02), Leseseite `webcamsSeiteHtml()`, `webcamsVerdrahten(el)` lädt die Bilder im Takt der Quelle neu (nur solange `el` im DOM hängt und der Tab sichtbar ist), Großansicht mit Pfeiltasten/Esc, Kartenebene `webcamsSymbole(map)` (Quelle/Ebene `wc-kameras`).
- Flugplatz Hamm-Lippewiesen, Vorfeld: Luftsportclub Hamm e. V., datarhei Restreamer, Lizenz laut Einbettung CC BY 4.0. Standbild `https://webcam.flugplatz-hamm.de/memfs/0a1965c5-a876-43ee-92f8-e6d1f113619a.jpg` (1280 × 720, jede Minute neu, Last-Modified, CORS `*`), direkt im Browser abgerufen: Node lehnt den Server ab (fehlendes Zwischenzertifikat), Browser nicht. Die Adresse aus OSM (`lsc30/images/webcam/flugplatz_hamm_live.jpg`) steht seit 2021.
- Segelfluggelände Kamen-Heeren (Nachbarstadt, knapp südwestlich der Stadtgrenze): LSF 2000 Kamen/Dortmund e. V., `http://lsf-kamera.heridns.de/webcam.jpeg` (960 × 540, etwa alle 20 s, abgefragt jede Minute), keine Lizenzangabe → nur privat, über `/api/bild`. Die Uhr im Bild geht eine Stunde nach.
- Storchennest Hamm und zwei Waldkauz-Kästen (Hamm-Mark, YouTube-Kanal `@Storchennest_Hamm`, unterstützt vom NABU Hamm): Vorschaubilder der laufenden Livestreams `i.ytimg.com/vi/<id>/sddefault_live.jpg` (groß `maxresdefault_live.jpg`), YouTube erneuert sie etwa alle 5 min; nur privat. Endet ein Stream, ändert sich die Video-ID (dann in `WEBCAMS` nachtragen, IDs über `youtube.com/channel/UCY7iw9z3QVvDBnTUEjEd6cw/streams`). Lage nur ungefähr (Privatgrundstück am Hohefeldweg).
- `/api/bild?ttl=<s>&u=<URL>`: nur Hosts aus `BILD_ERLAUBT` in `web/server/bild.ts`, nur image/*, höchstens 2 MB, Zwischenspeicher je URL `ttl` Sekunden (10–3600), bei Ausfall bis 1 h das letzte Bild; Kopfzeilen `x-stand` (Last-Modified der Quelle) und `x-abruf`. Ohne Last-Modified zeigt die Kachel „abgerufen …“ statt „Stand …“, ab drei Takten plus 10 min Alter „nicht aktuell“.
- Geprüft und verworfen: Verkehr.NRW WFS `vipnrw:infrastructure_webcams_feature` (Felder id, display_type, point, start/end_timestamp, future, urban, info, dx, dy; landesweit 0 Objekte), Autobahn GmbH `/o/autobahn/<A>/services/webcam` (für alle Autobahnen leer, auch A1, A2, A44, A445); WA-Kameras Marktplatz und Medienhaus (`neubau.wa.de`, abgeschaltet 2024); Skater-Kamera Lippepark auf hamm.de (404); foto-webcam.eu „Test-Webcam Hamm“ (`webcam-hamm.de`, letztes Bild 01.11.2025); Halde Großes Holz Bergkamen (RVR, letztes Bild 2024, Blick von Hamm weg); panoramablick.com Hamm 30382 (stark unscharf); Windy/webcams.travel (API-Schlüssel nötig); AMC Hamm Rennstrecke (Gastzugang mit Passwort); Kameras in Ahlen, Werne, Unna (ohne Bezug zu Hamm). Für Lippe, Kanal, Hafen, Schleusen (WSA Westdeutsche Kanäle), Maximilianpark, Kurpark und Wetterstationen in Hamm gibt es keine öffentliche Kamera.

## Quellen und Lizenzen (`web/src/quellen-seite.ts`, `/api/datenstand`)
- Seite `quellen` (nicht in der Navigation), erreichbar über `#quellen`: Fußzeile der Leseseiten, Quellenzeile auf Aktuell, Kartenhinweis unten rechts auf Kartenseiten, Fuß des Handy-Menüs. Inhalt: rechtliche Hinweise (privat, nicht kommerziell, keine Gewähr, keine Verbindung zu Stadt und Anbietern, Notruf), alle Live-Quellen aus dem Zwischenspeicher mit Lizenz und letztem Abruf, alle Datensätze mit Quelle und Stand (`server/datenstand.ts` liest `quelle`, `lizenz`, `stand`, `abruf`, `erzeugt` aus den Dateien), weitere Quellen (Nachrichten, Termine, Radio, Müll, Webcams), alle Kartenebenen aus `ebenen.ts`, Software.
- Neue Quelle: Lizenz in der `Quelle` (`lizenz`) pflegen, dann erscheint sie automatisch; neuer Datensatz: Eintrag in `DATENSAETZE`, besser `quelle`/`lizenz`/`abruf` direkt ins JSON schreiben.

## UI-Standards
- Verbindlich: `docs/ui-standards.md` (Seitentypen, Bausteine, Texte). Vor jedem Commit mit UI-Änderung `cd web && npm run ui-pruefung` (Playwright headless, Bilder in `web/.ui-pruefung/`).

## Design (gilt für alle Seiten, Entwurf `docs/mockups/designsystem.html`)

- Navigation in fünf Gruppen mit Menü (`NAV_GRUPPEN` in `tabs.ts`): Jetzt, Unterwegs, Stadt, Umwelt, Karten. Handy (≤ 760 px): Menüknopf mit Seitentitel, Vollbild-Menü.
- Zwei Seitenarten: Lesen (Aktuell, Termine, Energie, ohne Karte, Klasse `.seite`, beginnt mit der Lagezeile `lageHtml()`) und Karte (Suche schwebt oben links, Ebenen-Schalter oben rechts `#ebenenleiste`, Panel als Akkordeon: die ersten zwei Karten offen).
- Handy: Kartenseiten mit Panel als Blatt von unten (Griff oben antippen = groß/halb), Detailblatt ebenfalls von unten, Zeitleiste über dem Blatt; Lese-Seiten einspaltig.
- Spritpreise: ohne Anmeldung gibt es keine offene Live-Quelle (Recherche 2026-10-01: Tankerkönig-Historie nur nach Anmeldung, MTS-K nur für zugelassene Dienste, Portale verbieten automatisches Abrufen). Weg bleibt ein eigener kostenloser Tankerkönig-Schlüssel in `local/`.

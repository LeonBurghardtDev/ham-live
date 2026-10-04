# Geplante Erweiterungen

Am 2026-10-01 für gut befunden, noch nicht umsetzen. Grundsatz: nichts Personalisiertes.

## A. Hamm in Zahlen (Zensus 2022, 100-m-Gitter)

- **Wohin:** Tab „Politik“ wird zu „Politik und Zahlen“ mit Umschalter oben: *Wahlen* | *Bevölkerung*. Gleiche Bedienlogik wie die Wahlfärbung (Merkmal wählen, Legende, Klick zeigt Werte).
- **Merkmale:** Einwohner je Hektar, Durchschnittsalter, Anteil unter 18 und über 65, Leerstandsquote, Nettokaltmiete je m², überwiegende Heizart, Eigentümerquote.
- **Daten:** Zensus 2022 Gitterzellen 100 m, Statistisches Bundesamt (dl-de/by-2-0, ohne Anmeldung). Vorhanden ist nur die Einwohnerzahl (`$HAM_ROHDATEN/zensus/hamm_100m_*.csv`), die anderen Merkmale als CSV-Pakete nachladen. Export `daten/zensus.py` → `web/public/daten/zensus.json`, nur Zellen in der Stadtgrenze (rund 23 000), Werte als Spalten.
- **Darstellung:** Quadrate als Fill-Ebene ab Zoom 11, darunter Bezirkssummen in der Legende. Geheimhaltete Zellen (Werte „–“) grau.
- **Klick:** Steckbrief der Zelle mit Vergleich zum Stadtmittel, wie das Wahlblatt.

## B. Was wäre, wenn die Lippe steigt? – umgesetzt im Tab „Simulation“ (2026-10-01), dazu Starkregen und Sonne

- **Wohin:** Tab „Wetter“, unter den Pegeln eine Karte „Hochwasser“ mit Regler; im Tab „Eigene Karte“ bleibt die Vorlage „Hochwasser und Lärm“.
- **Regler mit drei Stufen** aus der amtlichen Gefahrenkarte (MUNV NRW, `HW_Gefahrenkarte`, dl-de/by-2-0): häufig (`_hw`), alle 100 Jahre (`_mw`), extrem (`_nw`), jeweils Wassertiefen. Zusätzlich Schalter „ohne Deiche“ (`Grenzen_ueberflutete_Gebiete_ohne_technischen_Hochwasserschutz_*`).
- **Live-Bezug:** Lippe-Pegel in Hamm vom Hochwasserportal NRW (LANUV) mit Warnstufen; PEGELONLINE hat die Lippe nicht (keine Bundeswasserstraße). Text „Pegel heute X cm, Szenario häufig beginnt bei etwa Y cm“, falls das Portal Schwellen liefert.
- **Klick:** Wassertiefe an der Stelle (GetFeatureInfo ist für die Ortsinfo schon gebaut).

## C. Vorher-nachher-Schieber

- **Wohin:** Tab „Historisch“, dritter Modus neben „Karten und Luftbilder“ und „Rückblick“: *Vergleich*.
- **Bedienung:** senkrechter Schieber über der Karte, links ein wählbares Jahr (1954 bis 2023, Uraufnahme 1840, Neuaufnahme 1900), rechts heute. Ziehen verschiebt die Kante.
- **Technik:** zwei MapLibre-Karten übereinander mit gekoppelter Kamera und `clip-path` (kein Zusatzpaket nötig) oder `maplibre-gl-compare` (MIT) – das Zusatzpaket nur, wenn die eigene Lösung ruckelt.
- **Vorschläge:** Knöpfe „Zechen“ (Radbod, Heinrich Robert, Maximilian), „Innenstadt nach dem Krieg“, „Neubaugebiete“ springen zu passenden Orten und Jahren.

## D. Ein Tag in 30 Sekunden

- **Wohin:** Tab „Historisch“, Modus *Rückblick* bekommt „Tag abspielen“ (bisher nur Liste/Einzelzeitpunkt).
- **Inhalt:** Busse und Züge aus dem Sollfahrplan (für jede Uhrzeit berechenbar, keine Aufzeichnung nötig), Staus und Verkehrslage, Regenradar, Wetter, Pegel aus der Aufzeichnung.
- **Vorarbeit:** Die Aufzeichnung (`vite.config.ts`, `AUFZEICHNEN`) erfasst bisher nur Wetter, Warnungen, Pegel und Abfahrten. Ergänzen: Verkehrslage NRW (nur Abschnitte in Hamm, Lage je Abschnitt-ID, klein halten) und Radio-Lippe-Welle-Meldungen. Regenradar: DWD-WMS liefert nur kurz zurück, deshalb alle 15 min ein kleines Radarbild (Hamm-Ausschnitt, PNG) in `aufzeichnung/radar/` sichern.
- **Abspielen:** Uhr oben groß, 24 h in 30 s (Regler für Tempo), Pause, Sprung zu Stoßzeiten. Wird mit jedem aufgezeichneten Tag besser.

## Offen für später

- **Ratsbeschlüsse auf der Karte** (Tab Politik): Vorlagen und Beschlüsse aus Rat und Bezirksvertretungen mit Ortsbezug. Erst prüfen, ob Hamm OParl anbietet; Ort über Straßennamen im Titel mit `strassen.json`.
- **Handy-Version** (Panel als Leiste von unten).
- **Eigener Kartenhintergrund** (basemap.de-Vektor mit eigenem Stil).

## E. Tab „Termine“ (Veranstaltungskalender)

- **Wunsch (2026-10-01):** eigener Tab, auf den „Heute noch“ im Tab Aktuell verlinkt.
- **Quelle:** WFS der Stadt Hamm `od_sport_kultur_tourismus.qgs`, Ebene `Veranstaltungen` (rund 200 Termine mit Koordinaten, Stadtbezirk und Einzel-Link; Lizenz bei der Stadt bestätigen, vermutlich dl-de/by-2-0). Dazu Wochenmarkt und Foodtruck-Halte aus demselben Projekt. Rückfall: iCal `veranstaltungen.hamm.de` (heute genutzt, ohne Koordinaten).
- **Aufbau:** links Liste nach Tagen (Heute, Morgen, Wochenende, Nächste Woche), oben Filter Kategorie und Stadtbezirk, rechts Karte mit allen Orten. Klick auf einen Termin: Blatt mit Zeit, Ort, Beschreibung, Link zur Stadt.

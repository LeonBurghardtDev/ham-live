# UI-Standards HAM:LIVE

Verbindlich für jede Seite. Neue Seiten und Änderungen werden mit `cd web && npm run ui-pruefung` geprüft (Entwicklungsserver muss laufen); das Skript nimmt jede Seite auf Desktop (1440 × 900) und Handy (390 × 844) auf und meldet messbare Verstöße. Bilder liegen danach in `web/.ui-pruefung/` und werden vor dem Commit angesehen.

## Seitentypen

Es gibt genau zwei:

| Typ | Seiten | Aufbau |
|---|---|---|
| Leseseite | Aktuell, Termine, Energie | ohne Karte, volle Breite, Rand `--rand`, Kacheln in `.box` |
| Kartenseite | alle anderen | Karte vollflächig; links oben Suche, darunter Panel (360 px, Wetter 460 px); rechts oben Ebenen-Chips; unten links Kartenart; unten Mitte Zeitleiste; rechts unten Zoom |

Kartenseiten-Panel, immer in dieser Reihenfolge:
1. Bedienelemente der Seite (Segmente, Auswahl) oder ein eigener Überblick (Verkehr, Wetter)
2. Listen der Quellen als Klappabschnitte (`.karte`). Ohne eigenen Überblick sind die ersten zwei offen, mit Überblick alle zu.

Das Panel ist nur so hoch wie sein Inhalt. Auf dem Handy wird es zum Blatt unten (44 % der Höhe, per Griff vergrößerbar), die Zeitleiste sitzt darüber, Chips und Filter scrollen waagerecht.

## Bausteine

Nur diese verwenden, keine Einzelanfertigungen:

- **Kennzahl** (`.mz2-pill`, `.vu-kz`, Energie-Lagezeile): Bezeichnung in DIN-Versalien 10 px, Wert 15–18 px, optional eine Zeile Beleg. Farbstreifen links nur für Bewertung (grün gut, gelb mittel, rot schlecht, grau neutral).
- **Segment** (`.segment`): 2–4 Optionen, kurze Wörter, aktive Option petrol gefüllt.
- **Chip** (`.chip-schalter`): Ebene an/aus, aktiv petrol gefüllt.
- **Klappabschnitt** (`.karte`): Titel petrol, Zähler rechts, Zeilen mit Haupttext und grauer Unterzeile, Quelle klein darunter.
- **Box** (`.box`) auf Leseseiten: weiße Fläche, Kennung in Versalien, Titel.
- **Detailblatt** (`#blatt`): Titel, Schließen-Knopf `button.zu`, Fakten als `dl.fakten`.

Klassennamen von Zuständen (`an`, `zu`, `aktiv`, `leer`) nie allein als Selektor stylen, immer mit Element oder Baustein (`button.zu`, `.karte.zu`).

## Gestaltung

- Farben nur aus den Tokens in `style.css` (`--petrol`, `--hamm-gruen`, `--gelb`, `--rot`, `--blau`, Flächen und Linien). Keine Verläufe, keine Glas-Effekte, keine runden Ecken, keine Emojis.
- Schriften: Poppins für Titel und große Zahlen, Fira Sans für Text, DIN-Ersatz für Bezeichnungen.
- Raster 8 px; Abstände 4, 8, 12, 16, 24 px.
- Zahlen deutsch (`toLocaleString('de-DE')`), Einheiten mit Leerzeichen (`16,9 °C`, `47 km`), Uhrzeit `21:30 Uhr`, Datum `Do., 01.10.`.

## Texte

- Sachlich, kurz, ohne Wertung und ohne Werbesprache. Kein „smart“, „spannend“, „entdecke“, keine Ausrufezeichen.
- Bezeichnungen sagen, was gemessen wird („Stau und zäh“, „Bahn Hamm Hbf“), nicht was es bedeutet.
- Schätzungen heißen so und nennen ihre Grundlage in einem Satz.
- Namen aus Quellen in normaler Schreibung (Pegelonline-Versalien werden umgesetzt). Keine Wiederholungen: was im Überblick steht, kommt nicht noch einmal als Liste oder Legende.
- Quellenangabe klein am Ende jedes Abschnitts.

## Prüfung vor jedem Commit

1. `npx tsc --noEmit -p .`
2. `npm run ui-pruefung` ohne Auffälligkeiten
3. Bilder der geänderten Seiten in `web/.ui-pruefung/` ansehen, Desktop und Handy

# HAM:LIVE

Eine Web-Karte für Hamm (Westfalen), die offene Daten an einer Stelle zusammenführt: Verkehrslage und Staumeldungen, Busse und Züge, Baustellen, Spritpreise, Wetter mit Regenradar und Temperaturen je Stadtbezirk, Pegel und Hochwasser-Szenarien, eine Schätzung des Stromverbrauchs, Zensus 2022 im 100-Meter-Raster, Wahlergebnisse, Einrichtungen und historische Karten seit 1840.

Privates, nicht kommerzielles Projekt. Alle Daten gehören den jeweiligen Anbietern; ihre Lizenzen stehen in der Anwendung unter „Quellen und Lizenzen“ und im Code bei jeder Quelle.

## Aufbau

| Teil | Ort | Technik |
|---|---|---|
| Oberfläche | `web/src/` | TypeScript, Vite, MapLibre GL, kein Framework |
| Server und Schnittstellen | `web/server/` | Node 24 ohne Abhängigkeiten (Proxy mit Zwischenspeicher, Aufzeichnung, Statistik, Kachelspeicher) |
| Datenaufbereitung | `daten/` | Python-Skripte, erzeugen `web/public/daten/` aus offenen Rohdaten |
| Betrieb | `Dockerfile`, `compose.yaml`, `deploy/` | ein Container, Daten als Volumes |

## Starten

Entwicklung:

```bash
cd web
npm install
npm run dev
```

Container:

```bash
docker compose up -d --build
```

Danach http://localhost:5300. Details in `docs/betrieb.md`.

Die Karte braucht erzeugte Daten in `web/public/daten/` (Stadtgrenzen, Fahrplan, Straßen, Zensus …). Die Skripte in `daten/` erzeugen sie aus offenen Rohdaten (OpenStreetMap-Auszug, GTFS Deutschland, Geobasis NRW, Zensus 2022); der Ordner mit den Rohdaten wird über `HAM_ROHDATEN` angegeben.

## Quellen ohne offene Lizenz

Einige Quellen haben keine offene Lizenz (zum Beispiel Nachrichten-Feeds, ein Radio-Livestream, Fahrplan-Echtzeit, Verkehrslage von Verkehr.NRW). Sie sind im Code mit „nur privat“ gekennzeichnet und **standardmäßig abgeschaltet**: Der Server sperrt diese Hosts, die Oberfläche blendet die Bereiche aus. Wer sie für sich privat nutzen möchte, setzt `HAM_PRIVATQUELLEN=an`. Eine öffentlich erreichbare Installation mit diesen Quellen braucht die Erlaubnis der jeweiligen Anbieter.

Für Spritpreise ist ein eigener, kostenloser Schlüssel von Tankerkönig nötig (`HAM_TANKERKOENIG` oder `local/tankerkoenig.json`).

## Lizenz

Code: MIT, siehe `LICENSE`. Die Daten und Inhalte der Anbieter fallen nicht darunter.

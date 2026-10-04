# Betrieb: HAM:LIVE im Container

HAM:LIVE läuft als ein Container mit Node 24 (`node server/start.ts`, keine npm-Abhängigkeiten zur Laufzeit). Er liefert das gebaute Frontend, die erzeugten Daten unter `/daten/` und alle Schnittstellen unter `/api/` aus und schreibt alle 5 Minuten eine Aufzeichnung (Rückblick, Statistik).

## Aufbau

| Teil | Wo | Im Image? |
|---|---|---|
| Frontend (Vite-Build) | `/app/dist` | ja |
| Server und Schnittstellen | `/app/server` (`web/server/`) | ja |
| Erzeugte Daten (`grenzen.geojson`, `fahrplan.json`, `zensus.json` …) | Volume `/data/daten` (nur lesend) | nein |
| Aufzeichnung (NDJSON je Tag) | Volume `/data/aufzeichnung` | nein |
| Private Dateien (`tankerkoenig.json`) und Kachelspeicher (`kacheln/`) | Volume `/data/local` | nein |

Umgebungsvariablen (siehe `web/server/konfig.ts`):

| Variable | Bedeutung |
|---|---|
| `PORT` | Port im Container, Vorgabe 8080 |
| `HAM_DATEN`, `HAM_AUFZEICHNUNG`, `HAM_LOCAL` | Pfade der Volumes |
| `HAM_TANKERKOENIG` | eigener Tankerkönig-Schlüssel (statt `local/tankerkoenig.json`) |
| `HAM_PRIVATQUELLEN` | `an` gibt Quellen ohne offene Lizenz frei (nur private Installationen) |
| `HAM_VORLADEN` | `aus` schaltet das Vorladen historischer Kartenkacheln ab |
| `TZ` | Zeitzone, wichtig für Tagesauswertungen (Europe/Berlin) |

## Lokal bauen und starten

```bash
docker compose up -d --build
```

Danach http://localhost:5300. `compose.yaml` bindet `web/public/daten`, `aufzeichnung/` und `local/` aus dem Repository ein.

## Fertiges Image mit automatischer Aktualisierung

Die Pipeline `.github/workflows/image.yml` baut bei jedem Push auf `main` ein Image, prüft es (`/api/gesund`, Frontend) und schiebt es nach `ghcr.io/<benutzer>/ham-live`. `deploy/compose.yaml` startet dieses Image mit einem eigenen Watchtower, der nur diesen Container aktualisiert:

```bash
HAM_IMAGE=ghcr.io/<benutzer>/ham-live:latest HAM_ORDNER=/srv/ham-live docker compose -f deploy/compose.yaml up -d
```

Der Container läuft als Benutzer `node` (UID 1000); `aufzeichnung/` und `local/` müssen für ihn schreibbar sein.

## Daten erzeugen

Die Skripte in `daten/` erzeugen `web/public/daten/` aus offenen Rohdaten. Den Ordner mit den Rohdaten (OSM-Auszug `osm/hamm_*.osm.pbf`, GTFS `gtfs/`, ALKIS-Gebäudereferenzen `alkis/` …) gibt `HAM_ROHDATEN` an. Danach den Inhalt von `web/public/daten/` in das Daten-Volume kopieren; ein Neustart ist nicht nötig.

## Prüfen

```bash
cd web && HAM_URL=http://localhost:5300/ npm run ui-pruefung
```

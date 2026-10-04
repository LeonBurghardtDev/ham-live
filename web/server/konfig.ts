/**
 * Pfade und Einstellungen des Servers, gleich für Entwicklung (Vite) und Betrieb (server/start.ts, Container).
 * Umgebungsvariablen überschreiben die Vorgaben:
 *   HAM_DATEN         erzeugte Daten (grenzen.geojson, fahrplan.json …), Vorgabe web/public/daten
 *   HAM_AUFZEICHNUNG  NDJSON-Aufzeichnung je Tag, Vorgabe ../aufzeichnung
 *   HAM_LOCAL         private Dateien (tankerkoenig.json) und Kachelspeicher, Vorgabe ../local
 *   HAM_TANKERKOENIG  Tankerkönig-Schlüssel direkt (statt local/tankerkoenig.json)
 *   HAM_VORLADEN      „aus“ schaltet das Vorladen der Kartenkacheln ab
 *   HAM_PRIVATQUELLEN „an“ gibt Quellen ohne offene Lizenz frei (nur für private Installationen; alternativ Datei local/privatquellen-an)
 *   PORT              Port des Betriebsservers (Vorgabe 8080), in der Entwicklung 5300 aus vite.config.ts
 */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

export type Konfig = { daten: string; aufzeichnung: string; local: string; kacheln: string; port: number; vorladen: boolean; privatquellen: boolean }

const web = fileURLToPath(new URL('..', import.meta.url))
const ordner = (p: string) => (p.endsWith('/') || p.endsWith('\\') ? p : p + '/')

export function konfig(port = Number(process.env.PORT) || 8080): Konfig {
  const local = ordner(process.env.HAM_LOCAL ?? join(web, '..', 'local'))
  return {
    daten: ordner(process.env.HAM_DATEN ?? join(web, 'public', 'daten')),
    aufzeichnung: ordner(process.env.HAM_AUFZEICHNUNG ?? join(web, '..', 'aufzeichnung')),
    local,
    kacheln: ordner(join(local, 'kacheln')),
    port,
    vorladen: process.env.HAM_VORLADEN !== 'aus',
    privatquellen: process.env.HAM_PRIVATQUELLEN === 'an' || existsSync(join(local, 'privatquellen-an')),
  }
}

export const KENNUNG = 'HAM-LIVE/0.1 (privat, Hamm in Echtzeit)'

/** Hosts von Quellen ohne offene Lizenz; nur mit privatquellen abrufbar */
export const PRIVAT_HOSTS = [
  'www.lippewelle.de', 'www.wa.de', 'www.presseportal.de', 'www.westfalenfahrplan.de', 'iris.noncd.db.de', 'opensky-network.org',
  'www.verkehr.nrw', 'www.presse-service.de', 'veranstaltungen.hamm.de', 'api.mobidata-bw.de', 'www.aponet.de', 'www.muellmax.de',
  'lsf-kamera.heridns.de', 'i.ytimg.com',
]

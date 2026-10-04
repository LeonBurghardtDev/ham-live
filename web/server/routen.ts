/**
 * Alle Server-Schnittstellen von HAM:LIVE an einer Stelle. Genutzt von vite.config.ts (Entwicklung) und server/start.ts (Betrieb).
 * `hintergrund()` startet Aufzeichnung und Kachel-Vorladen; beides nur einmal je Prozess.
 */
import { konfig, type Konfig } from './konfig.ts'
import { json, type Protokoll, type Route } from './http.ts'
import { proxyHandler } from './proxy.ts'
import { postHandler } from './post.ts'
import { bildHandler } from './bild.ts'
import { tankerkoenig } from './tanken.ts'
import { kachelspeicher } from './kacheln.ts'
import { aufzeichnung } from './aufzeichnung.ts'
import { datenstandHandler } from './datenstand.ts'

export function hamServer(k: Konfig = konfig(), log: Protokoll = console) {
  const tank = tankerkoenig(k)
  const kacheln = kachelspeicher(k, log)
  const auf = aufzeichnung(k, tank.laden, log)
  const gestartet = new Date()
  const routen: Route[] = [
    { pfad: '/api/proxy', handler: proxyHandler(k.privatquellen) },
    { pfad: '/api/post', handler: postHandler(k.privatquellen) },
    { pfad: '/api/bild', handler: bildHandler(k.privatquellen) },
    { pfad: '/api/tanken', handler: tank.handler },
    { pfad: '/api/kachel', handler: kacheln.handler },
    { pfad: '/api/aufzeichnung', handler: auf.rueckblick },
    { pfad: '/api/verkehr-stand', handler: auf.verkehrStand },
    { pfad: '/api/statistik', handler: auf.statistik },
    { pfad: '/api/datenstand', handler: datenstandHandler(k) },
    { pfad: '/api/gesund', handler: (_req, res) => json(res, { ok: true, seit: gestartet.toISOString(), privatquellen: k.privatquellen }) },
  ]
  const hintergrund = () => {
    auf.starten()
    const g = globalThis as { hamLageVorladen?: boolean }
    if (k.vorladen && !g.hamLageVorladen) {
      g.hamLageVorladen = true
      setTimeout(() => void kacheln.vorladen().catch((e) => log.warn('[kacheln] Vorladen abgebrochen: ' + e)), 15000)
    }
  }
  return { routen, hintergrund, konfig: k }
}

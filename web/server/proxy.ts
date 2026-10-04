/**
 * Proxy mit Zwischenspeicher für Quellen ohne CORS (RSS, JSON-Dienste).
 * Nur Hosts aus der Liste, nur GET, Antworten werden je URL für `ttl` Sekunden gehalten; bei Ausfall die letzte Antwort.
 * Aufruf: /api/proxy?ttl=60&u=<URL-kodiert>
 */
import { KENNUNG, PRIVAT_HOSTS } from './konfig.ts'
import { parameter, type Handler } from './http.ts'

export const ERLAUBT = [
  'www.dwd.de', 'opendata.dwd.de', 'maps.dwd.de', 'api.brightsky.dev',
  'warnung.bund.de', 'nina.api.proxy.bund.dev',
  'verkehr.autobahn.de',
  'v6.db.transport.rest', 'v6.vbb.transport.rest',
  'www.pegelonline.wsv.de', 'pegelonline.wsv.de',
  'www.umweltbundesamt.de',
  'opensky-network.org',
  'www.presseportal.de',
  'earth-search.aws.element84.com',
  'nominatim.openstreetmap.org',
  'www.wms.nrw.de', 'www.gis.nrw.de',
  'www.westfalenfahrplan.de', 'luftdaten.umweltbundesamt.de', 'realtime.gtfs.de', 'iris.noncd.db.de', 'www.hochwasserportal.nrw',
  'overpass-api.de',
  'www.lippewelle.de',
  'www.wa.de',
  'data.sensor.community', 'www.verkehr.nrw', 'www.presse-service.de', 'www.hamm.de',
  'veranstaltungen.hamm.de',
  'api.mobidata-bw.de',
  'www.aponet.de',
  'api.energy-charts.info',
  'api.open-meteo.com',
]
/** Obergrenze des Zwischenspeichers, damit der Dauerbetrieb nicht wächst (älteste Einträge fallen heraus) */
const MAX_EINTRAEGE = 600

export function proxyHandler(privatquellen = false): Handler {
  const cache = new Map<string, { t: number; status: number; type: string; body: Buffer }>()
  return async (req, res) => {
    const q = parameter(req)
    const u = q.get('u') ?? ''
    const ttl = Math.max(5, Number(q.get('ttl') ?? 60))
    let host = ''
    try { host = new URL(u).host } catch { /* ungültig */ }
    if (!ERLAUBT.includes(host) || (!privatquellen && PRIVAT_HOSTS.includes(host))) { res.statusCode = 403; res.end('Host nicht erlaubt: ' + host); return }
    const hit = cache.get(u)
    if (hit && Date.now() - hit.t < ttl * 1000) {
      res.statusCode = hit.status; res.setHeader('content-type', hit.type); res.setHeader('x-cache', 'hit'); res.end(hit.body); return
    }
    try {
      const r = await fetch(u, { headers: { 'user-agent': KENNUNG, accept: '*/*' }, signal: AbortSignal.timeout(20000) })
      const body = Buffer.from(await r.arrayBuffer())
      const type = r.headers.get('content-type') ?? 'application/octet-stream'
      if (r.ok) {
        cache.delete(u); cache.set(u, { t: Date.now(), status: r.status, type, body })
        while (cache.size > MAX_EINTRAEGE) cache.delete(cache.keys().next().value as string)
      }
      res.statusCode = r.status; res.setHeader('content-type', type); res.end(body)
    } catch (e) {
      if (hit) { res.statusCode = hit.status; res.setHeader('content-type', hit.type); res.setHeader('x-cache', 'stale'); res.end(hit.body); return }
      res.statusCode = 502; res.end(String(e))
    }
  }
}

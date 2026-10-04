/**
 * POST-Weiterleitung für Formular-Dienste ohne CORS, die kein GET annehmen (Müllmax-Abfuhrkalender der ASH Hamm).
 * Nur Hosts aus POST_ERLAUBT, nur application/x-www-form-urlencoded, kein Zwischenspeicher (Sitzungsdaten im Formular).
 * Aufruf: fetch('/api/post?u=<URL-kodiert>', { method: 'POST', body: URLSearchParams })
 */
import { KENNUNG, PRIVAT_HOSTS } from './konfig.ts'
import { parameter, type Handler } from './http.ts'

const POST_ERLAUBT = ['www.muellmax.de']
const MAX_BYTES = 64 * 1024

export function postHandler(privatquellen = false): Handler {
  return async (req, res) => {
    const u = parameter(req).get('u') ?? ''
    let host = ''
    try { host = new URL(u).host } catch { /* ungültig */ }
    if (req.method !== 'POST' || !POST_ERLAUBT.includes(host) || (!privatquellen && PRIVAT_HOSTS.includes(host))) { res.statusCode = 403; res.end('nicht erlaubt: ' + host); return }
    const teile: Buffer[] = []
    let laenge = 0
    for await (const t of req) { laenge += (t as Buffer).length; if (laenge > MAX_BYTES) { res.statusCode = 413; res.end(); return } teile.push(t as Buffer) }
    try {
      const r = await fetch(u, {
        method: 'POST',
        body: Buffer.concat(teile).toString('utf8'),
        headers: { 'user-agent': KENNUNG, 'content-type': 'application/x-www-form-urlencoded', accept: '*/*' },
        signal: AbortSignal.timeout(20000),
      })
      res.statusCode = r.status
      res.setHeader('content-type', r.headers.get('content-type') ?? 'text/plain')
      res.end(Buffer.from(await r.arrayBuffer()))
    } catch (e) {
      res.statusCode = 502; res.end(String(e))
    }
  }
}

/**
 * Bild-Proxy für die Live-Bilder (Webcams, `src/webcams.ts`): holt ein Standbild, hält es `ttl` Sekunden im Speicher
 * und gibt den Zeitstempel der Quelle weiter. Der Browser liest ihn über fetch() aus den Kopfzeilen
 * `x-stand` (Last-Modified der Quelle, sonst leer) und `x-abruf` (Zeitpunkt des Abrufs beim Proxy, ISO).
 * Nur Hosts aus BILD_ERLAUBT, nur GET, nur image/*, höchstens 2 MB. Bei Ausfall der Quelle kommt das letzte Bild mit
 * `x-cache: stale`, solange es nicht älter als eine Stunde ist.
 * Aufruf: /api/bild?ttl=60&u=<URL-kodiert>
 */
import type { ServerResponse } from 'node:http'
import { KENNUNG, PRIVAT_HOSTS } from './konfig.ts'
import { parameter, type Handler } from './http.ts'

const BILD_ERLAUBT = [
  // webcam.flugplatz-hamm.de fehlt absichtlich: CORS offen, Abruf direkt im Browser (Node scheitert an der Zertifikatskette)
  'lsf-kamera.heridns.de', // Segelfluggelände Kamen-Heeren (LSF 2000 Kamen/Dortmund)
  'i.ytimg.com', // Vorschaubilder laufender YouTube-Livestreams (Storchennest Hamm)
]
const MAX_BYTES = 2 * 1024 * 1024
const MAX_EINTRAEGE = 40

interface Eintrag { t: number; type: string; body: Buffer; stand: string }

export function bildHandler(privatquellen = false): Handler {
  const cache = new Map<string, Eintrag>()
  const senden = (res: ServerResponse, e: Eintrag, art: string, ttl: number) => {
    res.statusCode = 200
    res.setHeader('content-type', e.type)
    res.setHeader('cache-control', `private, max-age=${Math.max(0, Math.round(ttl - (Date.now() - e.t) / 1000))}`)
    res.setHeader('x-stand', e.stand)
    res.setHeader('x-abruf', new Date(e.t).toISOString())
    res.setHeader('x-cache', art)
    res.end(e.body)
  }
  return async (req, res) => {
    const q = parameter(req)
    const u = q.get('u') ?? ''
    const ttl = Math.min(3600, Math.max(10, Number(q.get('ttl')) || 60))
    let host = ''
    try { host = new URL(u).host } catch { /* ungültig */ }
    if (req.method !== 'GET' || !BILD_ERLAUBT.includes(host) || (!privatquellen && PRIVAT_HOSTS.includes(host))) { res.statusCode = 403; res.end('Host nicht erlaubt: ' + host); return }
    const hit = cache.get(u)
    if (hit && Date.now() - hit.t < ttl * 1000) { senden(res, hit, 'hit', ttl); return }
    try {
      const r = await fetch(u, { headers: { 'user-agent': KENNUNG, accept: 'image/*' }, signal: AbortSignal.timeout(15000) })
      const type = r.headers.get('content-type') ?? ''
      const laenge = Number(r.headers.get('content-length') ?? 0)
      if (!r.ok || !type.startsWith('image/') || laenge > MAX_BYTES) throw new Error(`Quelle ${r.status} ${type} ${laenge} B`)
      const body = Buffer.from(await r.arrayBuffer())
      if (body.length > MAX_BYTES || body.length < 200) throw new Error(`Bildgröße ${body.length} B`)
      const lm = r.headers.get('last-modified')
      const e: Eintrag = { t: Date.now(), type, body, stand: lm ? new Date(lm).toISOString() : '' }
      cache.delete(u)
      cache.set(u, e)
      while (cache.size > MAX_EINTRAEGE) cache.delete(cache.keys().next().value as string)
      senden(res, e, 'miss', ttl)
    } catch (err) {
      if (hit && Date.now() - hit.t < 3600_000) { senden(res, hit, 'stale', ttl); return }
      res.statusCode = 502
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.end('Bild nicht verfügbar: ' + String(err) + ((err as { cause?: unknown }).cause ? ' (' + String((err as { cause?: unknown }).cause) + ')' : ''))
    }
  }
}

/**
 * Betriebsserver HAM:LIVE (Container, Heimserver): liefert das gebaute Frontend (dist/), die erzeugten Daten (/daten/)
 * und die Schnittstellen (/api/…) aus. Nur Node-Bordmittel, keine Abhängigkeiten. Start: `node server/start.ts`
 * (Node 24 führt TypeScript direkt aus). Pfade über Umgebungsvariablen, siehe server/konfig.ts.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'
import { hamServer } from './routen.ts'

const DIST = process.env.HAM_DIST ?? fileURLToPath(new URL('../dist/', import.meta.url))
const TYPEN: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.geojson': 'application/geo+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.pbf': 'application/x-protobuf', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
}
const KOMPRIMIEREN = /^(text\/|application\/(json|geo\+json|javascript))|image\/svg/

const log = { info: (s: string) => console.log(new Date().toISOString(), s), warn: (s: string) => console.warn(new Date().toISOString(), s) }
const ham = hamServer(undefined, log)
const k = ham.konfig

/** Datei aus einem Wurzelordner, ohne aus ihm herauszuführen; undefined, wenn es sie nicht gibt */
async function datei(wurzel: string, pfad: string) {
  const p = normalize(join(wurzel, decodeURIComponent(pfad)))
  if (!p.startsWith(normalize(wurzel).replace(/[\\/]$/, '') + sep) && p !== normalize(wurzel)) return undefined
  try { const s = await stat(p); return s.isFile() ? { p, s } : undefined } catch { return undefined }
}

async function senden(req: IncomingMessage, res: ServerResponse, f: { p: string; s: { size: number; mtime: Date } }, cache: string) {
  const typ = TYPEN[extname(f.p).toLowerCase()] ?? 'application/octet-stream'
  const etag = `"${f.s.size.toString(36)}-${f.s.mtime.getTime().toString(36)}"`
  res.setHeader('content-type', typ)
  res.setHeader('cache-control', cache)
  res.setHeader('etag', etag)
  if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return }
  if (KOMPRIMIEREN.test(typ) && f.s.size > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    res.setHeader('content-encoding', 'gzip'); res.setHeader('vary', 'accept-encoding')
    createReadStream(f.p).pipe(createGzip({ level: 6 })).pipe(res)
  } else {
    res.setHeader('content-length', f.s.size)
    createReadStream(f.p).pipe(res)
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  try {
    // Schnittstellen
    const r = ham.routen.find((x) => url.pathname === x.pfad || url.pathname.startsWith(x.pfad + '/'))
    if (r) { await r.handler(req, res); return }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return }
    // erzeugte Daten (Volume), erst danach eine etwaige Kopie im Build
    if (url.pathname.startsWith('/daten/')) {
      const f = await datei(k.daten, url.pathname.slice('/daten/'.length))
      if (f) { await senden(req, res, f, 'public, max-age=300'); return }
    }
    // gebautes Frontend; Dateien unter assets/ tragen einen Inhalts-Hash
    const f = await datei(DIST, url.pathname === '/' ? 'index.html' : url.pathname.slice(1))
    if (f) { await senden(req, res, f, url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'); return }
    res.statusCode = 404; res.end('nicht gefunden')
  } catch (e) {
    log.warn(`[server] ${req.method} ${url.pathname}: ${e}`)
    if (!res.headersSent) { res.statusCode = 500; res.end('Fehler') } else res.destroy()
  }
})

server.listen(k.port, () => {
  log.info(`[server] HAM:LIVE auf Port ${k.port} · Daten ${k.daten} · Aufzeichnung ${k.aufzeichnung} · Lokal ${k.local}`)
  ham.hintergrund()
})
for (const s of ['SIGTERM', 'SIGINT'] as const) process.on(s, () => { log.info('[server] beendet'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref() })

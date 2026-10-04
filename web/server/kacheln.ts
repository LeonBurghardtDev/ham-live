/**
 * Kachelspeicher für unveränderliche Karten (historische Luftbilder, preußische Karten): WMS-Kacheln werden einmal geholt
 * und in local/kacheln/ abgelegt (gitignored). Danach kommen sie sofort von der Platte. Beim Start lädt der Server
 * das Stadtgebiet bis Kartenzoom 15 im Hintergrund vor (fortsetzbar). Stand: /api/kachel?stand
 * Aufruf: /api/kachel?bbox={bbox-epsg-3857}&u=<WMS-URL ohne BBOX, URL-kodiert>
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { KENNUNG, type Konfig } from './konfig.ts'
import { json, parameter, type Handler, type Protokoll } from './http.ts'

const KACHEL_HOSTS = ['www.wms.nrw.de']
const UMFANG = 20037508.342789244 * 2

export function kachelspeicher(k: Konfig, log: Protokoll) {
  const stand = { gesamt: 0, fertig: 0 }
  /** Kachel z/x/y aus der BBOX (EPSG:3857), unabhängig von der Zahlendarstellung des Aufrufers */
  const zxy = (bbox: string) => {
    const [x0, , x1, y1] = bbox.split(',').map(Number)
    const g = x1 - x0, z = Math.round(Math.log2(UMFANG / g))
    return `${z}/${Math.round((x0 + UMFANG / 2) / g)}/${Math.round((UMFANG / 2 - y1) / g)}`
  }
  const datei = (basis: string, kz: string) => k.kacheln + createHash('sha1').update(basis + '|' + kz).digest('hex') + '.bin'
  const holen = async (basis: string, kz: string, bbox: string) => {
    const r = await fetch(`${basis}&BBOX=${bbox}`, { headers: { 'user-agent': KENNUNG }, signal: AbortSignal.timeout(30000) })
    const typ = r.headers.get('content-type') ?? ''
    const b = Buffer.from(await r.arrayBuffer())
    if (r.ok && typ.startsWith('image/')) { await mkdir(k.kacheln, { recursive: true }); await writeFile(datei(basis, kz), b) }
    return { r, typ, b }
  }

  /** Vorladen: alle festen Karten im Stadtgebiet bis Kachelzoom 14 (Kartenzoom 15), zwei Anfragen gleichzeitig, fortsetzbar. */
  const vorladen = async () => {
    const { EBENEN, kachelUrl } = await import('../src/ebenen.ts')
    const grenzen = JSON.parse(await readFile(k.daten + 'grenzen.geojson', 'utf-8').catch(() => '{"features":[]}'))
    const stadt = grenzen.features.find((f: any) => f.properties.ebene === 'stadt')
    if (!stadt) { log.warn('[kacheln] Vorladen übersprungen: grenzen.geojson fehlt'); return }
    const ringe: number[][][] = stadt.geometry.type === 'Polygon' ? [stadt.geometry.coordinates[0]] : stadt.geometry.coordinates.map((p: number[][][]) => p[0])
    const merc = ([lon, lat]: number[]) => [lon * 20037508.342789244 / 180, Math.log(Math.tan((90 + lat) * Math.PI / 360)) * 20037508.342789244 / Math.PI]
    const poly = ringe.map((r) => r.map(merc))
    const innen = (x: number, y: number) => poly.some((r) => { let i = false; for (let a = 0, b = r.length - 1; a < r.length; b = a++) { const [xa, ya] = r[a], [xb, yb] = r[b]; if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) i = !i } return i })
    const alle = poly.flat(), minx = Math.min(...alle.map((p) => p[0])), maxx = Math.max(...alle.map((p) => p[0])), miny = Math.min(...alle.map((p) => p[1])), maxy = Math.max(...alle.map((p) => p[1]))
    const auftraege: { basis: string; k: string; bbox: string }[] = []
    for (const e of EBENEN.filter((x) => x.fest)) {
      const basis = decodeURIComponent(kachelUrl(e).split('&u=')[1])
      for (let z = 10; z <= 14; z++) {
        const g = UMFANG / 2 ** z
        for (let tx = Math.floor((minx + UMFANG / 2) / g); tx <= Math.floor((maxx + UMFANG / 2) / g); tx++) {
          for (let ty = Math.floor((UMFANG / 2 - maxy) / g); ty <= Math.floor((UMFANG / 2 - miny) / g); ty++) {
            const x0 = tx * g - UMFANG / 2, y1 = UMFANG / 2 - ty * g
            let treffer = false
            for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) if (innen(x0 + fx * g, y1 - fy * g)) treffer = true
            if (treffer) auftraege.push({ basis, k: `${z}/${tx}/${ty}`, bbox: `${x0},${y1 - g},${x0 + g},${y1}` })
          }
        }
      }
    }
    let neu = 0, fehler = 0, n = 0
    const offen = [] as typeof auftraege
    for (const a of auftraege) { try { await stat(datei(a.basis, a.k)) } catch { offen.push(a) } }
    stand.gesamt = auftraege.length; stand.fertig = auftraege.length - offen.length
    if (!offen.length) return
    log.info(`[kacheln] Vorladen: ${offen.length} von ${auftraege.length} Kacheln fehlen, lade im Hintergrund`)
    const arbeiter = async () => {
      while (offen.length) {
        const a = offen.shift()!
        try { const { r } = await holen(a.basis, a.k, a.bbox); r.ok ? neu++ : fehler++ } catch { fehler++ }
        stand.fertig++
        if (++n % 500 === 0) log.info(`[kacheln] ${stand.fertig} von ${stand.gesamt}`)
        await new Promise((r) => setTimeout(r, 150))
      }
    }
    await Promise.all([arbeiter(), arbeiter()])
    log.info(`[kacheln] Vorladen fertig: ${neu} neu, ${fehler} Fehler`)
  }

  const handler: Handler = async (req, res) => {
    const q = parameter(req)
    if (q.has('stand')) { json(res, stand); return }
    const bbox = q.get('bbox') ?? '', basis = q.get('u') ?? ''
    let host = ''
    try { host = new URL(basis).host } catch { /* ungültig */ }
    if (!KACHEL_HOSTS.includes(host) || !/^[-\d.,e]+$/.test(bbox)) { res.statusCode = 403; res.end(); return }
    const kz = zxy(bbox)
    try {
      const b = await readFile(datei(basis, kz))
      res.setHeader('content-type', b[0] === 0xff ? 'image/jpeg' : 'image/png'); res.setHeader('cache-control', 'public, max-age=31536000, immutable'); res.setHeader('x-cache', 'platte')
      res.end(b); return
    } catch { /* noch nicht da */ }
    try {
      const { r, typ, b } = await holen(basis, kz, bbox)
      res.statusCode = r.status; res.setHeader('content-type', typ); res.setHeader('cache-control', 'public, max-age=31536000, immutable'); res.end(b)
    } catch (e) { res.statusCode = 502; res.end(String(e)) }
  }
  return { handler, vorladen }
}

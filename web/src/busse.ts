/** Busse nach Sollfahrplan (GTFS Deutschland, gtfs.de, CC BY 4.0): Positionen zwischen den Halten entlang der Buswege
 *  (OSM-Linienrelationen bzw. Wegsuche, daten/buswege.py); ohne bekannten Weg geradlinig.
 *  Echtzeit: Verspätungen aus den Abfahrten großer Haltestellen (Westfalenfahrplan) verschieben die Fahrt zeitlich (verspaetungSetzen). */
import type * as GeoJSON from 'geojson'

type Service = { tage: string; von: string; bis: string; plus: string[]; minus: string[] }
type Fahrplan = { quelle: string; stops: [string, number, number][]; routes: Record<string, string>; services: Record<string, Service>; trips: [string, string, string, number[]][] }

let fp: Fahrplan | null = null
let wege: Record<string, number[]> = {}

export async function fahrplanLaden() {
  if (!fp) {
    const [f, w] = await Promise.all([
      fetch('/daten/fahrplan.json').then((r) => r.json()),
      fetch('/daten/buswege.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ])
    wege = w ?? {}
    fp = f
  }
  return fp!
}

// ---------------------------------------------------------------- Buswege

type Weg = { pts: number[]; cum: number[]; laenge: number }
const wegCache = new Map<string, Weg | null>()

/** Weg zwischen zwei Halten (Stop-Indizes) mit kumulierten Längen, zwischengespeichert; null = geradlinig. */
function wegZwischen(a: number, b: number): Weg | null {
  const k = `${a}-${b}`
  const c = wegCache.get(k)
  if (c !== undefined) return c
  const pts = wege[k]
  let w: Weg | null = null
  if (pts && pts.length >= 4) {
    const cum = [0]
    for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot((pts[i] - pts[i - 2]) * 0.62, pts[i + 1] - pts[i - 1]))
    w = { pts, cum, laenge: cum[cum.length - 1] }
  }
  wegCache.set(k, w)
  return w
}

/** Punkt und Kurs (Grad) bei Anteil f zwischen zwei Halten. */
function lage(a: number, b: number, f: number): { lon: number; lat: number; kurs: number } {
  const s0 = fp!.stops[a], s1 = fp!.stops[b]
  const w = wegZwischen(a, b)
  let x0 = s0[2], y0 = s0[1], x1 = s1[2], y1 = s1[1], g = f
  if (w && w.laenge > 0) {
    const ziel = f * w.laenge
    // binäre Suche im kumulierten Längenfeld
    let lo = 1, hi = w.cum.length - 1
    while (lo < hi) { const m = (lo + hi) >> 1; if (w.cum[m] < ziel) lo = m + 1; else hi = m }
    const i = lo
    const seg = w.cum[i] - w.cum[i - 1]
    g = seg > 0 ? (ziel - w.cum[i - 1]) / seg : 0
    x0 = w.pts[(i - 1) * 2]; y0 = w.pts[(i - 1) * 2 + 1]; x1 = w.pts[i * 2]; y1 = w.pts[i * 2 + 1]
  }
  const lat = y0 + (y1 - y0) * g, lon = x0 + (x1 - x0) * g
  const kurs = (Math.atan2((x1 - x0) * Math.cos((lat * Math.PI) / 180), y1 - y0) * 180) / Math.PI
  return { lon, lat, kurs: (kurs + 360) % 360 }
}

/** Ganze Fahrt als Linie [lon, lat] entlang der Buswege, Lücken geradlinig. */
export function fahrtLinie(trip: number): [number, number][] {
  const t = fp?.trips[trip]
  if (!t) return []
  const seq = t[3]
  const out: [number, number][] = []
  const add = (lon: number, lat: number) => { const l = out[out.length - 1]; if (!l || l[0] !== lon || l[1] !== lat) out.push([lon, lat]) }
  for (let i = 0; i < seq.length; i += 2) {
    const s = fp!.stops[seq[i]]
    if (i + 2 >= seq.length) { add(s[2], s[1]); break }
    const w = wegZwischen(seq[i], seq[i + 2])
    if (w) for (let k = 0; k < w.pts.length; k += 2) add(w.pts[k], w.pts[k + 1])
    else add(s[2], s[1])
  }
  return out
}

const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

function aktiv(s: Service, d: Date): boolean {
  const t = ymd(d)
  if (s.minus.includes(t)) return false
  if (s.plus.includes(t)) return true
  const wt = (d.getDay() + 6) % 7
  return s.tage[wt] === '1' && t >= s.von && t <= s.bis
}

// ---------------------------------------------------------------- Echtzeit

/** Verspätung je Fahrt (Index in fp.trips) in Sekunden, aus der letzten Echtzeitabfrage */
let verspaetung = new Map<number, number>()
export const verspaetungen = () => verspaetung
let nachLinie: Map<string, number[]> | null = null

/** Echtzeit-Abfahrt einer Haltestelle: Linie, Sollzeit, erwartete Zeit, Lage des Steigs */
export type EchtzeitAbfahrt = { linie: string; soll: Date; ist: Date; lat: number; lon: number }

/**
 * Abfahrten den GTFS-Fahrten zuordnen: gleiche Linie, eine Haltestelle der Fahrt höchstens 300 m vom Steig,
 * Sollzeit dort auf ±60 s gleich, Fahrt verkehrt heute. Mehrere Treffer: der nächste Halt gewinnt.
 */
export function verspaetungSetzen(liste: EchtzeitAbfahrt[], d = new Date()) {
  if (!fp) return
  if (!nachLinie) {
    nachLinie = new Map()
    fp.trips.forEach(([route], ti) => { const l = fp!.routes[route] ?? '?'; const a = nachLinie!.get(l); if (a) a.push(ti); else nachLinie!.set(l, [ti]) })
  }
  const neu = new Map<number, { s: number; abstand: number }>()
  const mitternacht = new Date(d); mitternacht.setHours(0, 0, 0, 0)
  const ok = new Map<string, boolean>()
  for (const a of liste) {
    const soll = Math.round((a.soll.getTime() - mitternacht.getTime()) / 1000)
    const versp = Math.round((a.ist.getTime() - a.soll.getTime()) / 1000)
    // Fahrten nach Mitternacht stehen im GTFS mit Zeiten über 24 h am Vortag
    const kandidaten = soll < 4 * 3600 ? [soll, soll + 86400] : [soll]
    let best: { ti: number; abstand: number } | undefined
    for (const ti of nachLinie.get(a.linie) ?? []) {
      const [, , service, seq] = fp.trips[ti]
      for (let i = 0; i < seq.length; i += 2) {
        if (!kandidaten.some((k) => Math.abs(seq[i + 1] - k) <= 60)) continue
        const st = fp.stops[seq[i]]
        const m = Math.hypot((st[2] - a.lon) * 69100, (st[1] - a.lat) * 111200)
        if (m > 300 || (best && m >= best.abstand)) continue
        let akt = ok.get(service)
        if (akt === undefined) { akt = !!fp.services[service] && (aktiv(fp.services[service], d) || aktiv(fp.services[service], new Date(d.getTime() - 86400000))); ok.set(service, akt) }
        if (akt) best = { ti, abstand: m }
      }
    }
    if (best) {
      const alt = neu.get(best.ti)
      // mehrere Messungen einer Fahrt: die mit der kleinsten Abweichung im Ort
      if (!alt || best.abstand < alt.abstand) neu.set(best.ti, { s: Math.max(-120, Math.min(3600, versp)), abstand: best.abstand })
    }
  }
  // letzte bekannte Verspätung behalten, bis die Fahrt (mit Verspätung) zu Ende ist; neue Messungen überschreiben
  const jetzt = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
  const behalten = new Map<number, number>()
  for (const [ti, v] of verspaetung) {
    const seq = fp.trips[ti][3]
    if (jetzt - v <= seq[seq.length - 1] || jetzt + 86400 - v <= seq[seq.length - 1]) behalten.set(ti, v)
  }
  for (const [ti, v] of neu) behalten.set(ti, v.s)
  verspaetung = behalten
  return neu.size
}

export function bussePositionen(d = new Date()): { fc: GeoJSON.FeatureCollection; anzahl: number; linien: Map<string, number> } {
  const feats: GeoJSON.Feature[] = []
  const linien = new Map<string, number>()
  if (!fp) return { fc: { type: 'FeatureCollection', features: feats }, anzahl: 0, linien }
  // Betriebstag: Fahrten nach Mitternacht laufen mit Zeiten > 24 h am Vortag
  for (const [tag, versatz] of [[d, 0], [new Date(d.getTime() - 86400000), 86400]] as const) {
    const sek0 = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + versatz
    const ok = new Map<string, boolean>()
    for (let ti = 0; ti < fp.trips.length; ti++) {
      const [route, ziel, service, seq] = fp.trips[ti]
      // verspätete Fahrt: Position zur Sollzeit „jetzt minus Verspätung“
      const vs = verspaetung.get(ti) ?? 0
      const sek = sek0 - vs
      if (sek < seq[1] || sek > seq[seq.length - 1]) continue
      let a = ok.get(service)
      if (a === undefined) { a = !!fp.services[service] && aktiv(fp.services[service], tag); ok.set(service, a) }
      if (!a) continue
      for (let i = 0; i + 3 < seq.length; i += 2) {
        const t0 = seq[i + 1], t1 = seq[i + 3]
        if (sek < t0 || sek > t1) continue
        const s1 = fp.stops[seq[i + 2]]
        const f = t1 > t0 ? (sek - t0) / (t1 - t0) : 0
        const { lon, lat, kurs } = lage(seq[i], seq[i + 2], f)
        const linie = fp.routes[route] ?? '?'
        linien.set(linie, (linien.get(linie) ?? 0) + 1)
        feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { trip: ti, versatz, linie, ziel, naechster: s1[0], kurs, icon: verspaetung.has(ti) && vs >= 120 ? `bus-${linie}~${Math.round(vs / 60)}` : `bus-${linie}`, versp: verspaetung.has(ti) ? Math.round(vs / 60) : null } })
        break
      }
    }
  }
  return { fc: { type: 'FeatureCollection', features: feats }, anzahl: feats.length, linien }
}

/** Nächste Abfahrten am Halt, der einem Punkt am nächsten liegt. */
export function abfahrten(lat: number, lon: number, d = new Date(), n = 8): { halt: string; liste: { zeit: string; linie: string; ziel: string }[] } {
  if (!fp) return { halt: '', liste: [] }
  let best = -1, bd = Infinity
  fp.stops.forEach(([, la, lo], i) => { const dd = (la - lat) ** 2 + ((lo - lon) * 0.62) ** 2; if (dd < bd) { bd = dd; best = i } })
  const sek = d.getHours() * 3600 + d.getMinutes() * 60
  const name = fp.stops[best][0]
  const treffer: { t: number; linie: string; ziel: string }[] = []
  const ok = new Map<string, boolean>()
  for (const [route, ziel, service, seq] of fp.trips) {
    for (let i = 0; i < seq.length - 2; i += 2) {
      if (fp.stops[seq[i]][0] !== name || seq[i + 1] < sek || seq[i + 1] > sek + 3600) continue
      let a = ok.get(service)
      if (a === undefined) { a = !!fp.services[service] && aktiv(fp.services[service], d); ok.set(service, a) }
      if (a) treffer.push({ t: seq[i + 1], linie: fp.routes[route] ?? '?', ziel })
    }
  }
  treffer.sort((a, b) => a.t - b.t)
  return { halt: name, liste: treffer.slice(0, n).map((x) => ({ zeit: `${String(Math.floor(x.t / 3600) % 24).padStart(2, '0')}:${String(Math.floor((x.t % 3600) / 60)).padStart(2, '0')}`, linie: x.linie, ziel: x.ziel })) }
}

export type Halt = { name: string; lat: number; lon: number; zeit: string; vorbei: boolean }

/** Linie, Ziel und alle Halte einer Fahrt mit Sollzeiten; `versatz` = 86400 für Fahrten vom Vortag. */
export function fahrt(ti: number, versatz = 0, d = new Date()): { linie: string; ziel: string; halte: Halt[] } | null {
  if (!fp || !fp.trips[ti]) return null
  const [route, ziel, , seq] = fp.trips[ti]
  const jetzt = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + versatz
  const halte: Halt[] = []
  for (let i = 0; i < seq.length; i += 2) {
    const st = fp.stops[seq[i]], t = seq[i + 1] - versatz
    halte.push({ name: st[0].replace(/^Hamm, /, ''), lat: st[1], lon: st[2], zeit: `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`, vorbei: seq[i + 1] < jetzt })
  }
  return { linie: fp.routes[route] ?? '?', ziel, halte }
}

/** Alle Halte im Fahrplan (für die Haltestellenebene). */
export function halteGeojson(): GeoJSON.FeatureCollection {
  const seen = new Set<string>()
  const feats: GeoJSON.Feature[] = []
  for (const [name, lat, lon] of fp?.stops ?? []) {
    const k = `${name}|${lat.toFixed(4)}|${lon.toFixed(4)}`
    if (seen.has(k)) continue
    seen.add(k)
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name: name.replace(/^Hamm, /, ''), voll: name } })
  }
  return { type: 'FeatureCollection', features: feats }
}

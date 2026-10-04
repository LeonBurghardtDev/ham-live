/**
 * Züge im Raum Hamm: Sollfahrplan aus GTFS Deutschland (gtfs.de, CC BY 4.0, Regional- und Fernverkehr),
 * Positionen entlang der OSM-Gleise (ODbL, daten/zugfahrplan.py), Verspätungen und Ausfälle aus DB IRIS für Hamm (Westf) Hbf.
 *
 * DB IRIS (iris.noncd.db.de) ist ohne Schlüssel abrufbar, eine Lizenz ist aber nicht veröffentlicht: nur privat nutzen,
 * vor einer Veröffentlichung abschalten (IRIS_AN = false).
 *
 * Verspätung: IRIS kennt nur den Halt Hamm Hbf. Die dort gemessene Verspätung gilt für die ganze Fahrt (vereinfacht).
 */
import { privat } from './privat'
import type maplibregl from 'maplibre-gl'
import type * as GeoJSON from 'geojson'
import { BBOX, hole, type Zeile } from './live'

export const IRIS_AN = true
const EVA_HAMM = '8000149'

type Service = { tage: string; von: string; bis: string; plus: string[]; minus: string[] }
/** trips: [route, ziel, service, [halt, an, ab, halt, an, ab, …], hbfPos] */
type Zugplan = {
  quelle: string
  stops: [string, number, number][]
  routes: Record<string, string>
  services: Record<string, Service>
  trips: [string, string, string, number[], number][]
  wege: Record<string, number[]>
}
type Echt = { verspaetung: number; ausfall: boolean; nummer: string; gleis: string; echtzeit: boolean }

let zp: Zugplan | null = null
/** Echtzeit je Fahrt und Betriebstag: Schlüssel `${trip}|${JJJJMMTT}` */
const echt = new Map<string, Echt>()
let irisStand: Date | null = null
let irisFehler = ''

const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
const hhmm = (t: number) => `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function aktiv(s: Service | undefined, d: Date): boolean {
  if (!s) return false
  const t = ymd(d)
  if (s.minus.includes(t)) return false
  if (s.plus.includes(t)) return true
  return s.tage[(d.getDay() + 6) % 7] === '1' && t >= s.von && t <= s.bis
}

// ---------------------------------------------------------------- Gleiswege

type Weg = { pts: number[]; cum: number[]; laenge: number }
const wegCache = new Map<string, Weg | null>()

function wegZwischen(a: number, b: number): Weg | null {
  const k = `${a}-${b}`
  if (wegCache.has(k)) return wegCache.get(k)!
  let pts = zp!.wege[k]
  if (!pts && zp!.wege[`${b}-${a}`]) {
    const r = zp!.wege[`${b}-${a}`]
    pts = []
    for (let i = r.length - 2; i >= 0; i -= 2) pts.push(r[i], r[i + 1])
  }
  let w: Weg | null = null
  if (pts) {
    const cum = [0]
    for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot((pts[i] - pts[i - 2]) * 0.62, pts[i + 1] - pts[i - 1]))
    w = { pts, cum, laenge: cum[cum.length - 1] }
  }
  wegCache.set(k, w)
  return w
}

/** Punkt und Kurs (Grad) bei Anteil f zwischen zwei Halten, entlang der Gleise oder als Luftlinie. */
function lage(a: number, b: number, f: number): { lon: number; lat: number; kurs: number } {
  const s0 = zp!.stops[a], s1 = zp!.stops[b]
  const w = wegZwischen(a, b)
  let x0 = s0[2], y0 = s0[1], x1 = s1[2], y1 = s1[1], g = f
  if (w && w.laenge > 0) {
    const ziel = f * w.laenge
    let i = 1
    while (i < w.cum.length - 1 && w.cum[i] < ziel) i++
    const seg = w.cum[i] - w.cum[i - 1]
    g = seg > 0 ? (ziel - w.cum[i - 1]) / seg : 0
    x0 = w.pts[(i - 1) * 2]; y0 = w.pts[(i - 1) * 2 + 1]; x1 = w.pts[i * 2]; y1 = w.pts[i * 2 + 1]
  }
  const lat = y0 + (y1 - y0) * g, lon = x0 + (x1 - x0) * g
  const kurs = (Math.atan2((x1 - x0) * Math.cos((lat * Math.PI) / 180), y1 - y0) * 180) / Math.PI
  return { lon, lat, kurs: (kurs + 360) % 360 }
}

// ---------------------------------------------------------------- Laden

export async function zugplanLaden() {
  if (!zp) zp = await (await fetch('/daten/zuege.json')).json()
  return zp!
}

const linie = (ti: number) => zp!.routes[zp!.trips[ti][0]] ?? '?'
/** Kurzform für die Plakette: „ICE 10“ → „ICE“, „FLX30“ bleibt. */
const kurz = (l: string) => (/^(ICE|IC|EC|EN|NJ|TGV|RJ)\b/.test(l) ? l.split(' ')[0] : l.replace(/\s+/g, ''))

const inRaum = (lon: number, lat: number, rand = 0) => lon >= BBOX.w - rand && lon <= BBOX.e + rand && lat >= BBOX.s - rand && lat <= BBOX.n + rand

// ---------------------------------------------------------------- Echtzeit (DB IRIS)

type IrisHalt = { id: string; kat: string; nummer: string; linie: string; an?: string; ab?: string; gleis: string }

/** IRIS-Zeit JJMMTThhmm in Datum */
const irisZeit = (t: string) => new Date(2000 + Number(t.slice(0, 2)), Number(t.slice(2, 4)) - 1, Number(t.slice(4, 6)), Number(t.slice(6, 8)), Number(t.slice(8, 10)))

async function irisLaden() {
  if (!IRIS_AN || !privat.an || !zp) return
  const jetzt = new Date()
  const plan = new Map<string, IrisHalt>()
  const stunden = [-1, 0, 1].map((h) => new Date(jetzt.getTime() + h * 3600000))
  const xmls = await Promise.all(stunden.map((d) => {
    const tag = ymd(d).slice(2), hh = String(d.getHours()).padStart(2, '0')
    return hole(`https://iris.noncd.db.de/iris-tts/timetable/plan/${EVA_HAMM}/${tag}/${hh}`, 1800, 'text').catch(() => '')
  }))
  for (const x of xmls) {
    if (!x) continue
    const doc = new DOMParser().parseFromString(x, 'text/xml')
    for (const s of doc.querySelectorAll('s')) {
      const tl = s.querySelector('tl'), ar = s.querySelector('ar'), dp = s.querySelector('dp')
      plan.set(s.getAttribute('id')!, {
        id: s.getAttribute('id')!, kat: tl?.getAttribute('c') ?? '', nummer: tl?.getAttribute('n') ?? '',
        linie: dp?.getAttribute('l') ?? ar?.getAttribute('l') ?? '', an: ar?.getAttribute('pt') ?? undefined, ab: dp?.getAttribute('pt') ?? undefined,
        gleis: dp?.getAttribute('pp') ?? ar?.getAttribute('pp') ?? '',
      })
    }
  }
  const fx = await hole(`https://iris.noncd.db.de/iris-tts/timetable/fchg/${EVA_HAMM}`, 30, 'text')
  const aend = new Map<string, { ct?: string; ausfall: boolean; gleis?: string }>()
  for (const s of new DOMParser().parseFromString(fx, 'text/xml').querySelectorAll('s')) {
    const ar = s.querySelector(':scope > ar'), dp = s.querySelector(':scope > dp')
    const ausfall = ar?.getAttribute('cs') === 'c' || dp?.getAttribute('cs') === 'c'
    aend.set(s.getAttribute('id')!, { ct: dp?.getAttribute('ct') ?? ar?.getAttribute('ct') ?? undefined, ausfall, gleis: dp?.getAttribute('cp') ?? ar?.getAttribute('cp') ?? undefined })
  }
  // Index: Fahrten nach Sollzeit (Minute des Tages) am Hbf
  const nachMinute = new Map<number, number[]>()
  zp.trips.forEach((t, ti) => {
    if (t[4] < 0) return
    for (const z of [t[3][t[4] * 3 + 1], t[3][t[4] * 3 + 2]]) {
      const m = Math.round(z / 60)
      if (!nachMinute.has(m)) nachMinute.set(m, [])
      if (!nachMinute.get(m)!.includes(ti)) nachMinute.get(m)!.push(ti)
    }
  })
  echt.clear()
  for (const p of plan.values()) {
    const pt = p.ab ?? p.an
    if (!pt) continue
    const d = irisZeit(pt)
    const tagHeute = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const tagVor = new Date(tagHeute.getTime() - 86400000)
    const minHeute = d.getHours() * 60 + d.getMinutes()
    let treffer: { ti: number; tag: Date } | null = null
    for (const [tag, min] of [[tagHeute, minHeute], [tagVor, minHeute + 1440]] as const) {
      for (const ti of nachMinute.get(min) ?? []) {
        const t = zp.trips[ti]
        if (!aktiv(zp.services[t[2]], tag)) continue
        const l = linie(ti).replace(/\s+/g, '')
        const passt = (!!p.linie && (l === p.linie || l === p.kat + p.linie)) || (!!p.kat && l.startsWith(p.kat))
        if (passt) { treffer = { ti, tag }; break }
      }
      if (treffer) break
    }
    if (!treffer) continue
    const a = aend.get(p.id)
    const verspaetung = a?.ct ? Math.round((irisZeit(a.ct).getTime() - d.getTime()) / 1000) : 0
    echt.set(`${treffer.ti}|${ymd(treffer.tag)}`, {
      verspaetung: Math.max(-120, verspaetung), ausfall: !!a?.ausfall, nummer: `${p.kat} ${p.nummer}`.trim(),
      gleis: a?.gleis ?? p.gleis, echtzeit: !!a,
    })
  }
  irisStand = new Date()
  irisFehler = ''
}

// ---------------------------------------------------------------- Positionen

export type Zuginfo = { ti: number; versatz: number; linie: string; ziel: string; verspaetung: number; nummer: string; lon: number; lat: number }

export function zuegePositionen(d = new Date()) {
  const feats: GeoJSON.Feature[] = []
  const liste: Zuginfo[] = []
  const ausfaelle: { ti: number; linie: string; ziel: string; nummer: string; zeit: string }[] = []
  if (!zp) return { fc: { type: 'FeatureCollection', features: feats } as GeoJSON.FeatureCollection, liste, ausfaelle }
  for (const [tag, versatz] of [[d, 0], [new Date(d.getTime() - 86400000), 86400]] as const) {
    const tagKey = ymd(tag)
    const jetzt = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + versatz
    const ok = new Map<string, boolean>()
    for (let ti = 0; ti < zp.trips.length; ti++) {
      const [, ziel, service, seq, hbf] = zp.trips[ti]
      const e = echt.get(`${ti}|${tagKey}`)
      const v = e?.verspaetung ?? 0
      const sek = jetzt - v
      if (sek < seq[1] - 600 || sek > seq[seq.length - 1]) continue
      let a = ok.get(service)
      if (a === undefined) { a = aktiv(zp.services[service], tag); ok.set(service, a) }
      if (!a) continue
      if (e?.ausfall) {
        if (hbf >= 0 && Math.abs(seq[hbf * 3 + 2] - jetzt) < 3600) ausfaelle.push({ ti, linie: linie(ti), ziel, nummer: e.nummer, zeit: hhmm(seq[hbf * 3 + 2] - versatz) })
        continue
      }
      let pos: { lon: number; lat: number; kurs: number } | null = null
      for (let i = 0; i < seq.length; i += 3) {
        const an = seq[i + 1], ab = seq[i + 2]
        if (sek >= an && sek <= ab) { // steht am Halt
          const nb = i + 3 < seq.length ? seq[i + 3] : seq[i - 3]
          const l = lage(seq[i], nb, 0)
          pos = { ...l, kurs: i + 3 < seq.length ? l.kurs : (l.kurs + 180) % 360 }
          break
        }
        if (i + 3 < seq.length && sek > ab && sek < seq[i + 4]) {
          pos = lage(seq[i], seq[i + 3], (sek - ab) / (seq[i + 4] - ab))
          break
        }
      }
      if (!pos || !inRaum(pos.lon, pos.lat, 0.08)) continue
      const l = linie(ti)
      const vm = Math.round(v / 60)
      liste.push({ ti, versatz, linie: l, ziel, verspaetung: vm, nummer: e?.nummer ?? '', lon: pos.lon, lat: pos.lat })
      feats.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] },
        properties: { trip: ti, versatz, linie: l, ziel, kurs: pos.kurs, icon: `zug-${kurz(l)}${vm > 0 ? '~' + vm : ''}` },
      })
    }
  }
  return { fc: { type: 'FeatureCollection', features: feats } as GeoJSON.FeatureCollection, liste, ausfaelle }
}

// ---------------------------------------------------------------- Zuglauf

export type Zughalt = { name: string; lat: number; lon: number; an: string; ab: string; istAn: string; istAb: string; vorbei: boolean; hbf: boolean }

export function zuglauf(ti: number, versatz = 0, d = new Date()) {
  if (!zp || !zp.trips[ti]) return null
  const [, ziel, , seq, hbf] = zp.trips[ti]
  const tag = new Date(d.getTime() - versatz * 1000)
  const e = echt.get(`${ti}|${ymd(tag)}`)
  const v = e?.verspaetung ?? 0
  const jetzt = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + versatz
  const halte: Zughalt[] = []
  for (let i = 0; i < seq.length; i += 3) {
    const st = zp.stops[seq[i]], an = seq[i + 1] - versatz, ab = seq[i + 2] - versatz
    halte.push({
      name: st[0], lat: st[1], lon: st[2], an: hhmm(an), ab: hhmm(ab), istAn: hhmm(an + Math.max(0, v)), istAb: hhmm(ab + Math.max(0, v)),
      vorbei: seq[i + 2] + v < jetzt, hbf: i / 3 === hbf,
    })
  }
  return { linie: linie(ti), ziel, halte, echt: e ?? null, versatz }
}

// ---------------------------------------------------------------- Karte

type Helfer = {
  karteRendern: (id: string, zeilen: Zeile[], zaehler: string, lizenz: string) => void
  blatt: (titel: string, html: string, farbe?: string) => HTMLElement
  sichtbar: () => void
}
let map: maplibregl.Map
let helfer: Helfer
const LIZENZ = 'GTFS Deutschland, gtfs.de (CC BY 4.0); Gleise © OpenStreetMap (ODbL); Echtzeit DB IRIS (nur privat)'

export const ZUG_EBENEN = ['zug-keil', 'zug-plakette']

export async function zuegeStarten(m: maplibregl.Map, h: Helfer) {
  map = m; helfer = h
  await zugplanLaden()
  map.addSource('live-zuege', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addSource('zug-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: 'zug-route-linie', type: 'line', source: 'zug-route', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#c4271b', 'line-width': 5, 'line-opacity': 0.85 } }, 'anker-live')
  map.addLayer({ id: 'zug-route-halte', type: 'circle', source: 'zug-route', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': ['case', ['get', 'naechster'], 7, 4.5], 'circle-color': ['case', ['get', 'vorbei'], '#e3c3c0', '#ffffff'], 'circle-stroke-color': '#c4271b', 'circle-stroke-width': 2.5 } }, 'anker-live')
  map.addLayer({ id: 'zug-keil', type: 'symbol', source: 'live-zuege', layout: { 'icon-image': 'keil-zug', 'icon-rotate': ['get', 'kurs'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 1], visibility: 'none' } })
  map.addLayer({ id: 'zug-plakette', type: 'symbol', source: 'live-zuege', layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 16, 1], visibility: 'none' } })
  h.sichtbar()
  // Zuglauf ausblenden, wenn das Seitenblatt geschlossen oder durch etwas anderes ersetzt wird
  const blattEl = document.getElementById('blatt')
  if (blattEl) new MutationObserver(() => { if (blattEl.hidden || !blattEl.querySelector('.zuglauf')) routeLeeren() }).observe(blattEl, { attributes: true, childList: true })

  const zeichnen = () => {
    const { fc, liste, ausfaelle } = zuegePositionen()
    ;(map.getSource('live-zuege') as maplibregl.GeoJSONSource).setData(fc)
    const imRaum = liste.filter((z) => inRaum(z.lon, z.lat))
    const versp = imRaum.filter((z) => z.verspaetung >= 3).sort((a, b) => b.verspaetung - a.verspaetung)
    const zeilen: Zeile[] = [{
      text: `${imRaum.length} Züge im Raum Hamm, ${versp.length} verspätet`,
      klein: IRIS_AN ? (irisStand ? `Echtzeit Hamm Hbf ${irisStand.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : irisFehler ? `Echtzeit nicht erreichbar: ${irisFehler}` : 'Echtzeit wird geladen …') : 'Nur Sollfahrplan',
    }]
    for (const a of ausfaelle) zeilen.push({ text: `${a.nummer || a.linie} → ${a.ziel}: fällt aus`, klein: `Hamm Hbf ${a.zeit} Uhr`, stufe: 'alarm' })
    for (const z of versp) zeilen.push({ text: `${z.linie} → ${z.ziel} +${z.verspaetung} min`, klein: z.nummer ? `Zug ${z.nummer}` : undefined, stufe: z.verspaetung >= 10 ? 'warnung' : 'info', lon: z.lon, lat: z.lat })
    h.karteRendern('zuege', zeilen, String(imRaum.length), LIZENZ)
  }
  const iris = () => irisLaden().catch((e) => { irisFehler = String(e).slice(0, 80) }).finally(zeichnen)
  zeichnen()
  void iris()
  setInterval(zeichnen, 3000)
  setInterval(() => void iris(), 60000)
}

function routeLeeren() {
  ;(map?.getSource('zug-route') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] })
}

/** Klick auf einen Zug: Zuglauf mit Soll- und Ist-Zeiten im Seitenblatt, Weg auf der Karte. */
export function zugZeigen(ti: number, versatz: number) {
  const f = zuglauf(ti, versatz)
  if (!f) return
  const naechster = f.halte.findIndex((h) => !h.vorbei)
  // Linie entlang der Gleise, soweit bekannt
  const seq = zp!.trips[ti][3]
  const coords: [number, number][] = []
  for (let i = 0; i + 3 < seq.length; i += 3) {
    const w = wegZwischen(seq[i], seq[i + 3])
    if (w) for (let k = 0; k < w.pts.length; k += 2) coords.push([w.pts[k], w.pts[k + 1]])
    else coords.push([zp!.stops[seq[i]][2], zp!.stops[seq[i]][1]], [zp!.stops[seq[i + 3]][2], zp!.stops[seq[i + 3]][1]])
  }
  const punkte = f.halte.map((h, i): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [h.lon, h.lat] }, properties: { name: h.name, vorbei: h.vorbei, naechster: i === naechster } }))
  const e = f.echt
  const v = e ? Math.round(e.verspaetung / 60) : 0
  const status = !IRIS_AN ? 'Nur Sollfahrplan.'
    : !e ? 'Keine Echtzeit für diese Fahrt (IRIS kennt nur Züge über Hamm Hbf in den nächsten Stunden).'
    : e.ausfall ? 'Fällt in Hamm Hbf aus.'
    : !e.echtzeit ? 'Keine Abweichung gemeldet.'
    : v > 0 ? `${v} min verspätet (gemessen in Hamm Hbf, für die übrigen Halte geschätzt).` : 'Pünktlich.'
  const zeit = (soll: string, ist: string) => (e && !e.ausfall && ist !== soll ? `${soll}<br><b class="ist">${ist}</b>` : soll)
  const inhalt = helfer.blatt(`<span class="liniennr zug">${esc(f.linie)}</span><span>${esc(f.ziel)}</span>`, `
    <div class="zuglauf">
    <dl class="fakten">
      ${e?.nummer ? `<dt>Zug</dt><dd>${esc(e.nummer)}</dd>` : ''}
      ${e?.gleis ? `<dt>Gleis Hamm Hbf</dt><dd>${esc(e.gleis)}</dd>` : ''}
      <dt>Stand</dt><dd class="${e?.ausfall ? 'alarm' : v >= 5 ? 'warnung' : ''}">${esc(status)}</dd>
    </dl>
    <p class="hinweis">Sollzeiten nach GTFS, Ist-Zeiten aus DB IRIS. Die Linie folgt den OSM-Gleisen, wo bekannt.</p>
    <ol class="halte zughalte">${f.halte.map((h, i) => `<li class="${h.vorbei ? 'vorbei' : ''}${i === naechster ? ' naechster' : ''}${h.hbf ? ' hbf' : ''}" data-i="${i}"><time>${i === f.halte.length - 1 ? zeit(h.an, h.istAn) : zeit(h.ab, h.istAb)}</time><span>${esc(h.name)}</span></li>`).join('')}</ol>
    </div>`, 'rot')
  ;(map.getSource('zug-route') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }, ...punkte] })
  inhalt.querySelectorAll<HTMLLIElement>('.halte li').forEach((li) => li.addEventListener('click', () => { const h = f.halte[Number(li.dataset.i)]; map.flyTo({ center: [h.lon, h.lat], zoom: 15 }) }))
  inhalt.querySelector('.naechster')?.scrollIntoView({ block: 'center' })
}

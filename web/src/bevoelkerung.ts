import type maplibregl from 'maplibre-gl'
import type * as GeoJSON from 'geojson'
import type { ExpressionSpecification } from 'maplibre-gl'
import './bevoelkerung.css'
/**
 * Seite „Bevölkerung“: Zensus 2022 im 100-m- und 1-km-Gitter für Hamm, Kennzahlen je Stadtbezirk.
 * Daten aus public/daten/zensus.json (erzeugt von daten/zensus.py), Quelle Statistische Ämter des Bundes und der Länder,
 * dl-de/by-2-0. Dazu amtliche Gemeindewerte (Regionaltabellen) und die Stadtstatistik 2001–2017 (Strukturatlas, nur privat).
 *
 * Zell-IDs: „<N/100>_<E/100>“ (100 m) bzw. „<N/1000>_<E/1000>“ (1 km), Südwest-Ecke in EPSG:3035. Die Umrechnung
 * nach WGS84 geschieht mit der quadratischen Näherung aus zensus.json (`geo`, Fehler unter 0,1 m).
 * Unterhalb Zoom 12 zeigt die Karte die 1-km-Zellen; Anzahlen dort je Hektar (÷ 100), damit die Klassen zu den
 * 100-m-Zellen passen. Merkmale, die es nur im 1-km-Gitter gibt, erscheinen auf allen Zoomstufen in 1-km-Zellen.
 */

export interface Merkmal { id: string; name: string; einheit: string; gitter: '100m' | '1km'; gruppe: string; beschreibung: string; art?: 'anzahl' }
interface Abschnitt { id: string; titel: string; basis: number | null; zeilen: [string, number | null][] }
interface Stadtstatistik {
  quelle: string; lizenz: string; stand: string; jahre: number[]
  kennzahlen: { id: string; name: string; einheit: string; stand: string }[]
  bezirke: { name: string; einwohner: number[]; werte: (number | null)[] }[]
  hamm: { einwohner: number[]; werte: (number | null)[] }
}
interface Geo { e0: number; n0: number; lon0: number; lat0: number; lon: number[]; lat: number[]; u: number[]; v: number[] }
export interface Zensus {
  quelle: string; lizenz: string; stichtag: string; stand: string; hinweis: string
  merkmale: Merkmal[]
  geo: Geo
  hamm: (number | null)[]
  hamm_amtlich: (number | null)[] | null
  amtlich: { quelle: string; lizenz: string; hinweis: string; kennzahlen: Record<string, number | null>; abschnitte: Abschnitt[] } | null
  bezirke: { name: string; zellen: number; werte: (number | null)[] }[]
  zellen: Record<string, (number | null)[]>
  zellen1km: Record<string, (number | null)[]>
  stadtstatistik: Stadtstatistik | null
}

export const BV_STANDARD = 'einwohner'
export const BV_GRUPPEN = ['Bevölkerung', 'Haushalte', 'Wohnen', 'Gebäude'] as const
/** Ebenen dieser Seite, z. B. für queryRenderedFeatures beim Klick. */
export const BV_EBENEN = ['bv-1km-flaeche', 'bv-100m-flaeche'] as const
export const BV_LIZENZ = 'Zensus 2022, © Statistische Ämter des Bundes und der Länder, Datenlizenz Deutschland – Namensnennung – Version 2.0'
/** Nüchterne Stufen von hellem Hamm-Grün zu Petrol (5 Klassen). */
export const BV_FARBEN = ['#eef3d8', '#c6dc8c', '#7fae4f', '#2e7d6b', '#005468']

let daten: Zensus | undefined
let laden: Promise<void> | undefined
let aktuell = BV_STANDARD
let sichtbar = true
const offen = new Set<string>()

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Lädt zensus.json einmal. */
export function bevoelkerungLaden(): Promise<void> {
  laden ??= fetch(`${import.meta.env.BASE_URL}daten/zensus.json`)
    .then((r) => { if (!r.ok) throw new Error(`zensus.json: HTTP ${r.status}`); return r.json() })
    .then((d: Zensus) => { daten = d })
    .catch((e) => { laden = undefined; throw e })
  return laden
}

export const bevoelkerungDaten = () => daten

// ---------------------------------------------------------------- Hilfen
const idx = (id: string) => daten?.merkmale.findIndex((m) => m.id === id) ?? -1
const merkmal = (id: string) => daten?.merkmale.find((m) => m.id === id)
const wahlMerkmal = (id: string) => merkmal(id) ?? merkmal(BV_STANDARD)!

function stellen(m: Merkmal) {
  if (m.art === 'anzahl') return 0
  return m.einheit === '€/m²' || m.einheit === 'Personen' ? 2 : 1
}
function zahl(v: number | null | undefined, m: Merkmal, mitEinheit = true) {
  if (v == null || !Number.isFinite(v)) return '–'
  const s = stellen(m)
  const t = v.toLocaleString('de-DE', { minimumFractionDigits: s, maximumFractionDigits: s })
  return mitEinheit && m.einheit ? `${t} ${m.einheit}` : t
}
/** Wert für Hamm: amtlich, wenn es ihn in gleicher Abgrenzung gibt, sonst aus den Zellen. */
function hammWert(i: number) {
  const a = daten?.hamm_amtlich?.[i]
  return a ?? daten?.hamm[i] ?? null
}

function poly(c: number[], x: number, y: number) { return c[0] + c[1] * x + c[2] * y + c[3] * x * x + c[4] * x * y + c[5] * y * y }
function nachWgs(e: number, n: number): [number, number] {
  const g = daten!.geo
  const u = (e - g.e0) / 1000, v = (n - g.n0) / 1000
  return [Math.round(poly(g.lon, u, v) * 1e6) / 1e6, Math.round(poly(g.lat, u, v) * 1e6) / 1e6]
}
function nachLaea(lon: number, lat: number): [number, number] {
  const g = daten!.geo
  const p = lon - g.lon0, q = lat - g.lat0
  return [g.e0 + poly(g.u, p, q) * 1000, g.n0 + poly(g.v, p, q) * 1000]
}

/** Wert einer Zelle für die Karte (1-km-Anzahlen je Hektar). */
function zellwert(werte: (number | null)[], i: number, m: Merkmal, km: boolean) {
  const v = werte[i]
  if (v == null) return null
  return km && m.art === 'anzahl' ? v / 100 : v
}

function zellenGeojson(km: boolean): GeoJSON.FeatureCollection {
  const d = daten!
  const s = km ? 1000 : 100
  const quelle = km ? d.zellen1km : d.zellen
  const features: GeoJSON.Feature[] = []
  for (const [id, werte] of Object.entries(quelle)) {
    const [n, e] = id.split('_').map((x) => Number(x) * s)
    const ring = [nachWgs(e, n), nachWgs(e + s, n), nachWgs(e + s, n + s), nachWgs(e, n + s)]
    ring.push(ring[0])
    const props: Record<string, number | string> = { id }
    d.merkmale.forEach((m, i) => { const v = zellwert(werte, i, m, km); if (v != null) props[`m:${m.id}`] = v })
    features.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } })
  }
  return { type: 'FeatureCollection', features }
}

/** Klassengrenzen nach Quantilen (bis zu 5 Klassen), gerundet auf die Stellen des Merkmals. */
export function bevoelkerungKlassen(id: string): number[] {
  const d = daten
  const m = merkmal(id)
  if (!d || !m) return []
  const i = idx(id)
  const km = m.gitter === '1km'
  const werte = Object.values(km ? d.zellen1km : d.zellen).map((w) => zellwert(w, i, m, km)).filter((v): v is number => v != null).sort((a, b) => a - b)
  if (!werte.length) return []
  const f = 10 ** stellen(m)
  const quantil = (xs: number[], q: number) => Math.round(xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] * f) / f
  const grenzen: number[] = []
  const dazu = (g: number) => { if (g > werte[0] && !grenzen.includes(g)) grenzen.push(g) }
  // Viele Nullen (Geheimhaltung, kleine Zellen): eigene Klasse „0“, die übrigen nach Quartilen der Werte über 0
  const nullen = werte.filter((v) => v === 0).length
  if (werte[0] === 0 && nullen > 0.2 * werte.length && nullen < werte.length) {
    const pos = werte.slice(nullen)
    grenzen.push(1 / f)
    for (const q of [0.25, 0.5, 0.75]) dazu(quantil(pos, q))
  } else {
    for (const q of [0.2, 0.4, 0.6, 0.8]) dazu(quantil(werte, q))
  }
  return grenzen
}

function farben(n: number) {
  // n Grenzen → n + 1 Klassen, gleichmäßig aus der Skala gewählt
  if (n + 1 >= BV_FARBEN.length) return BV_FARBEN
  return Array.from({ length: n + 1 }, (_, k) => BV_FARBEN[Math.round((k * (BV_FARBEN.length - 1)) / Math.max(1, n))])
}

function farbausdruck(id: string): ExpressionSpecification {
  const g = bevoelkerungKlassen(id)
  const f = farben(g.length)
  const key = `m:${id}`
  const stufe: unknown[] = ['step', ['get', key], f[0]]
  g.forEach((x, k) => stufe.push(x, f[k + 1]))
  return ['case', ['has', key], stufe as ExpressionSpecification, 'rgba(0,0,0,0)'] as ExpressionSpecification
}

function anwenden(map: maplibregl.Map) {
  if (!map.getLayer('bv-100m-flaeche')) return
  const m = wahlMerkmal(aktuell)
  const nurKm = m.gitter === '1km'
  const farbe = farbausdruck(m.id)
  map.setPaintProperty('bv-100m-flaeche', 'fill-color', farbe)
  map.setPaintProperty('bv-1km-flaeche', 'fill-color', farbe)
  map.setLayoutProperty('bv-100m-flaeche', 'visibility', sichtbar && !nurKm ? 'visible' : 'none')
  map.setLayoutProperty('bv-1km-flaeche', 'visibility', sichtbar ? 'visible' : 'none')
  map.setLayoutProperty('bv-1km-rand', 'visibility', sichtbar ? 'visible' : 'none')
  map.setLayerZoomRange('bv-1km-flaeche', 0, nurKm ? 24 : 12)
  map.setLayerZoomRange('bv-1km-rand', nurKm ? 0 : 9, nurKm ? 24 : 12)
}

/** Legt Quellen und Ebenen an (beim ersten Aufruf) und färbt die Zellen nach dem Merkmal. */
export function bevoelkerungKarte(map: maplibregl.Map, merkmalId: string): void {
  aktuell = merkmalId
  if (!daten) { void bevoelkerungLaden().then(() => bevoelkerungKarte(map, aktuell)).catch((e) => console.warn('Zensus', e)); return }
  if (!map.getSource('bv-100m')) {
    if (!map.isStyleLoaded()) { map.once('idle', () => bevoelkerungKarte(map, aktuell)); return }
    const vor = map.getLayer('anker-live') ? 'anker-live' : undefined
    map.addSource('bv-100m', { type: 'geojson', data: zellenGeojson(false) })
    map.addSource('bv-1km', { type: 'geojson', data: zellenGeojson(true) })
    map.addLayer({ id: 'bv-1km-flaeche', type: 'fill', source: 'bv-1km', maxzoom: 12, paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 0.75, 'fill-antialias': false } }, vor)
    map.addLayer({ id: 'bv-1km-rand', type: 'line', source: 'bv-1km', minzoom: 9, maxzoom: 12, paint: { 'line-color': '#ffffff', 'line-width': 0.5, 'line-opacity': 0.6 } }, vor)
    map.addLayer({
      id: 'bv-100m-flaeche', type: 'fill', source: 'bv-100m', minzoom: 12,
      paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 0.6], 'fill-outline-color': 'rgba(255,255,255,0.35)' },
    }, vor)
  }
  anwenden(map)
}

/** Ebenen der Seite ein- oder ausblenden. */
export function bevoelkerungSichtbar(map: maplibregl.Map, an: boolean): void {
  sichtbar = an
  anwenden(map)
}

// ---------------------------------------------------------------- Panel
function kennzahlenHtml() {
  const d = daten!
  const kz = (id: string, beleg?: string) => {
    const m = merkmal(id)
    if (!m) return ''
    return `<div><span>${esc(m.name)}</span><b>${zahl(hammWert(idx(id)), m)}</b>${beleg ? `<small>${esc(beleg)}</small>` : ''}</div>`
  }
  const fort = d.amtlich?.kennzahlen.fortschreibung_2022_06_30
  return `<div class="vu-kz bv-kz">
    ${kz('einwohner', fort ? `Fortschreibung 30.06.2022: ${fort.toLocaleString('de-DE')}` : 'Stichtag 15.05.2022')}
    ${kz('alter')}${kz('ab65')}${kz('auslaender')}${kz('haushalte')}${kz('miete')}
  </div>`
}

function legendeHtml(m: Merkmal) {
  const g = bevoelkerungKlassen(m.id)
  const f = farben(g.length)
  const t = (v: number) => zahl(v, m, false)
  const einheit = m.art === 'anzahl' ? (m.gitter === '1km' ? 'je 1-km-Zelle' : 'je Hektar') : m.einheit
  const zeilen = f.map((farbe, k) => {
    const nullKlasse = g.length > 0 && g[0] === 1 / 10 ** stellen(m)
    const text = g.length === 0 ? 'alle Zellen' : k === 0 ? (nullKlasse ? '0' : `unter ${t(g[0])}`) : k === 1 && nullKlasse ? (g.length > 1 ? `über 0 bis unter ${t(g[1])}` : 'über 0') : k === g.length ? `${t(g[k - 1])} und mehr` : `${t(g[k - 1])} bis unter ${t(g[k])}`
    return `<div><i class="farbkasten" style="background:${farbe}"></i>${text}</div>`
  })
  return `<div class="legende bv-legende">${zeilen.join('')}</div><p class="quelle">${esc(einheit ? `${einheit}, ` : '')}Klassen nach Quantilen der ${m.gitter === '1km' ? '1-km' : '100-m'}-Zellen, Zellen ohne Wert bleiben frei.${m.gitter === '100m' ? ' Unter Zoom 12 in 1-km-Zellen.' : ''}</p>`
}

function bezirkeHtml(m: Merkmal) {
  const d = daten!
  const i = idx(m.id)
  const werte = d.bezirke.map((b) => b.werte[i])
  const zellenHamm = d.hamm[i]
  // Balken relativ zum größten Bezirk; bei Anzahlen hat die Summe für Hamm keinen Balken
  const max = Math.max(...werte.map((v) => v ?? 0), m.art === 'anzahl' ? 0 : zellenHamm ?? 0, 0)
  const zeile = (name: string, v: number | null | undefined, cls = '', balken = true) =>
    `<li class="${cls}"><span>${esc(name)}</span><i class="bv-balken"><i style="width:${balken && max > 0 && v != null ? Math.min(100, Math.max(0, (v / max) * 100)).toFixed(1) : 0}%"></i></i><b>${zahl(v, m)}</b></li>`
  const amtl = d.hamm_amtlich?.[i]
  const hinweis = amtl != null && zellenHamm != null && Math.abs(amtl - zellenHamm) > (m.art === 'anzahl' ? 0.005 * amtl : 0.15)
    ? `<p class="quelle">Hamm amtlich: ${zahl(amtl, m)}. Die Bezirkswerte sind Summen der 100-m-Zellen; durch die Geheimhaltung weichen sie vom amtlichen Wert ab.</p>` : ''
  return `<section class="karte bv-bezirke"><header><b>Stadtbezirke</b><span class="zaehler">${esc(m.name)}</span></header>
    <ul>${d.bezirke.map((b, k) => zeile(b.name, werte[k])).join('')}${zeile('Hamm', m.art === 'anzahl' ? (amtl ?? zellenHamm) : zellenHamm, 'summe', m.art !== 'anzahl')}</ul>
    ${hinweis}<p class="quelle">${m.gitter === '1km' ? '1-km-Zellen' : '100-m-Zellen'} mit Mittelpunkt im Bezirk${m.art === 'anzahl' ? '' : ', Mittelwerte gewichtet'}.</p></section>`
}

function klapp(id: string, titel: string, zaehler: string, inhalt: string) {
  return `<section class="karte bv-klapp ${offen.has(id) ? '' : 'zu'}" data-klapp="${esc(id)}"><header class="klapp"><b>${esc(titel)}</b><span class="zaehler">${esc(zaehler)}</span></header>${inhalt}</section>`
}

function amtlichHtml() {
  const a = daten!.amtlich
  if (!a) return ''
  const wahl = ['bevoelkerung', 'alter', 'haushalte', 'schule', 'beruf', 'erwerb', 'wirtschaft', 'wohnungen', 'eigentum', 'baujahr', 'energie']
  return wahl.map((id) => a.abschnitte.find((x) => x.id === id)).filter((x): x is Abschnitt => !!x).map((ab) => {
    const basis = ab.basis ?? ab.zeilen.reduce((s, z) => s + (z[1] ?? 0), 0)
    // erste Zeile entfällt, wenn sie die Bezugsgröße ist (steht schon als Zähler im Kopf)
    const zeilen = ab.zeilen.filter((z, k) => !(k === 0 && z[1] === ab.basis)).map(([n, v]) => {
      const anteil = v != null && basis ? ` <small>${(100 * v / basis).toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %</small>` : ''
      return `<li><span>${esc(n)}</span><b>${v == null ? '–' : v.toLocaleString('de-DE')}${anteil}</b></li>`
    })
    return klapp(`amtlich-${ab.id}`, ab.titel, ab.basis != null ? ab.basis.toLocaleString('de-DE') : '', `<ul class="kompakt bv-tabelle">${zeilen.join('')}</ul><p class="quelle">${esc(ab.id === 'schule' || ab.id === 'beruf' || ab.id === 'erwerb' || ab.id === 'wirtschaft' ? a.hinweis + ' ' : '')}Zensus 2022, Regionaltabelle Gemeinde Hamm, dl-de/by-2-0</p>`)
  }).join('')
}

function stadtstatistikHtml() {
  const s = daten!.stadtstatistik
  if (!s) return ''
  const j0 = s.jahre[0], j1 = s.jahre[s.jahre.length - 1]
  const zeilen = s.bezirke.map((b) => {
    const a = b.einwohner[0], z = b.einwohner[b.einwohner.length - 1]
    const d = ((z - a) / a) * 100
    return `<li><span>${esc(b.name)}</span><b>${z.toLocaleString('de-DE')} <small>${d >= 0 ? '+' : '−'}${Math.abs(d).toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %</small></b></li>`
  })
  const h = s.hamm.einwohner
  const kz = s.kennzahlen.map((k, i) => `<dt>${esc(k.name)}</dt><dd>${s.hamm.werte[i] == null ? '–' : s.hamm.werte[i]!.toLocaleString('de-DE').replace('-', '−')}${k.einheit === 'Personen' ? '' : ' ' + esc(k.einheit)}</dd>`).join('')
  return klapp('stadtstatistik', `Einwohner ${j0} bis ${j1}`, h[h.length - 1].toLocaleString('de-DE'),
    `<ul class="kompakt bv-tabelle">${zeilen.join('')}<li class="summe"><span>Hamm</span><b>${h[h.length - 1].toLocaleString('de-DE')} <small>seit ${j0}</small></b></li></ul>
     <h4>Hamm ${esc(s.stand)}</h4><dl class="fakten">${kz}</dl>
     <p class="quelle">Melderegister, Hauptwohnsitz; Veränderung seit ${j0}. ${esc(s.quelle)}; ${esc(s.lizenz)}.</p>`)
}

/** HTML für das linke Panel (360 px). Klickbare Elemente tragen data-merkmal. */
export function bevoelkerungPanelHtml(merkmalId: string): string {
  if (!daten) return '<p class="einleitung">Zensusdaten werden geladen …</p>'
  const m = wahlMerkmal(merkmalId)
  const gruppe = m.gruppe
  const segment = BV_GRUPPEN.map((g) => {
    const erstes = daten!.merkmale.find((x) => x.gruppe === g)
    return erstes ? `<button data-merkmal="${erstes.id}" class="${g === gruppe ? 'an' : ''}">${esc(g)}</button>` : ''
  }).join('')
  const liste = daten.merkmale.filter((x) => x.gruppe === gruppe).map((x) => {
    const i = idx(x.id)
    return `<li class="klickbar ${x.id === m.id ? 'an' : ''}" data-merkmal="${x.id}"><span>${esc(x.name)}${x.gitter === '1km' ? ' <em>1 km</em>' : ''}</span><b>${zahl(hammWert(i), x)}</b></li>`
  }).join('')
  return `${kennzahlenHtml()}
    <h4>Merkmal</h4><div class="segment bv-gruppen">${segment}</div>
    <section class="karte bv-merkmale"><ul class="kompakt">${liste}</ul></section>
    <section class="karte bv-auswahl"><header><b>${esc(m.name)}</b><span class="zaehler">${m.gitter === '1km' ? '1-km-Gitter' : '100-m-Gitter'}</span></header>
      <p class="bv-text">${esc(m.beschreibung)}</p>${legendeHtml(m)}</section>
    ${bezirkeHtml(m)}
    ${amtlichHtml()}
    ${stadtstatistikHtml()}
    <p class="quelle">${esc(BV_LIZENZ)}. Stichtag 15.05.2022, Abruf ${esc(daten.stand.split('-').reverse().join('.'))}. Werte durch Geheimhaltung leicht verändert.</p>`
}

/** Klicks im Panel: Merkmalwahl (data-merkmal) und Klappabschnitte. */
export function bevoelkerungPanelVerdrahten(el: HTMLElement, wahl: (merkmal: string) => void): void {
  el.querySelectorAll<HTMLElement>('[data-merkmal]').forEach((b) => b.addEventListener('click', () => wahl(b.dataset.merkmal!)))
  el.querySelectorAll<HTMLElement>('.bv-klapp').forEach((s) => s.querySelector('header.klapp')?.addEventListener('click', () => {
    const id = s.dataset.klapp!
    if (offen.has(id)) offen.delete(id); else offen.add(id)
    s.classList.toggle('zu', !offen.has(id))
  }))
}

// ---------------------------------------------------------------- Detailblatt
/** Alle Merkmale der Zelle unter lon/lat mit Vergleich zum Hamm-Wert; undefined, wenn dort keine Zelle liegt. */
export function bevoelkerungZelleHtml(lon: number, lat: number): { titel: string; html: string } | undefined {
  const d = daten
  if (!d) return undefined
  const [e, n] = nachLaea(lon, lat)
  const id100 = `${Math.floor(n / 100)}_${Math.floor(e / 100)}`
  const id1km = `${Math.floor(n / 1000)}_${Math.floor(e / 1000)}`
  const w100 = d.zellen[id100]
  const w1km = d.zellen1km[id1km]
  if (!w100 && !w1km) return undefined
  const ab = (m: Merkmal, i: number) => {
    const h = m.art === 'anzahl' ? null : hammWert(i)
    return h == null ? '' : ` <small>Hamm ${zahl(h, m)}</small>`
  }
  const teile = BV_GRUPPEN.map((g) => {
    const zeilen = d.merkmale.map((m, i) => ({ m, i })).filter(({ m }) => m.gruppe === g).map(({ m, i }) => {
      const quelle = m.gitter === '1km' || !w100 ? w1km : w100
      const v = quelle?.[i]
      if (v == null) return `<dt>${esc(m.name)}</dt><dd>–</dd>`
      return `<dt>${esc(m.name)}${m.gitter === '1km' || !w100 ? ' <small>1 km</small>' : ''}</dt><dd>${zahl(v, m)}${ab(m, i)}</dd>`
    })
    return `<h4>${esc(g)}</h4><dl class="fakten bv-fakten">${zeilen.join('')}</dl>`
  })
  const s = w100 ? 100 : 1000
  const [nn, ee] = (w100 ? id100 : id1km).split('_').map((x) => Number(x) * s)
  const inspire = `CRS3035RES${w100 ? '100m' : '1000m'}N${nn}E${ee}`
  const einw = w100?.[idx('einwohner')]
  return {
    titel: w100 ? 'Gitterzelle 100 × 100 m' : 'Gitterzelle 1 × 1 km',
    html: `<section><p class="bv-text">${einw != null ? `${einw.toLocaleString('de-DE')} Einwohner. ` : ''}Vergleich mit dem Wert für ganz Hamm.${w100 ? ' Merkmale mit „1 km“ beziehen sich auf die umgebende 1-km-Zelle.' : ''}</p>
      ${teile.join('')}
      <p class="quelle">Zelle ${esc(inspire)}. ${esc(BV_LIZENZ)}. Kleine Fallzahlen sind durch die Geheimhaltung verändert oder auf null gesetzt.</p></section>`,
  }
}

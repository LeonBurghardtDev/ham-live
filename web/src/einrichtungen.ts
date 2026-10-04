/**
 * Tab „Wegweiser“: Wo ist das nächste …? Einrichtungen aus public/daten/einrichtungen.geojson (daten/einrichtungen.py:
 * OSM ODbL, Stadt Hamm WFS dl-de/by-2-0, KVWL-Notdienstpraxen von Hand), Notdienst-Apotheken live (aponet.de, nur privat),
 * Notaufnahmen aus den geladenen Daten. Kartensymbole `ew:<typ>`: quadratische Plaketten, Farbe je Kategorie.
 */
import type maplibregl from 'maplibre-gl'
import type * as GeoJSON from 'geojson'
import { hole, HAMM, type Ergebnis, type Quelle, type Zeile } from './live'

export type Kat = 'notfall' | 'gesundheit' | 'bildung' | 'alltag'
export const KATEGORIEN: { id: Kat; name: string }[] = [
  { id: 'notfall', name: 'Notfall' }, { id: 'gesundheit', name: 'Gesundheit' }, { id: 'bildung', name: 'Bildung' }, { id: 'alltag', name: 'Alltag' },
]
const FARBE: Record<Kat, string> = { notfall: '#c4271b', gesundheit: '#1d7f3c', bildung: '#005468', alltag: '#505050' }
/** typ → Kategorie und Kürzel (leer = Piktogramm) */
const SYMBOL: Record<string, { kat: Kat; k: string }> = {
  krankenhaus: { kat: 'notfall', k: '' }, notdienstpraxis: { kat: 'notfall', k: 'ND' }, defi: { kat: 'notfall', k: '' },
  feuerwehr: { kat: 'notfall', k: 'F' }, polizei: { kat: 'notfall', k: 'P' }, notdienst: { kat: 'notfall', k: 'A' },
  apotheke: { kat: 'gesundheit', k: 'A' }, arzt: { kat: 'gesundheit', k: 'Dr' }, zahnarzt: { kat: 'gesundheit', k: 'Z' },
  schule: { kat: 'bildung', k: 'S' }, kita: { kat: 'bildung', k: 'Ki' }, hochschule: { kat: 'bildung', k: 'H' },
  rathaus: { kat: 'alltag', k: 'R' }, recyclinghof: { kat: 'alltag', k: 'RH' }, spielplatz: { kat: 'alltag', k: 'Sp' },
  wc: { kat: 'alltag', k: 'WC' }, post: { kat: 'alltag', k: 'Po' }, packstation: { kat: 'alltag', k: 'Pk' }, bibliothek: { kat: 'alltag', k: 'Bü' },
}
const SCHRIFT = '"Bahnschrift", "DIN 1451", "Arial Narrow", sans-serif'

let daten: Promise<Record<Kat, GeoJSON.FeatureCollection>> | undefined

/** Einrichtungen je Kategorie; setzt icon (`ew:<typ>`), titel (= name) und sub. Einmal geladen, danach aus dem Speicher. */
export function einrichtungenLaden(): Promise<Record<Kat, GeoJSON.FeatureCollection>> {
  daten ??= fetch('/daten/einrichtungen.geojson').then((r) => {
    if (!r.ok) throw new Error('einrichtungen.geojson: HTTP ' + r.status)
    return r.json()
  }).then((fc: GeoJSON.FeatureCollection) => {
    const out = Object.fromEntries(KATEGORIEN.map((k) => [k.id, { type: 'FeatureCollection', features: [] as GeoJSON.Feature[] }])) as Record<Kat, GeoJSON.FeatureCollection>
    for (const f of fc.features) {
      const p = f.properties ?? {}
      const kat = p.kat as Kat
      if (!out[kat]) continue
      p.icon = 'ew:' + p.typ
      p.titel = p.name
      p.sub = p.sub ?? ''
      out[kat].features.push(f)
    }
    return out
  }).catch((e) => { daten = undefined; throw e })
  return daten
}

/** Plakette 20 × 20 px (doppelte Pixeldichte), rechte Winkel, weißer Rand, weißes Kürzel oder Piktogramm. */
function plakette(typ: string): ImageData | undefined {
  const s = SYMBOL[typ]
  if (!s) return undefined
  const PR = 2, w = 20
  const c = document.createElement('canvas')
  c.width = w * PR; c.height = w * PR
  const g = c.getContext('2d')!
  g.scale(PR, PR)
  g.fillStyle = FARBE[s.kat]; g.fillRect(0, 0, w, w)
  g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, w - 1.5, w - 1.5)
  g.fillStyle = '#ffffff'
  if (typ === 'krankenhaus') {
    g.fillRect(8, 4, 4, 12); g.fillRect(4, 8, 12, 4)
  } else if (typ === 'defi') {
    // Herz mit Blitz
    g.beginPath(); g.moveTo(10, 16)
    g.bezierCurveTo(3, 11, 3, 5, 7, 5); g.bezierCurveTo(8.6, 5, 9.5, 6, 10, 7)
    g.bezierCurveTo(10.5, 6, 11.4, 5, 13, 5); g.bezierCurveTo(17, 5, 17, 11, 10, 16); g.fill()
    g.fillStyle = FARBE[s.kat]
    g.beginPath(); g.moveTo(10.8, 6.5); g.lineTo(8, 11); g.lineTo(10, 11); g.lineTo(9.2, 14.5); g.lineTo(12, 9.5); g.lineTo(10, 9.5); g.closePath(); g.fill()
  } else {
    const gr = s.k.length > 1 ? 10 : 13
    g.font = `700 ${gr}px ${SCHRIFT}`; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(s.k, w / 2, w / 2 + 0.5)
    if (typ === 'notdienst') { g.fillRect(4, 15.5, 12, 1.5) } // Strich: dienstbereit
  }
  return g.getImageData(0, 0, c.width, c.height)
}

export function einrichtungenSymbole(map: maplibregl.Map) {
  map.on('styleimagemissing', (e) => {
    const m = /^ew:([a-z]+)$/.exec(e.id)
    if (!m || map.hasImage(e.id)) return
    const b = plakette(m[1])
    if (b) map.addImage(e.id, b, { pixelRatio: 2 })
  })
}

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const km = (lon: number, lat: number) => Math.hypot((lon - HAMM.lon) * 69.2, (lat - HAMM.lat) * 111.2)

/** „bis morgen 9:00“ aus „02.10.2026 um 09:00“ */
function bisText(d: string, z: string) {
  const [tt, mm, jj] = d.split('.').map(Number)
  const ende = new Date(jj, mm - 1, tt), heute = new Date()
  heute.setHours(0, 0, 0, 0)
  const tage = Math.round((ende.getTime() - heute.getTime()) / 86400000)
  const uhr = z.replace(/^0/, '')
  return tage === 0 ? `bis heute ${uhr}` : tage === 1 ? `bis morgen ${uhr}` : `bis ${String(tt).padStart(2, '0')}.${String(mm).padStart(2, '0')}. ${uhr}`
}

export const notdienst: Quelle = {
  id: 'notdienst', name: 'Notdienst-Apotheken', takt: 1800,
  lizenz: 'aponet.de (Avoxa / ABDA, Daten der Bundesapothekerkammer), keine offene Lizenz – nur privat',
  async laden(): Promise<Ergebnis> {
    const html = await hole('https://www.aponet.de/notdienstsuche/59065-Hamm', 1800, 'text')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const zeilen: Zeile[] = [], feats: GeoJSON.Feature[] = []
    for (const li of doc.querySelectorAll('#pharmacy-search-result li.list-group-item')) {
      const lat = Number(li.getAttribute('data-latitude')), lon = Number(li.getAttribute('data-longitude'))
      const t = (sel: string) => li.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      const name = t('.name'), strasse = t('.strasse'), ort = t('.ort')
      const tel = li.querySelector('a[href^="tel:"]')?.textContent?.trim().replace(/^\+49\s*/, '0') ?? ''
      const zeit = /bis (\d\d\.\d\d\.\d{4}) um (\d\d:\d\d)/.exec(li.textContent ?? '')
      const bis = zeit ? bisText(zeit[1], zeit[2]) : ''
      const text = `${name}, ${strasse}${ort && ort !== 'Hamm' ? ' (' + ort + ')' : ''}`
      const klein = [bis, tel].filter(Boolean).join(' · ')
      zeilen.push({ text, klein, lon: lon || undefined, lat: lat || undefined, rang: lon ? km(lon, lat) : 99 })
      if (lon && lat) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { icon: 'ew:notdienst', titel: name, sub: `${strasse}, ${ort} · ${klein}` } })
    }
    zeilen.sort((a, b) => (a.rang ?? 0) - (b.rang ?? 0))
    if (!zeilen.length) zeilen.push({ text: 'Keine Notdienst-Apotheke gefunden', stufe: 'warnung' })
    return { zeilen, punkte: fc(feats), stand: new Date() }
  },
}

export const notaufnahmen: Quelle = {
  id: 'notaufnahmen', name: 'Notaufnahmen', takt: 86400,
  lizenz: 'OpenStreetMap (ODbL), Notaufnahmen und KVWL-Notdienstpraxen von Hand',
  async laden(): Promise<Ergebnis> {
    const d = await einrichtungenLaden()
    const zeilen: Zeile[] = [{ text: 'Ärztlicher Bereitschaftsdienst: 116117', klein: 'Lebensgefahr: 112', stufe: 'info' }]
    const feats = d.notfall.features.filter((f) => f.properties?.notaufnahme || f.properties?.typ === 'notdienstpraxis')
    for (const f of feats) {
      const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates
      zeilen.push({ text: String(f.properties?.name ?? ''), klein: String(f.properties?.sub ?? ''), lon, lat })
    }
    return { zeilen, punkte: fc(feats), stand: new Date() }
  },
}

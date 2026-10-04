/**
 * Tab „Verkehr“: Überblick auf der Karte (Kennzahlen, Hauptachsen mit Zeitverlust, wichtigste Störungen)
 * und Tagesleiste (Stau-Kilometer je Stunde aus der Aufzeichnung).
 * Hauptachsen: Straßenverläufe aus OSM (strassen.json), Zustand aus den Abschnitten von Verkehr.NRW.
 * Zeitverlust geschätzt aus der Länge der Abschnitte je Verkehrslage (Annahmen in GESCHW).
 * Verkehr.NRW liefert jede Fahrtrichtung als eigenen Abschnitt: Achsenwerte gelten je Richtung (Summe / 2).
 * Kilometerangaben zählen nur Abschnitte, deren Mitte im Stadtgebiet liegt.
 */
import type * as GeoJSON from 'geojson'
import type { Zeile } from './live'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const zahl = (v: number, n = 0) => v.toLocaleString('de-DE', { maximumFractionDigits: n, minimumFractionDigits: n })

/** Hauptachsen: Anzeigename und OSM-Straßennamen */
export const ACHSEN: { id: string; name: string; strassen: string[]; autobahn?: boolean }[] = [
  { id: 'a1', name: 'A 1', strassen: ['A 1'], autobahn: true },
  { id: 'a2', name: 'A 2', strassen: ['A 2'], autobahn: true },
  { id: 'werler', name: 'Werler Straße', strassen: ['Werler Straße'] },
  { id: 'muenster', name: 'Münsterstraße', strassen: ['Münsterstraße'] },
  { id: 'warendorfer', name: 'Warendorfer Straße', strassen: ['Warendorfer Straße'] },
  { id: 'kamener', name: 'Kamener Straße', strassen: ['Kamener Straße'] },
  { id: 'dortmunder', name: 'Dortmunder Straße', strassen: ['Dortmunder Straße'] },
  { id: 'soester', name: 'Soester Straße', strassen: ['Soester Straße'] },
  { id: 'hafen', name: 'Hafenstraße', strassen: ['Hafenstraße'] },
  { id: 'ring', name: 'Innenstadtring', strassen: ['Ostring', 'Westring', 'Nordring', 'Südring'] },
]
/** angenommene Geschwindigkeit als Anteil der freien (frei: innerorts 45 km/h, Autobahn 110 km/h) */
const GESCHW = { frei: 1, dicht: 0.7, zaeh: 0.45, stau: 0.2 } as const

type Linie = [number, number][]
type AchseGeo = { id: string; linien: Linie[]; box: [number, number, number, number] }
export type AchseStand = { id: string; name: string; km: number; kmGestoert: number; verlustMin: number; gesperrt: number; schlimmste: 'frei' | 'dicht' | 'zaeh' | 'stau' }

let geo: AchseGeo[] = []
let stand: AchseStand[] = []
export const achsenStand = () => stand
let grenze: [number, number][][] = []
let hamm = { frei: 0, dicht: 0, zaeh: 0, stau: 0, gesperrt: 0 }
/** Kilometer je Verkehrslage im Stadtgebiet (beide Richtungen) */
export const hammKm = () => hamm
export const achseLinien = (id: string): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: (geo.find((g) => g.id === id)?.linien ?? []).map((l) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: l }, properties: {} })) })

function imGebiet(p: [number, number]) {
  let drin = false
  for (const ring of grenze) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) drin = !drin
  }
  return drin
}

export async function achsenLaden() {
  if (geo.length) return
  const g = (await (await fetch('/daten/grenzen.geojson')).json()) as GeoJSON.FeatureCollection
  const stadt = g.features.find((f) => f.properties?.ebene === 'stadt')?.geometry
  if (stadt?.type === 'Polygon') grenze = stadt.coordinates as [number, number][][]
  else if (stadt?.type === 'MultiPolygon') grenze = stadt.coordinates.flat() as [number, number][][]
  const d = (await (await fetch('/daten/strassen.json')).json()) as { strassen: Record<string, { b: string; l: Linie[] }[]> }
  geo = ACHSEN.map((a) => {
    const linien = a.strassen.flatMap((n) => (d.strassen[n] ?? []).flatMap((x) => x.l))
    const xs = linien.flat()
    return { id: a.id, linien, box: [Math.min(...xs.map((p) => p[0])) - 0.001, Math.min(...xs.map((p) => p[1])) - 0.001, Math.max(...xs.map((p) => p[0])) + 0.001, Math.max(...xs.map((p) => p[1])) + 0.001] as [number, number, number, number] }
  }).filter((g) => g.linien.length)
}

// Abstand Punkt – Strecke in Metern (lokal eben gerechnet)
const KX = 111320 * Math.cos((51.68 * Math.PI) / 180), KY = 110540
function abstand(p: [number, number], a: [number, number], b: [number, number]) {
  const px = p[0] * KX, py = p[1] * KY, ax = a[0] * KX, ay = a[1] * KY, bx = b[0] * KX, by = b[1] * KY
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}
const laenge = (c: Linie) => { let m = 0; for (let i = 1; i < c.length; i++) m += Math.hypot((c[i][0] - c[i - 1][0]) * KX, (c[i][1] - c[i - 1][1]) * KY); return m }

/** Abschnitte von Verkehr.NRW den Achsen zuordnen (Mittelpunkt höchstens 35 m von der Achse) und auswerten */
export function achsenBerechnen(fc: GeoJSON.FeatureCollection | undefined) {
  if (!fc || !geo.length) return
  const neu = new Map<string, AchseStand>()
  for (const a of ACHSEN) neu.set(a.id, { id: a.id, name: a.name, km: 0, kmGestoert: 0, verlustMin: 0, gesperrt: 0, schlimmste: 'frei' })
  const rang = { frei: 0, dicht: 1, zaeh: 2, stau: 3 }
  hamm = { frei: 0, dicht: 0, zaeh: 0, stau: 0, gesperrt: 0 }
  for (const f of fc.features) {
    if (f.geometry.type !== 'LineString') continue
    const c = f.geometry.coordinates as Linie
    const p = c[Math.floor(c.length / 2)]
    const lage = (f.properties?.lage ?? 'frei') as keyof typeof GESCHW
    if (!(lage in GESCHW)) continue
    if (!grenze.length || imGebiet(p)) { const km = laenge(c) / 1000; if (f.properties?.gesperrt) hamm.gesperrt += km; else hamm[lage] += km }
    for (const g of geo) {
      if (p[0] < g.box[0] || p[0] > g.box[2] || p[1] < g.box[1] || p[1] > g.box[3]) continue
      let treffer = false
      for (const l of g.linien) { for (let i = 1; i < l.length; i++) if (abstand(p, l[i - 1], l[i]) < 35) { treffer = true; break } if (treffer) break }
      if (!treffer) continue
      const s = neu.get(g.id)!, autobahn = ACHSEN.find((a) => a.id === g.id)!.autobahn
      const km = laenge(c) / 1000, vFrei = autobahn ? 110 : 45
      s.km += km
      if (f.properties?.gesperrt) s.gesperrt++
      if (lage !== 'frei') { s.kmGestoert += km; s.verlustMin += km * (60 / (vFrei * GESCHW[lage]) - 60 / vFrei) }
      if (rang[lage] > rang[s.schlimmste]) s.schlimmste = lage
      break
    }
  }
  // je Richtung
  for (const s of neu.values()) { s.km /= 2; s.kmGestoert /= 2; s.verlustMin /= 2 }
  stand = [...neu.values()].filter((s) => s.km > 0)
}

const FARBE = { frei: '#95c11e', dicht: '#f0ca00', zaeh: '#e06c00', stau: '#c4271b' }
const TEXT = { frei: 'frei', dicht: 'dicht', zaeh: 'zähfließend', stau: 'Stau' }

export type VerkehrKennzahlen = { stauKm?: number; bahn?: string; baustellen?: number; veraltetSeit?: string; ohneLage?: boolean }

/** Überblick oben im Panel des Tabs Verkehr */
export function verkehrUeberblickHtml(k: VerkehrKennzahlen, stoerungen: Zeile[]): string {
  const achsen = [...stand].sort((a, b) => b.verlustMin - a.verlustMin || b.kmGestoert - a.kmGestoert).slice(0, 7)
  const maxV = Math.max(5, ...achsen.map((a) => a.verlustMin))
  return `<div class="vu">
    ${k.veraltetSeit ? `<p class="vu-hinweis">Verkehr.NRW liefert seit ${k.veraltetSeit} Uhr keine neue Verkehrslage. Die Farben auf der Karte stammen aus den aktuellen Staumeldungen: grün heißt keine Meldung. Hauptachsen und Stau-Kilometer entfallen so lange.</p>` : ''}
    <div class="vu-kz"><div><b>${k.stauKm == null ? '–' : zahl(k.stauKm, 1) + ' km'}</b><span>Stau und zäh</span></div><div><b>${esc(k.bahn ?? '–')}</b><span>Bahn Hamm Hbf</span></div><div><b>${k.baustellen ?? '–'}</b><span>Baustellen</span></div></div>
    ${k.ohneLage ? '<p class="vu-leer">Verkehrslage und Hauptachsen stammen von Verkehr.NRW (ohne offene Lizenz) und laufen nur in privaten Installationen.</p>' : k.veraltetSeit ? '' : `<p class="lbl">Hauptachsen jetzt</p>
    <ul class="vu-achsen">${achsen.map((a) => `<li data-achse="${a.id}"><span><b>${esc(a.name)}</b><small>${a.gesperrt ? `${a.gesperrt} Abschnitt${a.gesperrt > 1 ? 'e' : ''} gesperrt` : TEXT[a.schlimmste]}${a.kmGestoert >= 0.1 ? ` · ${zahl(a.kmGestoert, 1)} km betroffen` : ''}</small></span>
      <span class="vu-wert"><b style="color:${a.verlustMin >= 1 ? FARBE[a.schlimmste] : 'var(--text2)'}">${a.verlustMin >= 0.5 ? `+${zahl(a.verlustMin)} min` : '±0'}</b><i><i style="width:${Math.max(4, (a.verlustMin / maxV) * 100).toFixed(0)}%;background:${FARBE[a.schlimmste]}"></i></i></span></li>`).join('') || '<li><span>Verkehrslage lädt …</span></li>'}</ul>`}
    <p class="lbl">Störungen in Hamm</p>${stoerungen.length ? `<ul class="vu-stoer">${stoerungen.slice(0, 4).map((z, i) => `<li class="${z.stufe ?? ''}${z.lon != null ? ' klickbar' : ''}" data-i="${i}">${esc(z.text.replace(/^Verkehrslage:\s*/, ''))}${z.klein ? `<small>${esc(z.klein)}</small>` : ''}</li>`).join('')}</ul>` : '<p class="vu-leer">Keine Staus oder Störungen gemeldet</p>'}
    ${k.veraltetSeit || k.ohneLage ? '' : `<p class="vu-fuss">Zeitverlust je Richtung, geschätzt aus der Verkehrslage von Verkehr.NRW und angenommenen Geschwindigkeiten. Kilometer: Stadtgebiet, beide Richtungen.</p>`}
    <div class="vu-tag"></div>
  </div>`
}

/** Tagesleiste: Stau-Kilometer je Stunde heute (Aufzeichnung alle 5 Minuten) */
export function verkehrTagHtml(punkte: { t: string; stau?: number }[], jetztKm: number | undefined, veraltetSeit?: Date): string {
  const heute = new Date(); heute.setHours(0, 0, 0, 0)
  const stunden = Array.from({ length: 24 }, () => [] as number[])
  for (const p of punkte) { const d = new Date(p.t); if (d >= heute && p.stau != null && !(veraltetSeit && d > veraltetSeit)) stunden[d.getHours()].push(p.stau) }
  const jetztH = new Date().getHours()
  if (jetztKm != null) stunden[jetztH].push(jetztKm)
  const werte = stunden.map((xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null))
  const max = Math.max(1, ...werte.filter((x): x is number => x != null))
  const erste = werte.findIndex((x) => x != null)
  return `<div class="kopf"><b id="zl-titel">Verkehr heute</b><span id="zl-sub">Stau und zähfließend in km je Stunde${veraltetSeit ? ` · keine neuen Daten seit ${veraltetSeit.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : erste >= 0 && erste === jetztH ? ' · Aufzeichnung läuft seit heute' : ''}</span></div>
    <div class="vt-balken">${werte.map((v, h) => `<i class="${h === jetztH ? 'jetzt' : ''}${v == null ? ' leer' : ''}" style="height:${v == null ? 2 : Math.max(4, (v / max) * 100).toFixed(0)}%" title="${h} Uhr: ${v == null ? 'keine Daten' : zahl(v, 1) + ' km'}"></i>`).join('')}</div>
    <div class="marken skala"><span>0 Uhr</span><span>6</span><span>12</span><span>18</span><span>24</span></div>`
}

import type * as GeoJSON from 'geojson'
import type { ExpressionSpecification } from 'maplibre-gl'
/**
 * Tab „Politik“: Wahlergebnisse der Stadt Hamm je Stimmbezirk (137 Urnenbezirke) und Kommunalwahlbezirk (29).
 * Daten aus public/daten/wahlen.json (erzeugt von daten/wahlen.py), Quelle Stadt Hamm, dl-de/by-2-0.
 *
 * Für MapLibre werden die Ergebnisse je Wahl beim Laden zusätzlich flach in die Feature-Properties geschrieben
 * (verschachtelte Objekte kommen in MapLibre-Ausdrücken nicht an): `w:<wahlId>:beteiligung`,
 * `w:<wahlId>:staerkste`, `w:<wahlId>:<Partei>`.
 */

export const POLITIK_LIZENZ = 'Wahlergebnisse und Wahlbezirke: Stadt Hamm (votemanager, WFS od_wahlen), Datenlizenz Deutschland Namensnennung 2.0'

export type Partei = { kurz: string; name: string; farbe: string }
export type Gesamt = {
  wahlberechtigte: number; waehler: number; gueltig: number; ungueltig: number
  beteiligung: number | null; briefwaehler: number; stimmen: Record<string, number>; staerkste: string | null
}
export type Wahl = {
  id: string; name: string; datum: string; stimmart: 'Stimme' | 'Erststimme' | 'Zweitstimme'
  parteien: Partei[]; gesamt: Gesamt; stimmbezirke: number; briefwahlbezirke: number; zugeordnet: number
  quelle: string; hinweis?: string
}
/** Ergebnis einer Wahl in einer Fläche. Stimmbezirke: nur Urnenstimmen, Beteiligung geschätzt. Kommunalwahlbezirke: Urne + Brief. */
export type WahlWerte = {
  wahlberechtigte: number; beteiligung: number | null; stimmen: Record<string, number>; staerkste: string | null
  waehler?: number; urnenwaehler?: number; wahlscheine?: number; beteiligungUrne?: number | null
}
export type BezirkProps = { nr: string; name: string; kwb?: number; stadtbezirk?: string } & { [wahlId: string]: unknown }
export type Briefwahlbezirk = { nr: string; kwb: number | null; waehler: number; stimmen: Record<string, number>; staerkste: string | null }
export type WahlenDaten = {
  stand: string; quelle: string; hinweis: string; wahlen: Wahl[]
  bezirke: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, BezirkProps>
  wahlbezirke: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, BezirkProps>
  briefwahl: Record<string, Briefwahlbezirk[]>
}
export type Farbmodus = 'staerkste' | 'beteiligung' | 'partei'

const KEINE = '#D0D0D0'
const HELL = '#F4F4F4'
let daten: WahlenDaten | null = null
let laden: Promise<WahlenDaten> | null = null
const nachNr = new Map<string, BezirkProps>()

export const schluessel = (wahlId: string, feld: string) => `w:${wahlId}:${feld}`

/** Lädt wahlen.json einmal, schreibt flache Properties für MapLibre und gibt die Daten zurück. */
export async function wahlenLaden(): Promise<WahlenDaten> {
  if (daten) return daten
  laden ??= (async () => {
    const r = await fetch('/daten/wahlen.json')
    if (!r.ok) throw new Error(`wahlen.json: HTTP ${r.status}`)
    const d = (await r.json()) as WahlenDaten
    for (const fc of [d.bezirke, d.wahlbezirke]) {
      for (const f of fc.features) {
        const p = f.properties
        for (const w of d.wahlen) {
          const v = werteAus(p, w.id)
          if (!v) continue
          if (v.beteiligung != null) p[schluessel(w.id, 'beteiligung')] = v.beteiligung
          if (v.staerkste) p[schluessel(w.id, 'staerkste')] = v.staerkste
          for (const [k, a] of Object.entries(v.stimmen)) p[schluessel(w.id, k)] = a
        }
        nachNr.set(p.nr, p)
      }
    }
    daten = d
    return d
  })()
  return laden
}

export const wahlenGeladen = () => daten
export const wahl = (wahlId: string) => daten?.wahlen.find((w) => w.id === wahlId)

/** Ergebnis einer Wahl aus Properties (Objekt, als JSON-String aus queryRenderedFeatures oder über die Bezirksnummer). */
export function werteAus(props: Record<string, unknown>, wahlId: string): WahlWerte | null {
  let v = props[wahlId]
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = undefined } }
  if (v && typeof v === 'object') return v as WahlWerte
  const p = typeof props.nr === 'string' || typeof props.nr === 'number' ? nachNr.get(String(props.nr)) : undefined
  return p && p !== props ? werteAus(p, wahlId) : null
}

function grenzen(wahlId: string, feld: string): [number, number] {
  const xs: number[] = []
  for (const fc of daten ? [daten.bezirke, daten.wahlbezirke] : []) {
    for (const f of fc.features) {
      const x = f.properties[schluessel(wahlId, feld)]
      if (typeof x === 'number') xs.push(x)
    }
  }
  if (!xs.length) return [0, 100]
  xs.sort((a, b) => a - b)
  const q = (t: number) => xs[Math.min(xs.length - 1, Math.floor(t * (xs.length - 1)))]
  const lo = q(0.02), hi = q(0.98)
  return hi > lo ? [lo, hi] : [lo, lo + 1]
}

/** MapLibre-Ausdruck für fill-color. Vorher wahlenLaden() aufrufen (Parteifarben und Wertebereich kommen aus den Daten). */
export function wahlFarbausdruck(wahlId: string, modus: Farbmodus, partei?: string): ExpressionSpecification {
  const w = wahl(wahlId)
  if (modus === 'staerkste') {
    const paare = (w?.parteien ?? []).flatMap((p) => [p.kurz, p.farbe])
    if (!paare.length) return ['literal', KEINE] as unknown as ExpressionSpecification
    return ['match', ['coalesce', ['get', schluessel(wahlId, 'staerkste')], ''], ...paare, KEINE] as unknown as ExpressionSpecification
  }
  if (modus === 'beteiligung') {
    const k = schluessel(wahlId, 'beteiligung')
    const [lo, hi] = grenzen(wahlId, 'beteiligung')
    const m = (lo + hi) / 2
    return ['case', ['has', k],
      ['interpolate', ['linear'], ['get', k], lo, '#EEF3F9', m, '#7FA6D6', hi, '#0B3F7A'],
      KEINE] as ExpressionSpecification
  }
  const kurz = partei ?? w?.gesamt.staerkste ?? ''
  const farbe = w?.parteien.find((p) => p.kurz === kurz)?.farbe ?? '#555555'
  const k = schluessel(wahlId, kurz)
  const [, hi] = grenzen(wahlId, kurz)
  // Bezirke ohne Ergebnis grau, Partei ohne Stimmen im Bezirk hell
  return ['case', ['has', schluessel(wahlId, 'staerkste')],
    ['interpolate', ['linear'], ['coalesce', ['get', k], 0], 0, HELL, Math.max(hi, 0.1), farbe],
    KEINE] as ExpressionSpecification
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const pz = (v: number | null | undefined) => (v == null ? '–' : v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %')
const ganz = (v: number | undefined) => (v == null ? '–' : v.toLocaleString('de-DE'))
const diff = (v: number) => (Math.abs(v) < 0.05 ? '±0,0' : (v > 0 ? '+' : '−') + Math.abs(v).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))

/** Text auf Parteifarbe: dunkle Schrift auf hellen Farben (FDP gelb). */
function textFarbe(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return l > 150 ? '#000000' : '#FFFFFF'
}

/** HTML-Abschnitt fürs Detailblatt: Balken je Partei, Beteiligung, Vergleich zur Gesamtstadt (Prozentpunkte). */
export function bezirkHtml(props: Record<string, unknown>, wahlId: string): string {
  const w = wahl(wahlId)
  const v = werteAus(props, wahlId)
  const nr = String(props.nr ?? '')
  const istKwb = props.kwb == null && /^\d{1,2}$/.test(nr)
  const titel = istKwb ? `Kommunalwahlbezirk ${nr}` : `Stimmbezirk ${nr}${props.name ? ' · ' + String(props.name) : ''}`
  const kopf = `<h3 style="margin:0 0 8px">${esc(w ? `${w.name}${w.stimmart !== 'Stimme' ? ' · ' + w.stimmart : ''}` : wahlId)}</h3>`
    + `<div style="margin:0 0 8px">${esc(titel)}${props.stadtbezirk ? ' · Stadtbezirk ' + esc(String(props.stadtbezirk)) : ''}</div>`
  if (!w || !v) return `<section class="politik">${kopf}<p style="margin:0">Für diese Fläche liegt kein Ergebnis vor${w?.hinweis ? ' (' + esc(w.hinweis) + ')' : ''}.</p></section>`

  const g = w.gesamt
  const farbe = new Map(w.parteien.map((p) => [p.kurz, p]))
  const max = Math.max(1, ...Object.values(v.stimmen), ...Object.values(g.stimmen))
  const reihen = Object.entries(v.stimmen).sort((a, b) => b[1] - a[1])
  const gross = reihen.filter(([, a]) => a >= 1)
  const rest = reihen.filter(([, a]) => a < 1).reduce((s, [, a]) => s + a, 0)
  const zeile = (kurz: string, anteil: number, stadt: number | undefined, f: string, name: string) =>
    `<div title="${esc(name)}" style="display:grid;grid-template-columns:96px 1fr 56px 48px;gap:8px;align-items:center;margin:0 0 4px">`
    + `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(kurz)}</span>`
    + `<span style="position:relative;height:16px;background:#E6E6E6">`
    + `<span style="position:absolute;left:0;top:0;bottom:0;width:${(100 * anteil / max).toFixed(1)}%;background:${f}"></span>`
    + (stadt != null ? `<span title="Gesamtstadt ${pz(stadt)}" style="position:absolute;top:-2px;bottom:-2px;width:2px;left:calc(${(100 * stadt / max).toFixed(1)}% - 1px);background:#000"></span>` : '')
    + `</span><span style="text-align:right;font-variant-numeric:tabular-nums">${pz(anteil)}</span>`
    + `<span style="text-align:right;font-variant-numeric:tabular-nums;color:#555">${stadt != null ? diff(anteil - stadt) : ''}</span></div>`
  const balken = gross.map(([k, a]) => { const p = farbe.get(k); return zeile(k, a, g.stimmen[k], p?.farbe ?? '#8C8C8C', p?.name ?? k) }).join('')
    + (rest > 0 ? zeile('Sonstige', rest, undefined, '#8C8C8C', 'Parteien unter 1 %') : '')
  const st = v.staerkste ? farbe.get(v.staerkste) : undefined
  const staerkste = st ? `<span style="display:inline-block;padding:0 8px;background:${st.farbe};color:${textFarbe(st.farbe)}">${esc(st.kurz)}</span>` : '–'
  const bet = istKwb
    ? `Beteiligung ${pz(v.beteiligung)} (Stadt ${pz(g.beteiligung)}) · ${ganz(v.waehler)} von ${ganz(v.wahlberechtigte)} Wahlberechtigten`
    : `Beteiligung geschätzt ${pz(v.beteiligung)} (Stadt ${pz(g.beteiligung)}) · Urne ${pz(v.beteiligungUrne)}, ${ganz(v.urnenwaehler)} Urnenwähler, ${ganz(v.wahlscheine)} Wahlscheine, ${ganz(v.wahlberechtigte)} Wahlberechtigte`
  const fuss = istKwb
    ? 'Mit Briefwahl. Strich im Balken: Gesamtstadt, rechts Abstand in Prozentpunkten.'
    : 'Anteile nur Urnenwahl (Briefwahl wird je Briefwahlbezirk gezählt). Strich im Balken: Gesamtstadt, rechts Abstand in Prozentpunkten.'
  return `<section class="politik">${kopf}`
    + `<div style="margin:0 0 8px">Stärkste Kraft ${staerkste}</div>`
    + `<div style="margin:0 0 8px">${bet}</div>`
    + balken
    + `<p style="margin:8px 0 0;font-size:12px;color:#555">${fuss}${w.hinweis ? ' ' + esc(w.hinweis) + '.' : ''} Stand ${esc(w.datum.split('-').reverse().join('.'))}.</p></section>`
}

/** Kurze Legende zum Farbausdruck (HTML). */
export function wahlLegende(wahlId: string, modus: Farbmodus, partei?: string): string {
  const w = wahl(wahlId)
  if (!w) return ''
  const kasten = (f: string) => `<span style="display:inline-block;width:16px;height:16px;background:${f};vertical-align:middle;margin-right:8px"></span>`
  if (modus === 'staerkste') {
    const da = new Set<string>()
    for (const f of daten?.bezirke.features ?? []) { const s = f.properties[schluessel(wahlId, 'staerkste')]; if (typeof s === 'string') da.add(s) }
    return w.parteien.filter((p) => da.has(p.kurz)).map((p) => `<div>${kasten(p.farbe)}${esc(p.kurz)}</div>`).join('')
  }
  const [lo, hi] = grenzen(wahlId, modus === 'beteiligung' ? 'beteiligung' : (partei ?? w.gesamt.staerkste ?? ''))
  const f = modus === 'beteiligung' ? ['#EEF3F9', '#0B3F7A'] : [HELL, w.parteien.find((p) => p.kurz === partei)?.farbe ?? '#555555']
  return `<div>${kasten(f[0])}${pz(modus === 'beteiligung' ? lo : 0)}</div><div>${kasten(f[1])}${pz(hi)}</div><div>${kasten(KEINE)}kein Ergebnis</div>`
}

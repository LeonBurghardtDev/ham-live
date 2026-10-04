import type * as GeoJSON from 'geojson'
import { BBOX, hole, type Ergebnis, type Quelle, type Zeile } from './live.ts'

/**
 * Weitere Echtzeitquellen für Hamm (gleiche Typen wie live.ts):
 * Verkehrslage (Verkehr.NRW), ÖPNV-Störungen (Westfalenfahrplan), Blitzer-Schwerpunkte der Woche (Stadt Hamm),
 * Ladesäulen mit Belegung (Stadt Hamm). Linien tragen properties.lage, Punkte properties.icon.
 */

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const pt = (lon: number, lat: number, props: Record<string, unknown>): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props })
const datum = (d: Date) => d.toLocaleDateString('de-DE', d.getFullYear() === new Date().getFullYear() ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', year: 'numeric' })
const tagKurz = (d: Date) => d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '') + ' ' + datum(d)
const zahl = (v: number, st = 0) => v.toLocaleString('de-DE', { maximumFractionDigits: st, minimumFractionDigits: st })

/** Länge eines Linienzugs in Metern (Näherung für Hamm). */
function laenge(c: number[][]) {
  const kx = 111320 * Math.cos((51.68 * Math.PI) / 180), ky = 111320
  let s = 0
  for (let i = 1; i < c.length; i++) s += Math.hypot((c[i][0] - c[i - 1][0]) * kx, (c[i][1] - c[i - 1][1]) * ky)
  return s
}
const mitte = (c: number[][]) => c[Math.floor(c.length / 2)]

// ---------------------------------------------------------------- Straßen (OSM, aus daten/strassen.py)

type StrassenEintrag = { b: string; l: number[][][] }
let strassen: Record<string, StrassenEintrag[]> | null = null
let strassenRaster: Map<string, string[]> | null = null
const ZELLE = 0.002 // Grad, rund 140 × 220 m

/** Lädt web/public/daten/strassen.json einmal (Straßenname → Linienzüge je Stadtbezirk). */
export async function strassenLaden() {
  if (!strassen) strassen = (await (await fetch('/daten/strassen.json')).json()).strassen
  return strassen!
}

/** Nächster Straßenname zu einem Punkt (Rasterindex über alle Stützpunkte, max. ~150 m). */
async function naechsteStrasse(lon: number, lat: number): Promise<string | undefined> {
  const s = await strassenLaden()
  if (!strassenRaster) {
    strassenRaster = new Map()
    for (const [name, eintraege] of Object.entries(s)) for (const e of eintraege) for (const l of e.l) for (const [x, y] of l) {
      const k = `${Math.floor(x / ZELLE)}_${Math.floor(y / ZELLE)}`
      const liste = strassenRaster.get(k)
      if (!liste) strassenRaster.set(k, [name])
      else if (liste[liste.length - 1] !== name) liste.push(name)
    }
  }
  const zx = Math.floor(lon / ZELLE), zy = Math.floor(lat / ZELLE)
  let best: string | undefined, bd = Infinity
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const name of new Set(strassenRaster.get(`${zx + dx}_${zy + dy}`) ?? [])) {
      for (const e of s[name]) for (const l of e.l) for (const [x, y] of l) {
        const d = Math.hypot((x - lon) * 0.62, y - lat)
        if (d < bd) { bd = d; best = name }
      }
    }
  }
  return best
}

// ---------------------------------------------------------------- 1. Verkehrslage Verkehr.NRW

export type Lage = 'frei' | 'dicht' | 'zaeh' | 'stau' | 'unbekannt'
const LOS: Record<string, Lage> = { LOS1: 'frei', LOS2: 'dicht', LOS3: 'zaeh', LOS4: 'stau', LOS_CLOSED: 'stau' }
const LAGE_TEXT: Record<Lage, string> = { frei: 'frei', dicht: 'dicht', zaeh: 'zähfließend', stau: 'Stau', unbekannt: 'unbekannt' }
const lage = (v: unknown): Lage => LOS[String(v)] ?? 'unbekannt'

const VERKEHR_NRW = 'https://www.verkehr.nrw/geoserver/vipnrw/wfs?' + new URLSearchParams({
  service: 'WFS', version: '1.1.0', request: 'GetFeature', typeName: 'vipnrw:traffic_los_status_lines',
  outputFormat: 'application/json', srsName: 'EPSG:4326', propertyName: 'linestring,los,los15,los30,los45,roadclass',
  // „linestring“ ist in CQL ein Schlüsselwort, deshalb in Anführungszeichen; unbekannte Abschnitte filtert der Server
  cql_filter: `BBOX("linestring",${BBOX.w},${BBOX.s},${BBOX.e},${BBOX.n},'EPSG:4326') AND los<>'LOS_UNKNOWN'`,
})

export const verkehrslage: Quelle = {
  id: 'verkehrslage', name: 'Verkehrslage Hamm', takt: 120,
  lizenz: 'Verkehr.NRW (Straßen.NRW), Verkehrslage teils TomTom – Nutzungsbedingungen Verkehr.NRW, nur privat',
  async laden(): Promise<Ergebnis> {
    const d = await hole(VERKEHR_NRW, 110)
    const feats: GeoJSON.Feature[] = []
    const km: Record<Lage, number> = { frei: 0, dicht: 0, zaeh: 0, stau: 0, unbekannt: 0 }
    let gesperrt = 0
    const auffaellig: { c: number[][]; l: Lage; zu: boolean; m: number }[] = []
    for (const f of d.features ?? []) {
      const p = f.properties ?? {}
      const l = lage(p.los)
      if (l === 'unbekannt' || !f.geometry) continue
      const teile: number[][][] = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates]
      const zu = p.los === 'LOS_CLOSED'
      if (zu) gesperrt++
      const prog = [lage(p.los15), lage(p.los30), lage(p.los45)]
      // Prognose knapp: gleichbleibend zusammenfassen, sonst nur die Änderungen
      const sub = prog.every((x) => x === l || x === 'unbekannt') ? 'Prognose: bleibt in den nächsten 45 Minuten so'
        : 'Prognose: ' + prog.map((x, i) => `in ${(i + 1) * 15} min ${LAGE_TEXT[x]}`).join(', ')
      for (const c of teile) {
        const m = laenge(c)
        km[l] += m / 1000
        if (l === 'stau' || l === 'zaeh') auffaellig.push({ c, l, zu, m })
        feats.push({
          type: 'Feature', geometry: { type: 'LineString', coordinates: c },
          properties: { lage: l, prognose15: prog[0], prognose30: prog[1], prognose45: prog[2], gesperrt: zu, klasse: p.roadclass, titel: zu ? 'Gesperrt' : 'Verkehr ' + LAGE_TEXT[l], sub },
        })
      }
    }
    const zeilen: Zeile[] = []
    // Eingefrorene Daten erkennen: der Server vergleicht jede Aufzeichnung (alle 5 min) mit der vorigen
    const st = await fetch('/api/verkehr-stand').then((r) => r.json()).catch(() => ({})) as { unveraendertSeit?: string; letzte?: string }
    const seit = st.unveraendertSeit ? new Date(st.unveraendertSeit) : undefined
    if (seit && st.letzte && new Date(st.letzte).getTime() - seit.getTime() >= 20 * 60000) {
      const uhr = seit.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
      // Ersatz: aktuelle Staumeldungen (TomTom). Abschnitte bis 400 m um eine Meldung gelten als gestört, alle anderen als frei.
      const meldungen = await hole(STAU_NRW, 110).then((d) => (d.features ?? []).filter((f: any) => f.geometry?.type === 'Point' && !f.properties?.future).map((f: any) => f.geometry.coordinates as number[])).catch(() => undefined) as number[][] | undefined
      for (const f of feats) {
        const p = f.properties!
        p.lageAlt = p.lage
        if (!meldungen) { p.lage = 'veraltet'; p.titel = 'Stand ' + uhr + ' Uhr'; p.sub = 'Verkehr.NRW liefert seitdem keine neuen Daten'; continue }
        const [x, y] = mitte((f.geometry as GeoJSON.LineString).coordinates)
        const nah = meldungen.some(([mx, my]) => Math.hypot((mx - x) * 69100, (my - y) * 110540) < 400)
        p.lage = nah ? 'zaeh' : 'frei'
        p.titel = nah ? 'Stau gemeldet' : 'Keine Staumeldung'
        p.sub = 'abgeleitet aus den Staumeldungen (TomTom), Verkehr.NRW liefert seit ' + uhr + ' Uhr keine neue Verkehrslage'
      }
      zeilen.push({ text: `Keine aktuellen Verkehrsdaten seit ${uhr} Uhr`, klein: meldungen ? 'Verkehr.NRW liefert seitdem unveränderte Werte. Die Farben sind aus den aktuellen Staumeldungen abgeleitet: grün heißt keine Meldung.' : 'Verkehr.NRW liefert seitdem unveränderte Werte. Die Linien sind grau und zeigen den letzten Stand.', stufe: 'warnung' })
      zeilen.push({ text: `Erfasst: ${zahl(km.frei + km.dicht + km.zaeh + km.stau)} km Straße`, klein: `Stand ${uhr} Uhr`, stufe: 'info' })
      return { zeilen, punkte: fc(feats), stand: new Date() }
    }
    // Auffällige Abschnitte mit Straßenname (nächste OSM-Straße), längste zuerst
    auffaellig.sort((a, b) => Number(b.l === 'stau') - Number(a.l === 'stau') || b.m - a.m)
    const gesehen = new Set<string>()
    for (const a of auffaellig) {
      if (zeilen.length >= 15) break
      const [lon, lat] = mitte(a.c)
      const name = (await naechsteStrasse(lon, lat).catch(() => undefined)) ?? 'Abschnitt im Umland'
      const key = name + a.l
      if (gesehen.has(key)) continue
      gesehen.add(key)
      zeilen.push({ text: `${a.zu ? 'Gesperrt' : LAGE_TEXT[a.l][0].toUpperCase() + LAGE_TEXT[a.l].slice(1)}: ${name}`, klein: `${zahl(a.m)} m`, stufe: a.l === 'stau' ? 'alarm' : 'warnung', lon, lat })
    }
    // Hamm zuerst: Abschnitte ohne Straße in Hamm ans Ende
    zeilen.sort((x, y) => Number(x.text.endsWith('Abschnitt im Umland')) - Number(y.text.endsWith('Abschnitt im Umland')))
    zeilen.push({ text: `Erfasst: ${zahl(km.frei + km.dicht + km.zaeh + km.stau)} km Straße`, klein: `frei ${zahl(km.frei)} km · dicht ${zahl(km.dicht, 1)} km · zähfließend ${zahl(km.zaeh, 1)} km · Stau ${zahl(km.stau, 1)} km${gesperrt ? ` · ${gesperrt} gesperrt` : ''}`, stufe: 'info' })
    return { zeilen, punkte: fc(feats), stand: new Date() }
  },
}

// ---------------------------------------------------------------- 1b. Staumeldungen (TomTom über Verkehr.NRW)

const STAU_NRW = 'https://www.verkehr.nrw/geoserver/vipnrw/wfs?' + new URLSearchParams({
  service: 'WFS', version: '1.1.0', request: 'GetFeature', typeName: 'vipnrw:traffic_abnormal_travel_time_loss_feature',
  outputFormat: 'application/json', srsName: 'EPSG:4326',
  cql_filter: `BBOX("point",${BBOX.w},${BBOX.s},${BBOX.e},${BBOX.n},'EPSG:4326')`,
})
const TREND: Record<string, string> = { TRAFFIC_BUILDING_UP: 'wächst', TRAFFIC_EASING: 'löst sich auf', TRAFFIC_STABLE: 'gleichbleibend' }

/** Staus mit Zeitverlust (TomTom-Meldungen, laufend aktualisiert); unabhängig von der Verkehrslage-Ebene */
export const staumeldungen: Quelle = {
  id: 'staumeldungen', name: 'Staumeldungen', takt: 120,
  lizenz: 'Verkehr.NRW (Straßen.NRW), Meldungen TomTom – Nutzungsbedingungen Verkehr.NRW, nur privat',
  async laden(): Promise<Ergebnis> {
    const d = await hole(STAU_NRW, 110)
    const feats: GeoJSON.Feature[] = []
    const zeilen: Zeile[] = []
    const liste = (d.features ?? []).filter((f: any) => f.geometry?.type === 'Point' && !f.properties?.future)
      .sort((a: any, b: any) => (b.properties.travel_time_loss ?? 0) - (a.properties.travel_time_loss ?? 0))
    for (const f of liste) {
      const p = f.properties, [lon, lat] = f.geometry.coordinates
      const min = Math.round((p.travel_time_loss ?? 0) / 60)
      const name = (await naechsteStrasse(lon, lat).catch(() => undefined)) ?? 'Umland'
      const text = `Stau: ${name}${min ? `, +${min} min` : ''}`
      const klein = [TREND[p.trend], p.urban ? 'innerorts' : 'außerorts'].filter(Boolean).join(' · ')
      zeilen.push({ text, klein, stufe: min >= 5 ? 'alarm' : 'warnung', lon, lat })
      feats.push(pt(lon, lat, { titel: text, sub: klein, icon: 'stau' }))
    }
    if (!zeilen.length) zeilen.push({ text: 'Keine Staus im Raum Hamm gemeldet', stufe: 'info' })
    return { zeilen, punkte: fc(feats), stand: new Date() }
  },
}

// ---------------------------------------------------------------- 1c. Baustellen, Sperrungen, Umleitungen (Verkehr.NRW, Mobilithek)

const NRW_WFS = (typ: string, geo: string) => 'https://www.verkehr.nrw/geoserver/vipnrw/wfs?' + new URLSearchParams({
  service: 'WFS', version: '1.1.0', request: 'GetFeature', typeName: `vipnrw:${typ}`, outputFormat: 'application/json', srsName: 'EPSG:4326',
  cql_filter: `BBOX("${geo}",7.68,51.585,8.03,51.765,'EPSG:4326')`,
})
const ART_NRW: Record<string, { name: string; lage: string; icon: string; stufe: Zeile['stufe'] }> = {
  CLOSURE: { name: 'Sperrung', lage: 'baustelle', icon: 'sperrung', stufe: 'warnung' },
  OBSTRUCTION: { name: 'Sperrung', lage: 'baustelle', icon: 'sperrung', stufe: 'warnung' },
  ROADWORKS: { name: 'Baustelle', lage: 'baustelle', icon: 'baustelle', stufe: 'info' },
  ROAD_MAINTENANCE: { name: 'Baustelle', lage: 'baustelle', icon: 'baustelle', stufe: 'info' },
  REROUTING: { name: 'Umleitung', lage: 'umleitung', icon: 'warnung', stufe: 'info' },
}
const RANG_NRW = ['Sperrung', 'Baustelle', 'Umleitung']
const datumNrw = (s?: string) => (s ? new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '')

/** Amtlich gemeldete Baustellen, Sperrungen und Umleitungen im Stadtgebiet (kommunal und Straßen.NRW über die Mobilithek) */
export const baustellenNrw: Quelle = {
  id: 'baustellen_nrw', name: 'Baustellen und Sperrungen (Verkehr.NRW)', takt: 1800,
  lizenz: 'Verkehr.NRW (Straßen.NRW, Kommunen über Mobilithek) – Nutzungsbedingungen Verkehr.NRW, nur privat',
  async laden(): Promise<Ergebnis> {
    const [lin1, lin2, pkt1, pkt2] = await Promise.all([
      hole(NRW_WFS('traffic_roadworks_lines', 'linestring'), 1700), hole(NRW_WFS('traffic_obstructions_lines', 'linestring'), 1700),
      hole(NRW_WFS('traffic_roadworks_urban_feature', 'point'), 1700), hole(NRW_WFS('traffic_obstructions_urban_feature', 'point'), 1700),
    ].map((p) => p.catch(() => ({ features: [] }))))
    const feats: GeoJSON.Feature[] = []
    const eintraege = new Map<string, { art: typeof ART_NRW[string]; strasse: string; von?: string; bis?: string; info?: string; lon: number; lat: number }>()
    const merke = async (art: typeof ART_NRW[string] | undefined, lon: number, lat: number, p: any) => {
      if (!art || p.future) return
      const strasse = (await naechsteStrasse(lon, lat).catch(() => undefined)) ?? 'Umland'
      const k = art.name + strasse
      const info = String(p.info ?? '').split('|').map((x: string) => x.trim()).filter((x: string) => x && !/^Länge: 0\.0 km$/.test(x)).join(' · ')
      const alt = eintraege.get(k)
      if (!alt || (info && !alt.info)) eintraege.set(k, { art, strasse, von: p.start_timestamp, bis: p.end_timestamp, info, lon, lat })
    }
    for (const f of [...lin1.features, ...lin2.features]) {
      if (f.geometry?.type !== 'LineString') continue
      const art = ART_NRW[f.properties?.type]
      const c = f.geometry.coordinates as number[][]
      const [lon, lat] = mitte(c)
      feats.push({ type: 'Feature', geometry: f.geometry, properties: { lage: art?.lage ?? 'baustelle', titel: art?.name ?? 'Baustelle', sub: `bis ${datumNrw(f.properties?.end_timestamp)}` } })
      await merke(art, lon, lat, f.properties ?? {})
    }
    for (const f of [...pkt1.features, ...pkt2.features]) {
      if (f.geometry?.type !== 'Point') continue
      const [lon, lat] = f.geometry.coordinates
      await merke(ART_NRW[f.properties?.display_type], lon, lat, f.properties ?? {})
    }
    const zeilen: Zeile[] = []
    const reihen = [...eintraege.values()].filter((e) => e.strasse !== 'Umland')
      .sort((a, b) => RANG_NRW.indexOf(a.art.name) - RANG_NRW.indexOf(b.art.name) || a.strasse.localeCompare(b.strasse, 'de'))
    for (const e of reihen) {
      zeilen.push({ text: `${e.art.name}: ${e.strasse}`, klein: [e.von && new Date(e.von) > new Date(Date.now() - 30 * 86400000) ? `seit ${datumNrw(e.von)}` : '', e.bis ? `bis ${datumNrw(e.bis)}` : '', e.info].filter(Boolean).join(' · '), stufe: e.art.stufe, lon: e.lon, lat: e.lat })
      feats.push(pt(e.lon, e.lat, { titel: `${e.art.name}: ${e.strasse}`, sub: e.bis ? `bis ${datumNrw(e.bis)}` : '', icon: e.art.icon }))
    }
    if (!zeilen.length) zeilen.push({ text: 'Keine Baustellen gemeldet', stufe: 'info' })
    return { zeilen, punkte: fc(feats), stand: new Date() }
  },
}

// ---------------------------------------------------------------- 2. ÖPNV-Störungen Westfalenfahrplan

type Haltestelle = [string, number, number]
let haltestellen: Map<string, [number, number]> | null = null
const halteName = (s: string) => s.toLowerCase().replace(/\(westf\)/g, '').replace(/str\.(?=\s|$)/g, 'straße').replace(/[^a-zäöüß0-9]+/g, ' ').trim()

/** Haltestellenkoordinaten aus dem GTFS-Export (fahrplan.json), Schlüssel normalisierter Name. */
async function halteKoordinaten() {
  if (!haltestellen) {
    haltestellen = new Map()
    const fp = await (await fetch('/daten/fahrplan.json')).json()
    for (const [n, lat, lon] of fp.stops as Haltestelle[]) if (!haltestellen.has(halteName(n))) haltestellen.set(halteName(n), [lon, lat])
  }
  return haltestellen
}

const BETREIBER_HAMM = /Stadtwerke Hamm/
const RRL = /Regionalverkehr Ruhr-Lippe/
const ohneHtml = (s: string) => entities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

export const oepnvStoerungen: Quelle = {
  id: 'oepnv_stoerungen', name: 'Bus: Störungen und Umleitungen', takt: 600, lizenz: 'Westfalenfahrplan (EFA, NWL), nur privat',
  async laden(): Promise<Ergebnis> {
    const d = await hole('https://www.westfalenfahrplan.de/nwl-efa/XML_ADDINFO_REQUEST?outputFormat=rapidJSON&filterPublished=1', 300)
    const alle: any[] = Object.values<any>(d.infos ?? {}).flat()
    const jetzt = Date.now()
    const hk = await halteKoordinaten().catch(() => new Map<string, [number, number]>())
    const zeilen: Zeile[] = []
    const feats: GeoJSON.Feature[] = []
    const ids = new Set<string>()
    for (const i of alle) {
      if (!i || ids.has(i.id)) continue
      const a = i.affected ?? {}
      const linien: any[] = a.lines ?? []
      const stops: any[] = a.stops ?? []
      const link = i.infoLinks?.[0] ?? {}
      const titel = ohneHtml(link.title ?? link.subtitle ?? link.urlText ?? '')
      const hammStops = stops.filter((s) => /^de:05915:/.test(s.id ?? '') || /^Hamm\b/.test(s.parent?.name ?? ''))
      const relevant = linien.some((l) => BETREIBER_HAMM.test(l.operator?.name ?? ''))
        || hammStops.length > 0
        || (linien.some((l) => RRL.test(l.operator?.name ?? '')) && /\bHamm\b/.test(titel + ' ' + (link.content ?? '')))
      if (!relevant) continue
      const gueltig: { from?: string; to?: string }[] = i.timestamps?.validity ?? []
      const bis = Math.max(...gueltig.map((g) => (g.to ? Date.parse(g.to) : Infinity)), 0)
      if (gueltig.length && bis < jetzt) continue
      ids.add(i.id)
      const von = Math.min(...gueltig.map((g) => (g.from ? Date.parse(g.from) : jetzt)))
      const nummern = [...new Set(linien.map((l) => String(l.number ?? l.name ?? '').trim()).filter(Boolean))]
        .sort((x, y) => x.localeCompare(y, 'de', { numeric: true }))
      const zeit = gueltig.length ? `${von > jetzt ? 'ab ' : 'seit '}${datum(new Date(von))}${Number.isFinite(bis) ? ' bis ' + datum(new Date(bis)) : ''}` : ''
      const zukunft = von > jetzt
      const erster = hammStops.map((s) => hk.get(halteName(s.name ?? ''))).find(Boolean)
      zeilen.push({
        text: titel || 'Hinweis',
        klein: [nummern.length ? 'Linie ' + nummern.join(', ') : '', zeit].filter(Boolean).join(' · '),
        stufe: zukunft ? 'info' : i.priority === 'high' || i.priority === 'veryHigh' ? 'warnung' : 'info',
        rang: zukunft ? 1 : 0, link: link.url, lon: erster?.[0], lat: erster?.[1],
      })
      for (const s of hammStops) {
        const k = hk.get(halteName(s.name ?? ''))
        if (k) feats.push(pt(k[0], k[1], { titel: String(s.name ?? '').replace('Hamm (Westf), ', ''), sub: titel, icon: 'warnung', linien: nummern.join(', ') }))
      }
    }
    zeilen.sort((x, y) => (x.rang ?? 0) - (y.rang ?? 0))
    if (!zeilen.length) zeilen.push({ text: 'Keine Störungsmeldungen für Busse in Hamm', stufe: 'info' })
    return { zeilen, punkte: fc(feats), stand: new Date() }
  },
}

// ---------------------------------------------------------------- 3. Blitzer-Schwerpunkte der Woche (Stadt Hamm)

const ENT: Record<string, string> = {
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>',
  eacute: 'é', egrave: 'è', ndash: '–', mdash: '—', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚', hellip: '…',
}
/** HTML-Entities dekodieren (benannt und numerisch), ohne DOM. */
export function entities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m)
}

export type BlitzerTag = { datum: Date; tag: string; orte: { bezirk: string; strasse: string }[] }

/** Schwerpunkte aus dem Meldungstext: „Am Montag, 05.10.2026, …“ gefolgt von „- Bezirk, Straße“. */
export function blitzerParsen(html: string): BlitzerTag[] {
  const text = entities(html.replace(/<\/(p|div|li)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
  const tage: BlitzerTag[] = []
  let akt: BlitzerTag | null = null
  for (const roh of text.split('\n')) {
    const z = roh.replace(/\s+/g, ' ').trim()
    const t = z.match(/^Am \p{L}+,? (\d{1,2})\.(\d{1,2})\.(\d{4})/u)
    if (t) {
      const d = new Date(Number(t[3]), Number(t[2]) - 1, Number(t[1]))
      akt = { datum: d, tag: tagKurz(d), orte: [] }
      tage.push(akt)
      continue
    }
    const o = z.match(/^[-–•]\s*([^,]+),\s*(.+)$/)
    if (o && akt) akt.orte.push({ bezirk: o[1].trim(), strasse: o[2].trim().replace(/\.$/, '') })
  }
  return tage
}

const BEZIRK = (b: string) => b.replace(/^Hamm-/, '').toLowerCase()

export const blitzerWoche: Quelle = {
  id: 'blitzer_woche', name: 'Blitzer-Schwerpunkte der Woche', takt: 3600,
  lizenz: 'Stadt Hamm, Pressemitteilung über presse-service.de (nur Fakten, Text nicht übernommen), nur privat',
  async laden(): Promise<Ergebnis> {
    const rss: string = await hole('https://www.presse-service.de/rss.aspx?p=1256', 1800, 'text')
    const items = rss.split(/<item>/).slice(1)
      .filter((i) => /Geschwindigkeits(ü|&uuml;)berwachung/.test(i))
      .map((i) => ({ link: entities(i.match(/<link>([^<]+)<\/link>/)?.[1] ?? '').trim(), datum: Date.parse(i.match(/<pubDate>([^<]+)/)?.[1] ?? '') }))
      .filter((i) => i.link)
      .sort((a, b) => b.datum - a.datum)
      .slice(0, 2)
    const heute = new Date(); heute.setHours(0, 0, 0, 0)
    let tage: BlitzerTag[] = []
    for (const i of items) {
      const html: string = await hole(i.link, 3600, 'text').catch(() => '')
      const ab = html.indexOf('ps_meldungstext')
      tage.push(...blitzerParsen(ab >= 0 ? html.slice(ab) : html))
    }
    // gleiche Tage aus zwei Meldungen nur einmal, nur heute und folgende Tage
    const proTag = new Map<number, BlitzerTag>()
    for (const t of tage) if (!proTag.has(t.datum.getTime())) proTag.set(t.datum.getTime(), t)
    tage = [...proTag.values()].sort((a, b) => a.datum.getTime() - b.datum.getTime())
    const kommend = tage.filter((t) => t.datum >= heute)
    if (kommend.length) tage = kommend
    else tage = tage.slice(-6)
    const s = await strassenLaden().catch(() => ({} as Record<string, StrassenEintrag[]>))
    const feats: GeoJSON.Feature[] = []
    const zeilen: Zeile[] = []
    for (const t of tage) {
      const istHeute = t.datum.getTime() === heute.getTime()
      let erster: number[] | undefined
      for (const o of t.orte) {
        const eintraege = s[o.strasse] ?? []
        const passend = eintraege.filter((e) => BEZIRK(e.b) === BEZIRK(o.bezirk))
        for (const e of passend.length ? passend : eintraege) for (const l of e.l) {
          erster ??= mitte(l)
          feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: l }, properties: { lage: 'blitzer', tag: t.tag, heute: istHeute, titel: 'Geschwindigkeitsmessung ' + t.tag, sub: `${o.strasse} (${o.bezirk})` } })
        }
      }
      zeilen.push({
        text: `${istHeute ? 'Heute' : t.tag}: ${t.orte.map((o) => o.strasse).join(', ') || '–'}`,
        klein: t.orte.map((o) => o.bezirk).join(', ') + (istHeute ? ' · ' + t.tag : ''),
        stufe: istHeute ? 'warnung' : 'info', lon: erster?.[0], lat: erster?.[1], link: items[0]?.link,
      })
    }
    if (!zeilen.length) zeilen.push({ text: 'Keine Schwerpunkte veröffentlicht', stufe: 'info' })
    return { zeilen, punkte: fc(feats), stand: new Date() }
  },
}

// ---------------------------------------------------------------- 4. Ladesäulen mit Belegung (Stadt Hamm)

const LADE_WFS = 'https://www.hamm.de/wmsserver/qgisserver/qgis_mapserv.fcgi.exe?MAP=C:/qgis_server_daten/od_digitale_infrastruktur.qgs&SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature&TYPENAME=E-Ladestationen&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326'

type Ladepunkt = 'frei' | 'belegt' | 'gestoert' | 'unbekannt'
function ladeStatus(s: string): Ladepunkt {
  if (/verf(ü|u)gbar/i.test(s) && !/nicht/i.test(s)) return 'frei'
  if (/ladevorgang|charging|occupied|belegt/i.test(s)) return 'belegt'
  if (/outoforder|st(ö|o)rung|defekt|inoperative/i.test(s)) return 'gestoert'
  return 'unbekannt'
}

export const ladesaeulenLive: Quelle = {
  id: 'ladesaeulen_live', name: 'Ladesäulen (Belegung)', takt: 300,
  lizenz: 'Stadt Hamm, E-Ladestationen (WFS), Datenlizenz Deutschland – Namensnennung – Version 2.0',
  async laden(): Promise<Ergebnis> {
    const d = await hole(LADE_WFS, 240)
    // Stationen (haupt_id) → Ladepunkte (evses_uid) → Stecker
    const st = new Map<string, { lon: number; lat: number; lage: string; betreiber: string; kw: number; stecker: Set<string>; punkte: Map<string, Ladepunkt> }>()
    for (const f of d.features ?? []) {
      const p = f.properties ?? {}
      const [lon, lat] = f.geometry?.coordinates ?? []
      if (lon == null) continue
      const id = String(p.haupt_id ?? `${lon},${lat}`)
      let s = st.get(id)
      if (!s) st.set(id, s = { lon, lat, lage: String(p.lage ?? '').replace(/\s+/g, ' ').trim(), betreiber: String(p.betreiber ?? '').trim(), kw: 0, stecker: new Set(), punkte: new Map() })
      s.kw = Math.max(s.kw, Number(String(p.max_leistung ?? '').match(/[\d.,]+/)?.[0]?.replace(',', '.') ?? 0))
      const typ = String(p.stecker_typ ?? '').replace(/^Steckertyp:\s*/, '').trim()
      if (typ) s.stecker.add(typ)
      const evse = String(p.evses_uid ?? p.connector_id ?? s.punkte.size)
      const neu = ladeStatus(String(p.status ?? ''))
      const alt = s.punkte.get(evse)
      // ein Ladepunkt mit mehreren Steckern: frei gewinnt, sonst belegt vor gestört vor unbekannt
      const ordnung: Ladepunkt[] = ['frei', 'belegt', 'gestoert', 'unbekannt']
      if (!alt || ordnung.indexOf(neu) < ordnung.indexOf(alt)) s.punkte.set(evse, neu)
    }
    const feats: GeoJSON.Feature[] = []
    const zeilen: Zeile[] = []
    let frei = 0, gesamt = 0, gestoert = 0
    for (const s of st.values()) {
      const werte = [...s.punkte.values()]
      const f = werte.filter((w) => w === 'frei').length
      const g = werte.filter((w) => w === 'gestoert').length
      frei += f; gesamt += werte.length; gestoert += g
      const schnell = s.kw >= 50
      const titel = s.lage || 'Ladestation'
      const sub = `${f} von ${werte.length} frei${g ? ` · ${g} gestört` : ''} · ${zahl(s.kw)} kW · ${[...s.stecker].join(', ')}${s.betreiber ? ' · ' + s.betreiber : ''}`
      feats.push(pt(s.lon, s.lat, { titel, sub, icon: f ? (schnell ? 'lade-schnell' : 'lade') : 'lade-belegt', frei: f, gesamt: werte.length, kw: s.kw }))
      zeilen.push({ text: `${titel}: ${f} von ${werte.length} frei`, klein: sub.split(' · ').slice(1).join(' · '), stufe: f ? undefined : 'warnung', lon: s.lon, lat: s.lat, rang: f ? (schnell ? 1 : 2) : 3 })
    }
    zeilen.sort((a, b) => (a.rang ?? 0) - (b.rang ?? 0) || a.text.localeCompare(b.text, 'de'))
    zeilen.unshift({ text: `${frei} von ${gesamt} Ladepunkten frei`, klein: `${st.size} Standorte${gestoert ? ` · ${gestoert} gestört` : ''}`, stufe: 'info', rang: 0 })
    return { zeilen, punkte: fc(feats), stand: new Date() }
  },
}

/** Alle Quellen dieses Moduls, zum Anhängen an QUELLEN aus live.ts. */
export const QUELLEN_HAMM: Quelle[] = [verkehrslage, staumeldungen, baustellenNrw, oepnvStoerungen, blitzerWoche, ladesaeulenLive]

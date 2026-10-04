import type * as GeoJSON from 'geojson'
import { BBOX, HAMM, hole, type Ergebnis, type Quelle, type Zeile } from './live.ts'

/**
 * Parken in Hamm.
 * - Parkhäuser, Tiefgaragen und große Parkplätze: Lage und Kapazität aus OSM (daten/parken.py → /daten/parken.geojson, ODbL).
 *   Eine offene Live-Belegung der städtischen Anlagen gibt es nicht (Parkleitsystem nur über mobilitaetsplan-hamm.de mit Anmeldung).
 * - Live: Lkw-Parkplätze an den Autobahnen um Hamm (Toll Collect über die ParkAPI von MobiData BW, ohne Schlüssel, Lizenz nicht angegeben → nur privat).
 * Punkte tragen properties.icon 'parken' bzw. 'parken-voll', titel, sub.
 */

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const pt = (lon: number, lat: number, props: Record<string, unknown>): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props })
const inHamm = (lon: number, lat: number) => lon >= BBOX.w && lon <= BBOX.e && lat >= BBOX.s && lat <= BBOX.n
const zahl = (v: number) => v.toLocaleString('de-DE')
const abstand = (lon: number, lat: number) => Math.hypot((lon - HAMM.lon) * 69.2, (lat - HAMM.lat) * 111.3) // km
const km = (d: number) => d.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' km'

const PARKAPI = `https://api.mobidata-bw.de/park-api/api/public/v3/parking-sites?lat=${HAMM.lat}&lon=${HAMM.lon}&radius=15000`

type Anlage = { name: string; art: string; kapazitaet: number | null; betreiber?: string | null; gebuehr?: string | null; oeffnungszeiten?: string | null; maxhoehe?: string | null }
let statisch: GeoJSON.Feature[] | null = null

async function osmAnlagen() {
  if (!statisch) statisch = ((await (await fetch('/daten/parken.geojson')).json()).features as GeoJSON.Feature[])
    .filter((f) => { const [x, y] = (f.geometry as GeoJSON.Point).coordinates; return inHamm(x, y) })
  return statisch
}

export const parken: Quelle = {
  id: 'parken', name: 'Parken', takt: 120,
  lizenz: 'Parkhäuser: © OpenStreetMap-Mitwirkende (ODbL), ohne Live-Belegung · Lkw-Parken Autobahn live: Toll Collect über ParkAPI MobiData BW (Lizenz nicht angegeben, nur privat)',
  async laden(): Promise<Ergebnis> {
    const feats: GeoJSON.Feature[] = []
    const zeilen: Zeile[] = []
    let fehler: string | undefined

    // Live: Lkw-Parken Autobahn (nur mit Echtzeitwert)
    const live: (Zeile & { d: number })[] = []
    try {
      const d = await hole(PARKAPI, 110)
      for (const s of d.items ?? []) {
        if (!s.has_realtime_data || s.realtime_free_capacity == null || !inHamm(s.lon, s.lat)) continue
        const kap = Number(s.realtime_capacity ?? s.capacity ?? 0), frei = Number(s.realtime_free_capacity)
        const voll = kap > 0 && frei / kap < 0.1
        const lkw = (s.restrictions ?? []).some((r: any) => r.type === 'TRUCK')
        const titel = `${lkw ? 'Lkw-Parken ' : ''}${s.name}`
        const sub = `${zahl(frei)} frei von ${zahl(kap)} · ${s.operator_name ?? ''} · Stand ${new Date(s.realtime_data_updated_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
        feats.push(pt(s.lon, s.lat, { icon: voll ? 'parken-voll' : 'parken', titel, sub }))
        live.push({ text: `${titel}: ${zahl(frei)} frei von ${zahl(kap)}`, klein: `live · ${km(abstand(s.lon, s.lat))} vom Marktplatz`, stufe: voll ? 'warnung' : undefined, lon: s.lon, lat: s.lat, d: abstand(s.lon, s.lat) })
      }
    } catch (e) { fehler = String(e) }

    // Statisch: Parkhäuser und große Parkplätze aus OSM, nach Nähe zum Marktplatz
    const haeuser: (Zeile & { d: number })[] = []
    for (const f of await osmAnlagen()) {
      const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates
      const p = f.properties as Anlage
      const kap = p.kapazitaet ? `${zahl(p.kapazitaet)} Plätze` : 'Kapazität unbekannt'
      const extra = [p.art, kap, p.betreiber, p.gebuehr === 'no' ? 'kostenlos' : p.gebuehr === 'yes' ? 'gebührenpflichtig' : '', p.oeffnungszeiten, p.maxhoehe ? `max. Höhe ${p.maxhoehe} m` : ''].filter(Boolean).join(' · ')
      feats.push(pt(lon, lat, { icon: 'parken', titel: p.name, sub: `${extra} · keine Live-Belegung verfügbar` }))
      if (p.art !== 'Parkplatz' || (p.kapazitaet ?? 0) >= 100) {
        haeuser.push({ text: `${p.name}: ${kap}`, klein: `${p.art} · ${km(abstand(lon, lat))} vom Marktplatz`, lon, lat, d: abstand(lon, lat) })
      }
    }
    haeuser.sort((a, b) => a.d - b.d)
    live.sort((a, b) => a.d - b.d)
    zeilen.push(...haeuser.slice(0, 20).map(({ d: _d, ...z }) => z))
    zeilen.push(...live.map(({ d: _d, ...z }) => z))
    if (fehler) zeilen.push({ text: 'Lkw-Parken live nicht erreichbar', klein: fehler, stufe: 'warnung' })
    return { zeilen, punkte: fc(feats), stand: new Date(), fehler: live.length || !fehler ? undefined : fehler }
  },
}

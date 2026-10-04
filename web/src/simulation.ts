/**
 * Tab „Simulation“: amtliche Was-wäre-wenn-Szenarien.
 * Hochwasser der Lippe (Gefahrenkarte MUNV NRW, drei Wahrscheinlichkeiten, wahlweise ohne Deiche),
 * Starkregen (Hinweiskarte Starkregengefahren des BKG) und Sonne und Schatten (3D-Gebäude).
 * Live-Bezug: Lippe-Pegel oberhalb von Hamm (Hochwasserportal NRW, LANUK, dl-de/zero-2-0, ungeprüfte Rohdaten).
 */
import type * as GeoJSON from 'geojson'
import { hole, type Ergebnis, type Quelle, type Zeile } from './live'

export type SimModus = 'hochwasser' | 'starkregen' | 'sonne'
export type HwStufe = 'hw' | 'mw' | 'nw'
export type SrStufe = 'agw' | 'extrem'

export const SIM_MODI: { id: SimModus; name: string }[] = [
  { id: 'hochwasser', name: 'Hochwasser' }, { id: 'starkregen', name: 'Starkregen' }, { id: 'sonne', name: 'Schatten' },
]
/** Ebenen-IDs aus ebenen.ts je Stufe */
export const HW_EBENE: Record<HwStufe, string> = { hw: 'hw_haeufig', mw: 'hochwasser', nw: 'hochwasser_ex' }
export const HW_OHNE: Record<HwStufe, string> = { hw: 'hw_ohne_hw', mw: 'hw_ohne_mw', nw: 'hw_ohne_nw' }
export const SR_EBENE: Record<SrStufe, string> = { agw: 'sr_agw', extrem: 'sr_extrem' }

export const HW_STUFEN: { id: HwStufe; name: string; text: string }[] = [
  { id: 'hw', name: 'Häufig', text: 'Statistisch etwa alle 10 bis 20 Jahre.' },
  { id: 'mw', name: 'Alle 100 Jahre', text: 'Statistisch einmal in 100 Jahren (HQ100).' },
  { id: 'nw', name: 'Extrem', text: 'Deutlich seltener als alle 100 Jahre.' },
]
export const SR_STUFEN: { id: SrStufe; name: string; text: string }[] = [
  { id: 'agw', name: 'Außergewöhnlich', text: 'Eine Stunde Regen, statistisch einmal in 100 Jahren.' },
  { id: 'extrem', name: 'Extrem', text: '100 mm Regen in einer Stunde.' },
]
export const SIM_LIZENZ = {
  hochwasser: 'Hochwassergefahrenkarte © MUNV NRW (dl-de/by-2-0)',
  starkregen: 'Hinweiskarte Starkregengefahren © BKG (dl-de/by-2-0)',
  sonne: 'Gebäude: 3D-Gebäudemodell LoD2 © Geobasis NRW (dl-de/zero-2-0), Sonnenstand berechnet',
}

const PEGEL: { nr: string; name: string; lon: number; lat: number }[] = [
  { nr: '2785790000300', name: 'Lippe bei Kesseler (vor Hamm)', lon: 8.08938, lat: 51.66297 },
  { nr: '2785710000100', name: 'Lippe bei Hovestadt', lon: 8.14416, lat: 51.65969 },
]

export const lippe: Quelle = {
  id: 'lippe', name: 'Lippe-Pegel', takt: 900, lizenz: 'Hochwasserportal NRW, LANUK (dl-de/zero-2-0, ungeprüfte Rohdaten)',
  async laden(): Promise<Ergebnis> {
    const zeilen: Zeile[] = []
    const fs: GeoJSON.Feature[] = []
    for (const p of PEGEL) {
      const d = await hole(`https://www.hochwasserportal.nrw/data/internet/stations/100/${p.nr}/S/week.json`, 900).catch(() => null)
      const reihe = ((d?.[0]?.data ?? []) as [string, number | null][]).filter((x): x is [string, number] => typeof x[1] === 'number')
      if (!reihe.length) continue
      const [zeit, wert] = reihe[reihe.length - 1]
      const vor3h = reihe[Math.max(0, reihe.length - 13)][1]
      const werte = reihe.map((x) => x[1])
      const diff = wert - vor3h
      const trend = Math.abs(diff) < 2 ? 'gleichbleibend' : diff > 0 ? `steigt (+${Math.round(diff)} cm in 3 h)` : `fällt (${Math.round(diff)} cm in 3 h)`
      const stand = new Date(zeit).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
      zeilen.push({ text: `${p.name}: ${Math.round(wert)} cm`, klein: `${trend} · Woche ${Math.round(Math.min(...werte))}–${Math.round(Math.max(...werte))} cm · Stand ${stand}`, stufe: diff > 20 ? 'warnung' : undefined, lon: p.lon, lat: p.lat })
      fs.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { icon: 'pegel', titel: p.name, sub: `${Math.round(wert)} cm, ${trend}` } })
    }
    if (!zeilen.length) zeilen.push({ text: 'Lippe-Pegel gerade nicht erreichbar', stufe: 'info' })
    return { zeilen, punkte: { type: 'FeatureCollection', features: fs }, stand: new Date() }
  },
}

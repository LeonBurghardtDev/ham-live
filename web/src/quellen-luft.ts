/**
 * Luft live: Feinstaub-Sensoren der Bürgerwissenschaft (sensor.community, ODbL, 5-Minuten-Werte, unkalibriert)
 * und die nächsten amtlichen Messstationen (Umweltbundesamt/LANUV, Luftqualitätsindex). In Hamm selbst misst
 * seit 2020 keine amtliche Station mehr; die nächsten sind Unna-Königsborn und Lünen.
 * Kartensymbol: Plakette mit PM2,5-Wert, Farbe nach Luftqualitätsindex des UBA.
 */
import type maplibregl from 'maplibre-gl'
import type * as GeoJSON from 'geojson'
import { hole, HAMM, type Ergebnis, type Quelle, type Zeile } from './live'

export const LUFT_STUFEN = ['sehr gut', 'gut', 'mäßig', 'schlecht', 'sehr schlecht']
const FARBEN = ['#1d7f3c', '#6aa84f', '#f0ca00', '#e06c00', '#c4271b']
/** UBA-Index für PM2,5 (µg/m³, Stundenwert): bis 10, 20, 25, 50, darüber */
export const pm25Stufe = (v: number) => (v <= 10 ? 0 : v <= 20 ? 1 : v <= 25 ? 2 : v <= 50 ? 3 : 4)

const STATIONEN: [string, string][] = [['1065', 'Unna-Königsborn'], ['1061', 'Lünen-Niederaden'], ['1289', 'Lünen Viktoriastraße']]
const KOMPONENTE: Record<number, string> = { 1: 'PM10', 3: 'Ozon', 5: 'NO₂', 9: 'PM2,5' }
const zahl = (v: number, n = 0) => v.toLocaleString('de-DE', { maximumFractionDigits: n })
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }

type Messung = { sensor: { id: number; sensor_type: { name: string } }; location: { latitude: string; longitude: string; indoor: number }; timestamp: string; sensordatavalues: { value_type: string; value: string }[] }

export const luft: Quelle = {
  id: 'luft', name: 'Luft', takt: 600,
  lizenz: 'sensor.community (ODbL, Bürgersensoren, unkalibriert) · Umweltbundesamt, Luftqualitätsindex (dl-de/by-2-0)',
  async laden(): Promise<Ergebnis> {
    const [sensoren, amtlich] = await Promise.all([
      hole(`https://data.sensor.community/airrohr/v1/filter/area=${HAMM.lat},${HAMM.lon},12`, 300).catch(() => [] as Messung[]),
      Promise.all(STATIONEN.map(async ([id, name]) => {
        const heute = new Date(), gestern = new Date(Date.now() - 86400000)
        const tag = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
        const d = await hole(`https://luftdaten.umweltbundesamt.de/api/air-data/v3/airquality/json?station=${id}&date_from=${tag(gestern)}&time_from=1&date_to=${tag(heute)}&time_to=24`, 900).catch(() => null)
        const werte = d?.data?.[id] ? Object.entries(d.data[id] as Record<string, unknown[]>).sort((a, b) => a[0].localeCompare(b[0])) : []
        const letzte = werte[werte.length - 1]
        if (!letzte) return null
        const [, eintrag] = letzte
        const index = Number(eintrag[1])
        const teile = (eintrag.slice(3) as [number, number, number, string][]).filter((k) => KOMPONENTE[k[0]]).map((k) => `${KOMPONENTE[k[0]]} ${zahl(k[1])}`)
        return { name, index, zeit: String(letzte[0]).slice(11, 16), teile }
      })),
    ])
    // Feinstaub je Sensor: Fehlwerte (999,9 / 1999,9), Innenraum und Überläufe verwerfen
    const fs: GeoJSON.Feature[] = []
    const pm25: number[] = [], pm10: number[] = []
    for (const m of sensoren as Messung[]) {
      if (m.location.indoor) continue
      const w = Object.fromEntries(m.sensordatavalues.map((x) => [x.value_type, Number(x.value)]))
      if (!(w.P2 >= 0 && w.P2 < 500 && w.P1 >= 0 && w.P1 < 900)) continue
      pm25.push(w.P2); pm10.push(w.P1)
      const st = pm25Stufe(w.P2)
      fs.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: [Number(m.location.longitude), Number(m.location.latitude)] },
        properties: { icon: `luft:${Math.round(w.P2)}:${st}`, titel: `Feinstaubsensor ${m.sensor.id}`, sub: `PM2,5 ${zahl(w.P2, 1)} µg/m³ · PM10 ${zahl(w.P1, 1)} µg/m³ · ${LUFT_STUFEN[st]} · Stand ${m.timestamp.slice(11, 16)} UTC · Bürgersensor, bei hoher Luftfeuchte oft zu hoch` },
      })
    }
    const zeilen: Zeile[] = []
    if (pm25.length) {
      const m = median(pm25), st = pm25Stufe(m)
      zeilen.push({ text: `Luft in Hamm: ${LUFT_STUFEN[st]}`, klein: `Feinstaub PM2,5 im Mittel ${zahl(m, 1)} µg/m³, PM10 ${zahl(median(pm10), 1)} µg/m³ · ${pm25.length} Sensoren`, stufe: st >= 3 ? 'warnung' : 'info' })
    }
    for (const a of amtlich) if (a) zeilen.push({ text: `${a.name}: ${LUFT_STUFEN[a.index] ?? '–'}`, klein: `Amtliche Station, ${a.zeit} Uhr · ${a.teile.join(' · ')} µg/m³`, stufe: a.index >= 3 ? 'warnung' : undefined })
    if (!zeilen.length) zeilen.push({ text: 'Gerade keine Luftdaten', stufe: 'info' })
    return { zeilen, punkte: { type: 'FeatureCollection', features: fs }, stand: new Date() }
  },
}

function plakette(wert: string, st: number) {
  const PR = 2, w = 30, h = 18
  const c = document.createElement('canvas')
  c.width = w * PR; c.height = h * PR
  const g = c.getContext('2d')!
  g.scale(PR, PR)
  g.fillStyle = FARBEN[st]; g.fillRect(0, 0, w, h)
  g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, w - 1.5, h - 1.5)
  g.fillStyle = st === 2 ? '#141416' : '#ffffff'
  g.font = '700 11px "Bahnschrift", "DIN 1451", "Arial Narrow", sans-serif'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(wert, w / 2, h / 2 + 0.5)
  return g.getImageData(0, 0, c.width, c.height)
}

export function luftSymbole(map: maplibregl.Map) {
  map.on('styleimagemissing', (e) => {
    const m = /^luft:(\d+):(\d)$/.exec(e.id)
    if (m && !map.hasImage(e.id)) map.addImage(e.id, plakette(m[1], Number(m[2])), { pixelRatio: 2 })
  })
}

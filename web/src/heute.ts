/**
 * „Heute in Hamm“: Überblick oben im Tab Aktuell, zusammengesetzt aus den bereits geladenen Quellen
 * plus der Tagesvorhersage (DWD über Bright Sky, CC BY 4.0). Keine eigenen Abfragen außer der Vorhersage.
 */
import { hole, HAMM, type Ergebnis, type Quelle, type Zeile } from './live'

const zahl = (v: number, n = 0) => v.toLocaleString('de-DE', { maximumFractionDigits: n })

export const vorhersage: Quelle = {
  id: 'vorhersage', name: 'Vorhersage heute', takt: 1800, lizenz: 'DWD über Bright Sky (CC BY 4.0)',
  async laden(): Promise<Ergebnis> {
    const tag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
    const d = await hole(`https://api.brightsky.dev/weather?lat=${HAMM.lat}&lon=${HAMM.lon}&date=${tag}T00:00+02:00&last_date=${tag}T23:59+02:00&tz=Europe/Berlin`, 1800)
    const h = (d.weather ?? []) as { timestamp: string; temperature: number | null; precipitation: number | null; precipitation_probability: number | null; wind_gust_speed: number | null }[]
    const ts = h.map((x) => x.temperature).filter((x): x is number => x != null)
    const jetzt = Date.now()
    const rest = h.filter((x) => new Date(x.timestamp).getTime() >= jetzt - 3600000)
    const regenStunden = rest.filter((x) => (x.precipitation ?? 0) >= 0.1 || (x.precipitation_probability ?? 0) >= 50)
    const summe = rest.reduce((a, x) => a + (x.precipitation ?? 0), 0)
    const boe = Math.max(0, ...rest.map((x) => x.wind_gust_speed ?? 0))
    const uhr = (s: string) => s.slice(11, 13)
    const regen = regenStunden.length
      ? `Regen ab ${uhr(regenStunden[0].timestamp)} Uhr${summe >= 0.5 ? `, ${zahl(summe, 1)} mm` : ''}`
      : 'heute trocken'
    return {
      stand: new Date(),
      zeilen: [{ text: ts.length ? `${zahl(Math.min(...ts))} bis ${zahl(Math.max(...ts))} °C, ${regen}` : regen, klein: boe >= 50 ? `Böen bis ${zahl(boe)} km/h` : undefined }],
    }
  },
}

export type Heute = { symbol: string; text: string; klein?: string; stufe?: Zeile['stufe']; ziel?: string }

/** Höchstens sechs Zeilen; `z(id)` liefert die zuletzt geladenen Zeilen einer Quelle. */
export function heuteZeilen(z: (id: string) => Zeile[] | undefined): Heute[] {
  const aus: Heute[] = []
  const wetter = z('wetter')?.[0], vh = z('vorhersage')?.[0]
  if (wetter || vh) aus.push({ symbol: 'Wetter', text: vh?.text ?? wetter!.text, klein: [wetter ? `jetzt ${wetter.text}` : '', vh?.klein ?? ''].filter(Boolean).join(' · ') })
  const luft = z('luft')?.[0]
  if (luft && /^Luft in Hamm/.test(luft.text)) aus.push({ symbol: 'Luft', text: luft.text.replace('Luft in Hamm: ', ''), klein: luft.klein, stufe: luft.stufe === 'warnung' ? 'warnung' : undefined, ziel: 'luft' })
  const warn = (z('warnungen') ?? []).filter((x) => x.stufe !== 'info')
  if (warn.length) aus.push({ symbol: 'Warnung', text: warn[0].text, klein: warn.length > 1 ? `und ${warn.length - 1} weitere` : warn[0].klein, stufe: 'alarm', ziel: 'warnungen' })
  const staus = (z('lippewelle') ?? []).filter((x) => x.stufe !== 'info' && /hamm/i.test(x.text + ' ' + (x.klein ?? '')))
  const bau = (z('baustellen') ?? []).filter((x) => x.stufe !== 'info' && x.lon != null)
  const verkehr = [staus.length ? `${staus.length} Meldung${staus.length > 1 ? 'en' : ''} in Hamm` : 'keine Staus in Hamm', bau.length ? `${bau.length} Baustelle${bau.length > 1 ? 'n' : ''} der Stadt` : '']
  aus.push({ symbol: 'Verkehr', text: verkehr.filter(Boolean).join(', '), klein: staus[0]?.text.replace(/^Verkehrslage:\s*/, ''), stufe: staus.some((x) => x.stufe === 'alarm') ? 'warnung' : undefined, ziel: 'lippewelle' })
  const blitzer = (z('blitzer_woche') ?? []).find((x) => /^heute/i.test(x.text))
  if (blitzer) aus.push({ symbol: 'Blitzer', text: blitzer.text.replace(/^heute:\s*/i, 'Mobil heute: '), klein: blitzer.klein, ziel: 'blitzer_woche' })
  const v = (z('veranstaltungen') ?? []).filter((x) => /^(heute|läuft)/i.test(x.klein ?? ''))
  const abends = v.filter((x) => /^heute/i.test(x.klein ?? ''))
  if (v.length) aus.push({ symbol: 'Termine', text: `${v.length} Veranstaltung${v.length > 1 ? 'en' : ''} heute`, klein: (abends[0] ?? v[0]).text + ' · ' + ((abends[0] ?? v[0]).klein ?? '').split(' · ').slice(0, 2).join(' · '), ziel: 'veranstaltungen' })
  return aus.slice(0, 7)
}

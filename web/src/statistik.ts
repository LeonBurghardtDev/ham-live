/**
 * Auswertungen der Aufzeichnung (/api/statistik, alle 5 min erfasst):
 * Buspünktlichkeit je Linie (pünktlich = weniger als 3 min verspätet) und Spritpreise je Stunde in Hamm.
 */
import type { Ergebnis, Quelle, Zeile } from './live'

type Statistik = {
  bus: Record<string, { heute: number[]; woche: number[] }>
  busStunde: number[][]
  spritStunde: Record<string, (number | null)[]>
  spritHeute: Record<string, { t: string; min: number; mittel: number }[]>
  messungen: { bus: number; sprit: number }
  tage: number
}
let letzte: Statistik | undefined
export const statistik = () => letzte
export async function statistikLaden() { letzte = await (await fetch('/api/statistik')).json(); return letzte! }

const zahl = (v: number, n = 1) => v.toLocaleString('de-DE', { minimumFractionDigits: n, maximumFractionDigits: n })
const prozent = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

/** Pünktlichkeit der Stadtbuslinien heute, schlechteste zuerst */
export const buspuenktlichkeit: Quelle = {
  id: 'buspuenktlichkeit', name: 'Pünktlichkeit Bus', takt: 300,
  lizenz: 'eigene Auswertung der Echtzeit-Abfahrten (Westfalenfahrplan, NWL) an 10 Haltestellen',
  async laden(): Promise<Ergebnis> {
    const s = await statistikLaden()
    const zeilen: Zeile[] = []
    const linien = Object.entries(s.bus).filter(([, v]) => v.heute[0] >= 3)
    const n = linien.reduce((a, [, v]) => a + v.heute[0], 0), p = linien.reduce((a, [, v]) => a + v.heute[2], 0), sum = linien.reduce((a, [, v]) => a + v.heute[1], 0)
    if (!n) {
      zeilen.push({ text: 'Noch zu wenige Abfahrten erfasst', klein: `Die Aufzeichnung läuft alle 5 Minuten (${s.messungen.bus} Messungen bisher)`, stufe: 'info' })
      return { zeilen, stand: new Date() }
    }
    zeilen.push({ text: `Alle Linien heute: ${prozent(p, n)} % pünktlich, im Mittel ${sum / n >= 0 ? '+' : ''}${zahl(sum / n / 60)} min`, klein: `${n} Abfahrten an 10 Haltestellen · pünktlich heißt weniger als 3 min verspätet`, stufe: 'info' })
    linien.sort((a, b) => a[1].heute[2] / a[1].heute[0] - b[1].heute[2] / b[1].heute[0] || b[1].heute[1] / b[1].heute[0] - a[1].heute[1] / a[1].heute[0])
    for (const [l, v] of linien) {
      const anteil = prozent(v.heute[2], v.heute[0]), mittel = v.heute[1] / v.heute[0] / 60
      const woche = v.woche[0] > v.heute[0] ? ` · 7 Tage ${prozent(v.woche[2], v.woche[0])} %` : ''
      zeilen.push({ text: `Linie ${l}: ${anteil} % pünktlich, Ø ${mittel >= 0 ? '+' : ''}${zahl(mittel)} min`, klein: `${v.heute[0]} Abfahrten heute${woche}`, stufe: anteil < 70 ? 'alarm' : anteil < 85 ? 'warnung' : undefined })
    }
    return { zeilen, stand: new Date() }
  },
}

/** Spritpreis-Verlauf als Balken je Stunde (Mittel der günstigsten Tankstelle in Hamm, letzte 7 Tage) */
export function spritVerlaufHtml(sorte: string): string {
  const s = letzte
  const werte = s?.spritStunde[sorte] ?? []
  const da = werte.filter((x): x is number => x != null)
  if (da.length < 6) return `<div class="sv"><p class="lbl">Tagesverlauf</p><p class="sv-leer">Die Aufzeichnung läuft seit heute. Der Verlauf über den Tag erscheint, sobald genug Stunden erfasst sind.</p></div>`
  const min = Math.min(...da), max = Math.max(...da)
  const besteH = werte.indexOf(min), teuerH = werte.indexOf(max)
  const hoehe = (v: number) => (max - min < 0.001 ? 50 : 15 + ((v - min) / (max - min)) * 85)
  return `<div class="sv"><p class="lbl">Tagesverlauf, günstigste Tankstelle in Hamm</p>
    <div class="sv-balken">${werte.map((v, h) => `<i class="${h === besteH ? 'best' : ''}${v == null ? ' leer' : ''}" style="height:${v == null ? 3 : hoehe(v).toFixed(0)}%" title="${h} Uhr: ${v == null ? 'keine Daten' : zahl(v, 3) + ' €'}"></i>`).join('')}</div>
    <div class="sv-skala"><span>0</span><span>6</span><span>12</span><span>18</span><span>24 Uhr</span></div>
    <p class="sv-text">Am günstigsten gegen ${besteH} Uhr (${zahl(min, 3)} €), am teuersten gegen ${teuerH} Uhr (${zahl(max, 3)} €), ${zahl((max - min) * 100, 0)} ct Unterschied. Mittel aus ${s!.tage} Tag${s!.tage > 1 ? 'en' : ''}.</p></div>`
}

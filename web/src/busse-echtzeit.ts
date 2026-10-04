/**
 * Echtzeit für die Busse auf der Karte: Abfahrten großer Haltestellen in Hamm (Westfalenfahrplan, EFA, mit Echtzeit)
 * alle 90 s; die Verspätungen werden den Fahrten im Sollfahrplan zugeordnet (busse.ts, verspaetungSetzen).
 */
import { hole } from './live'
import { verspaetungSetzen, type EchtzeitAbfahrt } from './busse'

/** Haltestellen, an denen fast alle Hammer Linien vorbeikommen (EFA-IDs) */
const HALTE: [string, string][] = [
  ['de:05915:7756', 'Hauptbahnhof'], ['de:05915:7328', 'Westentor'], ['de:05915:7779', 'Allee-Center'],
  ['de:05915:7227', 'Nordstraße'], ['de:05915:7113', 'Hans-Böckler-Platz'], ['de:05915:7129', 'Herringer Markt'],
  ['de:05915:7124', 'Heessener Markt'], ['de:05915:35259', 'Bockum-Hövel Bahnhof'], ['de:05915:7169', 'Uentroper Kirche'],
  ['de:05915:7238', 'Pelkum Selbachpark'],
]
const url = (id: string) => 'https://www.westfalenfahrplan.de/nwl-efa/XML_DM_REQUEST?' + new URLSearchParams({
  outputFormat: 'rapidJSON', type_dm: 'stop', name_dm: id, mode: 'direct', useRealtime: '1', limit: '40', coordOutputFormat: 'WGS84[dd.ddddd]',
})

export type EchtzeitStand = { fahrten: number; abfahrten: number; halte: number; zeit: Date }
let stand: EchtzeitStand | undefined
export const busEchtzeitStand = () => stand

export async function busEchtzeitLaden(): Promise<EchtzeitStand> {
  const liste: EchtzeitAbfahrt[] = []
  let halte = 0
  // nacheinander statt alle gleichzeitig, um den Fahrplanserver zu schonen
  for (const [id] of HALTE) {
    try {
      const d = await hole(url(id), 80)
      halte++
      for (const e of d.stopEvents ?? []) {
        const t = e.transportation ?? {}
        if (!/bus/i.test(t.product?.name ?? '') || !e.departureTimeEstimated || !e.location?.coord) continue
        liste.push({ linie: String(t.number ?? t.disassembledName ?? ''), soll: new Date(e.departureTimePlanned), ist: new Date(e.departureTimeEstimated), lat: e.location.coord[0], lon: e.location.coord[1] })
      }
    } catch { /* Haltestelle gerade nicht erreichbar */ }
  }
  const fahrten = verspaetungSetzen(liste) ?? 0
  stand = { fahrten, abfahrten: liste.length, halte, zeit: new Date() }
  return stand
}

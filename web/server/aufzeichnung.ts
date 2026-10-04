/**
 * Aufzeichnung für Rückblick und Statistik: alle 5 Minuten die wichtigsten Live-Quellen als NDJSON je Tag
 * nach <HAM_AUFZEICHNUNG>/AAAA-MM-TT.ndjson (gitignored). Nur Hamm-relevante Ausschnitte.
 * Schnittstellen: /api/aufzeichnung (Rückblick), /api/verkehr-stand (eingefrorene Verkehrslage), /api/statistik.
 */
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { PRIVAT_HOSTS, type Konfig } from './konfig.ts'
import { json, type Handler, type Protokoll } from './http.ts'
import type { TankAntwort } from './tanken.ts'

const KENNUNG_KURZ = 'HAM-LIVE/0.1 (privat)'
const holeJson = async (u: string, ms = 20000) => (await fetch(u, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': KENNUNG_KURZ } })).json()

const AUFZEICHNEN: Record<string, string> = {
  wetter: 'https://api.brightsky.dev/current_weather?lat=51.6807&lon=7.8189',
  warnungen: 'https://warnung.bund.de/api31/dashboard/059150000000.json',
  pegel: 'https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?latitude=51.6807&longitude=7.8189&radius=25&includeTimeseries=true&includeCurrentMeasurement=true',
  abfahrten: 'https://www.westfalenfahrplan.de/nwl-efa/XML_DM_REQUEST?outputFormat=rapidJSON&type_dm=stop&name_dm=de:05915:7756&mode=direct&useRealtime=1&limit=30',
}
// Verkehrslage Verkehr.NRW: nur Kilometer je Lage im Stadtgebiet speichern (beide Richtungen), nicht die Geometrie
const VERKEHR_NRW = 'https://www.verkehr.nrw/geoserver/vipnrw/wfs?' + new URLSearchParams({
  service: 'WFS', version: '1.1.0', request: 'GetFeature', typeName: 'vipnrw:traffic_los_status_lines',
  outputFormat: 'application/json', srsName: 'EPSG:4326', propertyName: 'linestring,los,los15',
  cql_filter: `BBOX("linestring",7.62,51.58,8.05,51.78,'EPSG:4326') AND los<>'LOS_UNKNOWN'`,
})
// Buspünktlichkeit: Abfahrten mit Echtzeit an großen Haltestellen, je Lauf nur die der nächsten 5 Minuten (jede Abfahrt einmal)
const BUS_HALTE = ['7756', '7328', '7779', '7227', '7113', '7129', '7124', '35259', '7169', '7238']

function imGebiet(ringe: number[][][], p: number[]) {
  let drin = false
  for (const r of ringe) for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) drin = !drin
  return drin
}

export function aufzeichnung(k: Konfig, tanken: () => Promise<TankAntwort>, log: Protokoll) {
  const dir = k.aufzeichnung
  let grenze: number[][][] | undefined
  const stadtgrenze = async () => {
    if (!grenze) {
      const g = JSON.parse(await readFile(k.daten + 'grenzen.geojson', 'utf-8'))
      const geo = g.features.find((f: any) => f.properties?.ebene === 'stadt')?.geometry
      grenze = geo?.type === 'MultiPolygon' ? geo.coordinates.flat() : geo?.coordinates ?? []
    }
    return grenze!
  }
  const verkehrKm = async () => {
    const ringe = await stadtgrenze().catch(() => [] as number[][][])
    const d = await holeJson(VERKEHR_NRW, 30000)
    const km: Record<string, number | string> = { frei: 0, dicht: 0, zaeh: 0, stau: 0, gesperrt: 0 }
    const teile: string[] = []
    const art: Record<string, string> = { LOS1: 'frei', LOS2: 'dicht', LOS3: 'zaeh', LOS4: 'stau', LOS_CLOSED: 'gesperrt' }
    for (const f of d.features ?? []) {
      teile.push(`${f.id}:${f.properties?.los}:${f.properties?.los15}`)
      const kl = art[f.properties?.los]
      if (!kl || !f.geometry) continue
      const linien = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates]
      for (const c of linien) if (!ringe.length || imGebiet(ringe, c[Math.floor(c.length / 2)])) for (let i = 1; i < c.length; i++) (km[kl] as number) += Math.hypot((c[i][0] - c[i - 1][0]) * 69100, (c[i][1] - c[i - 1][1]) * 110540) / 1000
    }
    for (const x in km) km[x] = Math.round((km[x] as number) * 100) / 100
    // Fingerabdruck aller Abschnitte: bleibt er gleich, liefert Verkehr.NRW keine neuen Daten
    km.hash = createHash('sha1').update(teile.sort().join('|')).digest('hex').slice(0, 16)
    return km
  }
  const busPuenktlichkeit = async () => {
    const linien: Record<string, [number, number, number]> = {}
    const jetzt = Date.now()
    for (const h of BUS_HALTE) {
      try {
        const d = await holeJson('https://www.westfalenfahrplan.de/nwl-efa/XML_DM_REQUEST?' + new URLSearchParams({ outputFormat: 'rapidJSON', type_dm: 'stop', name_dm: `de:05915:${h}`, mode: 'direct', useRealtime: '1', limit: '30' }))
        for (const e of d.stopEvents ?? []) {
          const t = e.transportation ?? {}
          if (!/bus/i.test(t.product?.name ?? '') || !e.departureTimeEstimated) continue
          const soll = new Date(e.departureTimePlanned).getTime()
          if (soll < jetzt || soll >= jetzt + 5 * 60000) continue
          const v = (new Date(e.departureTimeEstimated).getTime() - soll) / 1000
          const x = (linien[String(t.number ?? '?')] ??= [0, 0, 0])
          x[0]++; x[1] += v; if (v < 180) x[2]++
        }
      } catch { /* Haltestelle nicht erreichbar */ }
    }
    return linien
  }
  // Spritpreise der Tankstellen in Hamm (aus dem Tankerkönig-Speicher, keine zusätzliche Abfrage)
  const spritPreise = async () => {
    const d = await tanken()
    if (!d.ok) return { fehler: d.fehlt ? 'Schlüssel fehlt' : String(d.fehler ?? 'keine Antwort') }
    const st: Record<string, [number | null, number | null, number | null]> = {}
    const p = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null)
    for (const s of d.stationen ?? []) if (s.isOpen && /hamm/i.test(s.place ?? '')) st[s.id] = [p(s.e5), p(s.e10), p(s.diesel)]
    return st
  }

  const runde = async () => {
    await mkdir(dir, { recursive: true })
    const t = new Date()
    const zeile: Record<string, unknown> = { t: t.toISOString() }
    const frei = (u: string) => k.privatquellen || !PRIVAT_HOSTS.includes(new URL(u).host)
    await Promise.all(Object.entries(AUFZEICHNEN).filter(([, u]) => frei(u)).map(async ([key, u]) => {
      try { zeile[key] = await holeJson(u) } catch (e) { zeile[key] = { fehler: String(e) } }
    }))
    if (k.privatquellen) {
      try { zeile.verkehr = await verkehrKm() } catch (e) { zeile.verkehr = { fehler: String(e) } }
      try { zeile.bus = await busPuenktlichkeit() } catch (e) { zeile.bus = { fehler: String(e) } }
    }
    try { zeile.sprit = await spritPreise() } catch (e) { zeile.sprit = { fehler: String(e) } }
    await appendFile(dir + t.toISOString().slice(0, 10) + '.ndjson', JSON.stringify(zeile) + '\n')
  }
  /** Zeitgeber starten; nach einem Neustart im selben Prozess (Vite) werden die alten beendet */
  const starten = () => {
    const g = globalThis as { hamAufzeichnung?: ReturnType<typeof setInterval>[] }
    for (const z of g.hamAufzeichnung ?? []) clearTimeout(z)
    const sicher = () => void runde().catch((e) => log.warn('[aufzeichnung] ' + e))
    g.hamAufzeichnung = [setTimeout(sicher, 15000), setInterval(sicher, 5 * 60 * 1000)]
  }

  /** Zeilen der letzten n Tagesdateien, je Zeile geparst */
  async function* zeilen(n: number) {
    const dateien = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.ndjson')).sort().slice(-n)
    for (const f of dateien) for (const z of (await readFile(dir + f, 'utf-8')).split('\n')) {
      if (!z.trim()) continue
      try { yield JSON.parse(z) } catch { /* kaputte Zeile */ }
    }
  }
  const tageAnzahl = async (n: number) => (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.ndjson')).slice(-n).length

  // Seit wann liefert Verkehr.NRW unveränderte Verkehrslage? (gleiche km-Werte)
  const verkehrStand: Handler = async (_req, res) => {
    const reihe: { t: string; k: string }[] = []
    for await (const d of zeilen(2)) if (d.verkehr && !d.verkehr.fehler) { const { hash: _h, ...km } = d.verkehr; reihe.push({ t: d.t, k: JSON.stringify(km) }) }
    reihe.sort((a, b) => a.t.localeCompare(b.t))
    let seit: string | undefined
    const letzte = reihe[reihe.length - 1]
    if (letzte) { seit = letzte.t; for (let i = reihe.length - 2; i >= 0 && reihe[i].k === letzte.k; i--) seit = reihe[i].t }
    json(res, { unveraendertSeit: seit, letzte: letzte?.t, messungen: reihe.length })
  }

  // Statistik: Buspünktlichkeit je Linie (heute, 7 Tage) und Spritpreise je Stunde (7 Tage)
  const statistik: Handler = async (_req, res) => {
    const heute = new Date(); heute.setHours(0, 0, 0, 0)
    const woche = Date.now() - 7 * 86400000
    const bus: Record<string, { heute: number[]; woche: number[] }> = {}
    const busStunde: number[][] = Array.from({ length: 24 }, () => [0, 0])
    const sprit: Record<string, number[][]> = {}
    for (const s of ['e5', 'e10', 'diesel']) sprit[s] = Array.from({ length: 24 }, () => [] as number[])
    const spritHeute: Record<string, { t: string; min: number; mittel: number }[]> = { e5: [], e10: [], diesel: [] }
    let messBus = 0, messSprit = 0
    for await (const d of zeilen(8)) {
      const t = new Date(d.t)
      if (t.getTime() < woche) continue
      if (d.bus && !d.bus.fehler) {
        messBus++
        for (const [l, [n, summe, p]] of Object.entries(d.bus as Record<string, number[]>)) {
          const x = (bus[l] ??= { heute: [0, 0, 0], woche: [0, 0, 0] })
          x.woche[0] += n; x.woche[1] += summe; x.woche[2] += p
          if (t >= heute) { x.heute[0] += n; x.heute[1] += summe; x.heute[2] += p; busStunde[t.getHours()][0] += n; busStunde[t.getHours()][1] += p }
        }
      }
      if (d.sprit && !d.sprit.fehler) {
        messSprit++
        const werte = Object.values(d.sprit as Record<string, (number | null)[]>)
        ;(['e5', 'e10', 'diesel'] as const).forEach((s, i) => {
          const ps = werte.map((w) => w[i]).filter((x): x is number => x != null)
          if (!ps.length) return
          const min = Math.min(...ps), mittel = ps.reduce((a, b) => a + b, 0) / ps.length
          sprit[s][t.getHours()].push(min)
          if (t >= heute) spritHeute[s].push({ t: d.t, min, mittel: Math.round(mittel * 1000) / 1000 })
        })
      }
    }
    const spritStunde = Object.fromEntries(Object.entries(sprit).map(([s, h]) => [s, h.map((xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : null))]))
    json(res, { bus, busStunde, spritStunde, spritHeute, messungen: { bus: messBus, sprit: messSprit }, tage: await tageAnzahl(8) })
  }

  // Rückblick: kompakte Zeitreihe der letzten Tage (Wetter, Pegel, Verspätungen am Hbf, Warnungen, Stau-km)
  const rueckblick: Handler = async (_req, res) => {
    const punkte: unknown[] = []
    for await (const d of zeilen(4)) {
      try {
        const w = d.wetter?.weather ?? {}
        const pegel = (Array.isArray(d.pegel) ? d.pegel : []).map((s: any) => ({ name: s.longname, wert: (s.timeseries ?? []).find((t: any) => t.shortname === 'W')?.currentMeasurement?.value }))
        const ev = d.abfahrten?.stopEvents ?? []
        const versp = ev.map((e: any) => e.departureTimeEstimated ? (new Date(e.departureTimeEstimated).getTime() - new Date(e.departureTimePlanned).getTime()) / 60000 : 0)
        punkte.push({
          t: d.t, temp: w.temperature, regen: w.precipitation_10, wind: w.wind_speed_10, boeen: w.wind_gust_speed_10, wolken: w.cloud_cover, zustand: w.condition,
          warnungen: Array.isArray(d.warnungen) ? d.warnungen.length : 0, pegel,
          abfahrten: ev.length, verspaetet: versp.filter((v: number) => v >= 5).length, mittel: versp.length ? versp.reduce((a: number, b: number) => a + b, 0) / versp.length : 0,
          stau: d.verkehr && !d.verkehr.fehler ? d.verkehr.zaeh + d.verkehr.stau : undefined,
        })
      } catch { /* unvollständige Zeile */ }
    }
    json(res, punkte)
  }

  return { starten, verkehrStand, statistik, rueckblick }
}

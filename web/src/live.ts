import type * as GeoJSON from 'geojson'
/** Echtzeitquellen. Alles über /api/proxy (Zwischenspeicher, kein CORS-Problem). Jede Quelle liefert Zeilen fürs Panel und optional GeoJSON für die Karte. */

/** Pegelonline schreibt Namen in Großbuchstaben: in normale Schreibung, UW/OW ausgeschrieben */
export function pegelName(n: string) {
  return n.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/\bUw\b/, 'Unterwasser').replace(/\bOw\b/, 'Oberwasser')
}

export const HAMM = { lon: 7.8189, lat: 51.6807 }
export const BBOX = { w: 7.62, s: 51.58, e: 8.05, n: 51.78 }

export type Zeile = { rang?: number; text: string; klein?: string; stufe?: 'info' | 'warnung' | 'alarm'; lon?: number; lat?: number; link?: string }
export type Ergebnis = { zeilen: Zeile[]; punkte?: GeoJSON.FeatureCollection; stand: Date; fehler?: string }
export type Quelle = { id: string; name: string; takt: number; lizenz: string; laden: () => Promise<Ergebnis> }

export async function hole(url: string, ttl = 60, als: 'json' | 'text' = 'json'): Promise<any> {
  const r = await fetch(`/api/proxy?ttl=${ttl}&u=${encodeURIComponent(url)}`)
  if (!r.ok) throw new Error(`${new URL(url).host}: HTTP ${r.status}`)
  return als === 'json' ? r.json() : r.text()
}

const WETTER: Record<string, string> = { dry: 'trocken', fog: 'Nebel', rain: 'Regen', sleet: 'Schneeregen', snow: 'Schnee', hail: 'Hagel', thunderstorm: 'Gewitter' }
const zahl = (v: number, st = 1) => v.toLocaleString('de-DE', { maximumFractionDigits: st, minimumFractionDigits: st })
const uhr = (d: Date | string) => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const pt = (lon: number, lat: number, props: Record<string, unknown>): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props })
const inHamm = (lon: number, lat: number) => lon >= BBOX.w && lon <= BBOX.e && lat >= BBOX.s && lat <= BBOX.n

function dauer(plan: string, ist?: string) {
  if (!ist) return ''
  const m = Math.round((new Date(ist).getTime() - new Date(plan).getTime()) / 60000)
  return m > 0 ? ` +${m}` : ''
}

const STAUART: Record<string, { name: string; icon: string; stufe: Zeile['stufe'] }> = {
  trafficjam: { name: 'Stau', icon: 'stau', stufe: 'alarm' },
  accident: { name: 'Unfall', icon: 'unfall', stufe: 'alarm' },
  warning: { name: 'Verkehrslage', icon: 'warnung', stufe: 'warnung' },
  construction: { name: 'Baustelle', icon: 'baustelle', stufe: 'info' },
}

export const QUELLEN: Quelle[] = [
  {
    id: 'nachrichten', name: 'Nachrichten Hamm', takt: 900, lizenz: 'Westfälischer Anzeiger, wa.de (nur Überschrift und Link, privat)',
    async laden() {
      const x = await hole('https://www.wa.de/hamm/rssfeed.rdf', 900, 'text')
      const doc = new DOMParser().parseFromString(x, 'text/xml')
      const zeilen: Zeile[] = [...doc.querySelectorAll('item')].slice(0, 12).map((it) => ({
        text: it.querySelector('title')?.textContent ?? '',
        klein: new Date(it.querySelector('pubDate')?.textContent ?? '').toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' · WA',
        link: it.querySelector('link')?.textContent ?? undefined,
      }))
      return { zeilen, stand: new Date() }
    },
  },
  {
    id: 'lippewelle', name: 'Verkehr Hamm', takt: 120, lizenz: 'Radio Lippe Welle Hamm / ADAC, Hörermeldungen (nur privat)',
    async laden() {
      // die Senderseite liegt hinter einem CDN-Cache: Zeitstempel erzwingt den aktuellen Stand
      const d = await hole(`https://www.lippewelle.de/traffic/detail?station=17&t=${Math.floor(Date.now() / 60000)}`, 110)
      const feats: GeoJSON.Feature[] = []
      const zeilen: Zeile[] = []
      const nah = (lon: number, lat: number) => lon >= BBOX.w - 0.1 && lon <= BBOX.e + 0.1 && lat >= BBOX.s - 0.06 && lat <= BBOX.n + 0.06
      for (const [art, liste] of Object.entries<any[]>(d.local ?? {})) {
        const a = STAUART[art] ?? STAUART.warning
        for (const m of liste ?? []) {
          const x0 = Number(m.coord_start_x), y0 = Number(m.coord_start_y), x1 = Number(m.coord_end_x), y1 = Number(m.coord_end_y)
          if (!x0 || !y0) continue
          const text = String(m.message ?? '').replace(/\s+/g, ' ').trim()
          const imRaum = nah(x0, y0)
          zeilen.push({ text: `${a.name}: ${text.slice(0, 110)}`, klein: `${m.source ?? ''}${m.delay ? ' · +' + m.delay + ' min' : ''}`, stufe: a.stufe, lon: x0, lat: y0, rang: (inHamm(x0, y0) || /Hamm/.test(text) ? 0 : 10) + (a.stufe === 'alarm' ? 0 : a.stufe === 'warnung' ? 1 : 2) } as Zeile)
          if (!imRaum) continue
          feats.push(pt(x0, y0, { titel: a.name, sub: text, icon: a.icon }))
          // Strecke von Anfang bis Ende: gelb = dichter Verkehr, rot = Stau
          if (x1 && y1 && (art === 'trafficjam' || /dicht|stockend|Stau/i.test(text))) {
            feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[x0, y0], [x1, y1]] }, properties: { lage: art === 'trafficjam' || /Stau/i.test(text) ? 'stau' : 'dicht', titel: a.name, sub: text } })
          }
        }
      }
      for (const r of d.radars ?? []) {
        const x = Number(r.coord_start_x ?? r.lon ?? r.longitude), y = Number(r.coord_start_y ?? r.lat ?? r.latitude)
        const text = String(r.message ?? r.street ?? 'Mobiler Blitzer')
        zeilen.unshift({ text: `Blitzer: ${text}`, klein: `${r.datecreated ?? ''} · Hörermeldung`, stufe: 'warnung', lon: x || undefined, lat: y || undefined })
        if (x && y) feats.push(pt(x, y, { titel: 'Mobiler Blitzer', sub: text, icon: 'blitzer-mobil' }))
      }
      zeilen.sort((a, b) => (a.rang ?? 0) - (b.rang ?? 0))
      if (!zeilen.length) zeilen.push({ text: 'Keine Meldungen für Hamm und Umgebung', stufe: 'info' })
      return { zeilen, punkte: fc(feats), stand: new Date() }
    },
  },
  {
    id: 'abfahrten', name: 'Abfahrten Hamm Hbf (live)', takt: 60, lizenz: 'Westfalenfahrplan (EFA), nur privat',
    async laden() {
      const d = await hole('https://www.westfalenfahrplan.de/nwl-efa/XML_DM_REQUEST?outputFormat=rapidJSON&type_dm=stop&name_dm=de:05915:7756&mode=direct&useRealtime=1&limit=14', 50)
      const zeilen: Zeile[] = (d.stopEvents ?? []).map((e: any) => {
        const t = e.transportation ?? {}
        const plan = e.departureTimePlanned, ist = e.departureTimeEstimated
        const v = dauer(plan, ist)
        return { text: `${uhr(plan)}${v} · ${t.number ?? t.name ?? ''} → ${t.destination?.name ?? ''}`, klein: `${t.product?.name ?? ''} · Steig ${e.location?.properties?.platformName ?? e.location?.properties?.platform ?? '–'}`, stufe: v && parseInt(v) >= 5 ? 'warnung' : undefined }
      })
      return { zeilen, stand: new Date() }
    },
  },
  {
    id: 'blaulicht', name: 'Blaulicht Hamm (Polizei)', takt: 600, lizenz: 'Presseportal, Polizei Dortmund (nur Überschrift und Link)',
    async laden() {
      const x = await hole('https://www.presseportal.de/rss/polizei/r/Hamm.rss2', 600, 'text')
      const doc = new DOMParser().parseFromString(x, 'text/xml')
      const zeilen: Zeile[] = [...doc.querySelectorAll('item')].slice(0, 10).map((it) => ({
        text: (it.querySelector('title')?.textContent ?? '').replace(/^POL-[A-Z]+:\s*/, ''),
        klein: new Date(it.querySelector('pubDate')?.textContent ?? '').toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
        link: it.querySelector('link')?.textContent ?? undefined,
        stufe: 'alarm' as const,
      }))
      return { zeilen, stand: new Date() }
    },
  },
  {
    id: 'wetter', name: 'Wetter jetzt', takt: 300, lizenz: 'DWD über Bright Sky (CC BY 4.0)',
    async laden() {
      const d = await hole(`https://api.brightsky.dev/current_weather?lat=${HAMM.lat}&lon=${HAMM.lon}`, 300)
      const w = d.weather
      const zeilen: Zeile[] = [
        { text: `${zahl(w.temperature)} °C, ${WETTER[w.condition] ?? w.condition ?? '–'}`, klein: `Station ${d.sources?.[0]?.station_name ?? ''}, ${uhr(w.timestamp)} Uhr` },
        { text: `Wind ${zahl(w.wind_speed_10 ?? 0, 0)} km/h, Böen ${zahl(w.wind_gust_speed_10 ?? 0, 0)} km/h`, klein: `Richtung ${w.wind_direction_10 ?? '–'}°` },
        { text: `Niederschlag ${zahl(w.precipitation_10 ?? 0)} mm (10 min)`, klein: `Bewölkung ${w.cloud_cover ?? '–'} %, Sonne ${w.sunshine_30 ?? 0} min (30 min)` },
      ]
      return { zeilen, stand: new Date() }
    },
  },
  {
    id: 'warnungen', name: 'Warnungen für Hamm', takt: 300, lizenz: 'BBK NINA (dl-de/by-2-0), DWD',
    async laden() {
      const d = await hole('https://warnung.bund.de/api31/dashboard/059150000000.json', 120)
      const zeilen: Zeile[] = (d ?? []).map((w: any) => ({
        text: w.i18nTitle?.de ?? w.payload?.data?.headline ?? 'Warnung',
        klein: `${w.payload?.data?.provider ?? ''} · ${w.sent ? uhr(w.sent) + ' Uhr' : ''}`,
        stufe: /extrem|unwetter|gefahr/i.test(JSON.stringify(w.payload?.data?.severity ?? '')) ? 'alarm' : 'warnung',
      }))
      if (!zeilen.length) zeilen.push({ text: 'Keine aktuellen Warnungen', stufe: 'info' })
      return { zeilen, stand: new Date() }
    },
  },
  {
    id: 'autobahn', name: 'Autobahn A1/A2 bei Hamm', takt: 300, lizenz: 'Autobahn GmbH des Bundes (dl-de/by-2-0)',
    async laden() {
      const feats: GeoJSON.Feature[] = []
      const zeilen: Zeile[] = []
      for (const a of ['A1', 'A2']) for (const art of ['warning', 'closure', 'roadworks']) {
        const d = await hole(`https://verkehr.autobahn.de/o/autobahn/${a}/services/${art}`, 300).catch(() => null)
        for (const m of d?.[art] ?? []) {
          const lat = Number(m.coordinate?.lat), lon = Number(m.coordinate?.long)
          if (!inHamm(lon, lat)) continue
          const titel = `${a}: ${m.title ?? ''}`.trim()
          const sub = (m.subtitle ?? '') + (m.description?.[0] ? ' · ' + String(m.description[0]).slice(0, 80) : '')
          const stufe = art === 'warning' ? 'warnung' : art === 'closure' ? 'alarm' : 'info'
          zeilen.push({ text: titel, klein: sub, stufe, lon, lat })
          feats.push(pt(lon, lat, { titel, art, sub, icon: art === 'roadworks' ? 'baustelle' : art === 'closure' ? 'sperrung' : 'warnung' }))
        }
      }
      if (!zeilen.length) zeilen.push({ text: 'Keine Meldungen im Raum Hamm', stufe: 'info' })
      return { zeilen, punkte: fc(feats), stand: new Date() }
    },
  },
  {
    id: 'pegel', name: 'Pegel', takt: 900, lizenz: 'WSV Pegelonline (dl-de/zero-2-0)',
    async laden() {
      const d = await hole(`https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?latitude=${HAMM.lat}&longitude=${HAMM.lon}&radius=25&includeTimeseries=true&includeCurrentMeasurement=true`, 900)
      const feats: GeoJSON.Feature[] = []
      const zeilen: Zeile[] = []
      for (const s of d ?? []) {
        const ts = (s.timeseries ?? []).find((t: any) => t.shortname === 'W') ?? s.timeseries?.[0]
        const m = ts?.currentMeasurement
        // Gewässer steht schon im Titel des Abschnitts
        const text = pegelName(s.longname)
        const wert = m ? `${ts.unit === 'm+NN' ? zahl(m.value, 2) + ' m ü. NN' : zahl(m.value, 0) + ' ' + ts.unit} · ${uhr(m.timestamp)} Uhr` : 'kein Messwert'
        zeilen.push({ text, klein: wert, lon: s.longitude, lat: s.latitude })
        feats.push(pt(s.longitude, s.latitude, { titel: text, sub: wert, icon: 'pegel' }))
      }
      if (!zeilen.length) zeilen.push({ text: 'Keine Pegel im Umkreis', stufe: 'info' })
      return { zeilen, punkte: fc(feats), stand: new Date() }
    },
  },
  {
    id: 'flug', name: 'Flugzeuge über Hamm', takt: 60, lizenz: 'The OpenSky Network (nicht kommerziell)',
    async laden() {
      const d = await hole(`https://opensky-network.org/api/states/all?lamin=${BBOX.s}&lomin=${BBOX.w}&lamax=${BBOX.n}&lomax=${BBOX.e}`, 60)
      const feats: GeoJSON.Feature[] = []
      const zeilen: Zeile[] = []
      for (const s of d?.states ?? []) {
        const [, call, land, , , lon, lat, hoehe, amBoden, v, kurs] = s
        if (lon == null || lat == null) continue
        const titel = (call || '').trim() || 'unbekannt'
        const sub = `${land}, ${hoehe != null ? zahl(hoehe, 0) + ' m' : 'Höhe ?'}, ${v != null ? zahl(v * 3.6, 0) + ' km/h' : ''}`
        zeilen.push({ text: `${titel}${amBoden ? ' (am Boden)' : ''}`, klein: sub, lon, lat })
        feats.push(pt(lon, lat, { titel, sub, kurs: kurs ?? 0, icon: 'flugzeug' }))
      }
      if (!zeilen.length) zeilen.push({ text: 'Gerade kein Flugzeug im Raum Hamm', stufe: 'info' })
      return { zeilen, punkte: fc(feats), stand: new Date() }
    },
  },
]

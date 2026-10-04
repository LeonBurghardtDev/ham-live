/**
 * Wetter (Entwurf verkehr-wetter.html, W1 Wetterbericht mit Radar):
 * - stadtwetter: Temperatur je Stadtbezirk (Open-Meteo, eine Anfrage für alle sieben Mittelpunkte)
 *   plus die drei Messstationen der Stadt Hamm (WFS „Wetterstationen“, Zeitreihe, je Station der neueste Datensatz).
 * - wetterbericht: DWD über Bright Sky, jetzt und Stundenwerte für acht Tage; wetterberichtHtml() baut daraus die Spalte.
 * Kartensymbole 'temp:<°C>:<bezirk|station>[:<Name>]' per styleimagemissing (stadtwetterSymbole).
 */
import type maplibregl from 'maplibre-gl'
import type * as GeoJSON from 'geojson'
import { hole, HAMM, type Ergebnis, type Quelle, type Zeile } from './live'

const zahl = (v: number, n = 1) => v.toLocaleString('de-DE', { maximumFractionDigits: n, minimumFractionDigits: n })
const grad = (v: number) => `${Math.round(v).toLocaleString('de-DE')}°`
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const uhr = (d: string | Date) => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
const tagBerlin = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
const pt = (lon: number, lat: number, props: Record<string, unknown>): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props })

/* ------------------------------------------------------------------ Stadtwetter: Bezirke und Messstationen */

const WFS_STATIONEN = 'https://www.hamm.de/wmsserver/qgisserver/qgis_mapserv.fcgi.exe?MAP=C:/qgis_server_daten/od_natur_umwelt.qgs&SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature&TYPENAME=Wetterstationen&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326'

/** WMO-Wettercode (Open-Meteo) → Zustand */
const wmo = (c: number) =>
  c === 0 ? 'sonnig' : c === 1 ? 'heiter' : c === 2 ? 'wolkig' : c === 3 ? 'bedeckt' : c === 45 || c === 48 ? 'Nebel'
  : c >= 51 && c <= 57 ? 'Nieselregen' : (c >= 61 && c <= 67) ? 'Regen' : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 'Schnee'
  : c >= 80 && c <= 82 ? 'Schauer' : c >= 95 ? 'Gewitter' : '–'

type Bezirk = { name: string; lon: number; lat: number }
let bezirke: Promise<Bezirk[]> | null = null
const ladeBezirke = () => (bezirke ??= fetch('/daten/grenzen.geojson').then((r) => r.json()).then((g: GeoJSON.FeatureCollection) =>
  g.features.filter((f) => f.properties?.ebene === 'bezirk').map((f) => ({ name: String(f.properties!.name), lon: Number(f.properties!.lon), lat: Number(f.properties!.lat) }))))

/** gefühlte Temperatur Hamm-Mitte aus Open-Meteo (Bright Sky liefert keine) */
let gefuehlt: number | undefined

export const stadtwetter: Quelle = {
  id: 'stadtwetter', name: 'Stadtwetter', takt: 900,
  lizenz: 'Open-Meteo (CC BY 4.0) · Stadt Hamm, Wetterstationen (dl-de/by-2-0)',
  async laden(): Promise<Ergebnis> {
    const bz = await ladeBezirke()
    const om = `https://api.open-meteo.com/v1/forecast?latitude=${bz.map((b) => b.lat).join(',')}&longitude=${bz.map((b) => b.lon).join(',')}&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=Europe%2FBerlin`
    const [modell, wfs] = await Promise.all([hole(om, 840).catch(() => null), hole(WFS_STATIONEN, 600).catch(() => null)])
    const feats: GeoJSON.Feature[] = []
    const zeilen: Zeile[] = []
    const liste: any[] = Array.isArray(modell) ? modell : modell ? [modell] : []
    bz.forEach((b, i) => {
      const c = liste[i]?.current
      if (!c || typeof c.temperature_2m !== 'number') return
      const t = c.temperature_2m as number
      if (b.name === 'Hamm-Mitte' && typeof c.apparent_temperature === 'number') gefuehlt = c.apparent_temperature
      const sub = `${zahl(t)} °C · ${wmo(c.weather_code)} · Wind ${zahl(c.wind_speed_10m ?? 0, 0)} km/h${c.precipitation > 0 ? ` · Niederschlag ${zahl(c.precipitation)} mm` : ''} · Modell Open-Meteo, ${String(c.time).slice(11, 16)} Uhr`
      feats.push(pt(b.lon, b.lat, { icon: `temp:${Math.round(t)}:bezirk:${b.name}`, titel: b.name, sub }))
      zeilen.push({ text: `${b.name}: ${zahl(t)} °C`, klein: `${wmo(c.weather_code)} · Wind ${zahl(c.wind_speed_10m ?? 0, 0)} km/h`, lon: b.lon, lat: b.lat })
    })
    // Messstationen: Zeitreihe, je stations_id der neueste Datensatz
    const neu = new Map<string, { p: any; lon: number; lat: number }>()
    for (const f of wfs?.features ?? []) {
      const p = f.properties ?? {}
      const g = f.geometry
      const xy: number[] | undefined = g?.type === 'MultiPoint' ? g.coordinates?.[0] : g?.type === 'Point' ? g.coordinates : undefined
      if (!xy || typeof p.temperatur !== 'number' || !p.stations_id) continue
      const alt = neu.get(p.stations_id)
      if (!alt || String(p.timestamp) > String(alt.p.timestamp)) neu.set(p.stations_id, { p, lon: xy[0], lat: xy[1] })
    }
    for (const [id, { p, lon, lat }] of [...neu].sort((a, b) => a[0].localeCompare(b[0]))) {
      const alt = Date.now() - new Date(p.timestamp).getTime() > 3 * 3600_000
      const rf = typeof p.relative_luftfeutigkeit === 'number' ? p.relative_luftfeutigkeit : undefined
      const sub = [`${zahl(p.temperatur)} °C`, rf != null ? `Luftfeuchte ${zahl(rf, 0)} %` : '', typeof p.taupunkt === 'number' ? `Taupunkt ${zahl(p.taupunkt)} °C` : '', typeof p.bodentemperatur === 'number' ? `Boden ${zahl(p.bodentemperatur)} °C` : '', `Stand ${uhr(p.timestamp)} Uhr`].filter(Boolean).join(' · ')
      feats.push(pt(lon, lat, { icon: `temp:${Math.round(p.temperatur)}:station`, titel: `Messstation ${id}`, sub }))
      zeilen.push({ text: `Messstation ${id}: ${zahl(p.temperatur)} °C${rf != null ? `, ${zahl(rf, 0)} %` : ''}`, klein: `Stadt Hamm · Stand ${new Date(p.timestamp).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })}`, stufe: alt ? 'warnung' : undefined, lon, lat })
    }
    if (!zeilen.length) zeilen.push({ text: 'Gerade keine Temperaturen', stufe: 'info' })
    return { zeilen, punkte: { type: 'FeatureCollection', features: feats }, stand: new Date(), fehler: !modell ? 'Open-Meteo nicht erreichbar' : !wfs ? 'Messstationen nicht erreichbar' : undefined }
  },
}

/** Tönung nach Temperatur: kalt Blau → mild Graugrün → warm Orange → heiß Rotbraun */
const STUFEN: [number, [number, number, number]][] = [[-10, [31, 61, 110]], [0, [44, 98, 160]], [8, [74, 138, 168]], [14, [106, 150, 120]], [19, [214, 150, 50]], [25, [224, 108, 0]], [32, [176, 58, 20]]]
export function tempFarbe(t: number): string {
  if (t <= STUFEN[0][0]) return rgb(STUFEN[0][1])
  for (let i = 1; i < STUFEN.length; i++) {
    const [t1, c1] = STUFEN[i], [t0, c0] = STUFEN[i - 1]
    if (t <= t1) { const f = (t - t0) / (t1 - t0); return rgb(c0.map((v, k) => v + (c1[k] - v) * f) as [number, number, number]) }
  }
  return rgb(STUFEN[STUFEN.length - 1][1])
}
const rgb = (c: [number, number, number]) => `rgb(${c.map(Math.round).join(',')})`

function schild(t: number, art: string, name?: string) {
  const PR = 2
  const c = document.createElement('canvas')
  const g0 = c.getContext('2d')!
  const zahlFont = art === 'bezirk' ? '600 17px Poppins, "Fira Sans", sans-serif' : '600 12px "Fira Sans", sans-serif'
  const nameFont = '500 9.5px "Fira Sans", sans-serif'
  const text = `${t.toLocaleString('de-DE')}°`
  g0.font = zahlFont; const wz = g0.measureText(text).width
  g0.font = nameFont; const wn = name ? g0.measureText(name).width : 0
  const w = Math.ceil(Math.max(wz, wn) + (art === 'bezirk' ? 16 : 12)), h = art === 'bezirk' ? (name ? 36 : 26) : 18
  c.width = w * PR; c.height = h * PR
  const g = c.getContext('2d')!
  g.scale(PR, PR)
  g.textAlign = 'center'; g.textBaseline = 'middle'
  if (art === 'bezirk') {
    g.fillStyle = tempFarbe(t); g.fillRect(0, 0, w, h)
    g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, w - 1.5, h - 1.5)
    g.fillStyle = '#ffffff'
    g.font = zahlFont; g.fillText(text, w / 2, name ? 13 : h / 2 + 0.5)
    if (name) { g.font = nameFont; g.fillText(name, w / 2, 28) }
  } else {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h)
    g.strokeStyle = '#005468'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2)
    g.fillStyle = '#005468'; g.font = zahlFont; g.fillText(text, w / 2, h / 2 + 0.5)
  }
  return g.getImageData(0, 0, c.width, c.height)
}

export function stadtwetterSymbole(map: maplibregl.Map) {
  map.on('styleimagemissing', (e) => {
    const m = /^temp:(-?\d+):(bezirk|station)(?::(.+))?$/.exec(e.id)
    if (m && !map.hasImage(e.id)) map.addImage(e.id, schild(Number(m[1]), m[2], m[3]), { pixelRatio: 2 })
  })
}

/* ------------------------------------------------------------------ Wetterbericht: DWD über Bright Sky */

export type Stunde = { zeit: string; temperatur: number | null; niederschlag: number | null; zustand: string; condition: string | null; icon: string | null; wolken: number | null; wind: number | null; boeen: number | null }
export type WetterDaten = {
  jetzt?: { zeit: string; temperatur: number; zustand: string; gefuehlt?: number; wind?: number; windRichtung?: string; boeen?: number; luftfeuchte?: number; station?: string }
  stunden: Stunde[]
  stand?: Date
}
let daten: WetterDaten = { stunden: [] }
export const wetterDaten = () => daten

const RICHTUNG = ['Nord', 'Nordost', 'Ost', 'Südost', 'Süd', 'Südwest', 'West', 'Nordwest']
const himmelsrichtung = (g: number) => RICHTUNG[Math.round(((g % 360) + 360) % 360 / 45) % 8]

/** Zustand aus Bright Sky condition/icon/cloud_cover */
function zustand(condition: string | null | undefined, icon: string | null | undefined, wolken: number | null | undefined, regen?: number | null): string {
  switch (condition) {
    case 'thunderstorm': return 'Gewitter'
    case 'hail': return 'Hagel'
    case 'snow': return 'Schnee'
    case 'sleet': return 'Schneeregen'
    case 'fog': return 'Nebel'
    case 'rain': return wolken != null && wolken < 80 ? 'Schauer' : (regen ?? 1) < 0.3 ? 'Nieselregen' : 'Regen'
  }
  const nacht = icon?.endsWith('night')
  if (icon === 'fog') return 'Nebel'
  if (icon === 'wind') return 'windig'
  if (wolken != null) return wolken < 15 ? (nacht ? 'klar' : 'sonnig') : wolken < 45 ? 'heiter' : wolken < 85 ? 'wolkig' : 'bedeckt'
  return icon?.startsWith('clear') ? (nacht ? 'klar' : 'sonnig') : icon?.startsWith('partly') ? 'heiter' : icon === 'cloudy' ? 'bedeckt' : '–'
}

export const wetterbericht: Quelle = {
  id: 'wetterbericht', name: 'Wetterbericht', takt: 900, lizenz: 'DWD über Bright Sky (CC BY 4.0)',
  async laden(): Promise<Ergebnis> {
    const heute = new Date()
    const bis = new Date(heute.getTime() + 8 * 86400_000)
    const [jetzt, vorher] = await Promise.all([
      hole(`https://api.brightsky.dev/current_weather?lat=${HAMM.lat}&lon=${HAMM.lon}&tz=Europe/Berlin`, 600),
      hole(`https://api.brightsky.dev/weather?lat=${HAMM.lat}&lon=${HAMM.lon}&date=${tagBerlin(heute)}&last_date=${tagBerlin(bis)}&tz=Europe/Berlin`, 840),
    ])
    const w = jetzt.weather ?? {}
    const stunden: Stunde[] = (vorher.weather ?? []).map((s: any) => ({
      zeit: s.timestamp, temperatur: s.temperature, niederschlag: s.precipitation, condition: s.condition, icon: s.icon, wolken: s.cloud_cover,
      wind: s.wind_speed, boeen: s.wind_gust_speed, zustand: zustand(s.condition, s.icon, s.cloud_cover, s.precipitation),
    }))
    daten = {
      jetzt: typeof w.temperature === 'number' ? {
        zeit: w.timestamp, temperatur: w.temperature, zustand: zustand(w.condition, w.icon, w.cloud_cover, w.precipitation_60),
        gefuehlt, wind: w.wind_speed_10 ?? w.wind_speed_30 ?? undefined,
        windRichtung: typeof (w.wind_direction_10 ?? w.wind_direction_30) === 'number' ? himmelsrichtung(w.wind_direction_10 ?? w.wind_direction_30) : undefined,
        boeen: w.wind_gust_speed_10 ?? w.wind_gust_speed_30 ?? undefined, luftfeuchte: w.relative_humidity ?? undefined,
        station: jetzt.sources?.[0]?.station_name,
      } : undefined,
      stunden, stand: new Date(),
    }
    const j = daten.jetzt
    const zeilen: Zeile[] = []
    if (j) {
      zeilen.push({ text: `${zahl(j.temperatur)} °C, ${j.zustand}`, klein: `Station ${j.station ?? '–'}, ${uhr(j.zeit)} Uhr` })
      zeilen.push({ text: `Wind ${zahl(j.wind ?? 0, 0)} km/h${j.windRichtung ? ' aus ' + j.windRichtung : ''}${j.boeen != null ? `, Böen ${zahl(j.boeen, 0)} km/h` : ''}`, klein: j.luftfeuchte != null ? `Luftfeuchte ${zahl(j.luftfeuchte, 0)} %` : undefined })
    }
    for (const t of tage().slice(0, 3)) zeilen.push({ text: `${t.name}: ${t.zustand}, ${grad(t.max)} / ${grad(t.min)}`, klein: t.regen > 0 ? `Regen ${zahl(t.regen)} mm` : undefined })
    if (!zeilen.length) zeilen.push({ text: 'Gerade keine Wetterdaten', stufe: 'info' })
    return { zeilen, stand: new Date() }
  },
}

/* ------------------------------------------------------------------ Seite W1 */

type Tag = { datum: string; name: string; zustand: string; max: number; min: number; regen: number }

/** Tage nach heute (Europe/Berlin): Zustand = Gewitter/Schnee/Regen/Schauer bei Niederschlag, sonst häufigster Himmelszustand 7–20 Uhr */
function tage(): Tag[] {
  const gruppen = new Map<string, Stunde[]>()
  for (const s of daten.stunden) {
    const d = tagBerlin(new Date(s.zeit))
    ;(gruppen.get(d) ?? gruppen.set(d, []).get(d)!).push(s)
  }
  const heute = tagBerlin(new Date())
  const aus: Tag[] = []
  for (const [datum, st] of [...gruppen].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (datum <= heute || st.length < 20) continue
    const temps = st.map((s) => s.temperatur).filter((v): v is number => typeof v === 'number')
    if (!temps.length) continue
    const regen = st.reduce((a, s) => a + (s.niederschlag ?? 0), 0)
    const regenStunden = st.filter((s) => (s.niederschlag ?? 0) >= 0.1).length
    const hat = (c: string) => st.some((s) => s.condition === c)
    let z: string
    if (hat('thunderstorm')) z = 'Gewitter'
    else if (st.filter((s) => s.condition === 'snow').length >= 2) z = 'Schnee'
    else if (regen >= 2 && regenStunden >= 4) z = 'Regen'
    else if (regen >= 0.3) z = 'Schauer'
    else {
      const zaehl = new Map<string, number>()
      for (const s of st) {
        const h = Number(new Date(s.zeit).toLocaleString('de-DE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }))
        if (h < 7 || h > 20) continue
        const k = s.zustand === 'klar' ? 'sonnig' : /Regen|Schauer/.test(s.zustand) ? 'wolkig' : s.zustand
        zaehl.set(k, (zaehl.get(k) ?? 0) + 1)
      }
      z = [...zaehl].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '–'
    }
    const name = new Date(datum + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long' })
    aus.push({ datum, name, zustand: z, max: Math.max(...temps), min: Math.min(...temps), regen: Math.round(regen * 10) / 10 })
  }
  return aus.slice(0, 7)
}

/** 8 Spalten im 3-h-Takt ab der aktuellen Stunde: Temperatur zur Spaltenzeit, Regen = Summe der drei Stunden */
function naechste24() {
  const ab = Date.now() - 3600_000
  const st = daten.stunden.filter((s) => new Date(s.zeit).getTime() >= ab)
  const spalten: { uhr: string; t: number | null; mm: number }[] = []
  for (let i = 0; i < 8 && i * 3 < st.length; i++) {
    const blk = st.slice(i * 3, i * 3 + 3)
    spalten.push({ uhr: new Date(blk[0].zeit).toLocaleTimeString('de-DE', { hour: '2-digit', timeZone: 'Europe/Berlin' }).replace(/\D/g, '').replace(/^0(?=\d)/, ''), t: blk[0].temperatur, mm: blk.reduce((a, s) => a + (s.niederschlag ?? 0), 0) })
  }
  return spalten
}

export function wetterberichtHtml(): string {
  const j = daten.jetzt
  if (!j && !daten.stunden.length) return '<p class="lade" style="padding:24px">Lädt …</p>'
  const teile: string[] = []
  if (j) {
    const g = j.gefuehlt ?? gefuehlt
    const info = [
      g != null && Math.abs(g - j.temperatur) >= 1 ? `gefühlt ${grad(g)}` : '',
      j.wind != null ? `Wind ${zahl(j.wind, 0)} km/h${j.windRichtung ? ' aus ' + j.windRichtung : ''}${j.boeen != null && j.boeen - j.wind >= 10 ? `, Böen ${zahl(j.boeen, 0)}` : ''}` : '',
      j.luftfeuchte != null ? `${zahl(j.luftfeuchte, 0)} % Luftfeuchte` : '',
    ].filter(Boolean).join(' · ')
    teile.push(`<div class="box wb-jetzt"><p class="lbl">Jetzt in Hamm</p><div class="wb-gross"><b>${grad(j.temperatur)}</b><span>${esc(j.zustand)}</span></div><div class="wb-info">${esc(info)}</div><div class="wb-stand">Station ${esc(j.station ?? '–')} · ${uhr(j.zeit)} Uhr</div></div>`)
  }
  const sp = naechste24()
  if (sp.length) {
    const max = Math.max(1, ...sp.map((s) => s.mm))
    const mm = (v: number) => (v < 0.05 ? '–' : v < 10 ? zahl(v, 1) : zahl(v, 0))
    teile.push(`<div class="box"><p class="lbl">Nächste 24 Stunden</p><div class="wb-stunden">${sp.map((s) =>
      `<div class="wb-spalte"><span class="wb-uhr">${s.uhr}</span><b>${s.t != null ? grad(s.t) : '–'}</b><span class="wb-balken">${s.mm >= 0.05 ? `<i style="height:${Math.max(8, Math.round((s.mm / max) * 100))}%"></i>` : ''}</span><span class="wb-mm">${mm(s.mm)}</span></div>`).join('')}</div><div class="wb-einheit">Uhr · °C · Regen in mm je 3 h</div></div>`)
  }
  const td = tage()
  if (td.length) {
    teile.push(`<div class="box"><p class="lbl">Nächste Tage</p>${td.map((t) =>
      `<div class="zeile wb-tag"><span class="wb-tname">${esc(t.name)}</span><span class="wb-tzust">${esc(t.zustand)}</span><span class="wb-tregen">${t.regen > 0 ? zahl(t.regen, 1) + ' mm' : ''}</span><b>${grad(t.max)} / ${grad(t.min)}</b></div>`).join('')}</div>`)
  }
  teile.push('<p class="wb-quelle">DWD über Bright Sky (CC BY 4.0) · Open-Meteo (CC BY 4.0) · Stadt Hamm</p>')
  return `<div class="wb">${teile.join('')}</div>`
}

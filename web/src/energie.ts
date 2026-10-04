/**
 * Energie: Strom in Deutschland live (Energy-Charts, Fraunhofer ISE, CC BY 4.0), Day-Ahead-Preis (Bundesnetzagentur | SMARD.de
 * über Energy-Charts, CC BY 4.0), Stromampel für 59065, Anlagen in Hamm aus dem Marktstammdatenregister (dl-de/by-2-0,
 * vorab mit daten/mastr.py nach /daten/energie-hamm.json) und daraus geschätzte Solar- und Windleistung mit DWD-Werten
 * über Bright Sky (CC BY 4.0). Einzelkraftwerke live gibt es bei Energy-Charts nicht als offene Schnittstelle.
 */
import type maplibregl from 'maplibre-gl'
import type * as GeoJSON from 'geojson'
import { hole, HAMM, type Ergebnis, type Quelle, type Zeile } from './live'

// ---------- Typen ----------

export type Reihe = { name: string; farbe: string; werte: (number | null)[] }
export type Kurve = { zeit: number[]; reihen: Reihe[] }
type Summe = { anzahl: number; kW: number }
export type HammAnlage = { id: string; name: string; einheit: string; traeger: string; bruttoKW: number; nettoKW: number; inbetriebnahme: string | null; lat: number | null; lon: number | null; betreiber: string; brennstoff: string | null; technik: string | null; speicherKWh: number | null; ort: string }
export type HammDaten = {
  quelle: string; lizenz: string; abruf: string; einheitenGesamt: number; status: Record<string, number>
  traeger: Record<string, { anzahl: number; bruttoKW: number; nettoKW: number }>
  solar: { art: Record<string, Summe>; klassen: Record<string, Summe>; zubauMonate: ({ monat: string } & Summe)[]; zubauJahr: { jahr: number } & Summe }
  speicher: Summe & { kWh: number; mitKapazitaet: number }
  grossanlagen: HammAnlage[]
  geplant?: { id: string; name: string; traeger: string; bruttoKW: number; geplant: string; betreiber: string; lat: number | null; lon: number | null }[]
}
export type Signal = 'grün' | 'gelb' | 'rot' | 'Netzengpass'
export type EnergieDaten = {
  hamm?: HammDaten
  stromDe?: { stand: number; jetztMW: Record<string, number>; lastMW: number; anteilEE: number; anteilEEErzeugung: number; verlauf: Kurve; last: (number | null)[] }
  preis?: { stand: number; jetzt: number; min: number; minZeit: number; max: number; maxZeit: number; kurve: Kurve }
  ampel?: { stand: number; jetzt: Signal; anteil: number; folge: { zeit: number; signal: Signal; anteil: number }[] }
  solar?: { stand: number; jetztMW: number; heuteMWh: number; installiertMW: number; strahlungW: number; stunden: { zeit: number; MW: number }[] }
  wind?: { stand: number; jetztMW: number; installiertMW: number; v10: number; vNabe: number }
}

// ---------- Hilfen ----------

export const FARBE = { solar: '#f0ca00', wind: '#005468', windSee: '#4f8a9b', biomasse: '#1d7f3c', wasser: '#5b8fc7', gas: '#8a8c92', kohle: '#444444', braunkohle: '#6b5843', pumpspeicher: '#7fb2cc', import: '#95c11e', sonstige: '#b4b4b4', last: '#141416', preis: '#005468' }
const zahl = (v: number, n = 0) => v.toLocaleString('de-DE', { maximumFractionDigits: n, minimumFractionDigits: n })
const uhr = (s: number) => new Date(s * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
const mw = (kw: number) => (kw >= 1000 ? `${zahl(kw / 1000, kw >= 100000 ? 0 : 1)} MW` : `${zahl(kw, 0)} kW`)
const gw = (v: number) => `${zahl(v / 1000, 1)} GW`
const daten: EnergieDaten = {}
/** Rohwerte aller Energiequellen (werden von den Quellen beim Laden gefüllt) */
export const energieDaten = (): EnergieDaten => daten

let hammLaden: Promise<HammDaten | undefined> | undefined
export function energieHamm(): Promise<HammDaten | undefined> {
  hammLaden ??= fetch('/daten/energie-hamm.json').then((r) => (r.ok ? r.json() : undefined)).then((d) => (daten.hamm = d)).catch(() => undefined)
  return hammLaden
}

/** Datum mit Berliner Zeitzonenversatz, z. B. 2026-10-01T00:00+02:00 */
function berlin(d: Date, zeit = '00:00') {
  const tag = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
  const off = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Berlin', timeZoneName: 'longOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value.replace('GMT', '') || '+01:00'
  return `${tag}T${zeit}${off}`
}
const letzter = (werte: (number | null)[]) => { for (let i = werte.length - 1; i >= 0; i--) if (werte[i] != null) return i; return -1 }

/** Mittelt eine Kurve auf Schritte von `min` Minuten */
export function verdichte(k: Kurve, min: number): Kurve {
  const s = min * 60, gruppen = new Map<number, number[]>()
  k.zeit.forEach((t, i) => { const g = Math.floor(t / s) * s; (gruppen.get(g) ?? gruppen.set(g, []).get(g)!).push(i) })
  const zeit = [...gruppen.keys()]
  return {
    zeit,
    reihen: k.reihen.map((r) => ({ ...r, werte: zeit.map((g) => { const w = gruppen.get(g)!.map((i) => r.werte[i]).filter((v): v is number => v != null); return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null }) })),
  }
}

// ---------- Diagramme ----------

/** Waagerechte Balken als HTML, z. B. installierte Leistung je Träger */
export function balkenHtml(reihen: { name: string; wert: number; farbe: string; text?: string }[]): string {
  const max = Math.max(1e-9, ...reihen.map((r) => Math.abs(r.wert)))
  return `<div class="energie-balken" style="display:grid;grid-template-columns:auto 1fr auto;gap:4px 8px;align-items:center;font-size:13px">${reihen.map((r) =>
    `<span>${r.name}</span><span style="display:block;height:8px;background:#e6e6e6"><span style="display:block;height:8px;width:${(Math.abs(r.wert) / max * 100).toFixed(1)}%;background:${r.farbe}"></span></span><span style="text-align:right;font-variant-numeric:tabular-nums">${r.text ?? zahl(r.wert)}</span>`).join('')}</div>`
}

/**
 * Schlichtes Inline-SVG: gestapelte Flächen (Erzeugung) oder Linien (Preis), Stufen statt Glättung, Stundenraster,
 * optional Linie „jetzt“ und Nulllinie. Negative Werte werden beim Stapeln nach unten gestapelt.
 */
export function kurveSvg(k: Kurve, opt: { breite?: number; hoehe?: number; gestapelt?: boolean; einheit?: string; jetzt?: number; linie?: Reihe } = {}): string {
  const B = opt.breite ?? 320, H = opt.hoehe ?? 120, L = 36, U = 16, O = 4
  const n = k.zeit.length
  if (n < 2) return ''
  const t0 = k.zeit[0], schritt = k.zeit[1] - k.zeit[0], t1 = k.zeit[n - 1] + schritt
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (B - L - 2)
  // Stapel berechnen
  const oben: number[][] = [], unten: number[][] = []
  const pos = new Array(n).fill(0), neg = new Array(n).fill(0)
  for (const r of k.reihen) {
    const lo: number[] = [], hi: number[] = []
    for (let i = 0; i < n; i++) {
      const v = r.werte[i] ?? 0
      if (opt.gestapelt) { if (v >= 0) { lo.push(pos[i]); pos[i] += v; hi.push(pos[i]) } else { hi.push(neg[i]); neg[i] += v; lo.push(neg[i]) } }
      else { lo.push(0); hi.push(v) }
    }
    unten.push(lo); oben.push(hi)
  }
  const alle = [...oben.flat(), ...unten.flat(), ...(opt.linie?.werte.filter((v): v is number => v != null) ?? []), 0]
  let vmin = Math.min(...alle), vmax = Math.max(...alle)
  if (vmax === vmin) vmax = vmin + 1
  const y = (v: number) => O + (1 - (v - vmin) / (vmax - vmin)) * (H - O - U)
  const stufe = (werte: (number | null)[]) => { let d = ''; werte.forEach((v, i) => { if (v == null) return; d += `${d ? 'L' : 'M'}${x(k.zeit[i]).toFixed(1)} ${y(v).toFixed(1)}H${x(k.zeit[i] + schritt).toFixed(1)}` }); return d }
  const teile: string[] = []
  // Stundenraster alle 3 h, Beschriftung alle 6 h
  for (let t = Math.ceil(t0 / 3600) * 3600; t < t1; t += 3600) {
    const h = Number(new Date(t * 1000).toLocaleString('de-DE', { hour: 'numeric', hour12: false, timeZone: 'Europe/Berlin' }))
    if (h % 3) continue
    teile.push(`<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${O}" y2="${H - U}" stroke="#e0e0e0" stroke-width="1"/>`)
    if (h % 6 === 0) teile.push(`<text x="${x(t).toFixed(1)}" y="${H - 4}" font-size="10" text-anchor="middle" fill="#505050">${h} Uhr</text>`)
  }
  k.reihen.forEach((r, j) => {
    if (opt.gestapelt) {
      let d = ''
      for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${x(k.zeit[i]).toFixed(1)} ${y(oben[j][i]).toFixed(1)}H${x(k.zeit[i] + schritt).toFixed(1)}`
      for (let i = n - 1; i >= 0; i--) d += `L${x(k.zeit[i] + schritt).toFixed(1)} ${y(unten[j][i]).toFixed(1)}H${x(k.zeit[i]).toFixed(1)}`
      teile.push(`<path d="${d}Z" fill="${r.farbe}" stroke="none"><title>${r.name}</title></path>`)
    } else teile.push(`<path d="${stufe(r.werte)}" fill="none" stroke="${r.farbe}" stroke-width="1.5"><title>${r.name}</title></path>`)
  })
  if (opt.linie) teile.push(`<path d="${stufe(opt.linie.werte)}" fill="none" stroke="${opt.linie.farbe}" stroke-width="1.5"><title>${opt.linie.name}</title></path>`)
  if (vmin < 0) teile.push(`<line x1="${L}" x2="${B - 2}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="#505050" stroke-width="1"/>`)
  if (opt.jetzt && opt.jetzt >= t0 && opt.jetzt <= t1) teile.push(`<line x1="${x(opt.jetzt).toFixed(1)}" x2="${x(opt.jetzt).toFixed(1)}" y1="${O}" y2="${H - U}" stroke="#c4271b" stroke-width="1"/>`)
  const e = opt.einheit ?? ''
  teile.push(`<text x="${L - 4}" y="${y(vmax) + 8}" font-size="10" text-anchor="end" fill="#505050">${zahl(vmax)}</text>`, `<text x="${L - 4}" y="${y(vmin)}" font-size="10" text-anchor="end" fill="#505050">${zahl(vmin)}</text>`)
  if (e) teile.push(`<text x="${L - 4}" y="${(H - U) / 2 + 4}" font-size="10" text-anchor="end" fill="#505050">${e}</text>`)
  return `<svg class="energie-kurve" viewBox="0 0 ${B} ${H}" width="100%" role="img" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">${teile.join('')}</svg>`
}

// ---------- Strom Deutschland ----------

/** Energy-Charts-Namen → Anzeige; mehrere Namen können zu einer Art zusammenfallen */
const ARTEN: [string, string, string][] = [
  ['Solar', 'Solar', FARBE.solar],
  ['Wind onshore', 'Wind an Land', FARBE.wind],
  ['Wind offshore', 'Wind auf See', FARBE.windSee],
  ['Biomass', 'Biomasse', FARBE.biomasse],
  ['Hydro Run-of-River', 'Wasser', FARBE.wasser],
  ['Hydro water reservoir', 'Wasser', FARBE.wasser],
  ['Hydro pumped storage', 'Pumpspeicher', FARBE.pumpspeicher],
  ['Hydro pumped storage consumption', 'Pumpspeicher', FARBE.pumpspeicher],
  ['Fossil brown coal / lignite', 'Braunkohle', FARBE.braunkohle],
  ['Fossil hard coal', 'Steinkohle', FARBE.kohle],
  ['Fossil gas', 'Erdgas', FARBE.gas],
  ['Fossil coal-derived gas', 'Sonstige', FARBE.sonstige],
  ['Fossil oil', 'Sonstige', FARBE.sonstige],
  ['Geothermal', 'Sonstige', FARBE.sonstige],
  ['Waste', 'Sonstige', FARBE.sonstige],
  ['Others', 'Sonstige', FARBE.sonstige],
  ['Cross border electricity trading', 'Import (Saldo)', FARBE.import],
]

export const stromDe: Quelle = {
  id: 'stromDe', name: 'Strom in Deutschland', takt: 900, lizenz: 'Energy-Charts, Fraunhofer ISE (CC BY 4.0)',
  async laden(): Promise<Ergebnis> {
    const d = await hole('https://api.energy-charts.info/public_power?country=de', 840)
    const typ = new Map<string, (number | null)[]>((d.production_types ?? []).map((p: any) => [p.name, p.data]))
    const lastW = typ.get('Load') ?? []
    const i = letzter(lastW)
    if (i < 0) throw new Error('Energy-Charts: keine Werte')
    const reihen = new Map<string, Reihe>()
    for (const [quelle, name, farbe] of ARTEN) {
      const w = typ.get(quelle)
      if (!w) continue
      const r = reihen.get(name) ?? reihen.set(name, { name, farbe, werte: w.map(() => null) }).get(name)!
      w.forEach((v, j) => { if (v != null) r.werte[j] = (r.werte[j] ?? 0) + v })
    }
    const jetztMW: Record<string, number> = {}
    for (const r of reihen.values()) jetztMW[r.name] = r.werte[i] ?? 0
    const anteil = typ.get('Renewable share of load')?.[i] ?? NaN, anteilErz = typ.get('Renewable share of generation')?.[i] ?? NaN
    const zeit: number[] = d.unix_seconds
    daten.stromDe = { stand: zeit[i], jetztMW, lastMW: lastW[i] ?? 0, anteilEE: anteil, anteilEEErzeugung: anteilErz, verlauf: { zeit, reihen: [...reihen.values()] }, last: lastW }
    const sortiert = Object.entries(jetztMW).filter(([n]) => n !== 'Import (Saldo)').sort((a, b) => b[1] - a[1])
    const saldo = jetztMW['Import (Saldo)'] ?? 0
    const zeilen: Zeile[] = [
      { text: `Verbrauch ${gw(lastW[i] ?? 0)}, erneuerbar ${zahl(anteil)} %`, klein: `Stand ${uhr(zeit[i])} Uhr · Anteil an der Erzeugung ${zahl(anteilErz)} %` },
      ...sortiert.filter(([, v]) => Math.abs(v) >= 50).map(([n, v]) => ({ text: `${n}: ${gw(v)}` })),
      { text: saldo >= 0 ? `Import ${gw(saldo)}` : `Export ${gw(-saldo)}`, klein: 'Saldo Stromaustausch mit den Nachbarländern' },
    ]
    return { zeilen, stand: new Date(zeit[i] * 1000) }
  },
}

// ---------- Strompreis ----------

export const strompreis: Quelle = {
  id: 'strompreis', name: 'Strompreis (Day-Ahead)', takt: 900, lizenz: 'Bundesnetzagentur | SMARD.de über Energy-Charts (CC BY 4.0)',
  async laden(): Promise<Ergebnis> {
    const heute = new Date(), morgen = new Date(Date.now() + 86400000)
    const d = await hole(`https://api.energy-charts.info/price?bzn=DE-LU&start=${encodeURIComponent(berlin(heute))}&end=${encodeURIComponent(berlin(morgen, '23:45'))}`, 840)
    const zeit: number[] = d.unix_seconds ?? [], preis: (number | null)[] = d.price ?? []
    const jetzt = Date.now() / 1000
    const schritt = zeit.length > 1 ? zeit[1] - zeit[0] : 900
    const i = zeit.findIndex((t) => t <= jetzt && jetzt < t + schritt)
    const tagEnde = new Date(berlin(morgen)).getTime() / 1000
    const heuteIdx = zeit.map((t, j) => [t, j] as const).filter(([t, j]) => t < tagEnde && preis[j] != null)
    if (i < 0 || !heuteIdx.length) throw new Error('Energy-Charts: kein Preis')
    const [minZ, minJ] = heuteIdx.reduce((a, b) => (preis[b[1]]! < preis[a[1]]! ? b : a))
    const [maxZ, maxJ] = heuteIdx.reduce((a, b) => (preis[b[1]]! > preis[a[1]]! ? b : a))
    const p = preis[i]!
    daten.preis = { stand: zeit[i], jetzt: p, min: preis[minJ]!, minZeit: minZ, max: preis[maxJ]!, maxZeit: maxZ, kurve: { zeit, reihen: [{ name: 'Day-Ahead-Preis', farbe: FARBE.preis, werte: preis }] } }
    const ct = (v: number) => `${zahl(v / 10, 1)} ct/kWh`
    const morgenDa = zeit.some((t, j) => t >= tagEnde && preis[j] != null)
    const zeilen: Zeile[] = [
      { text: `Jetzt ${zahl(p, 2)} €/MWh (${ct(p)})`, klein: `${uhr(zeit[i])} Uhr · Großhandel, ohne Netzentgelte und Steuern`, stufe: p < 0 ? 'info' : undefined },
      { text: `Heute günstigst ${zahl(preis[minJ]!, 2)} €/MWh um ${uhr(minZ)} Uhr`, klein: ct(preis[minJ]!) },
      { text: `Heute teuerst ${zahl(preis[maxJ]!, 2)} €/MWh um ${uhr(maxZ)} Uhr`, klein: ct(preis[maxJ]!) },
    ]
    if (morgenDa) {
      const m = zeit.map((t, j) => [t, preis[j]] as const).filter(([t, v]) => t >= tagEnde && v != null) as [number, number][]
      const mitte = m.reduce((a, b) => a + b[1], 0) / m.length
      zeilen.push({ text: `Morgen im Mittel ${zahl(mitte, 2)} €/MWh`, klein: `${zahl(Math.min(...m.map((x) => x[1])), 2)} bis ${zahl(Math.max(...m.map((x) => x[1])), 2)} €/MWh` })
    }
    return { zeilen, stand: new Date(zeit[i] * 1000) }
  },
}

// ---------- Stromampel ----------

const SIGNAL: Record<number, Signal> = { [-1]: 'Netzengpass', 0: 'rot', 1: 'gelb', 2: 'grün' }

export const stromampel: Quelle = {
  id: 'stromampel', name: 'Stromampel Hamm', takt: 900, lizenz: 'Energy-Charts, Fraunhofer ISE (CC BY 4.0)',
  async laden(): Promise<Ergebnis> {
    const d = await hole('https://api.energy-charts.info/signal?country=de&postal_code=59065', 840)
    const zeit: number[] = d.unix_seconds ?? [], sig: number[] = d.signal ?? [], anteil: number[] = d.share ?? []
    const jetzt = Date.now() / 1000
    let i = zeit.findIndex((t, j) => t <= jetzt && (zeit[j + 1] ?? Infinity) > jetzt)
    if (i < 0) i = 0
    const folge = zeit.map((t, j) => ({ zeit: t, signal: SIGNAL[sig[j]] ?? 'gelb', anteil: anteil[j] })).filter((f) => f.zeit >= zeit[i] && f.zeit < jetzt + 86400)
    if (!folge.length) throw new Error('Energy-Charts: kein Signal')
    daten.ampel = { stand: zeit[i], jetzt: folge[0].signal, anteil: folge[0].anteil, folge }
    // zusammenhängende Abschnitte
    const abschnitte: { von: number; bis: number; signal: Signal }[] = []
    const schritt = zeit.length > 1 ? zeit[1] - zeit[0] : 900
    for (const f of folge) {
      const a = abschnitte[abschnitte.length - 1]
      if (a && a.signal === f.signal) a.bis = f.zeit + schritt
      else abschnitte.push({ von: f.zeit, bis: f.zeit + schritt, signal: f.signal })
    }
    const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
    const tagUhr = (t: number) => (new Date(t * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }) === heute ? '' : 'morgen ') + uhr(t)
    const stufe = (s: Signal): Zeile['stufe'] => (s === 'Netzengpass' ? 'alarm' : s === 'rot' ? 'warnung' : 'info')
    const zeilen: Zeile[] = [
      { text: `Jetzt ${folge[0].signal} bis ${tagUhr(abschnitte[0].bis)} Uhr, ${zahl(folge[0].anteil)} % erneuerbar`, klein: 'Postleitzahl 59065', stufe: stufe(folge[0].signal) },
      ...abschnitte.slice(1, 9).map((a) => ({ text: `${tagUhr(a.von)}–${uhr(a.bis)} Uhr: ${a.signal}`, stufe: stufe(a.signal) })),
    ]
    return { zeilen, stand: new Date(zeit[i] * 1000) }
  },
}

// ---------- Schätzungen für Hamm ----------

const PR = 0.8

export const solarHamm: Quelle = {
  id: 'solarHamm', name: 'Solarstrom Hamm (geschätzt)', takt: 600, lizenz: 'Marktstammdatenregister (dl-de/by-2-0), DWD über Bright Sky (CC BY 4.0), eigene Schätzung',
  async laden(): Promise<Ergebnis> {
    const hamm = await energieHamm()
    const kW = hamm?.traeger?.Solar?.bruttoKW
    if (!kW) throw new Error('energie-hamm.json fehlt (python daten/mastr.py)')
    const inst = kW / 1000
    const [jetzt, tagW] = await Promise.all([
      hole(`https://api.brightsky.dev/current_weather?lat=${HAMM.lat}&lon=${HAMM.lon}`, 300),
      hole(`https://api.brightsky.dev/weather?lat=${HAMM.lat}&lon=${HAMM.lon}&date=${encodeURIComponent(berlin(new Date()))}&last_date=${encodeURIComponent(berlin(new Date(), '23:59'))}`, 600),
    ])
    const w = jetzt.weather ?? {}
    // kWh/m² im Zeitraum → mittlere Bestrahlungsstärke in W/m²
    const G = w.solar_10 != null ? w.solar_10 * 6000 : w.solar_30 != null ? w.solar_30 * 2000 : (w.solar_60 ?? 0) * 1000
    const jetztMW = inst * (G / 1000) * PR
    const nun = Date.now()
    // Stundenwerte: Zeitstempel = Ende der Stunde; nur bereits vergangene Stunden zählen
    const stunden = (tagW.weather ?? []).filter((x: any) => x.solar != null && new Date(x.timestamp).getTime() <= nun)
      .map((x: any) => ({ zeit: new Date(x.timestamp).getTime() / 1000, MW: inst * x.solar * PR }))
    const heuteMWh = stunden.reduce((a: number, s: { MW: number }) => a + s.MW, 0)
    daten.solar = { stand: nun / 1000, jetztMW, heuteMWh, installiertMW: inst, strahlungW: G, stunden }
    return {
      zeilen: [
        { text: `Jetzt etwa ${zahl(jetztMW, 1)} MW (geschätzt)`, klein: `Globalstrahlung ${zahl(G)} W/m² · ${zahl(inst, 1)} MW installiert · Faktor ${zahl(PR, 1)}` },
        { text: `Heute bisher etwa ${zahl(heuteMWh, 0)} MWh (geschätzt)`, klein: `aus Stundenwerten der DWD-Station ${jetzt.sources?.[0]?.station_name ?? ''}` },
      ],
      stand: new Date(w.timestamp ?? nun),
    }
  },
}

/** Einfache Leistungskurve: Anlauf 3 m/s, Nennleistung ab 12 m/s, Abschaltung über 25 m/s */
export const windAnteil = (v: number) => (v < 3 || v > 25 ? 0 : v >= 12 ? 1 : (v ** 3 - 27) / (12 ** 3 - 27))

export const windHamm: Quelle = {
  id: 'windHamm', name: 'Windstrom Hamm (geschätzt)', takt: 600, lizenz: 'Marktstammdatenregister (dl-de/by-2-0), DWD über Bright Sky (CC BY 4.0), eigene Schätzung',
  async laden(): Promise<Ergebnis> {
    const hamm = await energieHamm()
    const kW = hamm?.traeger?.Wind?.bruttoKW ?? 0
    if (!hamm) throw new Error('energie-hamm.json fehlt (python daten/mastr.py)')
    if (!kW) return { zeilen: [{ text: 'Keine Windenergieanlagen in Hamm registriert', stufe: 'info' }], stand: new Date() }
    const d = await hole(`https://api.brightsky.dev/current_weather?lat=${HAMM.lat}&lon=${HAMM.lon}`, 300)
    const w = d.weather ?? {}
    const v10 = (w.wind_speed_10 ?? w.wind_speed_30 ?? w.wind_speed_60 ?? 0) / 3.6
    const vNabe = v10 * (120 / 10) ** 0.2
    const inst = kW / 1000, jetztMW = inst * windAnteil(vNabe)
    daten.wind = { stand: Date.now() / 1000, jetztMW, installiertMW: inst, v10, vNabe }
    return {
      zeilen: [{ text: `Jetzt etwa ${zahl(jetztMW, 1)} MW (geschätzt)`, klein: `Wind ${zahl(v10, 1)} m/s in 10 m, etwa ${zahl(vNabe, 1)} m/s in 120 m · ${zahl(inst, 1)} MW installiert, ${hamm.traeger.Wind.anzahl} Anlagen` }],
      stand: new Date(w.timestamp ?? Date.now()),
    }
  },
}

// ---------- Großanlagen ----------

export const kraftwerkeHamm: Quelle = {
  id: 'kraftwerkeHamm', name: 'Großanlagen Hamm', takt: 900, lizenz: 'Marktstammdatenregister der Bundesnetzagentur (dl-de/by-2-0)',
  async laden(): Promise<Ergebnis> {
    const hamm = await energieHamm()
    if (!hamm) throw new Error('energie-hamm.json fehlt (python daten/mastr.py)')
    const feats: GeoJSON.Feature[] = []
    const zeilen: Zeile[] = hamm.grossanlagen.map((g) => {
      const titel = g.name || g.einheit || g.traeger
      const sub = `${g.traeger}${g.brennstoff && !g.brennstoff.startsWith(g.traeger) ? ', ' + g.brennstoff : ''} · ${mw(g.bruttoKW)}${g.speicherKWh ? ' · ' + zahl(g.speicherKWh / 1000, 1) + ' MWh' : ''}${g.inbetriebnahme ? ' · seit ' + g.inbetriebnahme.slice(0, 4) : ''} · ${g.betreiber ?? ''}`
      const lon = g.lon ?? undefined, lat = g.lat ?? undefined
      if (lon != null && lat != null) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { icon: 'kraftwerk', titel, sub } })
      return { text: `${titel}: ${mw(g.bruttoKW)}`, klein: sub, lon, lat }
    })
    for (const g of hamm.geplant ?? []) zeilen.push({ text: `Geplant: ${g.name}: ${mw(g.bruttoKW)}`, klein: `${g.traeger}${g.geplant ? ' · ab ' + g.geplant.slice(5, 7) + '/' + g.geplant.slice(0, 4) : ''} · ${g.betreiber ?? ''}`, lon: g.lon ?? undefined, lat: g.lat ?? undefined, stufe: 'info' })
    zeilen.push({ text: 'Keine offenen Live-Werte je Block', klein: 'Energy-Charts liefert offen nur Summen je Erzeugungsart', stufe: 'info' })
    return { zeilen, punkte: { type: 'FeatureCollection', features: feats }, stand: new Date(hamm.abruf) }
  },
}

export const ENERGIE_QUELLEN: Quelle[] = [stromDe, strompreis, stromampel, solarHamm, windHamm, kraftwerkeHamm]

/** Für die Kennzahlen-Zeile im Tab Aktuell; null, bis solarHamm einmal geladen hat */
export const kennzahlSolar = (): { jetztMW: number; heuteMWh: number; installiertMW: number } | null =>
  daten.solar ? { jetztMW: daten.solar.jetztMW, heuteMWh: daten.solar.heuteMWh, installiertMW: daten.solar.installiertMW } : null

// ---------- Kartensymbol ----------

function kraftwerkPlakette() {
  const P = 2, s = 22
  const c = document.createElement('canvas')
  c.width = s * P; c.height = s * P
  const g = c.getContext('2d')!
  g.scale(P, P)
  g.fillStyle = '#005468'; g.fillRect(0, 0, s, s)
  g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, s - 1.5, s - 1.5)
  // Blitz
  g.fillStyle = '#f0ca00'
  g.beginPath(); g.moveTo(12.5, 3.5); g.lineTo(6, 12.5); g.lineTo(10.5, 12.5); g.lineTo(9, 18.5); g.lineTo(16, 9.5); g.lineTo(11.5, 9.5); g.closePath(); g.fill()
  return g.getImageData(0, 0, c.width, c.height)
}

export function energieSymbole(map: maplibregl.Map) {
  map.on('styleimagemissing', (e) => {
    if (e.id === 'kraftwerk' && !map.hasImage(e.id)) map.addImage(e.id, kraftwerkPlakette(), { pixelRatio: 2 })
  })
}

/**
 * Tab „Tanken“: Spritpreise aller Tankstellen in Hamm (Tankerkönig, CC BY 4.0, über /api/tanken mit privatem Schlüssel)
 * Liste nach Literpreis der gewählten Sorte. Kartensymbol: Preisplakette je Tankstelle, Farbe nach Rang (günstig grün, teuer rot, zu grau).
 */
import type maplibregl from 'maplibre-gl'
import type * as GeoJSON from 'geojson'
import type { Ergebnis, Quelle, Zeile } from './live'

export type Sorte = 'e5' | 'e10' | 'diesel'
export const SORTEN: { id: Sorte; name: string }[] = [{ id: 'e10', name: 'Super E10' }, { id: 'e5', name: 'Super E5' }, { id: 'diesel', name: 'Diesel' }]

type Station = { id: string; name: string; brand: string; street: string; houseNumber: string; place: string; lat: number; lng: number; dist: number; isOpen: boolean; e5: number | null | false; e10: number | null | false; diesel: number | null | false }

const lese = <T>(k: string, d: T): T => { try { const v = localStorage.getItem('ham-lage.' + k); return v ? JSON.parse(v) : d } catch { return d } }
const schreibe = (k: string, v: unknown) => { try { localStorage.setItem('ham-lage.' + k, JSON.stringify(v)) } catch { /* privat */ } }

export const tankWahl = { sorte: lese<Sorte>('sorte', 'e10') }
export function tankWahlSetzen(w: Partial<typeof tankWahl>) { Object.assign(tankWahl, w); schreibe('sorte', tankWahl.sorte) }

/** 1,749 € mit hochgestellter letzter Ziffer wie an der Preistafel (als Text ohne Hochstellung) */
export const preisText = (p: number) => p.toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' €'
const titelFall = (s: string) => s.toLowerCase().replace(/(^|[\s\-/(])([a-zäöüß])/g, (_, a, b) => a + b.toUpperCase())
const preis = (s: Station, sorte: Sorte) => { const v = s[sorte]; return typeof v === 'number' && v > 0 ? v : null }

let letzte: Station[] = []
export const tankstellenRoh = () => letzte

export const tankstellen: Quelle = {
  id: 'tankstellen', name: 'Spritpreise', takt: 300, lizenz: 'Tankerkönig, Markttransparenzstelle für Kraftstoffe (CC BY 4.0)',
  async laden(): Promise<Ergebnis> {
    const d = await (await fetch('/api/tanken')).json() as { ok: boolean; fehlt?: boolean; fehler?: string; stand?: string; stationen?: Station[] }
    if (d.fehlt) return { stand: new Date(), zeilen: [{ text: 'Tankerkönig-Schlüssel fehlt', klein: 'local/tankerkoenig.json fehlt', stufe: 'warnung' }] }
    if (!d.ok) return { stand: new Date(), zeilen: [{ text: 'Tankerkönig antwortet nicht', klein: d.fehler ?? '', stufe: 'alarm' }] }
    letzte = d.stationen ?? []
    return tankErgebnis(new Date(d.stand ?? Date.now()))
  },
}

/** Zeilen und Punkte für die gewählte Sorte neu berechnen (ohne neue Abfrage). */
export function tankErgebnis(stand = new Date()): Ergebnis {
  const { sorte } = tankWahl
  const mit = letzte.filter((s) => preis(s, sorte) != null)
  const offen = mit.filter((s) => s.isOpen).sort((a, b) => preis(a, sorte)! - preis(b, sorte)! || a.dist - b.dist)
  const zu = mit.filter((s) => !s.isOpen)
  const ps = offen.map((s) => preis(s, sorte)!)
  const min = ps[0] ?? 0, max = ps[ps.length - 1] ?? 0
  const stufe = (p: number) => (max - min < 0.005 ? 1 : p <= min + (max - min) / 3 ? 0 : p >= max - (max - min) / 3 ? 2 : 1)
  const name = (s: Station) => `${titelFall(s.brand || s.name)}, ${titelFall(s.street)}${s.houseNumber ? ' ' + s.houseNumber.trim() : ''}`
  const features: GeoJSON.Feature[] = [...offen, ...zu].map((s) => {
    const p = preis(s, sorte)!
    const st = s.isOpen ? stufe(p) : 3
    return {
      type: 'Feature', geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: {
        icon: `tanke:${p.toFixed(3)}:${st}`, rang: s.isOpen ? p : 99,
        titel: name(s),
        sub: `${titelFall(s.place)} · ${s.isOpen ? 'geöffnet' : 'geschlossen'} · ${SORTEN.map((x) => `${x.name} ${preis(s, x.id) != null ? preisText(preis(s, x.id)!) : '–'}`).join(' · ')}`,
      },
    }
  })
  const zeilen: Zeile[] = []
  // Liste: nur Tankstellen in Hamm (Karte zeigt auch das Umland); Preisspanne bezieht sich auf Hamm
  const hamm = offen.filter((s) => /hamm/i.test(s.place))
  const hp = hamm.map((s) => preis(s, sorte)!)
  if (hamm.length) {
    const hmin = hp[0], hmax = hp[hp.length - 1], hmittel = hp.reduce((a, b) => a + b, 0) / hp.length
    zeilen.push({ text: `${SORTEN.find((x) => x.id === sorte)!.name} in Hamm: ${preisText(hmin)} bis ${preisText(hmax)}`, klein: `Mittel ${preisText(hmittel)} · ${hamm.length} Tankstellen geöffnet · Umland günstigste ${preisText(min)}`, stufe: 'info' })
    for (const s of hamm) {
      const p = preis(s, sorte)!
      zeilen.push({ text: `${preisText(p)}  ${name(s)}`, klein: `${titelFall(s.place)} · ${s.dist.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km vom Markt${p - hmin > 0.0005 ? ` · +${(p - hmin).toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €` : ' · günstigste'}`, lon: s.lng, lat: s.lat })
    }
  } else zeilen.push({ text: 'Gerade keine geöffnete Tankstelle in Hamm mit Preis', stufe: 'info' })
  if (zu.length) zeilen.push({ text: `${zu.length} Tankstellen geschlossen`, klein: zu.slice(0, 6).map(name).join(' · '), stufe: 'info' })
  return { stand, zeilen, punkte: { type: 'FeatureCollection', features } }
}

// ---------------------------------------------------------------- Kartensymbol: Preisplakette

const FARBEN = ['#1d7f3c', '#141416', '#c4271b', '#8a8c92']
const SCHRIFT = '"Bahnschrift", "DIN 1451", "Arial Narrow", sans-serif'

function plakette(p: string, st: number) {
  const PR = 2
  const [ganz, rest] = Number(p).toFixed(3).replace('.', ',').split(/(?<=,\d\d)/)
  const g0 = document.createElement('canvas').getContext('2d')!
  g0.font = `700 13px ${SCHRIFT}`
  const w1 = Math.ceil(g0.measureText(ganz).width)
  const w = 20 + w1 + 8 + 6, h = 20
  const c = document.createElement('canvas')
  c.width = w * PR; c.height = h * PR
  const g = c.getContext('2d')!
  g.scale(PR, PR)
  g.fillStyle = FARBEN[st]; g.fillRect(0, 0, w, h)
  g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, w - 1.5, h - 1.5)
  // Zapfsäule
  g.fillStyle = '#ffffff'
  g.fillRect(5, 4, 7, 12); g.fillStyle = FARBEN[st]; g.fillRect(6.5, 5.5, 4, 3.5)
  g.strokeStyle = '#ffffff'; g.lineWidth = 1.3
  g.beginPath(); g.moveTo(12, 7); g.lineTo(14.5, 9); g.lineTo(14.5, 14); g.stroke()
  g.fillStyle = '#ffffff'; g.textBaseline = 'middle'
  g.font = `700 13px ${SCHRIFT}`; g.fillText(ganz, 20, h / 2 + 0.5)
  g.font = `700 9px ${SCHRIFT}`; g.fillText(rest ?? '', 20 + w1 + 1, h / 2 - 2.5)
  return g.getImageData(0, 0, c.width, c.height)
}

export function tankSymbole(map: maplibregl.Map) {
  map.on('styleimagemissing', (e) => {
    const m = /^tanke:([\d.]+):(\d)$/.exec(e.id)
    if (m && !map.hasImage(e.id)) map.addImage(e.id, plakette(m[1], Number(m[2])), { pixelRatio: 2 })
  })
}

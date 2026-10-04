/**
 * Ortssuche ohne Server: Index aus web/public/daten/orte.json (OSM, daten/orte.py).
 * Unscharfe Präfix- und Wortsuche, tolerant für Umlaute und ß (ä = ae = a, ß = ss).
 * Ranking: exakt > Anfang > Wortanfang > enthält; bei gleicher Güte Stadtteile und große Orte vor Straßen.
 */

export type Treffer = { name: string; art: string; lon: number; lat: number; stadtteil: string }

type Eintrag = Treffer & { n: string; w: string[]; s: string; vorrang: number }
let index: Eintrag[] = []
let laden: Promise<void> | null = null

const VORRANG: Record<string, number> = {
  Stadtteil: 0, Ortsteil: 1, Bahnhof: 1,
  Park: 2, Gewässer: 2, Krankenhaus: 2, Rathaus: 2, Hochschule: 2, Museum: 2, Theater: 2, Sehenswürdigkeit: 2, Einkaufszentrum: 2, Friedhof: 2, Kino: 2, Sportanlage: 2, Schule: 2,
  Straße: 2, Haltestelle: 4,
}

/** Normalform: klein, ß → ss, Umlaute und ae/oe/ue → a/o/u, Satzzeichen → Leerzeichen. */
export function normal(s: string) {
  return s.toLowerCase().replace(/ß/g, 'ss').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/str\.(?=\s|$)/g, 'strasse').replace(/[^a-z0-9]+/g, ' ').trim()
}

// ---------------------------------------------------------------- Adressen (amtliche Hauskoordinaten, daten/adressen.py)
type Strasse = { name: string; n: string; nummern: [string, number, number][] }
let strassen: Strasse[] = []

function adressenLaden(url = '/daten/adressen.json') {
  return fetch(url).then((r) => r.json()).then((d: { strassen: string[]; a: [number, string, number, number][] }) => {
    strassen = d.strassen.map((name) => ({ name, n: normal(name), nummern: [] }))
    for (const [i, nr, lon, lat] of d.a) strassen[i].nummern.push([nr, lon, lat])
    const zahl = (x: string) => parseInt(x, 10) || 0
    for (const st of strassen) st.nummern.sort((a, b) => zahl(a[0]) - zahl(b[0]) || a[0].localeCompare(b[0]))
  }).catch(() => { /* ohne Adressen weiter */ })
}

/** Straßen, deren Name zur Eingabe passt: Anfang vor Wortanfang vor enthält. */
function strassenFinden(nq: string, n: number): Strasse[] {
  if (!nq) return []
  const g = (st: Strasse) => st.n.startsWith(nq) ? 0 : st.n.split(' ').some((w) => w.startsWith(nq)) ? 1 : st.n.includes(nq.replace(/ /g, '')) || st.n.includes(nq) ? 2 : -1
  return strassen.map((st) => ({ st, k: g(st) })).filter((x) => x.k >= 0).sort((a, b) => a.k - b.k || a.st.name.length - b.st.name.length).slice(0, n).map((x) => x.st)
}

/** Adresssuche: „Weststraße 12“, „weststr 12a“, „Nordenstiftsweg 3“. */
function adressenSuchen(q: string, n: number): Treffer[] {
  const m = q.trim().match(/^(.*?)[\s,]+(\d+\s*[a-zA-Z]?)$/)
  if (!m) return []
  const nr = m[2].replace(/\s+/g, '').toLowerCase()
  const aus: Treffer[] = []
  for (const st of strassenFinden(normal(m[1]), 3)) {
    const passend = st.nummern.filter(([x]) => x.toLowerCase() === nr).concat(st.nummern.filter(([x]) => x.toLowerCase() !== nr && x.toLowerCase().startsWith(nr)))
    if (!passend.length && st.nummern.length) {
      // Nummer gibt es nicht: nächstgelegene Hausnummern anbieten
      const ziel = parseInt(nr, 10) || 0
      passend.push(...[...st.nummern].sort((a, b) => Math.abs((parseInt(a[0], 10) || 0) - ziel) - Math.abs((parseInt(b[0], 10) || 0) - ziel)).slice(0, 2))
    }
    for (const [x, lon, lat] of passend.slice(0, n)) aus.push({ name: `${st.name} ${x}`, art: x.toLowerCase() === nr ? 'Adresse' : 'Adresse (nächste Nummer)', lon, lat, stadtteil: '' })
    if (aus.length >= n) break
  }
  return aus.slice(0, n)
}

/** Lädt den Index einmal (mehrfacher Aufruf liefert dasselbe Versprechen). */
export function orteLaden(url = '/daten/orte.json'): Promise<void> {
  void adressenLaden()
  laden ??= fetch(url).then((r) => r.json()).then((d: { arten: string[]; stadtteile: string[]; orte: [string, number, number, number, number][] }) => {
    index = d.orte.map(([name, a, lon, lat, t]) => {
      const art = d.arten[a], stadtteil = d.stadtteile[t] ?? ''
      const n = normal(name)
      return { name, art, lon, lat, stadtteil, n, w: n.split(' '), s: normal(stadtteil), vorrang: VORRANG[art] ?? 3 }
    })
  })
  return laden
}

/** Güte eines Suchworts gegen einen Eintrag: 0 Anfang, 1 Wortanfang, 2 enthält, 3 nur Stadtteil, sonst -1. */
function guete(e: Eintrag, q: string, erstes: boolean) {
  if (erstes && e.n.startsWith(q)) return 0
  if (e.w.some((w) => w.startsWith(q))) return 1
  // zusammengesetzte Namen: „bahnhof“ in „hauptbahnhof“, „strasse“ in „oststrasse“
  if (e.n.includes(q)) return 2
  if (e.s && e.s.split(' ').some((w) => w.startsWith(q))) return 3
  return -1
}

/** Bis zu n Treffer, vor dem Laden leer. */
export function suchen(q: string, n = 8): Treffer[] {
  const adr = adressenSuchen(q, n)
  if (adr.length) return adr
  const nq = normal(q)
  if (!nq || !index.length) return []
  const woerter = nq.split(' ')
  const kandidaten: { e: Eintrag; k: number }[] = []
  for (const e of index) {
    let k: number
    if (e.n === nq) k = 0
    else {
      let summe = 0, ok = true
      for (let i = 0; i < woerter.length; i++) {
        const g = guete(e, woerter[i], i === 0)
        if (g < 0) { ok = false; break }
        summe = Math.max(summe, g)
      }
      if (!ok) continue
      k = 1 + summe
    }
    kandidaten.push({ e, k })
  }
  kandidaten.sort((a, b) => a.k - b.k || a.e.vorrang - b.e.vorrang || a.e.name.length - b.e.name.length || a.e.name.localeCompare(b.e.name, 'de'))
  const aus: Treffer[] = []
  const gesehen = new Set<string>()
  for (const { e } of kandidaten) {
    const key = e.name + '|' + e.art + '|' + e.stadtteil
    if (gesehen.has(key)) continue
    gesehen.add(key)
    aus.push({ name: e.name, art: e.art, lon: e.lon, lat: e.lat, stadtteil: e.stadtteil })
    if (aus.length >= n) break
  }
  // Straßen aus den amtlichen Adressen ergänzen (Mittelpunkt der Hausnummern), falls noch nicht dabei
  for (const st of strassenFinden(nq, 3)) {
    if (aus.some((t) => normal(t.name) === st.n)) continue
    const mitte = st.nummern[Math.floor(st.nummern.length / 2)]
    if (mitte) aus.splice(Math.min(aus.length, 3), 0, { name: st.name, art: 'Straße', lon: mitte[1], lat: mitte[2], stadtteil: '' })
  }
  return aus.slice(0, n)
}

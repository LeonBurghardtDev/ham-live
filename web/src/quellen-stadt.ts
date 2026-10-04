import type * as GeoJSON from 'geojson'
import { hole, type Ergebnis, type Quelle, type Zeile } from './live.ts'
import { entities, strassenLaden } from './quellen-hamm.ts'

/**
 * Stadtquellen Hamm (gleiche Typen wie live.ts):
 * Baustellen und Sperrungen aus den Pressemitteilungen der Stadt Hamm (presse-service.de),
 * Veranstaltungen der nächsten 14 Tage aus dem Veranstaltungskalender der Stadt Hamm (iCal).
 * Linien tragen properties.lage, Punkte properties.icon.
 */

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const pt = (lon: number, lat: number, props: Record<string, unknown>): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props })
const datum = (d: Date) => d.toLocaleDateString('de-DE', d.getFullYear() === new Date().getFullYear() ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', year: 'numeric' })
const uhr = (d: Date) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
const kuerzen = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const TAG = 86400000
const tagesbeginn = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const mitte = (c: number[][]) => c[Math.floor(c.length / 2)]
const abstand = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * 69000, (a[1] - b[1]) * 111320) // Meter, Näherung für Hamm

// ---------------------------------------------------------------- 1. Baustellen und Sperrungen (Pressemitteilungen Stadt Hamm)

type StrassenEintrag = { b: string; l: number[][][] }
type Meldung = { id: string; titel: string; link: string; datum: number; kurz: string }

const PRESSE_RSS = 'https://www.presse-service.de/rss.aspx?p=1256'
/** Die Volltextsuche des Feeds (&s=) reicht weiter zurück als die letzten ~20 Meldungen. */
const SUCHWOERTER = ['Sperrung', 'gesperrt', 'Vollsperrung', 'Umleitung', 'Baustelle', 'Fahrbahn', 'Kanal', 'Sanierung']
const BAU = /Baustelle|Sperrung|gesperrt|Umleitung|umgeleitet|Fahrbahn|Kanal(arbeiten|bau|erneuerung)|Deckschicht|Asphalt|saniert|Sanierung|ausgebaut|Ausbau|Umbau|Bauabschnitt|Einbahnstraße/i
const BAU_SATZ = /Sperrung|gesperrt|Umleitung|umgeleitet|eingeengt|Einbahnstraße|Baustelle|Fahrbahn|Asphalt|Deckschicht|Kanal|saniert|Sanierung|ausgebaut|Ausbau|Umbau|Bauabschnitt/i
/** Pflicht: mindestens ein deutliches Wort für Verkehrseinschränkung oder Straßenbau im Text. */
const STARK = /gesperrt|Sperrung|Umleitung|umgeleitet|eingeengt|Einbahnstraße|Baustelle|Fahrbahn|Asphalt|Deckschicht|Kanal(bau|arbeiten|erneuerung)/i
/** Sperrungen von Anlagen statt Straßen. */
const ANLAGE = /Spielplatz|Schulhof|Sportplatz|Friedhof|Freibad|Hallenbad|Turnhalle|Kita/i
const ERLEDIGT = /freigegeben|abgeschlossen|fertiggestellt|eingeweiht|eröffnet|Spatenstich|Schlüsselübergabe/i
const MONATE = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember']
const MONAT_RE = 'Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember'
const ENDE_WORT = /abgeschlossen|beendet|fertiggestellt|Fertigstellung|freigegeben|dauern|andauern|enden\b|aufgehoben/i

function rssMeldungen(rss: string): Meldung[] {
  return rss.split(/<item>/).slice(1).map((i) => {
    const link = entities(i.match(/<link>([^<]+)<\/link>/)?.[1] ?? '').trim()
    return {
      id: link.match(/ID=(\d+)/i)?.[1] ?? link,
      titel: entities(i.match(/<title>([^<]*)<\/title>/)?.[1] ?? '').replace(/\s+/g, ' ').trim(),
      link,
      datum: Date.parse(i.match(/<pubDate>([^<]+)/)?.[1] ?? ''),
      kurz: entities(i.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
    }
  }).filter((m) => m.link && Number.isFinite(m.datum))
}

/** Meldungstext aus der Detailseite (Block ps_meldungstext bis zur Pressestellen-Signatur). */
function meldungstext(html: string) {
  const ab = html.indexOf('ps_meldungstext')
  let t = ab >= 0 ? html.slice(ab + 'ps_meldungstext'.length + 2) : html
  t = entities(t.replace(/<\/(p|div|li)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
  const ende = t.search(/Pressestelle der Stadt Hamm|Sämtliche Texte können/)
  return (ende > 0 ? t.slice(0, ende) : t).replace(/[ \t]+/g, ' ').trim()
}

type Fund = { d: Date; art: 'von' | 'bis' }

/** Datumsangaben im Meldungstext mit Rolle (Beginn oder Ende). Jahr fehlt meist: dann das der Meldung, bei frühen Monaten das folgende. */
export function zeitraumAus(text: string, pub: Date): { von?: Date; bis?: Date } {
  const funde: Fund[] = []
  const jahr = (j: string | undefined, m: number, t: number) => {
    if (j) return Number(j.length === 2 ? '20' + j : j)
    const d = new Date(pub.getFullYear(), m, t)
    return d.getTime() < pub.getTime() - 90 * TAG ? pub.getFullYear() + 1 : pub.getFullYear()
  }
  const rolle = (idx: number): 'von' | 'bis' => {
    const satzAnfang = Math.max(text.lastIndexOf('.', idx - 3) , text.lastIndexOf('\n', idx), 0)
    const vor = text.slice(Math.max(satzAnfang, idx - 45), idx)
    if (/\bbis\b|Ende\s*$/i.test(vor)) return 'bis'
    if (/\b(ab|seit|vom|beginn|start)/i.test(vor)) return 'von'
    const satzEnde = text.indexOf('.', idx + 12)
    const satz = text.slice(satzAnfang, satzEnde > 0 ? satzEnde : undefined)
    return ENDE_WORT.test(satz) ? 'bis' : 'von'
  }
  const add = (idx: number, d: Date, art?: 'von' | 'bis') => { if (!isNaN(d.getTime())) funde.push({ d, art: art ?? rolle(idx) }) }
  for (const m of text.matchAll(new RegExp(`(?<![\\d.])(\\d{1,2})\\.\\s?(${MONAT_RE})(?:\\s+(\\d{4}))?`, 'g'))) {
    const mo = MONATE.indexOf(m[2].toLowerCase()), t = Number(m[1])
    add(m.index!, new Date(jahr(m[3], mo, t), mo, t))
  }
  for (const m of text.matchAll(/(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2}(?!\d))?/g)) {
    const mo = Number(m[2]) - 1, t = Number(m[1])
    if (mo < 0 || mo > 11 || t < 1 || t > 31) continue
    add(m.index!, new Date(jahr(m[3], mo, t), mo, t))
  }
  for (const m of text.matchAll(new RegExp(`(Anfang|Mitte|Ende)\\s+(${MONAT_RE})(?:\\s+(\\d{4}))?`, 'g'))) {
    const mo = MONATE.indexOf(m[2].toLowerCase())
    const t = m[1] === 'Anfang' ? 7 : m[1] === 'Mitte' ? 15 : new Date(2001, mo + 1, 0).getDate()
    add(m.index!, new Date(jahr(m[3], mo, t), mo, t), m[1] === 'Ende' ? 'bis' : undefined)
  }
  for (const m of text.matchAll(/(Jahresende|Ende des Jahres)(?:\s+(\d{4}))?/g)) add(m.index!, new Date(m[2] ? Number(m[2]) : pub.getFullYear(), 11, 31), 'bis')
  const von = funde.filter((f) => f.art === 'von').map((f) => f.d.getTime())
  const bis = funde.filter((f) => f.art === 'bis').map((f) => f.d.getTime())
  return { von: von.length ? new Date(Math.min(...von)) : undefined, bis: bis.length ? new Date(Math.max(...bis)) : undefined }
}

type StrFund = { name: string; i: number; j: number }

/** Alle bekannten Straßennamen im Text, längste zuerst, ohne Überlappung. */
function strassenImText(text: string, namen: string[]): StrFund[] {
  const funde: StrFund[] = []
  for (const n of namen) {
    let i = text.indexOf(n)
    while (i >= 0) {
      const j = i + n.length
      const vor = text[i - 1] ?? ' ', nach = text[j] ?? ' '
      if (!/[\p{L}-]/u.test(vor) && !/[\p{L}]/u.test(nach) && !funde.some((f) => i < f.j && j > f.i)) funde.push({ name: n, i, j })
      i = text.indexOf(n, j)
    }
  }
  return funde.sort((a, b) => a.i - b.i)
}

const saetze = (t: string) => {
  const out: { a: number; e: number; s: string }[] = []
  const re = /[^.!?\n]+(?:[.!?](?!\d)|\n|$)/g
  for (const m of t.matchAll(re)) if (m[0].trim()) out.push({ a: m.index!, e: m.index! + m[0].length, s: m[0] })
  return out
}

/**
 * Linienzüge einer Straße auf den Abschnitt zwischen zwei Grenzstraßen kürzen: A und B sind die Stützpunkte,
 * die den Grenzstraßen am nächsten liegen (höchstens 80 m); behalten wird, was in der Ellipse um A und B liegt.
 */
function zuschneiden(linien: number[][][], grenzen: number[][][][]): number[][][] {
  if (grenzen.length < 2) return linien
  const naechster = (g: number[][][]) => {
    let best: number[] | undefined, bd = 80
    for (const l of linien) for (const p of l) for (const gl of g) for (const q of gl) { const d = abstand(p, q); if (d < bd) { bd = d; best = p } }
    return best
  }
  const A = naechster(grenzen[0]), B = naechster(grenzen[1])
  if (!A || !B || abstand(A, B) < 20) return linien
  const max = abstand(A, B) * 1.15 + 25
  const out: number[][][] = []
  for (const l of linien) {
    let lauf: number[][] = []
    for (const p of l) {
      if (abstand(p, A) + abstand(p, B) <= max) lauf.push(p)
      else { if (lauf.length > 1) out.push(lauf); lauf = [] }
    }
    if (lauf.length > 1) out.push(lauf)
  }
  return out.length ? out : linien
}

export type Baustelle = { meldung: Meldung; strassen: string[]; umleitung: string[]; grenzen: string[]; von?: Date; bis?: Date; bezirk?: string }

/** Wertet eine Meldung aus: betroffene Straßen (Titel, sonst erster Satz, plus Sperr-Sätze), Grenzen („zwischen … und …“), Umleitungsstraßen, Zeitraum. */
export function baustelleAus(meldung: Meldung, text: string, namen: string[]): Baustelle | null {
  const norm = (s: string) => s.replace(/(\p{L})str\.(?=[\s,;)]|$)/gu, '$1straße').replace(/\bStr\.(?=[\s,;)]|$)/g, 'Straße')
  const titel = norm(meldung.titel), voll = norm(text)
  const ss = saetze(voll)
  const funde = strassenImText(voll, namen)
  const grenzen = new Set<string>(), umleitung = new Set<string>(), sperr = new Set<string>()
  for (const s of ss) {
    const imSatz = funde.filter((f) => f.i >= s.a && f.j <= s.e)
    if (!imSatz.length) continue
    const zw = s.s.search(/zwischen|Einmündung|Kreuzung|Höhe/)
    for (const f of imSatz) {
      const rel = f.i - s.a
      if (zw >= 0 && rel > zw) grenzen.add(f.name)
    }
    if (/Umleitung|umgeleitet|Umweg/i.test(s.s)) imSatz.forEach((f) => umleitung.add(f.name))
    else if (/gesperrt|Sperrung|eingeengt|Einbahnstraße|Baustelle|saniert|erneuert|Arbeiten/i.test(s.s)) imSatz.forEach((f) => { if (!(zw >= 0 && f.i - s.a > zw)) sperr.add(f.name) })
  }
  const imTitel = strassenImText(titel, namen).map((f) => f.name)
  const erster = ss[0] ? funde.filter((f) => f.i >= ss[0].a && f.j <= ss[0].e && !grenzen.has(f.name)).map((f) => f.name) : []
  const haupt = new Set<string>(imTitel.length ? imTitel : erster)
  for (const n of sperr) if (!umleitung.has(n) || haupt.has(n)) haupt.add(n)
  for (const n of haupt) { grenzen.delete(n); umleitung.delete(n) }
  if (!haupt.size || ANLAGE.test(titel) || !STARK.test(voll + ' ' + titel)) return null
  // Mindestens ein Satz (oder der Titel) nennt eine betroffene Straße zusammen mit Sperrung, Umleitung oder Bauarbeiten
  const belegt = (t: string, a = 0, e = Infinity) => BAU_SATZ.test(t) && funde.some((f) => haupt.has(f.name) && f.i >= a && f.j <= e)
  if (!(BAU_SATZ.test(titel) && imTitel.length) && !ss.some((x) => belegt(x.s, x.a, x.e))) return null
  const { von, bis } = zeitraumAus(voll, new Date(meldung.datum))
  const bezirk = voll.match(/\b(?:Hamm-)?(Bockum-Hövel|Rhynern|Uentrop|Heessen|Pelkum|Herringen|Mitte)\b/)?.[1]
  return { meldung, strassen: [...haupt], umleitung: [...umleitung], grenzen: [...grenzen], von, bis, bezirk }
}

/** Passende Einträge einer Straße: Bezirk aus dem Text, sonst der Bezirk, in dem auch die Grenzstraßen liegen. */
function eintraegeFuer(name: string, b: Baustelle, s: Record<string, StrassenEintrag[]>) {
  const alle = s[name] ?? []
  if (alle.length < 2) return alle
  if (b.bezirk) { const p = alle.filter((e) => e.b === b.bezirk); if (p.length) return p }
  const andere = [...b.grenzen, ...b.strassen.filter((n) => n !== name)]
  const punkte = alle.map((e) => ({ e, n: andere.filter((a) => (s[a] ?? []).some((x) => x.b === e.b)).length }))
  const max = Math.max(...punkte.map((p) => p.n))
  return max > 0 ? punkte.filter((p) => p.n === max).map((p) => p.e) : alle
}

function zeitraumText(von: Date | undefined, bis: Date | undefined, jetzt: number) {
  if (von && bis) return `${datum(von)} – ${datum(bis)}`
  if (bis) return `bis voraussichtlich ${datum(bis)}`
  if (von) return `${von.getTime() > jetzt ? 'ab' : 'seit'} ${datum(von)}`
  return 'Zeitraum nicht genannt'
}

export const baustellen: Quelle = {
  id: 'baustellen', name: 'Baustellen und Sperrungen (Stadt Hamm)', takt: 3600,
  lizenz: 'Stadt Hamm, Pressemitteilungen über presse-service.de (nur Fakten, Text nicht übernommen), Straßen © OpenStreetMap-Mitwirkende (ODbL), nur privat',
  async laden(): Promise<Ergebnis> {
    const feeds = await Promise.all([
      hole(PRESSE_RSS, 1800, 'text'),
      ...SUCHWOERTER.map((w) => hole(`${PRESSE_RSS}&s=${encodeURIComponent(w)}`, 21600, 'text').catch(() => '')),
    ])
    const jetzt = Date.now(), heute = tagesbeginn().getTime()
    const proId = new Map<string, Meldung>()
    for (const f of feeds) for (const m of rssMeldungen(f)) if (!proId.has(m.id)) proId.set(m.id, m)
    const kandidaten = [...proId.values()]
      .filter((m) => m.datum > jetzt - 180 * TAG && BAU.test(m.titel + ' ' + m.kurz) && !ERLEDIGT.test(m.titel))
      .sort((a, b) => b.datum - a.datum)
      .slice(0, 16)
    const s = await strassenLaden().catch(() => ({} as Record<string, StrassenEintrag[]>))
    const namen = Object.keys(s).filter((n) => n.length >= 5 && !/^A \d/.test(n)).sort((a, b) => b.length - a.length)
    const texte = await Promise.all(kandidaten.map((m) => hole(m.link, 43200, 'text').then(meldungstext).catch(() => m.kurz)))
    const liste: Baustelle[] = []
    kandidaten.forEach((m, k) => {
      const b = baustelleAus(m, texte[k], namen)
      if (!b) return
      if (b.bis ? b.bis.getTime() + TAG <= heute : m.datum < jetzt - 42 * TAG) return // abgelaufen bzw. ohne Ende und älter als 6 Wochen
      liste.push(b)
    })
    const feats: GeoJSON.Feature[] = []
    const zeilen: Zeile[] = []
    for (const b of liste) {
      const zeit = zeitraumText(b.von, b.bis, jetzt)
      const aktiv = !b.von || b.von.getTime() <= jetzt
      const sub = `${b.strassen.join(', ')} · ${zeit}${b.umleitung.length ? ' · Umleitung über ' + b.umleitung.join(', ') : ''}`
      const props = { lage: 'baustelle', titel: kuerzen(b.meldung.titel, 90), sub, von: b.von?.toISOString().slice(0, 10) ?? null, bis: b.bis?.toISOString().slice(0, 10) ?? null, link: b.meldung.link }
      let erster: number[] | undefined
      const grenzGeo = b.grenzen.map((g) => eintraegeFuer(g, b, s).flatMap((e) => e.l)).filter((g) => g.length)
      for (const name of b.strassen) for (const teil of zuschneiden(eintraegeFuer(name, b, s).flatMap((e) => e.l), grenzGeo)) {
        erster ??= mitte(teil)
        feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: teil }, properties: { ...props, strasse: name } })
      }
      if (erster) feats.push(pt(erster[0], erster[1], { ...props, icon: 'baustelle' }))
      zeilen.push({
        text: kuerzen(b.meldung.titel, 70), klein: `${b.strassen.join(', ')} · ${zeit}`,
        stufe: aktiv ? 'warnung' : 'info', rang: aktiv ? 0 : 1, lon: erster?.[0], lat: erster?.[1], link: b.meldung.link,
      })
    }
    zeilen.sort((a, b) => (a.rang ?? 0) - (b.rang ?? 0))
    if (!zeilen.length) zeilen.push({ text: 'Keine aktuellen Baustellenmeldungen der Stadt Hamm', stufe: 'info' })
    return { zeilen, punkte: fc(feats), stand: new Date() }
  },
}

// ---------------------------------------------------------------- 2. Veranstaltungen (Veranstaltungskalender Stadt Hamm, iCal)

const KALENDER = 'https://veranstaltungen.hamm.de/output.php?id=1282&mode=ics'
const KALENDER_SEITE = 'https://veranstaltungen.hamm.de/'

export type Termin = { titel: string; kategorie: string; beginn: Date; ende?: Date; ort: string; frei: boolean; ganztag: boolean }

const icsWert = (v: string) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()
function icsZeit(v: string): { d: Date; ganztag: boolean } | undefined {
  const m = v.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/)
  if (!m) return undefined
  const [y, mo, t, h, mi, se] = [1, 2, 3, 4, 5, 6].map((k) => Number(m[k] ?? 0))
  return { d: m[7] ? new Date(Date.UTC(y, mo - 1, t, h, mi, se)) : new Date(y, mo - 1, t, h, mi, se), ganztag: !m[4] }
}

/** VEVENT-Blöcke aus iCal (gefaltete Zeilen werden zusammengefügt). Kategorie steht im Titel vor dem ersten Doppelpunkt. */
export function icsTermine(ics: string): Termin[] {
  const out: Termin[] = []
  for (const block of ics.replace(/\r?\n[ \t]/g, '').split('BEGIN:VEVENT').slice(1)) {
    const f: Record<string, string> = {}
    for (const z of block.split(/\r?\n/)) {
      const m = z.match(/^([A-Z-]+)(?:;[^:]*)?:(.*)$/)
      if (m && !(m[1] in f)) f[m[1]] = m[2]
    }
    const b = icsZeit(f.DTSTART ?? '')
    if (!b) continue
    const e = icsZeit(f.DTEND ?? '')
    const roh = icsWert(f.SUMMARY ?? '')
    const k = roh.match(/^([^:]{2,40}):\s*(.+)$/)
    out.push({
      titel: (k ? k[2] : roh).trim() || 'Veranstaltung', kategorie: k ? k[1].trim() : '',
      beginn: b.d, ende: e?.d, ort: icsWert(f.LOCATION ?? '').replace(/,\s*$/, ''),
      frei: /Preis:\s*0\s*€/.test(icsWert(f.DESCRIPTION ?? '')),
      ganztag: b.ganztag || (b.d.getHours() === 0 && b.d.getMinutes() === 0),
    })
  }
  return out
}

// Ortsname → Punkt über public/daten/orte.json (OSM). Haltestellen, Parkplätze und Straßen nur als Notlösung.
type OrtTreffer = { lon: number; lat: number; name: string; rang: number }
let orte: { n: string; t: OrtTreffer }[] | null = null
let orteMap: Map<string, OrtTreffer> | null = null
const ortNorm = (s: string) => s.toLowerCase().replace(/ß/g, 'ss').replace(/[^a-zäöü0-9]+/g, ' ').trim()
const NACHRANG = new Set(['Haltestelle', 'Parkplatz', 'Straße', 'Geschäft', 'Apotheke', 'Imbiss'])

async function orteLaden() {
  if (!orte) {
    const d = await (await fetch('/daten/orte.json')).json()
    orte = []; orteMap = new Map()
    for (const [name, art, lon, lat] of d.orte as [string, number, number, number, number][]) {
      const t: OrtTreffer = { lon, lat, name, rang: NACHRANG.has(d.arten[art]) ? 1 : 0 }
      const n = ortNorm(name)
      const alt = orteMap.get(n)
      if (!alt || t.rang < alt.rang) orteMap.set(n, t)
      if (n.length >= 6) orte.push({ n, t })
    }
    orte.sort((a, b) => b.n.length - a.n.length || a.t.rang - b.t.rang)
  }
  return { orte: orte!, orteMap: orteMap! }
}

/** Ort eines Termins: exakter Name, dann der längste bekannte Ortsname im Text (auch mit Genitiv-s), dann Teil vor „ - “. */
export async function ortFinden(ort: string): Promise<OrtTreffer | undefined> {
  if (!ort) return undefined
  const { orte, orteMap } = await orteLaden()
  const n = ortNorm(ort)
  const exakt = orteMap.get(n)
  if (exakt && !exakt.rang) return exakt
  const wort = ` ${n} `
  const enthalten = orte.find((o) => !o.t.rang && (wort.includes(` ${o.n} `) || wort.includes(` ${o.n}s `) || wort.includes(` ${o.n}es `)))
  if (enthalten) return enthalten.t
  const teil = orteMap.get(ortNorm(ort.split(/ - | – |, |\(/)[0]))
  return teil ?? exakt ?? orte.find((o) => wort.includes(` ${o.n} `))?.t
}

function wann(t: Termin, jetzt: Date) {
  const heute = tagesbeginn(jetzt).getTime()
  const tag = tagesbeginn(t.beginn).getTime()
  const z = t.ganztag ? '' : ', ' + uhr(t.beginn)
  if (tag <= heute && t.beginn <= jetzt && t.ende && t.ende > jetzt) return t.ganztag ? 'heute' : `läuft bis ${uhr(t.ende)}`
  if (tag === heute) return 'heute' + z
  if (tag === heute + TAG) return 'morgen' + z
  return t.beginn.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '') + ' ' + datum(t.beginn) + z
}

export const veranstaltungen: Quelle = {
  id: 'veranstaltungen', name: 'Veranstaltungen (14 Tage)', takt: 3600,
  lizenz: 'Stadt Hamm, Veranstaltungskalender veranstaltungen.hamm.de (iCal, RCE Event), Orte © OpenStreetMap-Mitwirkende (ODbL), nur privat',
  async laden(): Promise<Ergebnis> {
    const ics: string = await hole(KALENDER, 3000, 'text')
    const jetzt = new Date(), grenze = tagesbeginn(jetzt).getTime() + 15 * TAG
    const termine = icsTermine(ics)
      .filter((t) => t.beginn.getTime() < grenze && (t.ende ?? t.beginn).getTime() >= jetzt.getTime() - (t.ende ? 0 : 3 * 3600000))
      .sort((a, b) => a.beginn.getTime() - b.beginn.getTime())
    // Serien (Ausstellung täglich, Wochenmarkt) zu einem Eintrag mit nächstem Termin zusammenfassen
    const gruppen = new Map<string, { t: Termin; n: number; letzter: Date }>()
    for (const t of termine) {
      const k = t.titel + '|' + t.ort
      const g = gruppen.get(k)
      if (g) { g.n++; g.letzter = t.beginn } else gruppen.set(k, { t, n: 1, letzter: t.beginn })
    }
    const feats: GeoJSON.Feature[] = []
    const zeilen: Zeile[] = []
    let ohneOrt = 0
    for (const { t, n, letzter } of gruppen.values()) {
      const o = await ortFinden(t.ort).catch(() => undefined)
      if (!o) ohneOrt++
      const w = wann(t, jetzt)
      const serie = n > 1 ? ` · ${n} Termine bis ${datum(letzter)}` : ''
      const extra = t.kategorie // „Preis: 0 €“ steht auch bei unbekanntem Eintritt, deshalb nicht angezeigt
      if (o) feats.push(pt(o.lon, o.lat, { icon: 'veranstaltung', titel: kuerzen(t.titel, 90), sub: `${w} · ${t.ort}${serie}${extra ? ' · ' + extra : ''}`, kategorie: t.kategorie, beginn: t.beginn.toISOString(), ort: t.ort, link: KALENDER_SEITE }))
      zeilen.push({
        text: kuerzen(t.titel, 70), klein: `${w}${t.ort ? ' · ' + t.ort : ''}${serie}${extra ? ' · ' + extra : ''}`,
        stufe: 'info', lon: o?.lon, lat: o?.lat, link: KALENDER_SEITE,
      })
    }
    if (!zeilen.length) zeilen.push({ text: 'Keine Veranstaltungen in den nächsten 14 Tagen gefunden', stufe: 'info' })
    else zeilen.push({ text: `${termine.length} Termine, ${gruppen.size} Veranstaltungen`, klein: `nächste 14 Tage${ohneOrt ? ` · ${ohneOrt} ohne Kartenpunkt` : ''}`, stufe: 'info' })
    return { zeilen, punkte: fc(feats), stand: new Date() }
  },
}

/** Alle Quellen dieses Moduls, zum Anhängen an QUELLEN aus live.ts. */
export const QUELLEN_STADT: Quelle[] = [baustellen, veranstaltungen]

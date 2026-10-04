/**
 * Abfuhrtermine der ASH Hamm (Abfallwirtschafts- und Stadtreinigungsbetrieb Hamm) je Adresse.
 * Quelle: Müllmax-Abfuhrkalender (Grafik-Partner GmbH), den hamm.de/ash/abfuhrkalender einbettet:
 * https://www.muellmax.de/abfallkalender/ash/res/AshStart.php – ohne Anmeldung, aber nur per Formular-POST
 * mit Sitzungsfeld `mm_ses` (Start → Straße suchen → [Straße wählen] → Hausnummer → iCal-Auswahl → iCal).
 * Läuft deshalb über /api/post (web/post-relay.ts), nicht über /api/proxy (nur GET).
 * Müllmax sperrt bei zu vielen Abfragen für 24 h, Daten ändern sich höchstens täglich → Zwischenspeicher im Speicher.
 * Keine offene Lizenz → nur privat.
 */

export type MuellArt = 'rest' | 'bio' | 'papier' | 'gelb' | 'sonstig'
export type MuellTermin = { datum: string; art: MuellArt; name: string }
export type MuellErgebnis = { termine: MuellTermin[]; quelle: string; lizenz: string; adresse?: string; stand?: string }
export type Post = (url: string, form: Record<string, string>) => Promise<string>

const URL_ASH = 'https://www.muellmax.de/abfallkalender/ash/res/AshStart.php'
const QUELLE = 'ASH Hamm, Abfuhrkalender (Müllmax, muellmax.de)'
const LIZENZ = 'keine offene Lizenz, nur privat'
const TAGE = 56

export const MUELL_FARBE: Record<MuellArt, string> = {
  rest: '#3a3a3a',
  bio: '#7a4a1e',
  papier: '#1e5aa8',
  gelb: '#f2c500',
  sonstig: '#4c8c3c',
}

/** Browser: Formular-POST über den Entwicklungsserver (kein CORS bei Müllmax). */
const postRelay: Post = async (url, form) => {
  const r = await fetch(`/api/post?u=${encodeURIComponent(url)}`, { method: 'POST', body: new URLSearchParams(form).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } })
  if (!r.ok) throw new Error(`muellmax.de: HTTP ${r.status}`)
  return r.text()
}

/** Vergleichsform für Straßennamen: klein, ß/ss, Umlaute, „Str.“ = „straße“, ohne Leer- und Bindestriche. */
export function strNorm(s: string): string {
  return s.toLowerCase().trim()
    .replace(/str\.?(?=\s|$|-)/g, 'strasse').replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/[^a-z0-9]/g, '')
}
const hnrNorm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
const ent = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()

const ses = (html: string) => /name="mm_ses"\s+value="([^"]*)"/.exec(html)?.[1] ?? ''
const hat = (html: string, name: string) => html.includes(`name="${name}"`)
function optionen(html: string, select: string): string[] {
  const m = new RegExp(`<select[^>]*name="${select}"[^>]*>([\\s\\S]*?)</select>`).exec(html)
  if (!m) return []
  return [...m[1].matchAll(/<option[^>]*value="([^"]*)"/g)].map((o) => ent(o[1])).filter(Boolean)
}
function pruefe(html: string): string {
  if (html.includes('Abfragelimit wurde überschritten')) throw new Error('Müllmax: Abfragelimit überschritten, Zugang 24 h gesperrt')
  return html
}

/** Hausnummer wählen: genau, sonst gleiche Zahl ohne Zusatz, sonst nächste Nummer gleicher Seite (gerade/ungerade). */
function waehleHnr(opts: string[], hnr: string): string | undefined {
  const nr = (o: string) => o.split(';')[2] ?? o
  const h = hnrNorm(hnr)
  const genau = opts.find((o) => hnrNorm(nr(o)) === h)
  if (genau) return genau
  const zahl = parseInt(h, 10)
  if (!Number.isFinite(zahl)) return undefined
  const gleich = opts.find((o) => parseInt(nr(o), 10) === zahl)
  if (gleich) return gleich
  let best: string | undefined, d = Infinity
  for (const o of opts) {
    const z = parseInt(nr(o), 10)
    if (!Number.isFinite(z) || z % 2 !== zahl % 2) continue
    if (Math.abs(z - zahl) < d) { d = Math.abs(z - zahl); best = o }
  }
  return d <= 20 ? best : undefined
}

/** Müllmax-Formularweg bis zur iCal-Datei. Gibt null zurück, wenn Straße oder Hausnummer unbekannt sind. */
export async function muellmaxIcs(strasse: string, hausnummer: string, post: Post = postRelay): Promise<string | null> {
  const p = async (form: Record<string, string>) => pruefe(await post(URL_ASH, form))
  let h = await p({})
  h = await p({ mm_ses: ses(h), 'mm_aus_ort.x': '0', 'mm_aus_ort.y': '0' })
  const suche = strasse.replace(/str\.?(?=\s|$|-)/gi, 'straße').trim()
  h = await p({ mm_ses: ses(h), xxx: '1', mm_frm_str_name: suche, mm_aus_str_txt_submit: 'suchen' })
  if (hat(h, 'mm_frm_str_sel')) {
    // Mehrdeutig oder Vorschläge: nur eine Straße mit gleichem Namen übernehmen
    const ziel = strNorm(strasse)
    const wahl = optionen(h, 'mm_frm_str_sel').find((o) => strNorm(o) === ziel)
    if (!wahl) return null
    h = await p({ mm_ses: ses(h), xxx: '1', mm_frm_str_sel: wahl, mm_aus_str_sel_submit: 'weiter' })
  }
  if (hat(h, 'mm_frm_hnr_sel')) {
    const wahl = waehleHnr(optionen(h, 'mm_frm_hnr_sel'), hausnummer)
    if (!wahl) return null
    h = await p({ mm_ses: ses(h), xxx: '1', mm_frm_hnr_sel: wahl, mm_aus_hnr_sel_submit: 'weiter' })
  }
  if (!hat(h, 'mm_ica_auswahl')) return null
  h = await p({ mm_ses: ses(h), xxx: '1', mm_ica_auswahl: 'iCalendar-Datei' })
  const form: Record<string, string> = { mm_ses: ses(h), xxx: '1', mm_frm_type: 'termine' }
  for (const m of h.matchAll(/name="(mm_frm_fra_[A-Z]+)"\s+value="([A-Z]+)"/g)) if (m[2] !== 'MOB') form[m[1]] = m[2] // ohne Umweltmobil-Tour
  if (Object.keys(form).length <= 3) return null
  form.mm_ica_gen = 'iCalendar-Datei laden'
  const ics = await p(form)
  return ics.includes('BEGIN:VCALENDAR') ? ics : null
}

const NAMEN: [RegExp, MuellArt, string][] = [
  [/Rest/i, 'rest', 'Restmüll'],
  [/Bio/i, 'bio', 'Biomüll'],
  [/Papier.*Container/i, 'papier', 'Altpapier (Container)'],
  [/Papier/i, 'papier', 'Altpapier'],
  [/(Wertstoff|Gelb).*Container/i, 'gelb', 'Wertstoffe (Container)'],
  [/Wertstoff|Gelb/i, 'gelb', 'Gelbe Tonne'],
]
function einordnen(summary: string): { art: MuellArt; name: string } {
  for (const [re, art, name] of NAMEN) if (re.test(summary)) return { art, name }
  return { art: 'sonstig', name: summary.replace(/^ASH\s+/, '').trim() }
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** iCal (VALUE=DATE) in Termine wandeln, nur heute bis heute + `tage`, sortiert, ohne Doppelungen. */
export function icsTermine(ics: string, heute = new Date(), tage = TAGE): { termine: MuellTermin[]; adresse?: string } {
  const zeilen = ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const von = iso(heute)
  const bis = iso(new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() + tage))
  const termine: MuellTermin[] = []
  const gesehen = new Set<string>()
  let datum = '', summary = '', adresse: string | undefined
  for (const z of zeilen) {
    if (z.startsWith('BEGIN:VEVENT')) { datum = ''; summary = '' }
    else if (z.startsWith('DTSTART')) { const m = /(\d{4})(\d{2})(\d{2})/.exec(z.split(':')[1] ?? ''); if (m) datum = `${m[1]}-${m[2]}-${m[3]}` }
    else if (z.startsWith('SUMMARY')) summary = z.slice(z.indexOf(':') + 1).replace(/\\,/g, ',').trim()
    else if (z.startsWith('LOCATION') && !adresse) adresse = z.slice(z.indexOf(':') + 1).replace(/\\,/g, ',').trim()
    else if (z.startsWith('END:VEVENT') && datum && summary && datum >= von && datum <= bis) {
      const t = { datum, ...einordnen(summary) }
      const k = t.datum + t.name
      if (!gesehen.has(k)) { gesehen.add(k); termine.push(t) }
    }
  }
  const rang: Record<MuellArt, number> = { rest: 0, bio: 1, papier: 2, gelb: 3, sonstig: 4 }
  termine.sort((a, b) => a.datum.localeCompare(b.datum) || rang[a.art] - rang[b.art] || a.name.localeCompare(b.name))
  return { termine, adresse }
}

const cache = new Map<string, { t: number; p: Promise<MuellErgebnis | null> }>()
const HALTEN = 6 * 3600 * 1000

/**
 * Abfuhrtermine der nächsten 8 Wochen für eine Hamm-Adresse. null: Straße/Hausnummer bei der ASH unbekannt.
 * Wirft bei Netzfehler oder Müllmax-Sperre. Zwischenspeicher im Speicher (6 h) je Straße und Hausnummer.
 */
export function muellTermine(strasse: string, hausnummer: string, post: Post = postRelay): Promise<MuellErgebnis | null> {
  const key = strNorm(strasse) + '|' + hnrNorm(hausnummer)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.t < HALTEN) return hit.p
  const p = (async () => {
    const ics = await muellmaxIcs(strasse, hausnummer, post)
    if (!ics) return null
    const { termine, adresse } = icsTermine(ics)
    const stand = /Stand_(\d{4})(\d{2})(\d{2})/.exec(ics)?.slice(1).reverse().join('.') ?? /CREATED:(\d{4})(\d{2})(\d{2})/.exec(ics)?.slice(1).reverse().join('.')
    return { termine, quelle: QUELLE, lizenz: LIZENZ, adresse, stand }
  })()
  cache.set(key, { t: Date.now(), p })
  p.catch(() => cache.delete(key))
  return p
}

const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

/** Kompakte Liste „Do 08.10. · Restmüll“, heute/morgen hervorgehoben. */
export function muellHtml(e: MuellErgebnis | null, heute = new Date()): string {
  const fuss = (t: string) => `<div style="font-size:11px;color:#666;margin-top:4px">${t}</div>`
  if (!e) return `<div style="font-size:13px">Keine Abfuhrtermine gefunden (Adresse bei der ASH unbekannt).</div>`
  if (!e.termine.length) return `<div style="font-size:13px">Keine Abfuhr in den nächsten 8 Wochen.</div>${fuss(e.quelle)}`
  const h0 = iso(heute)
  const h1 = iso(new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() + 1))
  const zeilen = e.termine.map((t) => {
    const [y, m, d] = t.datum.split('-').map(Number)
    const wt = WT[new Date(y, m - 1, d).getDay()]
    const marke = t.datum === h0 ? 'heute' : t.datum === h1 ? 'morgen' : ''
    const stil = marke ? 'font-weight:700;background:#f2c500;color:#000;' : ''
    return `<div style="display:flex;align-items:center;gap:8px;padding:2px 4px;font-size:13px;${stil}">`
      + `<span style="display:inline-block;width:12px;height:12px;flex:none;background:${MUELL_FARBE[t.art]};border:1px solid #000"></span>`
      + `<span style="font-variant-numeric:tabular-nums">${wt} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.</span>`
      + `<span>· ${t.name}${marke ? ` · ${marke}` : ''}</span></div>`
  }).join('')
  return `<div>${zeilen}${fuss(`${e.quelle}${e.stand ? ', Stand ' + e.stand : ''} · ${e.lizenz}`)}</div>`
}

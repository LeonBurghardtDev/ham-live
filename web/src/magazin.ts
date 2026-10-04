/**
 * Tab „Aktuell“ als Magazin: was in Hamm passiert (WA, Stadt Hamm, Polizei) und was heute und morgen kommt (Kalender der Stadt).
 * Gleiche Ereignisse aus mehreren Quellen werden eine Meldung. Der Aufmacher ist die Meldung mit den meisten Quellen,
 * bei Gleichstand die neueste Meldung der Stadt. Ressorts ohne Meldung fallen weg.
 * Alle Quellen nur Überschrift und Link (nur privat, siehe CLAUDE.md).
 */
import { hole } from './live'
import { icsTermine, type Termin } from './quellen-stadt'

export type Ressort = 'stadt' | 'blaulicht' | 'kultur'
/** klein: nur Vorschaubild (400 px), nicht für den großen Aufmacher */
export type Bild = { url: string; nachweis: string; klein?: boolean }
export type Meldung = { titel: string; zeit: Date; links: { quelle: string; url: string }[]; ressort: Ressort; bild?: Bild }
export type Magazin = { meldungen: Meldung[]; termine: Termin[]; stand: Date }

const RESSORT_NAME: Record<Ressort, string> = { stadt: 'Stadt', blaulicht: 'Blaulicht', kultur: 'Kultur und Sport' }
const BLAULICHT = /(unfall|polizei|feuerwehr|brand|verletzt|festnahme|festgenommen|einbruch|tötung|prozess|gericht|raub|diebstahl|messer|vermisst|kollidiert|fährt auf|unfallflucht|betrug|schlägerei|flücht|erfasst|zeugen|überfall|angriff|schwer verletzt|rettungs)/i
const KULTUR = /(theater|konzert|ausstellung|museum|kunst|kino|festival|musik|lesung|chor|kabarett|uraufführung|bühne|sport|fußball|handball|turnier|kunstrasen|verein|meisterschaft|lauf|sve |hsv |hammer spvg|tsc )/i
const STOPP = new Set(['hamm', 'hammer', 'nach', 'über', 'eine', 'einen', 'einer', 'dieser', 'diese', 'werden', 'wird', 'sind', 'mehr', 'auch', 'beim', 'heute', 'jetzt', 'gibt'])

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const woerter = (t: string) => new Set(t.toLowerCase().replace(/[^a-zäöüß0-9 ]+/g, ' ').split(' ').filter((w) => w.length >= 4 && !STOPP.has(w)))
const aehnlich = (a: Set<string>, b: Set<string>) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n / Math.max(1, Math.min(a.size, b.size)) }

/**
 * Bild einer Meldung: WA liefert media:content mit Bildnachweis (media:copyright); die Stadt (presse-service.de) hängt
 * Originalfotos als enclosure an (bis 15 MB). Dort statt „…P.jpg“ die Vorschau „…T.jpg“ (400 × 267 px, rund 100 KB).
 */
function bildAus(it: Element, quelle: string): Bild | undefined {
  const media = it.getElementsByTagName('media:content')[0]?.getAttribute('url')
  if (media) return { url: media, nachweis: (it.getElementsByTagName('media:copyright')[0]?.textContent ?? quelle).trim() }
  const enc = [...it.getElementsByTagName('enclosure')].find((e) => (e.getAttribute('type') ?? '').startsWith('image/'))?.getAttribute('url')
  if (enc && /presse-service\.de\/data\.aspx\/medien\/\d+P\.jpe?g$/i.test(enc)) return { url: enc.replace(/P\.(jpe?g)$/i, 'T.$1'), nachweis: quelle === 'Stadt' ? 'Stadt Hamm' : quelle, klein: true }
  return undefined
}

async function rss(url: string, quelle: string, ttl: number): Promise<{ titel: string; zeit: Date; url: string; quelle: string; bild?: Bild }[]> {
  const x = await hole(url, ttl, 'text').catch(() => '')
  if (!x) return []
  const doc = new DOMParser().parseFromString(x, 'text/xml')
  return [...doc.querySelectorAll('item')].map((it) => ({
    titel: (it.querySelector('title')?.textContent ?? '').replace(/^POL-[A-Z]+:\s*/, '').replace(/\s+/g, ' ').trim(),
    zeit: new Date(it.querySelector('pubDate')?.textContent ?? it.getElementsByTagName('dc:date')[0]?.textContent ?? ''),
    url: it.querySelector('link')?.textContent?.trim() ?? '',
    quelle,
    bild: bildAus(it, quelle),
  })).filter((m) => m.titel && !isNaN(m.zeit.getTime()))
}

export async function magazinLaden(): Promise<Magazin> {
  const [wa, polizei, stadt, ics] = await Promise.all([
    rss('https://www.wa.de/hamm/rssfeed.rdf', 'WA', 900),
    rss('https://www.presseportal.de/rss/polizei/r/Hamm.rss2', 'Polizei', 900),
    rss('https://www.presse-service.de/rss.aspx?p=1256', 'Stadt', 1800),
    hole('https://veranstaltungen.hamm.de/output.php?id=1282&mode=ics', 3000, 'text').catch(() => ''),
  ])
  const grenze = Date.now() - 4 * 86400000
  // Stadt: wöchentliche Blitzer-Liste und Presseeinladungen sind keine Nachricht
  const roh = [...wa, ...polizei, ...stadt.filter((m) => !/geschwindigkeitsüberwachung|presseeinladung/i.test(m.titel))]
    .filter((m) => m.zeit.getTime() > grenze).sort((a, b) => b.zeit.getTime() - a.zeit.getTime())
  const meldungen: (Meldung & { w: Set<string> })[] = []
  for (const r of roh) {
    const w = woerter(r.titel)
    const gleich = meldungen.find((m) => Math.abs(m.zeit.getTime() - r.zeit.getTime()) < 48 * 3600000 && aehnlich(m.w, w) >= 0.5 && !m.links.some((l) => l.quelle === r.quelle))
    if (gleich) { gleich.links.push({ quelle: r.quelle, url: r.url }); gleich.bild ??= r.bild; if (r.quelle === 'Polizei') gleich.ressort = 'blaulicht'; continue }
    const ressort: Ressort = r.quelle === 'Polizei' || BLAULICHT.test(r.titel) ? 'blaulicht' : KULTUR.test(r.titel + ' ') ? 'kultur' : 'stadt'
    meldungen.push({ titel: r.titel, zeit: r.zeit, links: [{ quelle: r.quelle, url: r.url }], ressort, w, bild: r.bild })
  }
  const jetzt = Date.now(), bisMorgen = new Date(); bisMorgen.setHours(24 + 24, 0, 0, 0)
  const termine = (ics ? icsTermine(ics) : [])
    .filter((t) => (t.ende ?? t.beginn).getTime() >= jetzt && t.beginn.getTime() < bisMorgen.getTime())
    .sort((a, b) => a.beginn.getTime() - b.beginn.getTime())
  return { meldungen, termine, stand: new Date() }
}

/**
 * Wichtigkeit für Hamm (höher = wichtiger). Bausteine:
 * - Aktualität: volle Punkte in den ersten 6 Stunden, danach fällt der Wert über zwei Tage ab
 * - Reichweite: mehrere Quellen berichten (+3 je weitere Quelle), Meldung der Stadt (+2)
 * - Betrifft viele: Themen wie Rat, Innenstadt, Sperrung, Schule, Kita, Bus und Bahn, Großbrand, Unwetter, Wahl (+4)
 * - Örtlich klein: Einzelunfälle, Diebstähle, Vereinsnachrichten, Gerichtsberichte (−3)
 * - Bild vorhanden (+1, nur für die Darstellung)
 */
const VIELE = /(rat\b|stadtrat|ratssitzung|oberbürgermeister|innenstadt|sperrung|gesperrt|vollsperrung|umleitung|baustelle|schule|kita|bus|bahn|zug|hauptbahnhof|großbrand|evakuier|unwetter|sturm|hochwasser|wahl|haushalt|steuer|gebühr|klinik|krankenhaus|stadtwerke|müll|abfall|stadtjubiläum|800 jahre|neubau|eröffn|schließ|insolven|arbeitspl)/i
const KLEIN = /(seniorin|senior|pedelec|radfahrer|fußgänger|leicht verletzt|diebstahl|einbruch|stehlen|gestohlen|zeugen gesucht|polizei sucht|auseinandersetzung|prozess|verfahren|gericht|verein|jubilar|kleingarten|geburtstag)/i
export function wichtigkeit(m: Meldung, jetzt = Date.now()): number {
  const std = (jetzt - m.zeit.getTime()) / 3600000
  const aktuell = std <= 6 ? 10 : Math.max(0, 10 - ((std - 6) / 42) * 10)
  const quellenPunkte = (m.links.length - 1) * 3 + (m.links.some((l) => l.quelle === 'Stadt') ? 2 : 0)
  // „örtlich klein“ schlägt „betrifft viele“ (z. B. Einbruch in eine Kita)
  const klein = KLEIN.test(m.titel)
  return aktuell + quellenPunkte + (!klein && VIELE.test(m.titel) ? 4 : 0) - (klein ? 3 : 0) + (m.bild ? 1 : 0)
}
/** Meldungen nach Wichtigkeit, bei Gleichstand die neuere zuerst */
export const nachWichtigkeit = (ms: Meldung[]) => [...ms].sort((a, b) => wichtigkeit(b) - wichtigkeit(a) || b.zeit.getTime() - a.zeit.getTime())

/** Aufmacher: die wichtigste Meldung mit Bild (ohne Blaulicht), sonst die wichtigste überhaupt */
function aufmacher(ms: Meldung[]): Meldung | undefined {
  const sortiert = nachWichtigkeit(ms)
  // großes Bild bevorzugt, Vorschaubilder wirken im Aufmacher unscharf
  return sortiert.find((m) => m.bild && !m.bild.klein && m.ressort !== 'blaulicht') ?? sortiert.find((m) => m.bild && m.ressort !== 'blaulicht') ?? sortiert[0]
}

const wann = (d: Date) => {
  const heute = new Date(); heute.setHours(0, 0, 0, 0)
  const tag = Math.round((new Date(d).setHours(0, 0, 0, 0) - heute.getTime()) / 86400000)
  const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return tag === 0 ? uhr : tag === -1 ? `gestern ${uhr}` : d.toLocaleDateString('de-DE', { weekday: 'short' }) + ' ' + uhr
}
const quellen = (m: Meldung) => m.links.map((l) => l.quelle).join(', ')

/** Stichwort mit Einordnung, z. B. „Verkehrsfluss – flüssig“; ampel färbt die Marke */
export type Kennzahl = { name: string; wert: string; klein?: string; ampel: 'gut' | 'mittel' | 'schlecht' | 'neutral'; tab?: string }

/** Lagezeile: auf allen Lese-Seiten gleich (Aktuell, Energie) */
export function lageHtml(zahlen: Kennzahl[]): string {
  return zahlen.length ? `<div class="mz-lage">${zahlen.map((z) => `<button class="lz lz-${z.ampel}"${z.tab ? ` data-tab="${z.tab}"` : ''}><span class="lz-name">${esc(z.name)}</span><b>${esc(z.wert)}</b>${z.klein ? `<small>${esc(z.klein)}</small>` : ''}</button>`).join('')}</div>` : ''
}

export function magazinHtml(d: Magazin, zahlen: Kennzahl[], mehrOffen: boolean, live = ''): string {
  const auf = aufmacher(d.meldungen)
  const rest = nachWichtigkeit(d.meldungen.filter((m) => m !== auf))
  // vier Kacheln: die wichtigsten, Blaulicht höchstens eine
  const kacheln: Meldung[] = []
  for (const m of rest) {
    if (kacheln.length >= 4) break
    if (m.ressort === 'blaulicht' && kacheln.some((k) => k.ressort === 'blaulicht')) continue
    kacheln.push(m)
  }
  const weitere = rest.filter((m) => !kacheln.includes(m))
  const heuteEnde = new Date(); heuteEnde.setHours(24, 0, 0, 0)
  const heute = d.termine.filter((t) => t.beginn < heuteEnde)
  const morgen = d.termine.filter((t) => t.beginn >= heuteEnde)
  // lädt ein Bild nicht, steht dort die farbige Fläche wie bei Meldungen ohne Bild
  const bild = (b: Bild, klasse: string, ersatz = '') => `<img class="${klasse}" src="${esc(b.url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" title="Foto: ${esc(b.nachweis)}" onerror="this.outerHTML='<span class=&quot;${klasse} leer${ersatz ? ' ' + ersatz : ''}&quot;></span>'">`
  const kopf = (m: Meldung) => `${RESSORT_NAME[m.ressort]} · ${esc(quellen(m))} · ${wann(m.zeit)}`
  const termin = (t: Termin) => {
    const laeuft = t.beginn.getTime() <= Date.now()
    return `<li><time class="${laeuft ? 'jetzt' : ''}">${laeuft ? 'läuft' : t.ganztag ? 'ganztags' : t.beginn.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</time><span>${esc(t.titel)}<small>${esc(t.ort || t.kategorie)}</small></span></li>`
  }
  const jetzt = new Date()
  return `<div class="seite magazin mz2">
    <div class="mz2-kopf">
      <div class="mz2-datum"><b>${jetzt.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</b><span>Hamm · Stand ${jetzt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr</span></div>
      <div class="mz2-lage">${zahlen.map((z) => `<button class="mz2-pill lz-${z.ampel}"${z.tab ? ` data-tab="${z.tab}"` : ''} title="${esc(z.klein ?? '')}"><span>${esc(z.name)}</span><b>${esc(z.wert)}</b></button>`).join('')}</div>
    </div>
    <div class="mz2-raster">
      ${auf ? `<a class="mz2-auf" href="${esc(auf.links[0].url)}" target="_blank" rel="noopener">${auf.bild ? bild(auf.bild, 'mz2-auf-bild') : '<span class="mz2-auf-bild leer"></span>'}
        <div class="mz2-auf-text"><p class="lbl">${kopf(auf)}</p><h2>${esc(auf.titel)}</h2>${auf.bild ? `<small>Foto: ${esc(auf.bild.nachweis)}</small>` : ''}</div></a>` : '<div class="box">Gerade keine Meldungen.</div>'}
      <div class="mz2-kacheln">${kacheln.map((m) => `<a class="mz2-k" href="${esc(m.links[0].url)}" target="_blank" rel="noopener">${m.bild ? bild(m.bild, 'mz2-k-bild', 'r-' + m.ressort) : `<span class="mz2-k-bild leer r-${m.ressort}">${RESSORT_NAME[m.ressort]}</span>`}<div><p class="lbl">${kopf(m)}</p><b>${esc(m.titel)}</b></div></a>`).join('')}</div>
      <div class="mz2-rechts">
        <button class="box mz2-live" data-tab="verkehr"><span class="lbl"><i class="puls"></i>Live in Hamm</span><span class="mz2-live-text">${esc(live)}</span><span id="mz-kartenplatz"></span></button>
        <section class="box mz2-heute"><p class="lbl">Heute</p><ul>${heute.slice(0, 5).map(termin).join('') || '<li><span>Keine Termine mehr</span></li>'}</ul>
          ${morgen.length ? `<p class="lbl" style="margin-top:10px">Morgen</p><ul>${morgen.slice(0, 2).map(termin).join('')}</ul>` : ''}
          <button class="mz-alle" data-tab="termine">Alle Termine ›</button></section>
      </div>
    </div>
    <div class="mz2-fuss"><span class="lbl">Weitere Meldungen</span>${weitere.slice(0, 3).map((m) => `<a href="${esc(m.links[0].url)}" target="_blank" rel="noopener">${esc(m.titel)}</a>`).join('')}<button class="mz-mehr">Alle ${rest.length + 1} ›</button></div>
    ${mehrOffen ? `<div class="mz2-alle"><div class="mz2-alle-kopf"><b>Alle Meldungen</b><button class="mz-mehr">Schließen</button></div><ul>${d.meldungen.map((m) => `<li><a href="${esc(m.links[0].url)}" target="_blank" rel="noopener">${esc(m.titel)}</a><small>${kopf(m)}</small></li>`).join('')}</ul></div>` : ''}
    <p class="mz-quelle">Überschriften, Bilder und Links: Westfälischer Anzeiger, Stadt Hamm, Polizei (Presseportal), nur privat · Termine: Veranstaltungskalender der Stadt Hamm · <a class="mz-rechtlich" href="#quellen">Quellen, Lizenzen und rechtliche Hinweise</a></p>
  </div>`
}

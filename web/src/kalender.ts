/**
 * Tab „Termine“ als Kalender: Monatsansicht mit Terminen je Tag, rechts der gewählte Tag als Liste, oben Filter nach Art.
 * Quelle: Veranstaltungskalender der Stadt Hamm (iCal, rund drei Wochen voraus, nur privat).
 * Mehrtägige Termine (Ausstellungen) stehen als eigene Zeile „läuft“ und nicht in jedem Tagesfeld.
 */
import { hole } from './live'
import { icsTermine, type Termin } from './quellen-stadt'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const tagKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const uhr = (d: Date) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

let termine: Termin[] = []
let geladen: Promise<void> | null = null
export const kalender = { monat: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })(), tag: new Date(new Date().setHours(0, 0, 0, 0)), art: '' }

export function kalenderLaden(): Promise<void> {
  geladen ??= hole('https://veranstaltungen.hamm.de/output.php?id=1282&mode=ics', 3000, 'text')
    .then((ics: string) => { termine = icsTermine(ics).sort((a, b) => a.beginn.getTime() - b.beginn.getTime()) })
    .catch(() => { geladen = null })
  return geladen ?? Promise.resolve()
}
export const kalenderBereit = () => termine.length > 0

/** Serie: derselbe Titel an mehreren Tagen (Ausstellung, Kurs) */
function serien() {
  const n = new Map<string, number>()
  for (const t of termine) n.set(t.titel, (n.get(t.titel) ?? 0) + 1)
  return n
}
const amTag = (t: Termin, tag: Date) => {
  const a = new Date(tag), e = new Date(tag); e.setHours(24, 0, 0, 0)
  return t.beginn < e && (t.ende ?? t.beginn) >= a
}

export function kalenderHtml(): string {
  if (!termine.length) return '<p class="lade" style="padding:24px">Lädt …</p>'
  const arten = [...new Set(termine.map((t) => t.kategorie).filter(Boolean))].sort((a, b) => termine.filter((t) => t.kategorie === b).length - termine.filter((t) => t.kategorie === a).length).slice(0, 7)
  const liste = kalender.art ? termine.filter((t) => t.kategorie === kalender.art) : termine
  const serie = serien()
  const einzel = (t: Termin) => !t.ganztag && (serie.get(t.titel) ?? 1) <= 2
  const m = kalender.monat
  const erster = new Date(m.getFullYear(), m.getMonth(), 1)
  const start = new Date(erster); start.setDate(1 - ((erster.getDay() + 6) % 7))
  const wochen = Math.ceil((((erster.getDay() + 6) % 7) + new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()) / 7)
  const heute = tagKey(new Date())
  const zellen: string[] = []
  for (let i = 0; i < wochen * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i)
    const n = liste.filter((t) => einzel(t) && amTag(t, d)).length
    zellen.push(`<button class="mk${d.getMonth() !== m.getMonth() ? ' fremd' : ''}${tagKey(d) === heute ? ' heute' : ''}${tagKey(d) === tagKey(kalender.tag) ? ' gewaehlt' : ''}" data-tag="${d.getTime()}"><span>${d.getDate()}</span><i class="dichte d${Math.min(3, Math.ceil(n / 3))}"></i></button>`)
  }
  const tag = kalender.tag
  const ts = liste.filter((t) => amTag(t, tag))
  const zeitlich = ts.filter(einzel)
  const laufend = ts.filter((t) => !einzel(t))
  const teile: [string, Termin[]][] = [
    ['Vormittag', zeitlich.filter((t) => t.beginn.getHours() < 12)],
    ['Nachmittag', zeitlich.filter((t) => t.beginn.getHours() >= 12 && t.beginn.getHours() < 18)],
    ['Abend', zeitlich.filter((t) => t.beginn.getHours() >= 18)],
  ]
  const karte = (t: Termin) => `<article class="tk"><time>${uhr(t.beginn)}</time><div><h4>${esc(t.titel)}</h4><p>${esc(t.ort)}</p>
    <div class="tk-tags">${t.kategorie ? `<span>${esc(t.kategorie)}</span>` : ''}${t.frei ? '<span class="frei">Eintritt frei</span>' : ''}</div></div></article>`
  const tageswahl = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d })
  return `<div class="termine">
    <aside class="te-links">
      <div class="mk-kopf"><button data-monat="-1" aria-label="Voriger Monat">‹</button><b>${m.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</b><button data-monat="1" aria-label="Nächster Monat">›</button></div>
      <div class="mk-raster">${['M', 'D', 'M', 'D', 'F', 'S', 'S'].map((w) => `<span>${w}</span>`).join('')}${zellen.join('')}</div>
      <button class="te-heute" data-heute>Heute</button>
      <h5>Art</h5>
      <div class="te-arten"><button class="${kalender.art ? '' : 'an'}" data-art="">Alle</button>${arten.map((a) => `<button class="${kalender.art === a ? 'an' : ''}" data-art="${esc(a)}">${esc(a)}</button>`).join('')}</div>
    </aside>
    <main class="te-tag">
      <div class="te-leiste">${tageswahl.map((d) => `<button class="${tagKey(d) === tagKey(tag) ? 'an' : ''}" data-tag="${d.getTime()}"><small>${d.toLocaleDateString('de-DE', { weekday: 'short' })}</small><b>${d.getDate()}</b></button>`).join('')}</div>
      <h2>${tag.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}<span>${zeitlich.length} Termine</span></h2>
      ${zeitlich.length ? teile.filter(([, xs]) => xs.length).map(([name, xs]) => `<h3>${name}</h3><div class="tk-raster">${xs.map(karte).join('')}</div>`).join('') : '<p class="meta">Keine Einzeltermine an diesem Tag.</p>'}
      ${laufend.length ? `<h3>Läuft an diesem Tag</h3><div class="tk-laufend">${laufend.map((t) => `<span><b>${esc(t.titel)}</b>${esc(t.ort)}</span>`).join('')}</div>` : ''}
      <p class="mz-quelle">Veranstaltungskalender der Stadt Hamm · rund drei Wochen im Voraus · nur privat</p>
    </main>
  </div>`
}

/** Bedienung verdrahten; `neu` zeichnet den Kalender neu */
export function kalenderVerdrahten(el: HTMLElement, neu: () => void) {
  el.querySelectorAll<HTMLButtonElement>('[data-monat]').forEach((b) => b.addEventListener('click', () => { const m = kalender.monat; kalender.monat = new Date(m.getFullYear(), m.getMonth() + Number(b.dataset.monat), 1); neu() }))
  el.querySelector('[data-heute]')?.addEventListener('click', () => { const d = new Date(); kalender.monat = new Date(d.getFullYear(), d.getMonth(), 1); kalender.tag = new Date(d.setHours(0, 0, 0, 0)); neu() })
  el.querySelectorAll<HTMLButtonElement>('[data-tag]').forEach((b) => b.addEventListener('click', () => { kalender.tag = new Date(Number(b.dataset.tag)); neu() }))
  el.querySelectorAll<HTMLButtonElement>('[data-art]').forEach((b) => b.addEventListener('click', () => { kalender.art = b.dataset.art ?? ''; neu() }))
}

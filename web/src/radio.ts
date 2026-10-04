/**
 * Livestream Radio Lippe Welle Hamm oben rechts (nur privat).
 * Startet pausiert; der Stream wird erst beim ersten Klick geladen und nie gespeichert.
 * Aktueller Titel aus der Playlist der Senderseite (über /api/proxy), alle 30 s.
 */
import { hole } from './live'

const STREAM = 'https://stream.lokalradio.nrw/4454253'
const TITEL = 'https://www.lippewelle.de/playlist/current?station=17'
const SENDER = 'Radio Lippe Welle'

type Aktuell = { artist?: string; title?: string; timeend_iso?: string }

/** Großschreibung der Playlist („SOPHIE AND THE GIANTS, PURPLE “) in normale Schreibung */
const schreibung = (s: string) => s.trim().replace(/,\s*$/, '').toLowerCase().replace(/(^|[\s(\-/&.,])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())

export function radioStarten(el: HTMLElement) {
  el.innerHTML = `<button class="radio-knopf" aria-label="${SENDER} abspielen" title="${SENDER} live"><i></i></button>
    <span class="radio-text"><b>${SENDER}</b><small>live</small></span>`
  const knopf = el.querySelector<HTMLButtonElement>('.radio-knopf')!
  const zeile = el.querySelector<HTMLElement>('small')!
  let audio: HTMLAudioElement | undefined

  const zustand = (laeuft: boolean, laedt = false) => {
    el.classList.toggle('laeuft', laeuft)
    el.classList.toggle('laedt', laedt)
    knopf.setAttribute('aria-label', `${SENDER} ${laeuft ? 'anhalten' : 'abspielen'}`)
  }
  knopf.addEventListener('click', () => {
    if (audio && !audio.paused) {
      // anhalten und Verbindung trennen, damit kein Stream im Hintergrund weiterläuft
      audio.pause(); audio.removeAttribute('src'); audio.load(); zustand(false); return
    }
    audio ??= new Audio()
    audio.src = STREAM
    zustand(false, true)
    audio.play().then(() => zustand(true)).catch(() => { zustand(false); zeile.textContent = 'Stream nicht erreichbar' })
  })

  const titel = async () => {
    try {
      // die Senderseite liegt hinter einem CDN-Cache: Zeitstempel erzwingt den aktuellen Stand
      const d = (await hole(`${TITEL}&t=${Math.floor(Date.now() / 30000)}`, 25)) as Aktuell
      // länger als 4 Minuten nach Ende des gemeldeten Titels (Nachrichten, Werbung) nur „live“
      const gueltig = d.title && (!d.timeend_iso || new Date(d.timeend_iso).getTime() > Date.now() - 4 * 60000)
      const text = gueltig ? `${schreibung(d.artist ?? '')} – ${schreibung(d.title!)}` : 'live'
      zeile.textContent = text
      el.title = gueltig ? `Jetzt auf ${SENDER}: ${text}` : `${SENDER} live`
    } catch { zeile.textContent = 'live' }
  }
  void titel()
  setInterval(() => void titel(), 30000)
}

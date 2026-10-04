/**
 * Live-Bilder: öffentlich abrufbare Webcams in Hamm und direkt angrenzend (Tab „Live-Bilder“, CSS `webcams.css`, Präfix `.wc-`).
 * Bilder laufen über den Bild-Proxy `/api/bild` (web/bild-proxy.ts): ein Abruf je Intervall für alle offenen Seiten,
 * Zeitstempel der Quelle (Last-Modified) kommt als Kopfzeile `x-stand` mit.
 * Geprüft am 02.10.2026; Verkehr.NRW (WFS `infrastructure_webcams_feature`) und Autobahn GmbH (`/services/webcam`)
 * liefern derzeit keine Kameras, siehe CLAUDE.md, Abschnitt „Live-Bilder“.
 */
import type maplibregl from 'maplibre-gl'
import './webcams.css'

export type WebcamGruppe = 'Flugplätze' | 'Natur'

export interface Webcam {
  id: string
  name: string
  ort: string
  gruppe: WebcamGruppe
  lat: number
  lon: number
  /** Betreiber bzw. Herausgeber */
  quelle: string
  /** Seite der Quelle (Einbettung, Livestream) */
  quelleUrl: string
  lizenz: string
  /** Standbild für die Kachel */
  bild: string
  /** größeres Bild für die Großansicht, sonst `bild` */
  gross?: string
  /** Aktualisierung der Quelle in Sekunden (zugleich Neuladetakt) */
  intervall: number
  /** Quelle erlaubt CORS (Access-Control-Allow-Origin: *): Abruf direkt im Browser statt über /api/bild */
  direkt?: boolean
  blick?: string
  /** kurzer Hinweis zur Nutzung oder Lage */
  hinweis?: string
}

const yt = (id: string, stufe: string) => `https://i.ytimg.com/vi/${id}/${stufe}_live.jpg`

export const WEBCAMS: Webcam[] = [
  {
    id: 'flugplatz-hamm',
    name: 'Flugplatz Hamm-Lippewiesen, Vorfeld',
    ort: 'Hamm-Uentrop, Lippewiesen',
    gruppe: 'Flugplätze',
    lat: 51.68995, lon: 7.8143,
    quelle: 'Luftsportclub Hamm e. V.',
    quelleUrl: 'https://www.flugplatz-hamm.de/lsc20/flugplatz/webcam',
    lizenz: 'CC BY 4.0',
    bild: 'https://webcam.flugplatz-hamm.de/memfs/0a1965c5-a876-43ee-92f8-e6d1f113619a.jpg',
    intervall: 60,
    // direkt: der Server liefert keine Zwischenzertifikate, Node lehnt ab („unable to verify the first certificate“), Browser nicht
    direkt: true,
    blick: 'nach Südosten über Vorfeld und Start- und Landebahn',
  },
  {
    id: 'flugplatz-kamen',
    name: 'Segelfluggelände Kamen-Heeren',
    ort: 'Kamen-Heeren, südwestlich von Hamm',
    gruppe: 'Flugplätze',
    lat: 51.5909, lon: 7.707,
    quelle: 'LSF 2000 Kamen/Dortmund e. V.',
    quelleUrl: 'https://lsf-kamen.de/webcam/',
    lizenz: 'keine Angabe, nur privat',
    bild: 'http://lsf-kamera.heridns.de/webcam.jpeg',
    intervall: 60,
    blick: 'über Vorfeld und Flugfeld',
    hinweis: 'Uhrzeit im Bild geht eine Stunde nach, der Stand unten ist der Zeitstempel der Datei.',
  },
  {
    id: 'storchennest',
    name: 'Storchennest Hamm',
    ort: 'Hamm-Mark',
    gruppe: 'Natur',
    lat: 51.68, lon: 7.85,
    quelle: 'Storchennest Hamm, unterstützt vom NABU Hamm',
    quelleUrl: 'https://www.youtube.com/watch?v=NdPcieBZVMg',
    lizenz: 'Vorschaubild des YouTube-Livestreams, nur privat',
    bild: yt('NdPcieBZVMg', 'sddefault'),
    gross: yt('NdPcieBZVMg', 'maxresdefault'),
    intervall: 300,
    blick: 'auf das Nest in 9 m Höhe',
    hinweis: 'Lage auf der Karte nur ungefähr (Privatgrundstück). Störche sind von etwa März bis August im Nest.',
  },
  {
    id: 'waldkauz-aussen',
    name: 'Waldkauz-Kasten, außen',
    ort: 'Hamm-Mark',
    gruppe: 'Natur',
    lat: 51.68, lon: 7.85,
    quelle: 'Storchennest Hamm, unterstützt vom NABU Hamm',
    quelleUrl: 'https://www.youtube.com/watch?v=JwZFLC7qOqw',
    lizenz: 'Vorschaubild des YouTube-Livestreams, nur privat',
    bild: yt('JwZFLC7qOqw', 'sddefault'),
    gross: yt('JwZFLC7qOqw', 'maxresdefault'),
    intervall: 300,
    blick: 'auf den Nistkasten im Baum',
    hinweis: 'Lage auf der Karte nur ungefähr (Privatgrundstück).',
  },
  {
    id: 'waldkauz-innen',
    name: 'Waldkauz-Kasten, innen',
    ort: 'Hamm-Mark',
    gruppe: 'Natur',
    lat: 51.68, lon: 7.85,
    quelle: 'Storchennest Hamm, unterstützt vom NABU Hamm',
    quelleUrl: 'https://www.youtube.com/watch?v=yyNXF-me_Sk',
    lizenz: 'Vorschaubild des YouTube-Livestreams, nur privat',
    bild: yt('yyNXF-me_Sk', 'sddefault'),
    gross: yt('yyNXF-me_Sk', 'maxresdefault'),
    intervall: 300,
    blick: 'in den Nistkasten',
    hinweis: 'Lage auf der Karte nur ungefähr (Privatgrundstück).',
  },
]

const GRUPPEN: WebcamGruppe[] = ['Flugplätze', 'Natur']

/** Liste ist statisch (keine offene Webcam-Schnittstelle für Hamm); als Promise für eine spätere dynamische Quelle. */
export function webcamsLaden(): Promise<Webcam[]> {
  return Promise.resolve(WEBCAMS)
}

/**
 * Bild-URL: direkt bei der Quelle (`direkt`) oder über den Bild-Proxy, der das Bild `intervall` Sekunden hält.
 * `t` (Takt-Nummer) umgeht den Browser-Zwischenspeicher.
 */
export function webcamBildUrl(c: Webcam, gross = false, t = Date.now()): string {
  const u = gross ? (c.gross ?? c.bild) : c.bild
  const takt = Math.floor(t / (c.intervall * 1000))
  if (c.direkt) return `${u}${u.includes('?') ? '&' : '?'}t=${takt}`
  return `/api/bild?ttl=${c.intervall}&u=${encodeURIComponent(u)}&t=${takt}`
}

const esc = (s: string) => s.replace(/[&<>"]/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[z] as string)

function intervallText(s: number) {
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`
}

const TAGE = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.']
function standText(d: Date, quelleZeit: boolean) {
  const jetzt = new Date()
  const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'
  const heute = d.toDateString() === jetzt.toDateString()
  const tag = heute ? '' : `${TAGE[d.getDay()]}, ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}., `
  return (quelleZeit ? 'Stand ' : 'abgerufen ') + tag + uhr
}

function kachelHtml(c: Webcam): string {
  return `<article class="box wc-kachel" data-wc="${c.id}">
    <button type="button" class="wc-bildknopf" data-wc-auf="${c.id}" aria-label="${esc(c.name)} groß anzeigen">
      <span class="wc-rahmen"><img class="wc-bild" alt="${esc(c.name)}" decoding="async"><span class="wc-fehlt">Bild gerade nicht verfügbar</span></span>
    </button>
    <div class="wc-text">
      <h3 class="wc-name">${esc(c.name)}</h3>
      <p class="wc-ort">${esc(c.ort)}</p>
      <p class="wc-stand" data-wc-stand>lädt …</p>
      <p class="wc-quelle">${esc(c.quelle)} · ${esc(c.lizenz)} · alle ${intervallText(c.intervall)}</p>
    </div>
  </article>`
}

/** Leseseite: Kacheln je Gruppe, Großansicht über `webcamsVerdrahten`. */
export function webcamsSeiteHtml(cams: Webcam[] = WEBCAMS): string {
  const gruppen = GRUPPEN.map((g) => ({ g, liste: cams.filter((c) => c.gruppe === g) })).filter((x) => x.liste.length)
  return `<div class="seite wc-seite">
    <div class="wc-haupt">
      <div class="wc-kopf">
        <p class="lbl">Live-Bilder</p>
        <h2 class="wc-titel">Webcams in Hamm und direkt angrenzend</h2>
        <p class="wc-einl">${cams.length} öffentlich abrufbare Kameras. Die Bilder werden im Takt der Quelle neu geladen; ein Klick zeigt das Bild groß.</p>
      </div>
      ${gruppen.map(({ g, liste }) => `<section class="wc-gruppe">
        <h4 class="wc-gruppe-titel">${esc(g)} <span>${liste.length}</span></h4>
        <div class="wc-raster">${liste.map(kachelHtml).join('')}</div>
      </section>`).join('')}
      <p class="wc-hinweis">Verkehrskameras: Verkehr.NRW und die Autobahn GmbH veröffentlichen derzeit keine Kamerabilder für Hamm (geprüft 02.10.2026).</p>
    </div>
    <p class="mz-quelle">Luftsportclub Hamm e. V. (CC BY 4.0) · LSF 2000 Kamen/Dortmund e. V. · Storchennest Hamm über YouTube · Bilder nur zur privaten Ansicht</p>
  </div>`
}

interface Zustand { url: string; stand: Date | null; quelleZeit: boolean; ok: boolean }

/**
 * Lädt alle Bilder und hält sie aktuell, solange `el` im DOM hängt; Klick öffnet die Großansicht
 * (Pfeiltasten und Knöpfe blättern, Esc schließt). Gibt eine Funktion zum Beenden zurück.
 */
export function webcamsVerdrahten(el: HTMLElement, cams: Webcam[] = WEBCAMS): () => void {
  const zustand = new Map<string, Zustand>()
  const timer: number[] = []
  let offen = -1
  let beendet = false
  let ov: HTMLElement | null = null

  async function holen(c: Webcam, gross: boolean): Promise<Zustand> {
    const r = await fetch(webcamBildUrl(c, gross))
    const typ = r.headers.get('content-type') ?? ''
    if (!r.ok || !typ.startsWith('image/')) throw new Error(String(r.status))
    const blob = await r.blob()
    // Last-Modified ist ein CORS-freigegebener Kopf und bei direktem Abruf lesbar
    const stand = (c.direkt ? r.headers.get('last-modified') : r.headers.get('x-stand')) || ''
    const abruf = r.headers.get('x-abruf') || ''
    const d = stand ? new Date(stand) : abruf ? new Date(abruf) : new Date()
    return { url: URL.createObjectURL(blob), stand: isNaN(d.getTime()) ? null : d, quelleZeit: !!stand, ok: true }
  }

  function zeigen(c: Webcam, z: Zustand) {
    const k = el.querySelector<HTMLElement>(`.wc-kachel[data-wc="${c.id}"]`)
    if (!k) return
    const img = k.querySelector<HTMLImageElement>('img.wc-bild')!
    const st = k.querySelector<HTMLElement>('[data-wc-stand]')!
    k.classList.toggle('wc-aus', !z.ok)
    if (z.ok) img.src = z.url
    // älter als drei Takte plus 10 min: Quelle steht vermutlich
    const alt = z.stand && Date.now() - z.stand.getTime() > (c.intervall * 3 + 600) * 1000
    st.textContent = !z.ok ? 'keine Antwort der Quelle' : z.stand ? standText(z.stand, z.quelleZeit) + (alt ? ' · nicht aktuell' : '') : ''
    st.classList.toggle('wc-alt', !!alt || !z.ok)
  }

  async function laden(c: Webcam) {
    if (beendet) return
    if (!el.isConnected) { beenden(); return }
    if (document.hidden && zustand.has(c.id)) return
    const alt = zustand.get(c.id)
    try {
      const z = await holen(c, false)
      if (beendet) { URL.revokeObjectURL(z.url); return }
      zustand.set(c.id, z)
      zeigen(c, z)
      if (alt?.ok) setTimeout(() => URL.revokeObjectURL(alt.url), 1000)
    } catch {
      const z: Zustand = alt ? { ...alt, ok: false } : { url: '', stand: null, quelleZeit: false, ok: false }
      if (!alt) zustand.set(c.id, z)
      zeigen(c, z)
    }
    if (offen >= 0 && cams[offen] === c) grossLaden()
  }

  function beenden() {
    if (beendet) return
    beendet = true
    timer.forEach((t) => clearInterval(t))
    document.removeEventListener('keydown', taste)
    ov?.remove()
    for (const z of zustand.values()) if (z.url) URL.revokeObjectURL(z.url)
    if (grossUrl) URL.revokeObjectURL(grossUrl)
  }

  // ------------------------------------------------------------ Großansicht
  let grossUrl = ''
  async function grossLaden() {
    if (offen < 0 || !ov) return
    const c = cams[offen]
    const img = ov.querySelector<HTMLImageElement>('img.wc-gross-bild')!
    const st = ov.querySelector<HTMLElement>('[data-wc-gross-stand]')!
    try {
      const z = await holen(c, true)
      if (beendet || cams[offen] !== c) { URL.revokeObjectURL(z.url); return }
      const vorher = grossUrl
      grossUrl = z.url
      img.src = z.url
      ov.classList.remove('wc-aus')
      st.textContent = z.stand ? standText(z.stand, z.quelleZeit) : ''
      if (vorher) setTimeout(() => URL.revokeObjectURL(vorher), 1000)
    } catch {
      if (cams[offen] !== c) return
      ov.classList.add('wc-aus')
      st.textContent = 'keine Antwort der Quelle'
    }
  }

  function oeffnen(i: number) {
    offen = (i + cams.length) % cams.length
    const c = cams[offen]
    if (!ov) {
      ov = document.createElement('div')
      ov.className = 'wc-overlay'
      ov.setAttribute('role', 'dialog')
      ov.setAttribute('aria-modal', 'true')
      ov.innerHTML = `<div class="wc-gross">
        <div class="wc-gross-kopf">
          <div><h3 class="wc-gross-name"></h3><p class="wc-gross-ort"></p></div>
          <button type="button" class="zu wc-zu" aria-label="Schließen" title="Schließen (Esc)">×</button>
        </div>
        <div class="wc-gross-rahmen"><img class="wc-gross-bild" alt=""><span class="wc-fehlt">Bild gerade nicht verfügbar</span></div>
        <div class="wc-gross-fuss">
          <button type="button" class="wc-blaettern" data-wc-schritt="-1">Zurück</button>
          <div class="wc-gross-info"><p data-wc-gross-stand></p><p class="wc-gross-quelle"></p></div>
          <button type="button" class="wc-blaettern" data-wc-schritt="1">Weiter</button>
        </div>
      </div>`
      ov.addEventListener('click', (e) => {
        const t = e.target as HTMLElement
        if (t === ov || t.closest('button.wc-zu')) { schliessen(); return }
        const s = t.closest<HTMLElement>('[data-wc-schritt]')
        if (s) oeffnen(offen + Number(s.dataset.wcSchritt))
      })
      el.appendChild(ov)
    }
    ov.querySelector('.wc-gross-name')!.textContent = c.name
    ov.querySelector('.wc-gross-ort')!.textContent = c.ort + (c.blick ? `, Blick ${c.blick}` : '')
    ov.querySelector('.wc-gross-quelle')!.innerHTML = `${esc(c.quelle)} · ${esc(c.lizenz)} · <a href="${esc(c.quelleUrl)}" target="_blank" rel="noopener noreferrer">Seite der Quelle</a>${c.hinweis ? `<br>${esc(c.hinweis)}` : ''}`
    const img = ov.querySelector<HTMLImageElement>('img.wc-gross-bild')!
    img.alt = c.name
    // sofort das vorhandene Kachelbild zeigen, dann das große nachladen
    const z = zustand.get(c.id)
    if (z?.ok) img.src = z.url; else img.removeAttribute('src')
    ov.classList.toggle('wc-aus', !z?.ok)
    ov.querySelector<HTMLElement>('[data-wc-gross-stand]')!.textContent = z?.stand ? standText(z.stand, z.quelleZeit) : ''
    ov.hidden = false
    ov.querySelector<HTMLButtonElement>('button.wc-zu')!.focus({ preventScroll: true })
    grossLaden()
  }

  function schliessen() {
    if (!ov) return
    const c = cams[offen]
    ov.hidden = true
    offen = -1
    if (c) el.querySelector<HTMLElement>(`[data-wc-auf="${c.id}"]`)?.focus({ preventScroll: true })
  }

  function taste(e: KeyboardEvent) {
    if (!el.isConnected) { beenden(); return }
    if (offen < 0) return
    if (e.key === 'Escape') { e.preventDefault(); schliessen() }
    else if (e.key === 'ArrowRight') { e.preventDefault(); oeffnen(offen + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); oeffnen(offen - 1) }
  }

  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-wc-auf]')
    if (!b) return
    const i = cams.findIndex((c) => c.id === b.dataset.wcAuf)
    if (i >= 0) oeffnen(i)
  })
  document.addEventListener('keydown', taste)

  for (const c of cams) {
    laden(c)
    timer.push(window.setInterval(() => laden(c), c.intervall * 1000))
  }
  return beenden
}

// ------------------------------------------------------------ Kartenebene

/** Kamerastandorte als GeoJSON (Kameras am selben Ort werden zusammengefasst). */
export function webcamsGeojson(cams: Webcam[] = WEBCAMS): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const orte = new Map<string, Webcam[]>()
  for (const c of cams) {
    const k = `${c.lat},${c.lon}`
    orte.set(k, [...(orte.get(k) ?? []), c])
  }
  return {
    type: 'FeatureCollection',
    features: [...orte.values()].map((l) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [l[0].lon, l[0].lat] },
      properties: { ids: l.map((c) => c.id).join(','), name: l.length > 1 ? `${l[0].ort}: ${l.length} Kameras` : l[0].name, anzahl: l.length },
    })),
  }
}

function kameraSymbol(): ImageData {
  const pr = 2, s = 28 * pr
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const g = cv.getContext('2d')!
  const petrol = getComputedStyle(document.documentElement).getPropertyValue('--petrol').trim() || '#005468'
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, s, s)
  g.fillStyle = petrol
  g.fillRect(pr, pr, s - 2 * pr, s - 2 * pr)
  g.fillStyle = '#ffffff'
  // Gehäuse und Objektiv
  g.fillRect(6 * pr, 9 * pr, 12 * pr, 10 * pr)
  g.beginPath()
  g.moveTo(18 * pr, 12 * pr); g.lineTo(23 * pr, 9 * pr); g.lineTo(23 * pr, 19 * pr); g.lineTo(18 * pr, 16 * pr)
  g.closePath()
  g.fill()
  return g.getImageData(0, 0, s, s)
}

/** Kartenebene `wc-kameras` mit Kamerasymbol. Klick auf ein Symbol ruft `beiKlick(ids)` auf. */
export function webcamsSymbole(map: maplibregl.Map, beiKlick?: (ids: string[]) => void, cams: Webcam[] = WEBCAMS) {
  if (!map.isStyleLoaded()) { map.once('styledata', () => webcamsSymbole(map, beiKlick, cams)); return }
  if (!map.hasImage('wc-kamera')) map.addImage('wc-kamera', kameraSymbol(), { pixelRatio: 2 })
  const daten = webcamsGeojson(cams)
  const q = map.getSource('wc-kameras') as maplibregl.GeoJSONSource | undefined
  if (q) { q.setData(daten); return }
  map.addSource('wc-kameras', { type: 'geojson', data: daten })
  map.addLayer({
    id: 'wc-kameras',
    type: 'symbol',
    source: 'wc-kameras',
    // nur Symbol: der Kartenstil hat keine Glyphen; Name steht in `properties.name` für Tooltip/Blatt
    layout: { 'icon-image': 'wc-kamera', 'icon-allow-overlap': true },
  })
  if (beiKlick) {
    map.on('click', 'wc-kameras', (e) => {
      const f = e.features?.[0]
      if (f) beiKlick(String(f.properties?.ids ?? '').split(',').filter(Boolean))
    })
    map.on('mouseenter', 'wc-kameras', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'wc-kameras', () => { map.getCanvas().style.cursor = '' })
  }
}

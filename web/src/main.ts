import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@fontsource/fira-sans/400.css'
import '@fontsource/fira-sans/500.css'
import '@fontsource/fira-sans/600.css'
import '@fontsource/fira-sans/700.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import './style.css'
import './wetter.css'
import { privat, privatLaden, erlaubt } from './privat'
import type * as GeoJSON from 'geojson'
import { EBENEN, GRUPPEN, LUFTBILD_JAHRE, kachelUrl, type Ebene } from './ebenen'
import { TABS, GRUNDKARTEN, VORLAGEN, NAV_GRUPPEN, TAB_INFO, type Tab, type Zeitleiste } from './tabs'
import { QUELLEN, HAMM, hole, type Ergebnis, type Quelle, type Zeile, pegelName } from './live'
import { schatten, sonnenstand } from './sonne'
import { abfahrten, bussePositionen, fahrplanLaden, fahrt, fahrtLinie, halteGeojson, verspaetungen } from './busse'
import { busEchtzeitLaden, busEchtzeitStand } from './busse-echtzeit'
import { symboleRegistrieren } from './symbole'
import { ZUG_EBENEN, zuegeStarten, zugZeigen } from './zuege'
import { luft, luftSymbole } from './quellen-luft'
import { heuteZeilen, vorhersage } from './heute'
import { HW_EBENE, HW_OHNE, HW_STUFEN, SIM_LIZENZ, SIM_MODI, SR_EBENE, SR_STUFEN, lippe, type HwStufe, type SimModus, type SrStufe } from './simulation'
import { KATEGORIEN, einrichtungenLaden, einrichtungenSymbole, notaufnahmen, notdienst } from './einrichtungen'
import { ENERGIE_QUELLEN, energieDaten, energieHamm, energieSymbole } from './energie'
import { energieSeiteHtml } from './energie-seite'
import { achsenLaden, achsenBerechnen, hammKm, achseLinien, verkehrUeberblickHtml, verkehrTagHtml } from './verkehr-seite'
import { BV_EBENEN, BV_STANDARD, bevoelkerungKarte, bevoelkerungLaden, bevoelkerungPanelHtml, bevoelkerungPanelVerdrahten, bevoelkerungSichtbar, bevoelkerungZelleHtml } from './bevoelkerung'
import { radioStarten } from './radio'
import { WEBCAMS, webcamsSeiteHtml, webcamsVerdrahten } from './webcams'
import { quellenSeiteHtml, type Datenstand } from './quellen-seite'
import { buspuenktlichkeit, spritVerlaufHtml, statistikLaden } from './statistik'
import { stadtwetter, stadtwetterSymbole, wetterbericht, wetterberichtHtml } from './wetter-seite'
import { kalenderHtml, kalenderLaden, kalenderVerdrahten } from './kalender'
import { magazinHtml, magazinLaden, type Kennzahl, type Magazin } from './magazin'
import { HIGHLIGHT_EBENEN, stadtbildStarten, stadtbildSichtbar } from './stadtbild'
import { muellHtml, muellTermine } from './muell'
import { SORTEN, tankErgebnis, tankSymbole, tankWahl, tankWahlSetzen, tankstellen, type Sorte } from './tanken'
import { POLITIK_LIZENZ, bezirkHtml, wahlFarbausdruck, wahlLegende, wahlenGeladen, wahlenLaden, wahl, type Farbmodus } from './politik'

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const uhrzeit = (d: Date) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
const merke = (k: string, v: unknown) => { try { localStorage.setItem('ham-lage.' + k, JSON.stringify(v)) } catch { /* privat */ } }
const lies = <T>(k: string, d: T): T => { try { const v = localStorage.getItem('ham-lage.' + k); return v ? JSON.parse(v) : d } catch { return d } }

await privatLaden()

const map = new maplibregl.Map({
  container: 'karte',
  style: { version: 8, sources: {}, layers: [{ id: 'hintergrund', type: 'background', paint: { 'background-color': '#eceae4' } }] },
  center: [HAMM.lon, HAMM.lat],
  zoom: 14,
  maxZoom: 20,
  attributionControl: false,
})
map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '<a href="#quellen">Quellen und Lizenzen</a>' }), 'bottom-right')
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')

// ================================================================ Ladebildschirm

const startSchritte = new Set<string>()
function geladen(schritt: string) {
  startSchritte.add(schritt)
  document.querySelector(`#start-schritte [data-s="${schritt}"]`)?.classList.add('fertig')
  if (['karte', 'fahrplan', 'live'].every((s) => startSchritte.has(s))) startWeg()
}
function startWeg() { const el = document.getElementById('start'); if (el && !el.classList.contains('weg')) { el.classList.add('weg'); setTimeout(() => el.remove(), 500) } }
setTimeout(startWeg, 8000) // spätestens nach 8 s die Karte zeigen, auch wenn eine Quelle hängt

// ================================================================ Rasterebenen

const an = new Set<string>()
const deckkraft = new Map<string, number>()

// Regenradar als ein Bild für den Raum Hamm statt vieler Kacheln: ein Abruf je Zeitschritt, im Browser zwischengespeichert,
// dadurch flüssige Animation. Ausschnitt rund 140 × 110 km um Hamm.
const RADAR_BOX = { w: 6.85, s: 51.2, e: 8.85, n: 52.15 }
const merc = (lon: number, lat: number) => [(lon * 20037508.34) / 180, (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * 20037508.34) / Math.PI]
function radarUrl(zeit?: Date) {
  const [x0, y0] = merc(RADAR_BOX.w, RADAR_BOX.s), [x1, y1] = merc(RADAR_BOX.e, RADAR_BOX.n)
  const t = zeit ? `&TIME=${zeit.toISOString().replace(/\.\d{3}Z$/, '.000Z')}` : `&_t=${Math.floor(Date.now() / 300000)}`
  return `https://maps.dwd.de/geoserver/dwd/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=dwd:Niederschlagsradar&STYLES=&CRS=EPSG:3857&BBOX=${x0},${y0},${x1},${y1}&WIDTH=1200&HEIGHT=${Math.round((1200 * (y1 - y0)) / (x1 - x0))}&FORMAT=image/png&TRANSPARENT=true${t}`
}
/** Radarbilder werden über den Proxy geholt und als Blob im Speicher gehalten: Wechseln dauert dann nur Millisekunden,
 *  und kein laufender Abruf wird beim Abspielen abgebrochen. Vergangene Zeitpunkte bleiben einen Tag im Proxy-Speicher. */
const radarVorrat = new Map<string, Promise<string>>()
const radarFertig = new Set<string>()
const RADAR_ECKEN: [[number, number], [number, number], [number, number], [number, number]] = [[RADAR_BOX.w, RADAR_BOX.n], [RADAR_BOX.e, RADAR_BOX.n], [RADAR_BOX.e, RADAR_BOX.s], [RADAR_BOX.w, RADAR_BOX.s]]
function radarBlob(zeit?: Date) {
  const u = `/api/proxy?ttl=${zeit ? 86400 : 240}&u=${encodeURIComponent(radarUrl(zeit))}`
  let b = radarVorrat.get(u)
  if (!b) { b = fetch(u).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob() }).then((x) => { radarFertig.add(u); return URL.createObjectURL(x) }); b.catch(() => radarVorrat.delete(u)); radarVorrat.set(u, b) }
  return b
}
const radarBereit = (zeit?: Date) => radarFertig.has(`/api/proxy?ttl=${zeit ? 86400 : 240}&u=${encodeURIComponent(radarUrl(zeit))}`)
function radarVorladen(zeiten: Date[]) { for (const z of zeiten) void radarBlob(z).catch(() => {}) }
let radarZiel = 0
function radarZeigen(zeit?: Date) {
  const nr = ++radarZiel
  void radarBlob(zeit).then((url) => {
    if (nr !== radarZiel) return
    ;(map.getSource('radar') as maplibregl.ImageSource | undefined)?.updateImage({ url, coordinates: RADAR_ECKEN })
  }).catch(() => {})
}

function ebeneHinzufuegen(e: Ebene) {
  deckkraft.set(e.id, e.deckkraft ?? 1)
  if (e.id === 'radar') {
    map.addSource('radar', { type: 'image', url: radarUrl(), coordinates: [[RADAR_BOX.w, RADAR_BOX.n], [RADAR_BOX.e, RADAR_BOX.n], [RADAR_BOX.e, RADAR_BOX.s], [RADAR_BOX.w, RADAR_BOX.s]] })
    map.addLayer({ id: 'radar', type: 'raster', source: 'radar', layout: { visibility: 'none' }, paint: { 'raster-opacity': e.deckkraft ?? 0.7, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } }, 'anker-raster')
    return
  }
  map.addSource(e.id, { type: 'raster', tiles: [kachelUrl(e)], tileSize: e.fest ? 512 : 256, attribution: e.lizenz })
  map.addLayer({ id: e.id, type: 'raster', source: e.id, layout: { visibility: 'none' }, paint: { 'raster-opacity': e.deckkraft ?? 1, 'raster-fade-duration': 200 } }, 'anker-raster')
}
function zeige(id: string, sichtbar: boolean, opac?: number) {
  if (!map.getLayer(id)) return
  if (sichtbar) an.add(id); else an.delete(id)
  map.setLayoutProperty(id, 'visibility', sichtbar ? 'visible' : 'none')
  map.setPaintProperty(id, 'raster-opacity', opac ?? deckkraft.get(id) ?? 1)
}
function auffrischen(e: Ebene, extra = '') {
  if (e.id === 'radar') { const m = /TIME=([^&]+)/.exec(extra); radarZeigen(m ? new Date(decodeURIComponent(m[1])) : undefined); return }
  ;(map.getSource(e.id) as maplibregl.RasterTileSource | undefined)?.setTiles([kachelUrl(e, extra || `&_t=${Date.now()}`)])
}

// ================================================================ Live-Ebenen: je Quelle Punkte (Symbole) und Linien (Verkehrslage, Strecken)

const LINIENFARBE: maplibregl.ExpressionSpecification = ['match', ['get', 'lage'], 'frei', '#2e9e44', 'dicht', '#f0a800', 'zaeh', '#e06c00', 'stau', '#c4271b', 'blitzer', '#7a1fa2', 'baustelle', '#b35a00', 'umleitung', '#005ca9', '#8a8c92']
const LIVE_EBENEN: Record<string, string[]> = { busse: ['bus-keil', 'bus-plakette', 'halte'], zuege: ZUG_EBENEN }
let liveAn = new Set<string>()

function liveQuelleAnlegen(id: string, opts: Record<string, unknown> = {}) {
  if (map.getSource(`live-${id}`)) return
  map.addSource(`live-${id}`, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: `live-${id}-linie`, type: 'line', source: `live-${id}`, filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' }, paint: { 'line-color': LINIENFARBE, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['match', ['get', 'lage'], ['frei', 'veraltet'], 1, 3], 16, ['match', ['get', 'lage'], ['frei', 'veraltet'], 4, 8]], 'line-opacity': ['match', ['get', 'lage'], 'frei', 0.6, 'veraltet', 0.35, 0.85] } }, 'anker-live')
  map.addLayer({
    id: `live-${id}`, type: 'symbol', source: `live-${id}`, filter: ['==', ['geometry-type'], 'Point'],
    layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 15, 1], visibility: 'none', ...opts } as any,
  })
  LIVE_EBENEN[id] = [`live-${id}-linie`, `live-${id}`]
}
function liveSichtbar(ids: string[]) {
  liveAn = new Set(ids)
  // auf der Lagekarte (Tafel) nur Störungen, keine frei fließenden Straßen
  if (map.getLayer('live-verkehrslage-linie')) map.setFilter('live-verkehrslage-linie', tab?.tafel ? ['all', ['==', ['geometry-type'], 'LineString'], ['!=', ['get', 'lage'], 'frei']] : ['==', ['geometry-type'], 'LineString'])
  for (const [k, layers] of Object.entries(LIVE_EBENEN)) for (const l of layers) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', liveAn.has(k) ? 'visible' : 'none')
}

// ================================================================ Kartenart (unten links)

/** Vorschaubild: eine Kachel um den Marktplatz (Zoom 14) */
function vorschau(id: string) {
  const e = EBENEN.find((x) => x.id === id)
  if (!e) return ''
  const z = 14, n = 2 ** z, lat = (HAMM.lat * Math.PI) / 180
  const x = Math.floor(((HAMM.lon + 180) / 360) * n), y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n)
  const g = 40075016.686 / n, x0 = x * g - 20037508.343, y1 = 20037508.343 - y * g
  return kachelUrl(e).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)).replace('{bbox-epsg-3857}', `${x0},${y1 - g},${x0 + g},${y1}`)
}
let kartenartOffen = false
function kartenartZeichnen() {
  let el = document.getElementById('kartenart')
  if (!el) { el = document.createElement('div'); el.id = 'kartenart'; document.getElementById('karte')!.append(el) }
  el.hidden = tab.id === 'historisch'
  const aktiv = tab.id === 'eigene' ? (KARTENARTEN.find((k) => k.grund === eigeneGrund)?.id ?? 'karte') : kartenart
  const grundVon = (k: (typeof KARTENARTEN)[number]) => k.grund ?? (tab.id === 'eigene' ? 'basemap' : tab.grund)
  const jetzt = KARTENARTEN.find((k) => k.id === aktiv)!
  el.innerHTML = `<button class="ka-knopf" aria-label="Kartenart wechseln"><img alt="" src="${esc(vorschau(grundVon(jetzt === KARTENARTEN[2] ? KARTENARTEN[0] : KARTENARTEN[2])))}"><span>${jetzt.id === 'satellit' ? 'Karte' : 'Satellit'}</span></button>
    <button class="ka-mehr" aria-expanded="${kartenartOffen}">Ebenen</button>
    ${kartenartOffen ? `<div class="ka-auswahl">${KARTENARTEN.map((k) => `<button data-ka="${k.id}" class="${k.id === aktiv ? 'an' : ''}"><img alt="" src="${esc(vorschau(grundVon(k)))}"><span>${k.name}</span></button>`).join('')}
      <label class="ka-verkehr"><input type="checkbox" ${verkehrAn ? 'checked' : ''}><span>Verkehr</span></label></div>` : ''}`
  const setzen = (id: string) => {
    if (tab.id === 'eigene') { eigeneGrund = KARTENARTEN.find((k) => k.id === id)!.grund ?? 'basemap'; merke('grund', eigeneGrund) }
    else { kartenart = id; merke('kartenart', kartenart) }
    ebenenAnwenden(); if (tab.id === 'eigene') panelZeichnen()
  }
  // Hauptknopf wechselt schnell zwischen Karte und Satellit, „Ebenen“ öffnet die Auswahl
  el.querySelector('.ka-knopf')!.addEventListener('click', () => setzen(aktiv === 'satellit' ? 'karte' : 'satellit'))
  el.querySelector('.ka-mehr')!.addEventListener('click', () => { kartenartOffen = !kartenartOffen; kartenartZeichnen() })
  el.querySelectorAll<HTMLButtonElement>('[data-ka]').forEach((b) => b.addEventListener('click', () => setzen(b.dataset.ka!)))
  el.querySelector<HTMLInputElement>('.ka-verkehr input')?.addEventListener('change', (ev) => { verkehrAn = (ev.target as HTMLInputElement).checked; merke('verkehrAn', verkehrAn); ebenenAnwenden() })
}

// ================================================================ Tabs

/** Ganzes Stadtgebiet einpassen, Panel links und Blatt rechts freihalten */
const STADTGEBIET: [[number, number], [number, number]] = [[7.68, 51.585], [8.03, 51.765]]
function stadtgebiet(duration = 0) {
  // schmale Fenster: Panel liegt über der Karte, dann ohne Rand einpassen
  const links = tab.tafel || tab.magazin || map.getContainer().clientWidth < 900 ? 16 : 392
  // Handy: oben Suche und Ebenenleiste, unten das Blatt freihalten
  const handy = innerWidth <= 760
  const unten = handy ? Math.round(innerHeight * (document.body.classList.contains('mit-zeitleiste') ? 0.3 : 0.44)) + 12 : 24
  map.fitBounds(STADTGEBIET, { padding: { top: handy ? 120 : 24, bottom: unten, left: handy ? 8 : links, right: handy ? 8 : 24 }, pitch: 0, duration })
}

let tab: Tab = TABS[0]
let bvMerkmal = lies('bv', BV_STANDARD)
const chipAn = new Map<string, boolean>(lies<[string, boolean][]>('chips', []))
let histModus: 'zeitreise' | 'rueckblick' = 'zeitreise'
let eigeneGrund = lies('grund', 'basemap')
const eigeneEbenen = new Set<string>(lies<string[]>('eigene', []))
let d3An = false
/** Kartenart unten links wie bei Google Maps: Karte (Standard des Tabs), Grau, Satellit, Gelände; dazu Verkehr */
const KARTENARTEN: { id: string; name: string; grund: string | null }[] = [
  { id: 'karte', name: 'Karte', grund: null }, { id: 'grau', name: 'Grau', grund: 'basemap_grau' },
  { id: 'satellit', name: 'Satellit', grund: 'dop' }, { id: 'gelaende', name: 'Gelände', grund: 'topplus' },
]
let kartenart = lies('kartenart', 'karte')
let verkehrAn = lies('verkehrAn', false)
const sim = lies<{ modus: SimModus; hw: HwStufe; sr: SrStufe; ohne: boolean }>('sim', { modus: 'hochwasser', hw: 'mw', sr: 'agw', ohne: false })

const chipKey = (c: { id: string }) => `${tab.id}.${c.id}`
const chipIst = (c: { id: string; an: boolean }) => chipAn.get(chipKey(c)) ?? c.an

function zeitleisteFuer(): Zeitleiste {
  if (tab.id === 'historisch') return histModus
  if (tab.id === 'eigene' && d3An) return 'sonne'
  if (tab.id === 'simulation' && sim.modus === 'sonne') return 'sonne'
  return tab.zeitleiste
}

function tabSetzen(t: Tab, kamera = true) {
  tab = t
  merke('tab', t.id)
  blattZu()
  navZeichnen()
  ebenenAnwenden()
  zeitleisteZeigen(zeitleisteFuer())
  // erst das Panel (ändert ggf. die Kartenbreite), dann die Kamera
  panelZeichnen()
  if (kamera && t.kamera?.ganz) stadtgebiet(700)
  else if (kamera && t.kamera) map.easeTo({ zoom: t.kamera.zoom ?? map.getZoom(), pitch: t.kamera.pitch ?? 0, ...(t.kamera.mitte ? { center: t.kamera.mitte } : {}), duration: 700 })
  else if (kamera && !d3An) map.easeTo({ pitch: 0, duration: 500 })
}

/** Sichtbarkeit aller Ebenen aus Tab, Chips und eigener Auswahl ableiten. */
function ebenenAnwenden() {
  for (const e of EBENEN) zeige(e.id, false)
  const live = new Set<string>()
  if (tab.id === 'eigene') {
    zeige(eigeneGrund, true)
    for (const id of eigeneEbenen) zeige(id, true)
    if (eigeneEbenen.has('bergbau')) live.add('bergbau')
  } else if (tab.id === 'simulation') {
    zeige(tab.grund, true)
    if (sim.modus === 'hochwasser') { zeige(HW_EBENE[sim.hw], true); if (sim.ohne) zeige(HW_OHNE[sim.hw], true) }
    if (sim.modus === 'starkregen') zeige(SR_EBENE[sim.sr], true)
    live.add('lippe')
  } else if (tab.id === 'historisch') {
    zeige('dop', true)
  } else {
    zeige(KARTENARTEN.find((k) => k.id === kartenart)?.grund ?? tab.grund, true)
    for (const id of tab.ebenen) zeige(id, true)
    for (const c of tab.chips) if (chipIst(c)) { c.ebenen?.forEach((id) => zeige(id, true)); c.live?.forEach((id) => live.add(id)) }
    tab.live?.forEach((id) => live.add(id))
  }
  if (verkehrAn && tab.id !== 'historisch') live.add('verkehrslage')
  kartenartZeichnen()
  liveSichtbar([...live])
  stadtbildSichtbar(map, tab.id !== 'historisch')
  // Bevölkerung: Zensus-Raster nur auf der eigenen Seite
  if (tab.id === 'bevoelkerung') void bevoelkerungLaden().then(() => { if (tab.id === 'bevoelkerung') { bevoelkerungKarte(map, bvMerkmal); bevoelkerungSichtbar(map, true); panelZeichnen() } })
  else bevoelkerungSichtbar(map, false)
  // Temperaturschilder tragen den Bezirksnamen selbst
  if (live.has('stadtwetter') && map.getLayer('sb-bezirksnamen')) map.setLayoutProperty('sb-bezirksnamen', 'visibility', 'none')
  politikAnwenden()
  d3((tab.id === 'eigene' && d3An) || (tab.id === 'simulation' && sim.modus === 'sonne'))
}

// ---------------------------------------------------------------- Panel links: Inhalt des Tabs

const TITEL: Record<string, string> = {
  warnungen: 'Warnungen', lippewelle: 'Staus und Meldungen', verkehrslage: 'Verkehrslage', staumeldungen: 'Staumeldungen', baustellen_nrw: 'Baustellen und Sperrungen', abfahrten: 'Abfahrten Hamm Hbf',
  busse: 'Busse', buspuenktlichkeit: 'Pünktlichkeit Bus', zuege: 'Züge', autobahn: 'A1 und A2', blaulicht: 'Polizei Hamm', pegel: 'Pegel Datteln-Hamm-Kanal',
  flug: 'Flugzeuge über Hamm', wetter: 'Wetter jetzt', blitzer_woche: 'Blitzer diese Woche', oepnv_stoerungen: 'Störungen Bus',
  ladesaeulen_live: 'Ladesäulen jetzt', nachrichten: 'Nachrichten Hamm', tankstellen: 'Günstigste Tankstellen', luft: 'Luft', parken: 'Parken', lippe: 'Lippe-Pegel', notdienst: 'Notdienst-Apotheken heute', notaufnahmen: 'Notaufnahmen', baustellen: 'Baustellen der Stadt', veranstaltungen: 'Veranstaltungen',
}
/** Tafel: Kachel führt in diesen Tab */
const ZIEL_TAB: Record<string, string> = { lippewelle: 'verkehr', verkehrslage: 'verkehr', staumeldungen: 'verkehr', baustellen_nrw: 'verkehr', abfahrten: 'verkehr', oepnv_stoerungen: 'verkehr', baustellen: 'verkehr', blitzer_woche: 'verkehr', luft: 'wetter', pegel: 'simulation', warnungen: 'wetter' }
const MAX: Record<string, number> = { abfahrten: 6, busse: 2, wetter: 4, tankstellen: 11 }
const cache = new Map<string, { zeilen: Zeile[]; zaehler: string; lizenz: string; abruf?: Date; alt?: boolean }>()
const offen = new Set<string>(lies<string[]>('offen', []))

function panelZeichnen() {
  const tafel = !!tab.tafel
  $('#panel').hidden = tafel
  $('#tafel').hidden = !tafel
  const ohneKarte = !!(tab.magazin || tab.kalender || tab.energie || tab.webcams || tab.quellen)
  if (document.body.classList.contains('magazin-modus') !== ohneKarte) { document.body.classList.toggle('magazin-modus', ohneKarte); map.resize() }
  if (document.body.classList.contains('tafel-modus') !== tafel) {
    document.body.classList.toggle('tafel-modus', tafel)
    map.resize()
    // Lagekarte zeigt immer ganz Hamm
    if (tafel) map.fitBounds([[7.68, 51.585], [8.03, 51.765]], { padding: 16, duration: 0 })
  }
  document.body.classList.toggle('tab-wetter', tab.id === 'wetter')
  document.body.classList.toggle('tab-verkehr', tab.id === 'verkehr')
  const el = $(tafel ? '#tafel' : '#panel')
  if (tafel) $('#panel').innerHTML = ''; else $('#tafel').innerHTML = ''
  const leiste = $('#ebenenleiste')
  leiste.hidden = tafel || !tab.chips.length
  leiste.innerHTML = tab.chips.map((c) => `<button class="chip-schalter${chipIst(c) ? ' an' : ''}" data-id="${c.id}">${c.name}</button>`).join('')
  const chips = ''
  let inhalt = ''
  if (tab.id === 'historisch') {
    inhalt = `${tab.einleitung ? `<p class="einleitung">${tab.einleitung}</p>` : ''}
      <div class="segment"><button data-m="zeitreise" class="${histModus === 'zeitreise' ? 'an' : ''}">Karten und Luftbilder</button><button data-m="rueckblick" class="${histModus === 'rueckblick' ? 'an' : ''}">Rückblick Live-Daten</button></div>`
  } else if (tab.id === 'eigene') {
    inhalt = `${tab.einleitung ? `<p class="einleitung">${tab.einleitung}</p>` : ''}
      <h4>Grundkarte</h4><div class="segment umbruch">${GRUNDKARTEN.map((g) => `<button data-grund="${g.id}" class="${eigeneGrund === g.id ? 'an' : ''}">${g.name}</button>`).join('')}</div>
      <h4>Vorlagen</h4><div class="vorlagen">${VORLAGEN.map((v) => `<button data-vorlage="${v.id}">${v.name}</button>`).join('')}</div>
      <label class="schalter gross"><input type="checkbox" id="d3" ${d3An ? 'checked' : ''}><span>Gebäude in 3D mit Schatten</span></label>
      <h4>Ebenen</h4><input id="ebenen-suche" type="search" placeholder="Ebene suchen, z. B. Lärm, Bodenrichtwert">
      <div id="ebenen-liste"></div>`
  } else if (tab.id === 'tanken') {
    inhalt = `<h4>Kraftstoff</h4><div class="segment">${SORTEN.map((x) => `<button data-sorte="${x.id}" class="${tankWahl.sorte === x.id ? 'an' : ''}">${x.name}</button>`).join('')}</div><div id="sprit-verlauf">${spritVerlaufHtml(tankWahl.sorte)}</div>`
  } else if (tab.id === 'wetter') {
    inhalt = `<div id="wb">${wetterberichtHtml()}</div>`
  } else if (tab.id === 'verkehr') {
    inhalt = '<div id="vu"></div>'
  } else if (tab.id === 'bevoelkerung') {
    inhalt = bevoelkerungPanelHtml(bvMerkmal)
  } else if (tab.id === 'politik') {
    inhalt = politikPanel()
  } else if (tab.id === 'simulation') {
    const stufen = sim.modus === 'hochwasser' ? HW_STUFEN : sim.modus === 'starkregen' ? SR_STUFEN : []
    const aktiv = sim.modus === 'hochwasser' ? sim.hw : sim.sr
    const st = stufen.find((x) => x.id === aktiv)
    inhalt = `${tab.einleitung ? `<p class="einleitung">${tab.einleitung}</p>` : ''}
      <div class="segment">${SIM_MODI.map((m) => `<button data-sim="${m.id}" class="${sim.modus === m.id ? 'an' : ''}">${m.name}</button>`).join('')}</div>
      ${stufen.length ? `<h4>Szenario</h4><div class="segment">${stufen.map((x) => `<button data-stufe="${x.id}" class="${aktiv === x.id ? 'an' : ''}">${x.name}</button>`).join('')}</div>
        <p class="einleitung">${st?.text ?? ''}</p>` : ''}
      ${sim.modus === 'hochwasser' ? `<label class="schalter gross"><input type="checkbox" id="sim-ohne" ${sim.ohne ? 'checked' : ''}><span>Ohne Deiche</span></label>` : ''}
      <p class="quelle">${SIM_LIZENZ[sim.modus]}</p>`
  }
  if (!tab.magazin) karteInKachel()
  if (tab.magazin) { magazinZeichnen(); return }
  if (tab.energie) { el.innerHTML = energieSeiteHtml(energieDaten()) + FUSSZEILE; return }
  if (tab.quellen) { quellenZeichnen(el); return }
  if (tab.webcams) { const cams = WEBCAMS.filter((c) => erlaubt(c.lizenz)); el.innerHTML = webcamsSeiteHtml(cams) + FUSSZEILE; webcamsStopp?.(); webcamsStopp = webcamsVerdrahten(el, cams); return }
  if (tab.kalender) { el.innerHTML = kalenderHtml() + FUSSZEILE; kalenderVerdrahten(el, panelZeichnen); return }
  el.innerHTML = `${chips}${inhalt}<div id="jetzt"${tafel ? ' class="tafel-raster"' : ''}></div>`
  leiste.querySelectorAll<HTMLButtonElement>('.chip-schalter').forEach((b) => b.addEventListener('click', () => {
    const c = tab.chips.find((x) => x.id === b.dataset.id)!
    chipAn.set(chipKey(c), !chipIst(c))
    merke('chips', [...chipAn])
    b.classList.toggle('an', chipIst(c))
    ebenenAnwenden()
  }))
  el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => b.addEventListener('click', () => { histModus = b.dataset.m as typeof histModus; zeitleisteZeigen(histModus); panelZeichnen() }))
  el.querySelectorAll<HTMLButtonElement>('[data-grund]').forEach((b) => b.addEventListener('click', () => { eigeneGrund = b.dataset.grund!; merke('grund', eigeneGrund); ebenenAnwenden(); panelZeichnen() }))
  el.querySelectorAll<HTMLButtonElement>('[data-vorlage]').forEach((b) => b.addEventListener('click', () => {
    const v = VORLAGEN.find((x) => x.id === b.dataset.vorlage)!
    eigeneGrund = v.grund
    eigeneEbenen.clear(); v.ebenen.forEach((id) => eigeneEbenen.add(id))
    merke('grund', eigeneGrund); merke('eigene', [...eigeneEbenen])
    ebenenAnwenden(); panelZeichnen()
    map.easeTo({ zoom: v.zoom, duration: 700 })
  }))
  el.querySelector<HTMLInputElement>('#d3')?.addEventListener('change', (ev) => {
    d3An = (ev.target as HTMLInputElement).checked
    d3(d3An)
    map.easeTo({ pitch: d3An ? 55 : 0, zoom: d3An ? Math.max(map.getZoom(), 16) : map.getZoom(), duration: 700 })
    zeitleisteZeigen(zeitleisteFuer())
  })
  if (tab.id === 'eigene') {
    const liste = $('#ebenen-liste')
    const zeichnen = (f = '') => {
      const q = f.toLowerCase()
      liste.innerHTML = GRUPPEN.filter((g) => g !== 'Grundkarte').map((g) => {
        const es = EBENEN.filter((e) => e.gruppe === g && !e.versteckt && (!q || (e.name + ' ' + g).toLowerCase().includes(q)))
        if (!es.length) return ''
        return `<details ${q || es.some((e) => eigeneEbenen.has(e.id)) ? 'open' : ''}><summary>${g}<span>${es.filter((e) => eigeneEbenen.has(e.id)).length || ''}</span></summary>${es.map((e) => `
          <label class="schalter"><input type="checkbox" data-id="${e.id}" ${eigeneEbenen.has(e.id) ? 'checked' : ''}><span>${e.name}<small>${esc(e.lizenz)}${e.hinweis ? ' · ' + esc(e.hinweis) : ''}</small></span></label>`).join('')}</details>`
      }).join('')
      liste.querySelectorAll<HTMLInputElement>('input').forEach((cb) => cb.addEventListener('change', () => {
        cb.checked ? eigeneEbenen.add(cb.dataset.id!) : eigeneEbenen.delete(cb.dataset.id!)
        merke('eigene', [...eigeneEbenen])
        ebenenAnwenden()
      }))
    }
    zeichnen()
    $<HTMLInputElement>('#ebenen-suche').addEventListener('input', (ev) => zeichnen((ev.target as HTMLInputElement).value))
  }
  el.querySelectorAll<HTMLButtonElement>('[data-sorte]').forEach((b) => b.addEventListener('click', () => { tankWahlSetzen({ sorte: b.dataset.sorte as Sorte }); tankZeichnen(); panelZeichnen() }))
  if (tab.id === 'politik') politikPanelVerdrahten(el)
  if (tab.id === 'tanken') void statistikLaden().then(() => { const v = document.getElementById('sprit-verlauf'); if (v) v.innerHTML = spritVerlaufHtml(tankWahl.sorte) }).catch(() => {})
  if (tab.id === 'bevoelkerung') bevoelkerungPanelVerdrahten(el, (m) => { bvMerkmal = m; merke('bv', m); bevoelkerungKarte(map, m); panelZeichnen() })
  if (tab.id === 'verkehr') verkehrZeichnen()
  el.querySelectorAll<HTMLButtonElement>('[data-sim]').forEach((b) => b.addEventListener('click', () => {
    sim.modus = b.dataset.sim as SimModus; merke('sim', sim)
    ebenenAnwenden(); zeitleisteZeigen(zeitleisteFuer()); panelZeichnen()
    if (sim.modus === 'sonne') map.easeTo({ pitch: 55, zoom: Math.max(map.getZoom(), 16), duration: 700 })
    else if (map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 500 })
  }))
  el.querySelectorAll<HTMLButtonElement>('[data-stufe]').forEach((b) => b.addEventListener('click', () => {
    if (sim.modus === 'hochwasser') sim.hw = b.dataset.stufe as HwStufe; else sim.sr = b.dataset.stufe as SrStufe
    merke('sim', sim); ebenenAnwenden(); panelZeichnen()
  }))
  el.querySelector<HTMLInputElement>('#sim-ohne')?.addEventListener('change', (ev) => { sim.ohne = (ev.target as HTMLInputElement).checked; merke('sim', sim); ebenenAnwenden() })
  for (const id of tab.karten) if (cache.has(id)) karteZeichnen(id)
  heuteZeichnen()
}

// ---------------------------------------------------------------- Magazin (Tab Aktuell)

let magazin: Magazin | null = null
let magazinMehr = false
/** Kennzahlen oben: Wetter immer, Abweichungen nur wenn vorhanden, Solarstrom aus Hamm */
/** Lagezeile oben im Magazin: Stichwort, Einordnung, kurzer Beleg. Jede Einordnung aus Messwerten, Schwellen im Code. */
function kennzahlen(): Kennzahl[] {
  const z: Kennzahl[] = []
  const zl = (id: string) => cache.get(id)?.zeilen ?? []
  // Wetter: Lage jetzt + Vorhersage
  const w = zl('wetter')[0], vh = zl('vorhersage')[0]
  if (w) {
    const [t, ...rest] = w.text.split(', ')
    const regen = /regen|schauer|gewitter|schnee/i.test(w.text + ' ' + (vh?.text ?? ''))
    z.push({ name: 'Wetter', wert: `${t.replace(/,\d\s*°C/, '°').replace(' °C', '°')} ${rest.join(', ')}`.trim(), klein: vh?.text.replace(/^\d+ bis \d+ °C, /, ''), ampel: regen ? 'mittel' : 'gut', tab: 'wetter' })
  }
  // Warnungen nur, wenn es welche gibt
  const warn = zl('warnungen').filter((x) => x.stufe !== 'info')
  if (warn.length) z.push({ name: 'Warnung', wert: warn[0].text.slice(0, 40), klein: warn.length > 1 ? `und ${warn.length - 1} weitere` : undefined, ampel: 'schlecht', tab: 'wetter' })
  // Verkehrsfluss: Anteil frei fließender Straßenkilometer (Verkehr.NRW) und Störungen in Hamm (Radio Lippe Welle)
  // eingefrorene Verkehrslage nicht als Einordnung verwenden
  const km = verkehrVeraltet() ? '' : zl('verkehrslage').find((x) => /^Erfasst/.test(x.text))?.klein ?? ''
  const wert = (n: string) => Number((new RegExp(n + ' ([\\d.,]+) km').exec(km)?.[1] ?? '0').replace(/\./g, '').replace(',', '.'))
  const frei = wert('frei'), gestoert = wert('dicht') + wert('zähfließend') + wert('Stau')
  const stoer = zl('lippewelle').filter((x) => x.stufe === 'alarm' && /hamm/i.test(x.text + ' ' + (x.klein ?? '')))
  if (frei + gestoert > 0 || stoer.length) {
    const anteil = frei / Math.max(1, frei + gestoert)
    const lage = stoer.length >= 2 || anteil < 0.85 ? 'gestört' : stoer.length || anteil < 0.95 ? 'leicht zäh' : 'flüssig'
    z.push({ name: 'Verkehrsfluss', wert: lage, klein: `${Math.round(anteil * 100)} % der Strecken frei${stoer.length ? ` · ${stoer.length} Störung${stoer.length > 1 ? 'en' : ''}` : ''}`, ampel: lage === 'flüssig' ? 'gut' : lage === 'gestört' ? 'schlecht' : 'mittel', tab: 'verkehr' })
  }
  // Bahn: Echtzeit Hamm Hbf (Züge im Raum Hamm, verspätete Züge)
  const zz = zl('zuege')
  const zm = /(\d+) Züge im Raum Hamm, (\d+) verspätet/.exec(zz[0]?.text ?? '')
  if (zm) {
    const versp = zz.filter((x) => /\+\d+ min$/.test(x.text))
    const max = versp.map((x) => Number(/\+(\d+) min$/.exec(x.text)![1])).sort((a, b) => b - a)[0] ?? 0
    const ausfall = zz.filter((x) => /fällt aus/.test(x.text)).length
    z.push({ name: 'Bahn Hamm Hbf', wert: ausfall ? `${ausfall} Ausfall${ausfall > 1 ? 'e' : ''}` : Number(zm[2]) ? `${zm[2]} verspätet` : 'pünktlich', klein: max ? `größte Verspätung ${versp.find((x) => x.text.endsWith(`+${max} min`))?.text}` : `${zm[1]} Züge unterwegs`, ampel: ausfall || max >= 15 ? 'schlecht' : max >= 5 ? 'mittel' : 'gut', tab: 'verkehr' })
  }
  // Blitzer heute (Schwerpunkte der Stadt)
  const bl = zl('blitzer_woche').find((x) => /^heute/i.test(x.text))
  if (bl) z.push({ name: 'Blitzer heute', wert: bl.text.replace(/^heute:\s*/i, '').split(',')[0], klein: bl.text.replace(/^heute:\s*/i, ''), ampel: 'neutral', tab: 'verkehr' })
  // Luft und Lippe nur, wenn sie auffällig sind
  const luftZ = zl('luft')[0]
  if (luftZ && /^Luft in Hamm/.test(luftZ.text) && !/gut/.test(luftZ.text)) z.push({ name: 'Luftqualität', wert: luftZ.text.replace('Luft in Hamm: ', ''), klein: luftZ.klein?.split(', PM10')[0], ampel: /mäßig/.test(luftZ.text) ? 'mittel' : 'schlecht', tab: 'wetter' })
  const lp = zl('lippe')[0]
  if (lp && /steigt/.test(lp.klein ?? '')) z.push({ name: 'Lippe-Pegel', wert: 'steigt', klein: lp.text.replace(/^.*: /, '') + ' bei Kesseler', ampel: 'mittel', tab: 'simulation' })
  return z
}
function magazinZeichnen() {
  const el = $('#tafel')
  if (!tab.magazin) return
  if (!privat.an) { el.innerHTML = `<div class="seite"><div class="box" style="margin:24px var(--rand)"><p class="lbl">Aktuell</p><h2 style="margin:4px 0 8px">Nachrichten und Termine sind abgeschaltet</h2><p>Sie stammen aus Quellen ohne offene Lizenz und laufen nur in privaten Installationen (HAM_PRIVATQUELLEN=an). Karten, Verkehr, Wetter, Energie und alle offenen Daten sind über die Navigation erreichbar.</p></div>${FUSSZEILE}</div>`; return }
  if (!magazin) { el.innerHTML = '<p class="lade" style="padding:24px">Lädt …</p>'; return }
  const busse = cache.get('busse')?.zaehler
  el.innerHTML = magazinHtml(magazin, kennzahlen(), magazinMehr, busse ? `${busse} Busse unterwegs` : 'Busse, Staus, Baustellen')
  karteInKachel()
  el.querySelectorAll<HTMLButtonElement>('.lz[data-tab]').forEach((b) => b.addEventListener('click', () => tabSetzen(TABS.find((t) => t.id === b.dataset.tab)!)))
  el.querySelectorAll<HTMLButtonElement>('.mz-mehr').forEach((b) => b.addEventListener('click', () => { magazinMehr = !magazinMehr; magazinZeichnen() }))
  el.querySelectorAll<HTMLButtonElement>('.mz-alle, .mz2-live').forEach((b) => b.addEventListener('click', () => tabSetzen(TABS.find((t) => t.id === b.dataset.tab)!)))
}
/** Aktuell: die Hauptkarte liegt als Live-Karte in der Kachel „Live in Hamm“ (Busse, Züge, Staus, Baustellen) */
let karteImMagazin = false
function karteInKachel() {
  const platz = document.getElementById('mz-kartenplatz')
  const k = $('#karte')
  if (!tab.magazin || !platz) {
    if (karteImMagazin) { k.removeAttribute('style'); document.body.classList.remove('mz-karte'); karteImMagazin = false; map.resize() }
    return
  }
  kartePlatz(platz)
  document.body.classList.add('mz-karte')
  karteImMagazin = true
  map.resize()
  map.fitBounds([[7.70, 51.60], [8.00, 51.75]], { padding: 4, duration: 0 })
}
/** Karte genau über den Platzhalter legen (auch beim Scrollen auf dem Handy) */
function kartePlatz(platz = document.getElementById('mz-kartenplatz')) {
  if (!platz) return
  const r = platz.getBoundingClientRect(), k = $('#karte')
  Object.assign(k.style, { position: 'fixed', inset: 'auto', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, zIndex: '5' })
  k.style.clipPath = `inset(${Math.max(0, $('#kopf').getBoundingClientRect().bottom - r.top)}px 0 0 0)`
}
window.addEventListener('resize', () => { if (tab.magazin) karteInKachel() })
// jedes Scrollen (auch in inneren Bereichen) zieht die Live-Karte mit
document.addEventListener('scroll', () => { if (tab.magazin && karteImMagazin) kartePlatz() }, { passive: true, capture: true })

async function magazinAuffrischen() {
  try { magazin = await magazinLaden(); magazinZeichnen() } catch (e) { console.warn('Magazin', e) }
}

// ---------------------------------------------------------------- Tanken: Neuberechnung ohne Abfrage

let tankGeladen = false
function tankZeichnen() {
  if (!tankGeladen) return
  const e = tankErgebnis()
  ;(map.getSource('live-tankstellen') as maplibregl.GeoJSONSource | undefined)?.setData(e.punkte!)
  karteRendern('tankstellen', e.zeilen, String(e.zeilen.filter((z) => z.stufe !== 'info').length), tankstellen.lizenz)
}

// ---------------------------------------------------------------- Politik: Wahlergebnisse je Bezirk

const politik = { wahl: lies('wahl', 'kw25-rat'), modus: lies<Farbmodus>('wahlmodus', 'staerkste'), partei: lies('partei', 'SPD'), ebene: lies<'bezirke' | 'wahlbezirke'>('wahlebene', 'bezirke') }
const POLITIK_EBENEN = ['wahl-bezirke-flaeche', 'wahl-bezirke-rand', 'wahl-wahlbezirke-flaeche', 'wahl-wahlbezirke-rand']
const prozent = (x: number) => x.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' %'

function politikPanel() {
  const d = wahlenGeladen()
  if (!d) return `${tab.einleitung ? `<p class="einleitung">${tab.einleitung}</p>` : ''}<p class="einleitung">Wahldaten werden geladen …</p>`
  const w = wahl(politik.wahl) ?? d.wahlen[0]
  politik.wahl = w.id
  const anteil = (k: string) => w.gesamt.stimmen[k] ?? 0 // Prozent der gültigen Stimmen
  const parteien = w.parteien.filter((p) => anteil(p.kurz) >= 1).sort((a, b) => anteil(b.kurz) - anteil(a.kurz))
  if (!parteien.some((p) => p.kurz === politik.partei)) politik.partei = parteien[0]?.kurz ?? ''
  return `${tab.einleitung ? `<p class="einleitung">${tab.einleitung}</p>` : ''}
    <h4>Wahl</h4><select id="wahl-wahl" class="auswahl">${d.wahlen.map((x) => `<option value="${x.id}" ${x.id === w.id ? 'selected' : ''}>${esc(x.name)}${x.stimmart === 'Stimme' ? '' : ', ' + x.stimmart}</option>`).join('')}</select>
    <h4>Färbung</h4><div class="segment">${([['staerkste', 'Stärkste Partei'], ['beteiligung', 'Beteiligung'], ['partei', 'Eine Partei']] as const).map(([m, n]) => `<button data-wahlmodus="${m}" class="${politik.modus === m ? 'an' : ''}">${n}</button>`).join('')}</div>
    ${politik.modus === 'partei' ? `<div class="segment umbruch">${parteien.map((p) => `<button data-partei="${esc(p.kurz)}" class="${politik.partei === p.kurz ? 'an' : ''}">${esc(p.kurz)}</button>`).join('')}</div>` : ''}
    <h4>Einteilung</h4><div class="segment"><button data-wahlebene="bezirke" class="${politik.ebene === 'bezirke' ? 'an' : ''}">Stimmbezirke</button><button data-wahlebene="wahlbezirke" class="${politik.ebene === 'wahlbezirke' ? 'an' : ''}">Wahlbezirke mit Brief</button></div>
    <section class="karte"><header><b>${esc(w.name)}</b><span class="zaehler">${w.gesamt.beteiligung != null ? 'Beteiligung ' + prozent(w.gesamt.beteiligung) : ''}</span></header>
      <ul class="kompakt">${parteien.slice(0, 7).map((p) => `<li><span><i class="farbkasten" style="background:${p.farbe}"></i>${esc(p.kurz)}</span><small>${prozent(anteil(p.kurz))}</small></li>`).join('')}</ul>
      ${politik.modus === 'staerkste' ? '' : `<div class="legende">${wahlLegende(w.id, politik.modus, politik.partei)}</div>`}
      ${w.hinweis ? `<p class="quelle">${esc(w.hinweis)}</p>` : ''}
      <p class="quelle">${esc(POLITIK_LIZENZ)}</p></section>`
}

function politikPanelVerdrahten(el: HTMLElement) {
  const neu = () => { merke('wahl', politik.wahl); merke('wahlmodus', politik.modus); merke('partei', politik.partei); merke('wahlebene', politik.ebene); politikAnwenden(); panelZeichnen() }
  el.querySelector<HTMLSelectElement>('#wahl-wahl')?.addEventListener('change', (ev) => { politik.wahl = (ev.target as HTMLSelectElement).value; neu() })
  el.querySelectorAll<HTMLButtonElement>('[data-wahlmodus]').forEach((b) => b.addEventListener('click', () => { politik.modus = b.dataset.wahlmodus as Farbmodus; neu() }))
  el.querySelectorAll<HTMLButtonElement>('[data-partei]').forEach((b) => b.addEventListener('click', () => { politik.partei = b.dataset.partei!; neu() }))
  el.querySelectorAll<HTMLButtonElement>('[data-wahlebene]').forEach((b) => b.addEventListener('click', () => { politik.ebene = b.dataset.wahlebene as typeof politik.ebene; neu() }))
}

function politikAnwenden() {
  if (!map.getLayer('wahl-bezirke-flaeche')) return
  const sichtbar = tab.id === 'politik'
  for (const l of POLITIK_EBENEN) map.setLayoutProperty(l, 'visibility', sichtbar && l.startsWith(`wahl-${politik.ebene}-`) ? 'visible' : 'none')
  if (sichtbar) map.setPaintProperty(`wahl-${politik.ebene}-flaeche`, 'fill-color', wahlFarbausdruck(politik.wahl, politik.modus, politik.partei))
}

async function politikStarten() {
  const d = await wahlenLaden()
  for (const art of ['bezirke', 'wahlbezirke'] as const) {
    map.addSource(`wahl-${art}`, { type: 'geojson', data: d[art] as GeoJSON.FeatureCollection })
    map.addLayer({ id: `wahl-${art}-flaeche`, type: 'fill', source: `wahl-${art}`, layout: { visibility: 'none' }, paint: { 'fill-color': '#cccccc', 'fill-opacity': 0.72 } }, 'anker-live')
    map.addLayer({ id: `wahl-${art}-rand`, type: 'line', source: `wahl-${art}`, layout: { visibility: 'none' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 15, 2] } }, 'anker-live')
  }
  politikAnwenden()
  if (tab.id === 'politik') panelZeichnen()
}

function politikKlick(ev: maplibregl.MapMouseEvent) {
  const f = map.queryRenderedFeatures(ev.point, { layers: [`wahl-${politik.ebene}-flaeche`] })[0]
  if (!f) return false
  const nr = (f.properties as any).nr
  const orig = wahlenGeladen()?.[politik.ebene].features.find((x) => x.properties.nr === nr)
  const p = (orig?.properties ?? f.properties) as Record<string, unknown>
  blatt(esc(`${politik.ebene === 'bezirke' ? 'Stimmbezirk' : 'Wahlbezirk'} ${p.nr} ${p.name ?? ''}`), bezirkHtml(p, politik.wahl))
  return true
}

function karteRendern(id: string, zeilen: Zeile[], zaehler: string, lizenz: string, abruf = new Date(), alt = false) {
  cache.set(id, { zeilen, zaehler, lizenz, abruf, alt })
  if (tab.karten.includes(id)) karteZeichnen(id)
  heuteBald()
  if (tab.magazin && ['wetter', 'vorhersage', 'warnungen', 'lippewelle', 'verkehrslage', 'zuege', 'blitzer_woche', 'luft', 'lippe'].includes(id)) magazinBald()
  if (tab.energie && ENERGIE_QUELLEN.some((q) => q.id === id)) energieBald()
  // Quellen und Lizenzen: neu zeichnen, sobald weitere Quellen geladen sind (gebündelt)
  if (tab.quellen && !quellenZeit) quellenZeit = window.setTimeout(() => { quellenZeit = 0; if (tab.quellen) { const y = scrollY; quellenZeichnen($('#tafel')); scrollTo(0, y) } }, 1500)
  if (tab.id === 'wetter' && ['wetterbericht', 'stadtwetter'].includes(id)) { const wb = document.getElementById('wb'); if (wb) wb.innerHTML = wetterberichtHtml() }
  if (tab.id === 'verkehr' && ['verkehrslage', 'staumeldungen', 'zuege', 'baustellen', 'baustellen_nrw', 'lippewelle'].includes(id)) verkehrBald()
}

// ---------------------------------------------------------------- Verkehr: Überblick, Hauptachsen, Tagesleiste
let verkehrRaf = 0
/** Uhrzeit, seit der Verkehr.NRW unveränderte Daten liefert (sonst undefined) */
function verkehrVeraltet() { return /^Keine aktuellen Verkehrsdaten seit (\d\d:\d\d)/.exec(cache.get('verkehrslage')?.zeilen[0]?.text ?? '')?.[1] }
let verkehrFc: GeoJSON.FeatureCollection | undefined
function verkehrBald() { if (!verkehrRaf) verkehrRaf = requestAnimationFrame(() => { verkehrRaf = 0; verkehrZeichnen() }) }
function stauKm() { const k = hammKm(); return k.zaeh + k.stau }
function verkehrZeichnen() {
  const el = document.getElementById('vu')
  if (!el || tab.id !== 'verkehr') return
  achsenBerechnen(verkehrFc)
  const bahn = kennzahlen().find((k) => k.name === 'Bahn Hamm Hbf')
  // Baustellen: amtliche Meldungen (Verkehr.NRW) und Pressemitteilungen der Stadt
  const bsNrw = (cache.get('baustellen_nrw')?.zeilen ?? []).filter((z) => z.lon != null).length
  const bs = (Number(cache.get('baustellen')?.zaehler) || 0) + bsNrw || undefined
  // Störungen: Abschnitte von Verkehr.NRW auf Hammer Straßen, Meldungen von Lippe Welle/ADAC nur mit Ortsbezug
  const ORT = /Hamm|Bockum|Hövel|Heessen|Uentrop|Rhynern|Pelkum|Herringen|Werne|Ahlen|Kamen|Bönen|Werl/
  const stoer = [...(cache.get('staumeldungen')?.zeilen ?? []).filter((z) => z.stufe !== 'info' && !/: Umland/.test(z.text)),
    ...(cache.get('verkehrslage')?.zeilen ?? []).filter((z) => (z.stufe === 'alarm' || z.stufe === 'warnung') && !/Abschnitt im Umland|^Keine aktuellen/.test(z.text)),
    ...(cache.get('lippewelle')?.zeilen ?? []).filter((z) => (z.stufe === 'alarm' || z.stufe === 'warnung') && ORT.test(z.text))]
  el.outerHTML = `<div id="vu">${verkehrUeberblickHtml({ stauKm: verkehrVeraltet() ? undefined : stauKm(), bahn: bahn?.wert, baustellen: bs, veraltetSeit: verkehrVeraltet() }, stoer)}</div>`
  const neu = document.getElementById('vu')!
  neu.querySelectorAll<HTMLElement>('[data-achse]').forEach((li) => li.addEventListener('click', () => {
    const fc = achseLinien(li.dataset.achse!)
    const xs = fc.features.flatMap((f) => (f.geometry as GeoJSON.LineString).coordinates)
    if (!xs.length) return
    const src = map.getSource('vu-achse') as maplibregl.GeoJSONSource | undefined
    if (src) src.setData(fc)
    else { map.addSource('vu-achse', { type: 'geojson', data: fc }); map.addLayer({ id: 'vu-achse', type: 'line', source: 'vu-achse', paint: { 'line-color': '#00505a', 'line-width': 9, 'line-opacity': 0.25 } }, 'anker-live') }
    map.fitBounds([[Math.min(...xs.map((p) => p[0])), Math.min(...xs.map((p) => p[1]))], [Math.max(...xs.map((p) => p[0])), Math.max(...xs.map((p) => p[1]))]], { padding: innerWidth <= 760 ? { top: 120, bottom: Math.round(innerHeight * 0.44) + 12, left: 8, right: 8 } : { top: 24, bottom: 140, left: map.getContainer().clientWidth < 900 ? 16 : 392, right: 24 }, duration: 700, maxZoom: 15 })
  }))
  neu.querySelectorAll<HTMLElement>('.vu-stoer li.klickbar').forEach((li) => li.addEventListener('click', () => {
    const z = stoer[Number(li.dataset.i)]
    if (z?.lon != null) map.easeTo({ center: [z.lon, z.lat!], zoom: 15, duration: 700 })
  }))
  void verkehrTagZeichnen()
}
let verkehrPunkte: { t: string; stau?: number }[] = []
let verkehrPunkteZeit = 0
async function verkehrTagZeichnen() {
  if (Date.now() - verkehrPunkteZeit > 5 * 60000) {
    verkehrPunkteZeit = Date.now()
    verkehrPunkte = await (await fetch('/api/aufzeichnung')).json().catch(() => [])
  }
  const alt = verkehrVeraltet()
  const seit = alt ? new Date(new Date().toDateString() + ' ' + alt) : undefined
  const html = verkehrTagHtml(verkehrPunkte, alt ? undefined : stauKm(), seit)
  if (zlArt === 'verkehrtag') $('#zeitleiste').innerHTML = html
  // Handy: Tagesleiste im Blatt statt über der Karte
  const tag = document.querySelector('.vu-tag')
  if (tag) tag.innerHTML = html
}
let energieRaf = 0
let webcamsStopp: (() => void) | undefined
/** Fußzeile der Leseseiten (Kartenseiten: Link im Kartenhinweis unten rechts) */
const FUSSZEILE = `<footer class="fusszeile"><span>HAM:LIVE · privates Projekt, Daten aus öffentlichen Quellen, ohne Gewähr</span><a href="#quellen">Quellen, Lizenzen und rechtliche Hinweise</a></footer>`
let datenstand: Datenstand[] | undefined
let quellenZeit = 0
/** Quellen und Lizenzen: alle Listen mit Lizenz und letztem Abruf aus dem Zwischenspeicher, Datensätze vom Server */
function quellenZeichnen(el: HTMLElement) {
  const live = [...cache.entries()].map(([id, c]) => ({ name: TITEL[id] ?? id, lizenz: c.lizenz, abruf: c.abruf, alt: c.alt }))
  el.innerHTML = quellenSeiteHtml(live, datenstand, magazin?.stand)
  if (!datenstand) void fetch('/api/datenstand').then((r) => r.json()).then((d) => { datenstand = d; if (tab.quellen) quellenZeichnen($('#tafel')) }).catch(() => { datenstand = [] })
}
function energieBald() { if (!energieRaf) energieRaf = requestAnimationFrame(() => { energieRaf = 0; if (tab.energie) $('#tafel').innerHTML = energieSeiteHtml(energieDaten()) + FUSSZEILE }) }
let magazinRaf = 0
function magazinBald() { if (!magazinRaf) magazinRaf = requestAnimationFrame(() => { magazinRaf = 0; magazinZeichnen() }) }

// ---------------------------------------------------------------- Heute in Hamm (oben im Tab Aktuell)

try { localStorage.removeItem('ham-lage.tonne') } catch { /* privat */ }
let heuteRaf = 0
function heuteBald() { if (!heuteRaf) heuteRaf = requestAnimationFrame(() => { heuteRaf = 0; heuteZeichnen() }) }
function heuteZeichnen() {
  const ziel = document.getElementById('jetzt')
  if (!tab.tafel || tab.magazin || !ziel) return
  let el = document.getElementById('k-heute')
  if (!el) { el = document.createElement('section'); el.id = 'k-heute'; el.className = 'karte heute'; el.style.order = '-1'; ziel.prepend(el) }
  const zs = heuteZeilen((id) => cache.get(id)?.zeilen)
  const tag = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
  el.innerHTML = `<header><b>Heute in Hamm</b><span class="zaehler">${tag}</span></header>
    <ul>${zs.map((h) => `<li class="${h.stufe ?? ''}${h.ziel ? ' klickbar' : ''}" data-ziel="${h.ziel ?? ''}"><span><em class="art">${h.symbol}</em>${esc(h.text)}</span>${h.klein ? `<small>${esc(h.klein)}</small>` : ''}</li>`).join('')}</ul>`
  el.querySelectorAll<HTMLLIElement>('li.klickbar').forEach((li) => li.addEventListener('click', () => {
    const k = document.getElementById(`k-${li.dataset.ziel}`)
    if (k) k.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else if (li.dataset.ziel === 'luft') tabSetzen(TABS.find((t) => t.id === 'wetter')!)
  }))
}

/** Quellenzeile unter einer Karte: nur der Name, Lizenz und Hinweise im Tooltip */
const quelleKurz = (l: string) => l.split(' · ')[0].replace(/\s*\([^)]*\)/g, '').replace(/,?\s*(nur privat|Datenlizenz.*|Nutzungsbedingungen.*)$/i, '').replace(/\s+–.*$/, '').trim()

/** Akkordeon im Panel: die ersten zwei Karten eines Tabs offen, die übrigen zu – außer der Nutzer hat umgeschaltet */
const klappWahl = new Map<string, boolean>()
// Seiten mit eigenem Überblick oben (Verkehr, Wetter): alle Listen zunächst zu, sonst die ersten zwei offen
const kartenZu = (id: string) => klappWahl.get(`${tab.id}.${id}`) ?? (tab.id === 'verkehr' || tab.id === 'wetter' || (tab.id === 'tanken' && id !== 'tankstellen') || tab.karten.indexOf(id) >= 2)

function karteZeichnen(id: string) {
  const d = cache.get(id)!
  const ziel = document.getElementById('jetzt')
  if (!ziel) return
  let el = document.getElementById(`k-${id}`)
  if (!el) {
    el = document.createElement('section')
    el.id = `k-${id}`
    el.className = 'karte'
    el.style.order = String(tab.karten.indexOf(id))
    ziel.append(el)
  }
  const max = offen.has(id) || (tab.id === 'termine' && id === 'veranstaltungen') ? 40 : tab.tafel ? 3 : MAX[id] ?? 3
  const { zeilen, zaehler, lizenz, abruf, alt } = d
  const zu = !tab.tafel && kartenZu(id)
  el.classList.toggle('zu', zu)
  const zielTab = tab.tafel ? ZIEL_TAB[id] : undefined
  el.innerHTML = `<header class="${zielTab ? 'sprung' : 'klapp'}"${zielTab ? ` data-tab="${zielTab}" title="Im Tab ${TABS.find((t) => t.id === zielTab)?.name} öffnen"` : ''}><b>${TITEL[id] ?? id}</b><span class="zaehler">${esc(zaehler)}</span></header>
    <ul>${zeilen.slice(0, max).map((z, i) => `<li class="${z.stufe ?? ''}${z.lon != null || z.link ? ' klickbar' : ''}" data-i="${i}"><span>${esc(z.text)}</span>${z.klein ? `<small>${esc(z.klein)}</small>` : ''}</li>`).join('')}</ul>
    ${zeilen.length > (tab.tafel ? 3 : MAX[id] ?? 3) ? `<button class="mehr">${offen.has(id) ? 'Weniger anzeigen' : `Alle ${zeilen.length} anzeigen`}</button>` : ''}
    <p class="quelle${alt ? ' veraltet' : ''}" title="${esc(lizenz)}">${abruf ? `${alt ? 'nicht erreichbar, Stand' : 'abgerufen'} ${uhrzeit(abruf)} Uhr · ` : ''}${esc(quelleKurz(lizenz))}</p>`
  el.querySelectorAll<HTMLLIElement>('li.klickbar').forEach((li) => li.addEventListener('click', () => {
    const z = zeilen[Number(li.dataset.i)]
    if (z.link) window.open(z.link, '_blank', 'noopener')
    else map.flyTo({ center: [z.lon!, z.lat!], zoom: tab.tafel ? 14 : 15 })
  }))
  el.querySelector<HTMLElement>('header.klapp')?.addEventListener('click', () => { klappWahl.set(`${tab.id}.${id}`, !kartenZu(id)); karteZeichnen(id) })
  el.querySelector<HTMLElement>('header.sprung')?.addEventListener('click', (ev) => tabSetzen(TABS.find((t) => t.id === (ev.currentTarget as HTMLElement).dataset.tab)!))
  el.querySelector('.mehr')?.addEventListener('click', () => { offen.has(id) ? offen.delete(id) : offen.add(id); merke('offen', [...offen]); karteZeichnen(id) })
}

// ================================================================ Zeitleiste unten

const ZEITREISE = [
  { id: 'uraufnahme', jahr: '1840', name: 'Preußische Uraufnahme' },
  { id: 'neuaufnahme', jahr: '1900', name: 'Preußische Neuaufnahme' },
  { id: 'tk25_1940', jahr: '1940', name: 'Topografische Karte (nur in Nahansicht)' },
  ...LUFTBILD_JAHRE.map((j) => ({ id: `hdop${j}`, jahr: String(j), name: 'Luftbild' })),
  { id: 'dop', jahr: 'heute', name: 'Luftbild aktuell' },
]
let radarLauf: number | undefined
let zlArt: Zeitleiste = 'keine'

function zeitleisteZeigen(art: Zeitleiste) {
  const el = $('#zeitleiste')
  zlArt = art
  // Handy: die Tagesleiste Verkehr steht im Blatt, nicht über der Karte
  document.body.classList.toggle('mit-zeitleiste', art !== 'keine' && !(art === 'verkehrtag' && innerWidth <= 760))
  if (radarLauf) { clearInterval(radarLauf); radarLauf = undefined }
  el.hidden = art === 'keine'
  if (art === 'zeitreise') {
    el.innerHTML = `<div class="kopf"><b id="zl-titel"></b><span id="zl-sub"></span></div>
      <input type="range" id="zl" min="0" max="${ZEITREISE.length - 1}" step="0.01" value="${ZEITREISE.length - 1}">
      <div class="marken">${ZEITREISE.map((z, i) => `<button data-i="${i}">${z.jahr}</button>`).join('')}</div>`
    const r = $<HTMLInputElement>('#zl')
    const setzen = () => {
      const v = Number(r.value)
      // Nachbarjahre mit fast unsichtbarer Deckkraft mitladen, damit der nächste Schritt sofort da ist
      ZEITREISE.forEach((z, i) => { const d = Math.abs(v - i), a = Math.max(0, 1 - d); zeige(z.id, a > 0.01 || d < 2.2, Math.max(a, d < 2.2 ? 0.01 : 0)) })
      const z = ZEITREISE[Math.round(v)]
      $('#zl-titel').textContent = z.jahr === 'heute' ? 'Heute' : z.jahr
      $('#zl-sub').textContent = z.name
      el.querySelectorAll('.marken button').forEach((b, i) => b.classList.toggle('aktiv', i === Math.round(v)))
    }
    r.addEventListener('input', setzen)
    el.querySelectorAll<HTMLButtonElement>('.marken button').forEach((b) => b.addEventListener('click', () => { r.value = b.dataset.i!; setzen() }))
    setzen()
  } else if (art === 'radar') {
    el.innerHTML = `<div class="kopf"><b id="zl-titel">Jetzt</b><span id="zl-sub">Regenradar des DWD, alle 5 Minuten</span><button id="zl-play" class="knopf">Abspielen</button></div>
      <input type="range" id="zl" min="-180" max="0" step="5" value="0">
      <div class="marken skala"><span>vor 3 h</span><span>vor 2 h</span><span>vor 1 h</span><span>jetzt</span></div>`
    const r = $<HTMLInputElement>('#zl')
    const basis = Math.floor((Date.now() - 6 * 60000) / 300000) * 300000
    radarVorladen(Array.from({ length: 37 }, (_, i) => new Date(basis + (i * 5 - 180) * 60000)))
    const setzen = () => {
      const off = Number(r.value)
      const t = new Date(Math.floor((Date.now() - 6 * 60000) / 300000) * 300000 + off * 60000)
      radarZeigen(off === 0 ? undefined : t)
      $('#zl-titel').textContent = off === 0 ? 'Jetzt' : `${uhrzeit(t)} Uhr`
      $('#zl-sub').textContent = 'Regenradar DWD'
    }
    r.addEventListener('input', setzen)
    $('#zl-play').addEventListener('click', (ev) => {
      const b = ev.currentTarget as HTMLButtonElement
      if (radarLauf) { clearInterval(radarLauf); radarLauf = undefined; b.textContent = 'Abspielen'; return }
      b.textContent = 'Anhalten'
      r.value = '-180'
      radarLauf = window.setInterval(() => {
        const v = Number(r.value) + 5 > 0 ? -180 : Number(r.value) + 5
        // erst weiter, wenn das nächste Bild im Speicher ist
        if (v !== 0 && !radarBereit(new Date(Math.floor((Date.now() - 6 * 60000) / 300000) * 300000 + v * 60000))) return
        r.value = String(v); setzen()
      }, 300)
    })
  } else if (art === 'verkehrtag') {
    void verkehrTagZeichnen()
  } else if (art === 'rueckblick') {
    void rueckblick(el)
  } else if (art === 'sonne') {
    const jetzt = new Date()
    el.innerHTML = `<div class="kopf"><b id="zl-titel"></b><span id="zl-sub"></span><button id="zl-jetzt" class="knopf">Jetzt</button></div>
      <input type="range" id="zl" min="4" max="22" step="0.25" value="${jetzt.getHours() + jetzt.getMinutes() / 60}">
      <div class="marken skala"><span>4 Uhr</span><span>8 Uhr</span><span>12 Uhr</span><span>16 Uhr</span><span>20 Uhr</span></div>`
    const r = $<HTMLInputElement>('#zl')
    r.addEventListener('input', schattenAktualisieren)
    $('#zl-jetzt').addEventListener('click', () => { const d = new Date(); r.value = String(d.getHours() + d.getMinutes() / 60); schattenAktualisieren() })
    schattenAktualisieren()
  }
}

// ================================================================ Rückblick: aufgezeichnete Live-Daten + Radar der Vergangenheit

type Messpunkt = { t: string; temp?: number; regen?: number; wind?: number; boeen?: number; wolken?: number; zustand?: string; warnungen: number; pegel: { name: string; wert?: number }[]; abfahrten: number; verspaetet: number; mittel: number }

const dez = (v: number | undefined, n = 1) => v == null ? '–' : v.toLocaleString('de-DE', { maximumFractionDigits: n })
async function rueckblick(el: HTMLElement) {
  const punkte: Messpunkt[] = await (await fetch('/api/aufzeichnung')).json().catch(() => [])
  if (zlArt !== 'rueckblick') return
  zeige('dop', false); zeige('basemap_grau', true); zeige('radar', true)
  // Radar und Pegel gelten für die ganze Stadt
  stadtgebiet(600)
  if (!punkte.length) {
    el.innerHTML = `<div class="kopf"><b>Noch keine Aufzeichnung</b><span>Der Server zeichnet alle 5 Minuten auf. Der Rückblick füllt sich, solange er läuft.</span></div>`
    return
  }
  const t0 = new Date(punkte[0].t), t1 = new Date(punkte[punkte.length - 1].t)
  const W = 720, H = 44
  const temps = punkte.map((p) => p.temp ?? NaN).filter((v) => !isNaN(v))
  const tmin = Math.min(...temps), tmax = Math.max(...temps)
  const x = (p: Messpunkt) => ((new Date(p.t).getTime() - t0.getTime()) / Math.max(1, t1.getTime() - t0.getTime())) * W
  const y = (v: number) => H - 4 - ((v - tmin) / Math.max(0.1, tmax - tmin)) * (H - 8)
  const linie = punkte.filter((p) => p.temp != null).map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.temp!).toFixed(1)}`).join('')
  const balken = punkte.filter((p) => (p.regen ?? 0) > 0).map((p) => `<rect x="${x(p).toFixed(1)}" y="${H - Math.min(H, p.regen! * 12)}" width="2" height="${Math.min(H, p.regen! * 12)}" fill="#005ca9"/>`).join('')
  el.innerHTML = `<div class="kopf"><b id="zl-titel"></b><span id="zl-sub"></span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="kurve">${balken}<path d="${linie}" fill="none" stroke="#141416" stroke-width="1.5"/></svg>
    <input type="range" id="zl" min="0" max="${punkte.length - 1}" step="1" value="${punkte.length - 1}">
    <div class="marken skala"><span>${t0.toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span><span>${t1.toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>`
  const r = $<HTMLInputElement>('#zl'), radar = EBENEN.find((e) => e.id === 'radar')!
  const setzen = () => {
    if (zlArt !== 'rueckblick') return
    const p = punkte[Number(r.value)]
    const t = new Date(p.t)
    const t5 = new Date(Math.floor(t.getTime() / 300000) * 300000)
    if (Date.now() - t5.getTime() < 3 * 24 * 3600 * 1000) auffrischen(radar, `&TIME=${t5.toISOString().replace(/\.\d{3}Z$/, '.000Z')}`)
    $('#zl-titel').textContent = t.toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    $('#zl-sub').textContent = `${p.temp != null ? p.temp.toLocaleString('de-DE') + ' °C' : ''} · Regen ${(p.regen ?? 0).toLocaleString('de-DE')} mm · Wind ${Math.round(p.wind ?? 0)} km/h · ${p.warnungen ? p.warnungen + ' Warnungen' : 'keine Warnung'}`
    blatt('Rückblick', `<section><h3>Wetter</h3><dl class="fakten"><dt>Temperatur</dt><dd>${dez(p.temp)} °C</dd><dt>Regen (10 min)</dt><dd>${dez(p.regen ?? 0)} mm</dd><dt>Wind / Böen</dt><dd>${Math.round(p.wind ?? 0)} / ${Math.round(p.boeen ?? 0)} km/h</dd><dt>Bewölkung</dt><dd>${p.wolken ?? '–'} %</dd></dl></section>
      <section><h3>Pegel</h3><dl class="fakten">${p.pegel.map((g) => `<dt>${esc(pegelName(g.name))}</dt><dd>${g.wert != null ? g.wert.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m ü. NN' : '–'}</dd>`).join('')}</dl></section>
      <section><h3>Hamm Hbf</h3><dl class="fakten"><dt>Abfahrten</dt><dd>${p.abfahrten}</dd><dt>≥ 5 min verspätet</dt><dd>${p.verspaetet}</dd><dt>Mittlere Verspätung</dt><dd>${p.mittel.toFixed(1).replace('.', ',')} min</dd></dl></section>
      `)
  }
  r.addEventListener('input', setzen)
  setzen()
}

// ================================================================ 3D-Gebäude und Schatten (LoD2 NRW)

let gebaeude: GeoJSON.FeatureCollection | null = null
const himmelsrichtung = (g: number) => ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'][Math.round(g / 45) % 8]

function sonnenZeit() {
  const r = document.querySelector<HTMLInputElement>('#zl')
  const d = new Date()
  if (zlArt === 'sonne' && r) { const v = Number(r.value); d.setHours(Math.floor(v), Math.round((v % 1) * 60), 0, 0) }
  return d
}
function schattenAktualisieren() {
  const d = sonnenZeit()
  const { azimut, hoehe } = sonnenstand(d, HAMM.lat, HAMM.lon)
  if (zlArt === 'sonne' && document.querySelector('#zl-titel')) {
    $('#zl-titel').textContent = `${uhrzeit(d)} Uhr`
    $('#zl-sub').textContent = hoehe > 0 ? `Sonne ${Math.round((hoehe * 180) / Math.PI)}° hoch aus ${himmelsrichtung((azimut * 180) / Math.PI)}` : 'Sonne unter dem Horizont'
  }
  if (!gebaeude || !map.getSource('schatten')) return
  const b = map.getBounds()
  const fc = d3An && map.getZoom() >= 14 ? schatten(gebaeude, d, HAMM.lat, [b.getWest() - 0.005, b.getSouth() - 0.005, b.getEast() + 0.005, b.getNorth() + 0.005]) : { type: 'FeatureCollection' as const, features: [] }
  ;(map.getSource('schatten') as maplibregl.GeoJSONSource).setData(fc)
}

async function gebaeudeLaden() {
  gebaeude = await (await fetch('/daten/gebaeude.geojson')).json()
  geladen('gebaeude')
  map.addSource('gebaeude', { type: 'geojson', data: gebaeude!, attribution: '3D-Gebäude LoD2 © Geobasis NRW' })
  map.addSource('schatten', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: 'schatten', type: 'fill', source: 'schatten', layout: { visibility: 'none' }, paint: { 'fill-color': '#1b1d2a', 'fill-opacity': 0.3 } }, 'anker-raster')
  map.addLayer({ id: 'gebaeude-3d', type: 'fill-extrusion', source: 'gebaeude', minzoom: 13, layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'h'], 3, '#e9e4d8', 20, '#d6cfbf', 60, '#b9ae97'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.92 } }, 'anker-raster')
  map.on('moveend', () => { if (d3An) schattenAktualisieren() })
  if (d3An) d3(true)
}
function d3(ein: boolean) {
  if (map.getLayer('gebaeude-3d')) map.setLayoutProperty('gebaeude-3d', 'visibility', ein ? 'visible' : 'none')
  if (map.getLayer('schatten')) map.setLayoutProperty('schatten', 'visibility', ein ? 'visible' : 'none')
  if (ein) schattenAktualisieren()
}

// ================================================================ Seitenblatt rechts (Bus, Haltestelle, Ortsinfo)

let blattNr = 0
function blatt(titel: string, html: string, farbe = '') {
  const el = $('#blatt')
  el.dataset.nr = String(++blattNr)
  el.hidden = false
  el.innerHTML = `<header class="${farbe}"><h2>${titel}</h2><button class="zu" aria-label="Schließen">×</button></header><div class="inhalt">${html}</div>`
  el.querySelector('.zu')!.addEventListener('click', blattZu)
  return el.querySelector('.inhalt') as HTMLElement
}
function blattZu() {
  $('#blatt').hidden = true
  for (const q of ['route', 'zug-route']) (map.getSource(q) as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] })
}

function busZeigen(trip: number, versatz: number) {
  const f = fahrt(trip, versatz)
  if (!f) return
  const naechster = f.halte.findIndex((h) => !h.vorbei)
  const linie: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'LineString', coordinates: fahrtLinie(trip) }, properties: {} }
  const punkte = f.halte.map((h, i): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [h.lon, h.lat] }, properties: { name: h.name, vorbei: h.vorbei, naechster: i === naechster } }))
  ;(map.getSource('route') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [linie, ...punkte] })
  const inhalt = blatt(`<span class="liniennr">${esc(f.linie)}</span><span>${esc(f.ziel)}</span>`, `
    <p class="hinweis">${(() => { const v = verspaetungen().get(trip); return v == null ? 'Sollfahrplan, keine Echtzeit für diese Fahrt' : Math.abs(v) < 60 ? 'Echtzeit: pünktlich' : `Echtzeit: ${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) / 60)} min, die Zeiten unten sind Sollzeiten` })()}</p>
    <ol class="halte">${f.halte.map((h, i) => `<li class="${h.vorbei ? 'vorbei' : ''}${i === naechster ? ' naechster' : ''}" data-i="${i}"><time>${h.zeit}</time><span>${esc(h.name)}</span></li>`).join('')}</ol>`, 'blau')
  inhalt.querySelectorAll<HTMLLIElement>('.halte li').forEach((li) => li.addEventListener('click', () => { const h = f.halte[Number(li.dataset.i)]; map.flyTo({ center: [h.lon, h.lat], zoom: 16 }) }))
  inhalt.querySelector('.naechster')?.scrollIntoView({ block: 'center' })
  const b = new maplibregl.LngLatBounds()
  f.halte.forEach((h) => b.extend([h.lon, h.lat]))
  map.fitBounds(b, { padding: { top: 90, bottom: 60, left: 400, right: 420 }, maxZoom: 15, duration: 700 })
}

function halteZeigen(name: string, lat: number, lon: number) {
  const ab = abfahrten(lat, lon, new Date(), 14)
  blatt(`<span class="h-zeichen">H</span><span>${esc(name)}</span>`, `
    <p class="hinweis">Sollfahrplan</p>
    <ul class="abfahrten">${ab.liste.map((a) => `<li><time>${a.zeit}</time><span class="liniennr klein">${esc(a.linie)}</span><span>${esc(a.ziel)}</span></li>`).join('') || '<li>Keine Abfahrt in der nächsten Stunde</li>'}</ul>`)
}

// ---------------------------------------------------------------- Ortsinfo: alles zu einem Punkt

function utm32(lon: number, lat: number): [number, number] {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, lon0 = (9 * Math.PI) / 180
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2)
  const p = (lat * Math.PI) / 180, l = (lon * Math.PI) / 180
  const N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2), T = Math.tan(p) ** 2, C = ep2 * Math.cos(p) ** 2, A = Math.cos(p) * (l - lon0)
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * p - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * p) + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * p) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * p))
  return [k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000,
    k0 * (M + N * Math.tan(p) * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 + ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720))]
}

const ORTSINFO: { titel: string; ebene: string }[] = [
  { titel: 'Flurstück und Gebäude', ebene: 'alkis' },
  { titel: 'Bodenrichtwert', ebene: 'boris' },
  { titel: 'Solarpotenzial Dach', ebene: 'solar' },
  { titel: 'Hochwasser häufig', ebene: 'hw_haeufig' },
  { titel: 'Hochwasser (HQ100)', ebene: 'hochwasser' },
  { titel: 'Hochwasser extrem', ebene: 'hochwasser_ex' },
  { titel: 'Starkregen außergewöhnlich', ebene: 'sr_agw' },
  { titel: 'Starkregen extrem', ebene: 'sr_extrem' },
  { titel: 'Straßenlärm', ebene: 'laerm' },
  { titel: 'Denkmal', ebene: 'denkmal' },
  { titel: 'Bergbau', ebene: 'bergbau' },
  { titel: 'Geologie', ebene: 'geologie' },
]

function featureInfo(roh: string): [string, string][] {
  const text = /<html|<table|<body/i.test(roh) ? (new DOMParser().parseFromString(roh, 'text/html').body.innerText ?? '') : roh
  if (/ServiceException|LayerNotQueryable|no results|keine Ergebnisse/i.test(text)) return []
  const paare: [string, string][] = []
  for (const z of text.replace(/\r/g, '').split('\n')) {
    const m = z.match(/^\s*([^=:]{2,60}?)\s*[=:]\s*'?(.*?)'?\s*$/)
    if (!m) continue
    const k = m[1].trim(), v = m[2]
    if (!v || /^(null|none|-)$/i.test(v) || /^(gml_|ogc_|id$|fid$|objectid|shape|geom|the_geom|bbox|layer|feature)/i.test(k)) continue
    paare.push([k.replace(/_/g, ' '), v])
  }
  return paare.slice(0, 12)
}

async function ortsinfo(ll: maplibregl.LngLat, name?: string) {
  const [e, n] = utm32(ll.lng, ll.lat)
  const inhalt = blatt(esc(name ?? 'Ortsinfo'), `<div id="oi"></div><p class="lade">Wird zusammengestellt …</p>
    <section><h3>Lage</h3><dl class="fakten"><dt>Koordinaten</dt><dd>${ll.lat.toFixed(5).replace('.', ',')}° N, ${ll.lng.toFixed(5).replace('.', ',')}° O</dd><dt>UTM 32</dt><dd>${Math.round(e).toLocaleString('de-DE')} / ${Math.round(n).toLocaleString('de-DE')}</dd></dl></section>`)
  const oi = inhalt.querySelector('#oi')!
  const nr = blattNr
  const nochAktuell = () => $('#blatt').dataset.nr === String(nr)
  const abschnitt = (t: string, html: string) => oi.insertAdjacentHTML('beforeend', `<section><h3>${t}</h3>${html}</section>`)
  let muellDa = false
  const muell = (strasse: string, hnr: string) => {
    if (muellDa || !nochAktuell()) return
    muellDa = true
    oi.insertAdjacentHTML('beforeend', `<section class="muell"><h3>Müllabfuhr ${esc(strasse)} ${esc(hnr)}</h3><div class="muell-inhalt"><button class="knopf" data-muell>Abfuhrtermine anzeigen</button></div></section>`)
    const sec = oi.querySelector<HTMLElement>('section.muell')!
    sec.querySelector('[data-muell]')!.addEventListener('click', async () => {
      const ziel = sec.querySelector('.muell-inhalt')!
      ziel.innerHTML = '<p class="lade">Lädt …</p>'
      try {
        const e = await muellTermine(strasse, hnr)
        ziel.innerHTML = muellHtml(e)
      } catch (err) { ziel.innerHTML = `<p class="hinweis">ASH-Kalender gerade nicht erreichbar (${esc(String(err).slice(0, 80))}).</p>` }
    })
  }
  const adr = name?.match(/^(.*\D)\s+(\d+\s*[a-zA-Z]?)$/)
  if (adr) muell(adr[1].trim(), adr[2].replace(/\s+/g, ''))
  const m = (lon: number, lat: number) => [(lon * 20037508.34) / 180, (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * 20037508.34) / Math.PI]
  const [x, y] = m(ll.lng, ll.lat)
  const r = (40075016 / 2 ** (map.getZoom() + 8)) * 50
  const jobs: Promise<unknown>[] = [
    hole(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${ll.lat}&lon=${ll.lng}&zoom=18&addressdetails=1&accept-language=de`, 86400).then((d) => {
      const a = d.address ?? {}
      const z1 = [a.road ?? a.pedestrian ?? a.square, a.house_number].filter(Boolean).join(' ')
      const z2 = [a.postcode, a.city ?? a.town ?? 'Hamm'].filter(Boolean).join(' ')
      const teil = a.suburb ?? a.city_district ?? ''
      if (!nochAktuell()) return
      const h2 = document.querySelector('#blatt header h2')
      if (h2 && !name) h2.textContent = z1 || d.name || 'Ortsinfo'
      if (a.house_number && (a.road ?? a.pedestrian)) muell(a.road ?? a.pedestrian, String(a.house_number))
      oi.insertAdjacentHTML('afterbegin', `<section class="adresse"><p>${d.name && d.name !== a.road ? `<b>${esc(d.name)}</b><br>` : ''}${esc(z1)}<br>${esc(z2)}${teil ? ' · ' + esc(teil) : ''}</p></section>`)
    }).catch(() => {}),
    ...ORTSINFO.map(async (o) => {
      const eb = EBENEN.find((q) => q.id === o.ebene)
      if (!eb?.abfrage) return
      const url = `${eb.url}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=${eb.abfrage}&QUERY_LAYERS=${eb.abfrage}&STYLES=&CRS=EPSG:3857&BBOX=${x - r},${y - r},${x + r},${y + r}&WIDTH=101&HEIGHT=101&I=50&J=50&INFO_FORMAT=text/plain&FEATURE_COUNT=3`
      const paare = featureInfo(await hole(url, 86400, 'text').catch(() => ''))
      if (paare.length && nochAktuell()) abschnitt(o.titel, `<dl class="fakten">${paare.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`)
    }),
  ]
  await Promise.allSettled(jobs)
  if (!nochAktuell()) return
  inhalt.querySelector('.lade')?.remove()
  if (!oi.querySelector('section:not(.adresse)')) abschnitt('Fachdaten', '<p class="hinweis">Keine Angaben zu diesem Punkt.</p>')
}

// ================================================================ Suche: lokale Orte sofort, Adressen über Nominatim

type Treffer = { name: string; art: string; lon: number; lat: number; stadtteil?: string }
let lokaleSuche: ((q: string, n?: number) => Treffer[]) | null = null

function trefferZeigen(lokal: Treffer[], adressen: Treffer[]) {
  const liste = $('#treffer')
  const alle = [...lokal, ...adressen.filter((a) => !lokal.some((l) => l.name === a.name))].slice(0, 9)
  liste.hidden = !alle.length
  liste.innerHTML = alle.map((t, i) => `<li data-i="${i}"><b>${esc(t.name)}</b><span>${esc(t.art)}${t.stadtteil ? ' · ' + esc(t.stadtteil) : ''}</span></li>`).join('')
  liste.querySelectorAll<HTMLLIElement>('li').forEach((li) => li.addEventListener('mousedown', (ev) => {
    ev.preventDefault()
    const t = alle[Number(li.dataset.i)]
    liste.hidden = true
    $<HTMLInputElement>('#suche').value = t.name
    map.flyTo({ center: [t.lon, t.lat], zoom: /Stadtteil|Ortsteil/.test(t.art) ? 14 : /Straße/.test(t.art) ? 17 : 17.5 })
    void ortsinfo(new maplibregl.LngLat(t.lon, t.lat), t.name)
  }))
}

let suchTimer: number | undefined
let letzteLokal: Treffer[] = []
function suchen(q: string) {
  clearTimeout(suchTimer)
  if (q.length < 2) { $('#treffer').hidden = true; return }
  letzteLokal = lokaleSuche ? lokaleSuche(q, 6) : []
  trefferZeigen(letzteLokal, [])
  if (q.length < 3) return
  suchTimer = window.setTimeout(async () => {
    const d = await hole(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q + ', Hamm')}&viewbox=7.62,51.78,8.05,51.58&bounded=1&limit=5&addressdetails=1&accept-language=de`, 86400).catch(() => [])
    const adressen: Treffer[] = (d as any[]).map((t) => ({ name: [t.address?.road ?? t.name, t.address?.house_number].filter(Boolean).join(' ') || t.display_name.split(',')[0], art: 'Adresse', lon: Number(t.lon), lat: Number(t.lat), stadtteil: t.address?.suburb }))
    trefferZeigen(letzteLokal, adressen)
  }, 350)
}

// ================================================================ Live-Quellen laden

const ZAEHLER: Record<string, (e: Ergebnis) => string> = {
  warnungen: (e) => (e.zeilen.some((z) => z.stufe !== 'info') ? String(e.zeilen.length) : 'keine'),
  autobahn: (e) => String(e.punkte?.features.length ?? 0),
  blaulicht: (e) => String(e.zeilen.length),
  pegel: (e) => String(e.punkte?.features.length ?? 0),
  flug: (e) => String(e.punkte?.features.length ?? 0),
  luft: (e) => `${e.punkte?.features.length ?? 0} Sensoren`,
  abfahrten: () => 'live',
  lippewelle: (e) => String(e.zeilen.filter((z) => z.stufe !== 'info').length),
}

async function quelleLaden(q: Quelle) {
  if (!erlaubt(q.lizenz)) return
  try {
    const e = await q.laden()
    if (q.id === 'wetter') {
      const [kopf] = e.zeilen
      const [temp, ...art] = kopf.text.split(', ')
      $('#wetter').innerHTML = `<b>${esc(temp)}</b><span>${esc(art.join(', ').trim())}</span>`
      $('#wetter').title = e.zeilen.map((x) => `${x.text}${x.klein ? ' (' + x.klein + ')' : ''}`).join('\n')
    }
    if (q.id === 'warnungen') {
      const n = e.zeilen.filter((z) => z.stufe !== 'info').length
      const w = $('#warn')
      w.className = n ? 'chip alarm' : 'chip ok'
      w.textContent = n ? `${n} Warnung${n > 1 ? 'en' : ''}` : 'Keine Warnungen'
    }
    if (q.id === 'verkehrslage' && e.punkte) { verkehrFc = e.punkte; void achsenLaden().then(verkehrBald) }
    if (e.punkte) { liveQuelleAnlegen(q.id); (map.getSource(`live-${q.id}`) as maplibregl.GeoJSONSource).setData(e.punkte); liveSichtbar([...liveAn]) }
    karteRendern(q.id, e.zeilen, ZAEHLER[q.id]?.(e) ?? String(e.zeilen.filter((z) => z.stufe !== 'info').length || ''), q.lizenz)
  } catch (err) {
    // letzte gute Daten behalten und als veraltet kennzeichnen, statt die Liste zu leeren
    const vorher = cache.get(q.id)
    if (vorher?.abruf && !vorher.zeilen[0]?.text.startsWith('Quelle gerade nicht erreichbar')) karteRendern(q.id, vorher.zeilen, vorher.zaehler, q.lizenz, vorher.abruf, true)
    else karteRendern(q.id, [{ text: 'Quelle gerade nicht erreichbar', klein: String(err).slice(0, 100), stufe: 'alarm' }], '–', q.lizenz)
  }
}

async function busseStarten() {
  await fahrplanLaden()
  geladen('fahrplan')
  map.addSource('live-busse', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addSource('halte', { type: 'geojson', data: halteGeojson() })
  map.addLayer({ id: 'halte', type: 'symbol', source: 'halte', minzoom: 15, layout: { 'icon-image': 'haltestelle', visibility: 'none' } }, 'anker-live')
  map.addLayer({ id: 'bus-keil', type: 'symbol', source: 'live-busse', layout: { 'icon-image': 'keil', 'icon-rotate': ['get', 'kurs'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 1], visibility: 'none' } })
  map.addLayer({ id: 'bus-plakette', type: 'symbol', source: 'live-busse', layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.7, 16, 1], visibility: 'none' } })
  liveSichtbar([...liveAn])
  const zeichnen = () => {
    const { fc, anzahl, linien } = bussePositionen()
    ;(map.getSource('live-busse') as maplibregl.GeoJSONSource).setData(fc)
    const top = [...linien.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([l]) => l).join(', ')
    const es = busEchtzeitStand()
    const mitE = fc.features.filter((f) => f.properties!.versp != null)
    const spaet = mitE.filter((f) => f.properties!.versp >= 3).length
    karteRendern('busse', [
      { text: `${anzahl} Busse gerade unterwegs`, klein: `Linien ${top}` },
      ...(es ? [{ text: `${mitE.length} davon mit Echtzeit, ${spaet} mindestens 3 min verspätet`, klein: `Verspätungen von ${es.halte} Haltestellen, Stand ${uhrzeit(es.zeit)} Uhr; übrige Busse nach Sollzeit` }] : []),
    ], String(anzahl), 'GTFS Deutschland, gtfs.de (CC BY 4.0), Sollzeiten; Echtzeit Westfalenfahrplan (NWL)')
  }
  zeichnen()
  setInterval(zeichnen, 3000)
  // Echtzeit alle 90 s, danach sofort neu zeichnen
  // Echtzeit-Verspätungen (Westfalenfahrplan) nur mit Freigabe, sonst fahren die Busse nach Sollzeit
  if (privat.an) {
    const echtzeit = () => busEchtzeitLaden().then(zeichnen).catch(() => {})
    void echtzeit()
    setInterval(() => void echtzeit(), 90000)
  }
}

async function geojsonLaden(id: string, url: string, anpassen: (p: any) => void) {
  const fc = await (await fetch(url)).json()
  for (const f of fc.features) anpassen(f.properties)
  liveQuelleAnlegen(id)
  ;(map.getSource(`live-${id}`) as maplibregl.GeoJSONSource).setData(fc)
  liveSichtbar([...liveAn])
}

// ================================================================ Start

/** Zusätzliche Quellen aus weiteren Modulen (z. B. quellen-hamm.ts) */
const ZUSATZ: Quelle[] = [wetterbericht, stadtwetter, buspuenktlichkeit]

map.on('load', () => {
  geladen('karte')
  symboleRegistrieren(map)
  map.addLayer({ id: 'anker-raster', type: 'background', paint: { 'background-opacity': 0 } })
  for (const e of EBENEN) ebeneHinzufuegen(e)
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: 'route-linie', type: 'line', source: 'route', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round' }, paint: { 'line-color': '#005ca9', 'line-width': 5, 'line-opacity': 0.85 } })
  map.addLayer({ id: 'route-halte', type: 'circle', source: 'route', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': ['case', ['get', 'naechster'], 7, 4.5], 'circle-color': ['case', ['get', 'vorbei'], '#b8c4d4', '#ffffff'], 'circle-stroke-color': '#005ca9', 'circle-stroke-width': 2.5 } })
  map.addLayer({ id: 'anker-live', type: 'background', paint: { 'background-opacity': 0 } })
  liveQuelleAnlegen('flug', { 'icon-rotate': ['get', 'kurs'], 'icon-rotation-alignment': 'map' })
  void stadtbildStarten(map, 'anker-live').then(() => { LIVE_EBENEN.highlights = HIGHLIGHT_EBENEN; ebenenAnwenden() }).catch((e) => console.warn('Stadtbild', e))
  tankSymbole(map)
  luftSymbole(map)
  liveQuelleAnlegen('tankstellen', { 'symbol-sort-key': ['get', 'rang'], 'icon-allow-overlap': ['step', ['zoom'], false, 13, true], 'icon-padding': 1, 'icon-size': 1 })

  tabSetzen(TABS.find((t) => t.id === lies('tab', 'aktuell')) ?? TABS[0], false)
  if (tab.kamera?.ganz || tab.magazin) stadtgebiet()
  void gebaeudeLaden()
  void busseStarten()
  void zuegeStarten(map, { karteRendern, blatt, sichtbar: () => liveSichtbar([...liveAn]) })
  void geojsonLaden('bergbau', '/daten/osm-bergbau.geojson', (p) => { p.icon = 'schacht' })
  void geojsonLaden('blitzer', '/daten/osm-blitzer.geojson', (p) => { p.icon = 'blitzer'; const v = /maxspeed=(\d+)/.exec(p.sub ?? '')?.[1]; p.titel = `Blitzer (fest)${v ? ' · ' + v + ' km/h' : ''}` })
  const tankLaden = () => quelleLaden(tankstellen).then(() => { tankGeladen = true })
  void tankLaden()
  setInterval(() => void tankLaden(), tankstellen.takt * 1000)
  for (const q of [luft, vorhersage, lippe]) { void quelleLaden(q); setInterval(() => void quelleLaden(q), q.takt * 1000) }
  einrichtungenSymbole(map)
  void einrichtungenLaden().then((daten) => {
    for (const k of KATEGORIEN) {
      liveQuelleAnlegen(`ew_${k.id}`, { 'icon-allow-overlap': ['step', ['zoom'], false, 16, true], 'icon-padding': 1 })
      ;(map.getSource(`live-ew_${k.id}`) as maplibregl.GeoJSONSource).setData(daten[k.id])
    }
    liveSichtbar([...liveAn])
  }).catch((e) => console.warn('Wegweiser', e))
  for (const q of [notdienst, notaufnahmen]) { void quelleLaden(q); setInterval(() => void quelleLaden(q), q.takt * 1000) }
  energieSymbole(map)
  stadtwetterSymbole(map)
  void energieHamm().then(() => energieBald())
  for (const q of ENERGIE_QUELLEN) { void quelleLaden(q); setInterval(() => void quelleLaden(q), q.takt * 1000) }
  // Termine und Nachrichten stammen aus Quellen ohne offene Lizenz
  if (privat.an) {
    void kalenderLaden().then(() => { if (tab.kalender) panelZeichnen() })
    void magazinAuffrischen()
    setInterval(() => void magazinAuffrischen(), 600000)
  }
  void politikStarten().catch((e) => console.warn('Wahldaten', e))
  void geojsonLaden('ladesaeulen', '/daten/ladesaeulen.geojson', (p) => { p.icon = p.schnell ? 'lade-schnell' : 'lade' })
  void Promise.allSettled([...QUELLEN, ...ZUSATZ].slice(0, 6).map((q) => quelleLaden(q))).then(() => geladen('live'))
  for (const q of [...QUELLEN, ...ZUSATZ]) setInterval(() => void quelleLaden(q), q.takt * 1000)
  for (const q of [...QUELLEN, ...ZUSATZ].slice(6)) void quelleLaden(q)
  for (const e of EBENEN.filter((x) => x.auffrischen && x.id !== 'radar')) setInterval(() => { if (an.has(e.id)) auffrischen(e) }, e.auffrischen! * 1000)
  void import('./zusatz').then((m) => {
    for (const q of m.QUELLEN_ZUSATZ as Quelle[]) { void quelleLaden(q); setInterval(() => void quelleLaden(q), q.takt * 1000) }
    if (m.lokaleSuche) { lokaleSuche = m.lokaleSuche; void m.orteLaden?.() }
  }).catch(() => { /* Zusatzmodule noch nicht vorhanden */ })

  map.on('click', (ev) => {
    if (tab.magazin) { tabSetzen(TABS.find((t) => t.id === 'verkehr')!); return }
    const ebenen = Object.values(LIVE_EBENEN).flat().concat(['route-halte']).filter((l) => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none')
    const f = map.queryRenderedFeatures(ev.point, { layers: ebenen })[0]
    if (!f && tab.id === 'bevoelkerung' && map.queryRenderedFeatures(ev.point, { layers: BV_EBENEN.filter((l) => map.getLayer(l)) }).length) {
      const z = bevoelkerungZelleHtml(ev.lngLat.lng, ev.lngLat.lat)
      if (z) { blatt(z.titel, z.html); return }
    }
    if (!f) { if (tab.id === 'politik' && politikKlick(ev)) return; void ortsinfo(ev.lngLat); return }
    const p = f.properties as any
    const g = f.geometry as GeoJSON.Point
    if (ZUG_EBENEN.includes(f.layer.id)) zugZeigen(p.trip, p.versatz)
    else if (f.layer.id.startsWith('bus-')) busZeigen(p.trip, p.versatz)
    else if (f.layer.id === 'halte' || f.layer.id === 'route-halte') halteZeigen(p.name, g.coordinates[1], g.coordinates[0])
    else blatt(esc(p.titel ?? 'Meldung'), `<p>${esc(p.sub ?? '')}</p>${p.link ? `<p><a href="${esc(p.link)}" target="_blank" rel="noopener">Mehr dazu</a></p>` : ''}`)
  })
  map.on('mousemove', (ev) => {
    const ebenen = Object.values(LIVE_EBENEN).flat().filter((l) => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none')
    map.getCanvas().style.cursor = map.queryRenderedFeatures(ev.point, { layers: ebenen }).length ? 'pointer' : ''
  })
})

// ---------------- Navigation: Gruppen mit Menü (Desktop), Vollbild-Menü (Handy)
let offeneGruppe = ''
function navZeichnen() {
  const g = NAV_GRUPPEN.find((x) => x.tabs.includes(tab.id))
  $('#tabs').innerHTML = NAV_GRUPPEN.map((x) => `<div class="ng${x === g ? ' aktiv' : ''}${offeneGruppe === x.id ? ' offen' : ''}">
    <button class="ng-knopf" data-gruppe="${x.id}" aria-expanded="${offeneGruppe === x.id}">${x.name}<i class="ng-pfeil"></i></button>
    ${offeneGruppe === x.id ? `<div class="ng-menue">${x.tabs.map((id) => TABS.find((t) => t.id === id)!).map((t) => `<button data-tab="${t.id}" class="${t.id === tab.id ? 'an' : ''}"><b>${esc(t.name)}</b><small>${esc(TAB_INFO[t.id] ?? '')}</small></button>`).join('')}</div>` : ''}</div>`).join('')
  $('#tabs').querySelectorAll<HTMLButtonElement>('.ng-knopf').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); offeneGruppe = offeneGruppe === b.dataset.gruppe ? '' : b.dataset.gruppe!; navZeichnen() }))
  $('#tabs').querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => { offeneGruppe = ''; tabSetzen(TABS.find((t) => t.id === b.dataset.tab)!) }))
  $('#seitentitel').textContent = tab.name
  $('#menue').innerHTML = NAV_GRUPPEN.map((x) => `<section><h3>${x.name}</h3>${x.tabs.map((id) => TABS.find((t) => t.id === id)!).map((t) => `<button data-tab="${t.id}" class="${t.id === tab.id ? 'an' : ''}"><b>${esc(t.name)}</b><small>${esc(TAB_INFO[t.id] ?? '')}</small></button>`).join('')}</section>`).join('') + '<a class="menue-fuss" href="#quellen">Quellen, Lizenzen und rechtliche Hinweise</a>'
  $('#menue').querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => { menueAuf(false); tabSetzen(TABS.find((t) => t.id === b.dataset.tab)!) }))
}
function menueAuf(auf: boolean) { $('#menue').hidden = !auf; $('#menueknopf').setAttribute('aria-expanded', String(auf)); document.body.classList.toggle('menue-offen', auf) }
if (privat.an) radioStarten($('#radio')); else $('#radio').hidden = true
$('#menueknopf').addEventListener('click', () => menueAuf($('#menue').hidden === true))
document.addEventListener('click', () => { if (offeneGruppe) { offeneGruppe = ''; navZeichnen() } })
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { offeneGruppe = ''; navZeichnen(); menueAuf(false) } })
navZeichnen()
// Handy: Griff oben am Panel schaltet zwischen halber und großer Höhe
$('#panel').addEventListener('click', (ev) => {
  if (innerWidth > 760 || ev.target !== $('#panel') || (ev as MouseEvent).offsetY > 30) return
  document.body.classList.toggle('panel-gross')
})
const suchfeld = $<HTMLInputElement>('#suche')
suchfeld.addEventListener('input', () => suchen(suchfeld.value.trim()))
suchfeld.addEventListener('focus', () => { if (suchfeld.value.trim().length >= 2) suchen(suchfeld.value.trim()) })
suchfeld.addEventListener('blur', () => setTimeout(() => ($('#treffer').hidden = true), 150))
suchfeld.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ($('#treffer li') as HTMLElement | null)?.dispatchEvent(new MouseEvent('mousedown')) })
// Logo führt zur Startseite (Aktuell)
// Quellen und Lizenzen: Link im Kartenhinweis und im Kopf (#quellen)
const zuQuellen = () => { if (location.hash === '#quellen') { menueAuf(false); tabSetzen(TABS.find((t) => t.id === 'quellen')!); history.replaceState(null, '', location.pathname + location.search) } }
window.addEventListener('hashchange', zuQuellen)
setTimeout(zuQuellen, 0)
$('#marktplatz').addEventListener('click', () => { menueAuf(false); tabSetzen(TABS.find((t) => t.id === 'aktuell')!) })
const tick = () => ($('#uhr').textContent = new Date().toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))
tick()
setInterval(tick, 10000)

window.addEventListener('resize', () => { if (tab.kalender) panelZeichnen() })
;(window as any).hamLage = { map, an, tabSetzen, TABS }

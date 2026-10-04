/**
 * Stadtbild: Hamm hervorheben. Umland leicht ausgegraut, Stadtgrenze und die 7 Stadtbezirke (OSM, ODbL, daten/grenzen.py),
 * Namen der Bezirke und Stadtteile als Beschriftung, dazu die Sehenswürdigkeiten der Stadt mit kurzer Beschreibung.
 * Beschriftungen sind zur Laufzeit gezeichnete Bilder (keine Schriftserver nötig).
 */
import type maplibregl from 'maplibre-gl'
import type * as GeoJSON from 'geojson'

const PETROL = '#005468', GRUEN = '#95c11e'

/** Sehenswürdigkeiten: Lage aus OpenStreetMap, Text eigene Kurzbeschreibung. */
export const HIGHLIGHTS: { name: string; lon: number; lat: number; text: string }[] = [
  { name: 'Glaselefant', lon: 7.8826, lat: 51.6815, text: 'Begehbare Elefantenskulptur aus einer alten Kohlenwäsche, Wahrzeichen des Maximilianparks seit der Landesgartenschau 1984. Oben ein Palmengarten mit Blick über die Stadt.' },
  { name: 'Maximilianpark', lon: 7.8836, lat: 51.6839, text: 'Park auf dem Gelände der früheren Zeche Maximilian, mit Schmetterlingshaus, Spielflächen und Veranstaltungen.' },
  { name: 'Pauluskirche', lon: 7.8197, lat: 51.6814, text: 'Evangelische Stadtkirche am Marktplatz, im Kern aus dem 13. Jahrhundert, Mittelpunkt der 1226 gegründeten Stadt.' },
  { name: 'Marktplatz', lon: 7.8190, lat: 51.6812, text: 'Herz der Altstadt, Wochenmarkt und Ausgangspunkt der Stadtgeschichte: Hamm wurde 1226 von Graf Adolf I. von der Mark gegründet.' },
  { name: 'Sri-Kamadchi-Ampal-Tempel', lon: 7.9476, lat: 51.6885, text: 'Hindu-Tempel im Stil südindischer Tempelbauten in Uentrop, einer der größten seiner Art in Europa. Jährliches Tempelfest mit Zehntausenden Gästen.' },
  { name: 'Kurhaus Bad Hamm', lon: 7.8448, lat: 51.6903, text: 'Kurhaus im Kurpark, erinnert an die Zeit als Solbad im 19. Jahrhundert. Heute Theater und Veranstaltungen.' },
  { name: 'Gradierwerk', lon: 7.8395, lat: 51.6900, text: 'Gradierwerk im Kurpark, Erinnerung an die Solequellen von Bad Hamm.' },
  { name: 'Schloss Heessen', lon: 7.8466, lat: 51.6993, text: 'Wasserschloss an der Lippe, heute Landschulheim.' },
  { name: 'Schloss Oberwerries', lon: 7.8891, lat: 51.7043, text: 'Wasserschloss an der Lippe mit Park, heute Ort für Kultur und Bildung.' },
  { name: 'Zeche Radbod', lon: 7.7635, lat: 51.6875, text: 'Fördergerüste der früheren Zeche Radbod in Bockum-Hövel, Industriedenkmal und Ort des schweren Grubenunglücks von 1908.' },
  { name: 'Kissinger Höhe', lon: 7.7569, lat: 51.6592, text: 'Bergehalde mit Aussicht über Hamm und das Lippetal.' },
  { name: 'Lippepark', lon: 7.7488, lat: 51.6680, text: 'Landschaftspark auf früheren Zechen- und Kraftwerksflächen an der Lippe, mit Bikepark und Wegen am Wasser.' },
  { name: 'Gustav-Lübcke-Museum', lon: 7.8105, lat: 51.6769, text: 'Städtisches Museum für Kunst, Kulturgeschichte und eine bedeutende Ägypten-Sammlung.' },
  { name: 'Tierpark Hamm', lon: 7.8157, lat: 51.6625, text: 'Kleiner Tierpark im Süden der Innenstadt.' },
  { name: 'Waldbühne Heessen', lon: 7.8494, lat: 51.7120, text: 'Freilichtbühne im Wald, Sommertheater für Kinder und Erwachsene.' },
]

const SCHRIFT = '"Fira Sans", "Segoe UI", sans-serif'

/** Beschriftung: Bezirk groß in Petrol, Stadtteil klein grau, Sehenswürdigkeit als Schild Petrol mit grünem Fuß. */
function beschriftung(text: string, art: 'bezirk' | 'teil' | 'hl') {
  const PR = 2
  const font = art === 'bezirk' ? `600 15px ${SCHRIFT}` : art === 'teil' ? `500 12px ${SCHRIFT}` : `600 12px ${SCHRIFT}`
  const g0 = document.createElement('canvas').getContext('2d')!
  g0.font = font
  if (art === 'bezirk') g0.canvas.style.letterSpacing = g0.letterSpacing = '0.08em'
  const tw = Math.ceil(g0.measureText(art === 'bezirk' ? text.toUpperCase() : text).width)
  const w = art === 'hl' ? tw + 16 : tw + 10, h = art === 'bezirk' ? 22 : art === 'hl' ? 22 : 18
  const c = document.createElement('canvas')
  c.width = w * PR; c.height = h * PR
  const g = c.getContext('2d')!
  g.scale(PR, PR)
  g.font = font; g.textBaseline = 'middle'
  if (art === 'hl') {
    g.fillStyle = PETROL; g.fillRect(0, 0, w, h - 3)
    g.fillStyle = GRUEN; g.fillRect(0, h - 3, w, 3)
    g.fillStyle = '#ffffff'; g.fillText(text, 8, (h - 3) / 2 + 0.5)
  } else {
    const t = art === 'bezirk' ? text.toUpperCase() : text
    if (art === 'bezirk') g.letterSpacing = '0.08em'
    g.lineJoin = 'round'; g.lineWidth = 3.5; g.strokeStyle = 'rgba(255,255,255,0.92)'; g.strokeText(t, 4, h / 2 + 0.5)
    g.fillStyle = art === 'bezirk' ? PETROL : '#505050'; g.fillText(t, 4, h / 2 + 0.5)
  }
  return g.getImageData(0, 0, c.width, c.height)
}

export const STADTBILD_EBENEN = ['sb-umland', 'sb-stadtgrenze', 'sb-bezirksgrenzen', 'sb-bezirksnamen', 'sb-stadtteilnamen']
export const HIGHLIGHT_EBENEN = ['sb-highlights']

export async function stadtbildStarten(map: maplibregl.Map, unter: string) {
  map.on('styleimagemissing', (e) => {
    const m = /^name:(bezirk|teil|hl):(.+)$/.exec(e.id)
    if (m && !map.hasImage(e.id)) map.addImage(e.id, beschriftung(m[2], m[1] as 'bezirk' | 'teil' | 'hl'), { pixelRatio: 2 })
  })
  await document.fonts?.load(`600 15px "Fira Sans"`).catch(() => {})
  const [grenzen, umland, orte] = await Promise.all([
    fetch('/daten/grenzen.geojson').then((r) => r.json()) as Promise<GeoJSON.FeatureCollection>,
    fetch('/daten/umland.geojson').then((r) => r.json()) as Promise<GeoJSON.FeatureCollection>,
    fetch('/daten/orte.json').then((r) => r.json()).catch(() => null) as Promise<{ arten: string[]; orte: [string, number, number, number, number][] } | null>,
  ])
  const namen: GeoJSON.Feature[] = grenzen.features.filter((f) => f.properties!.ebene === 'bezirk').map((f) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [f.properties!.lon, f.properties!.lat] }, properties: { icon: `name:bezirk:${f.properties!.name}`, art: 'bezirk' },
  }))
  if (orte) {
    const ok = new Set(['Stadtteil', 'Ortsteil'].map((a) => orte.arten.indexOf(a)))
    for (const [name, a, lon, lat] of orte.orte) if (ok.has(a)) namen.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { icon: `name:teil:${name}`, art: 'teil' } })
  }
  map.addSource('sb-umland', { type: 'geojson', data: umland })
  map.addSource('sb-grenzen', { type: 'geojson', data: grenzen })
  map.addSource('sb-ortsnamen', { type: 'geojson', data: { type: 'FeatureCollection', features: namen } })
  map.addSource('sb-highlights', {
    type: 'geojson', data: {
      type: 'FeatureCollection', features: HIGHLIGHTS.map((h) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [h.lon, h.lat] }, properties: { icon: `name:hl:${h.name}`, titel: h.name, sub: h.text, link: `https://de.wikipedia.org/w/index.php?search=${encodeURIComponent(h.name + ' Hamm')}` } })),
    },
  })
  map.addLayer({ id: 'sb-umland', type: 'fill', source: 'sb-umland', paint: { 'fill-color': '#f2f2f2', 'fill-opacity': 0.55 } }, unter)
  map.addLayer({ id: 'sb-bezirksgrenzen', type: 'line', source: 'sb-grenzen', filter: ['==', ['get', 'ebene'], 'bezirk'], paint: { 'line-color': PETROL, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 2], 'line-dasharray': [3, 2], 'line-opacity': 0.55 } }, unter)
  map.addLayer({ id: 'sb-stadtgrenze', type: 'line', source: 'sb-grenzen', filter: ['==', ['get', 'ebene'], 'stadt'], paint: { 'line-color': PETROL, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2, 15, 4], 'line-opacity': 0.85 } })
  map.addLayer({ id: 'sb-bezirksnamen', type: 'symbol', source: 'sb-ortsnamen', filter: ['==', ['get', 'art'], 'bezirk'], maxzoom: 13, layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true } })
  map.addLayer({ id: 'sb-stadtteilnamen', type: 'symbol', source: 'sb-ortsnamen', filter: ['==', ['get', 'art'], 'teil'], minzoom: 12.5, maxzoom: 15.5, layout: { 'icon-image': ['get', 'icon'], 'icon-padding': 4 } })
  map.addLayer({ id: 'sb-highlights', type: 'symbol', source: 'sb-highlights', minzoom: 11, layout: { 'icon-image': ['get', 'icon'], 'icon-anchor': 'bottom', 'icon-padding': 2, visibility: 'none' } })
}

/** Stadtbild ein- oder ausblenden (im Tab Historisch stört die Abdunklung die alten Karten). */
export function stadtbildSichtbar(map: maplibregl.Map, an: boolean) {
  for (const l of STADTBILD_EBENEN) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', an ? 'visible' : 'none')
}

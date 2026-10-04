/** Kartensymbole, zur Laufzeit auf Canvas gezeichnet (keine Bilddateien, keine Schriftserver nötig). */
import type maplibregl from 'maplibre-gl'

const PR = 2 // Pixeldichte
const FARBE = { gelb: '#f0ca00', schwarz: '#141416', weiss: '#ffffff', blau: '#005ca9', rot: '#c4271b', gruen: '#1d7f3c', braun: '#6b4a2b', grau: '#5b5b5b' }
const SCHRIFT = '"Bahnschrift", "DIN 1451", "Arial Narrow", sans-serif'

function leinwand(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w * PR; c.height = h * PR
  const g = c.getContext('2d')!
  g.scale(PR, PR)
  return { c, g }
}
const bild = (c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height)

/** Bus-Plakette: Bussymbol und Liniennummer, Breite passt sich der Nummer an. */
export function busPlakette(linie: string, verspaetung = 0) {
  const g0 = document.createElement('canvas').getContext('2d')!
  g0.font = `700 12px ${SCHRIFT}`
  const tw = Math.ceil(g0.measureText(linie).width)
  const vt = verspaetung > 0 ? `+${verspaetung}` : ''
  const vw = vt ? Math.ceil(g0.measureText(vt).width) + 8 : 0
  const w = 22 + tw + 8, h = 20
  const { c, g } = leinwand(w + vw, h)
  g.fillStyle = FARBE.blau; g.fillRect(0, 0, w, h)
  g.strokeStyle = FARBE.weiss; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, w - 1.5, h - 1.5)
  // Bus von vorn
  g.fillStyle = FARBE.weiss
  g.fillRect(5, 4, 12, 10)
  g.fillStyle = FARBE.blau; g.fillRect(6.5, 5.5, 9, 4.5)
  g.fillStyle = FARBE.weiss; g.fillRect(6, 14, 3, 2.5); g.fillRect(13, 14, 3, 2.5)
  g.fillStyle = FARBE.weiss; g.font = `700 12px ${SCHRIFT}`; g.textBaseline = 'middle'
  g.fillText(linie, 22, h / 2 + 0.5)
  if (vt) {
    g.fillStyle = FARBE.gelb; g.fillRect(w, 0, vw, h)
    g.strokeStyle = FARBE.schwarz; g.lineWidth = 1; g.strokeRect(w + 0.5, 0.5, vw - 1, h - 1)
    g.fillStyle = FARBE.schwarz; g.fillText(vt, w + 4, h / 2 + 0.5)
  }
  return bild(c)
}

/**
 * Zug-Plakette im Stil der Bahn-Anzeiger (ohne Logo): rote Fläche, weiße Zugfront und Linie (RE6, RB69, ICE).
 * `verspaetung` in Minuten erscheint als gelbes Feld rechts daneben (ab 1 min).
 */
export function zugPlakette(linie: string, verspaetung = 0) {
  const g0 = document.createElement('canvas').getContext('2d')!
  g0.font = `700 12px ${SCHRIFT}`
  const tw = Math.ceil(g0.measureText(linie).width)
  const vt = verspaetung > 0 ? `+${verspaetung}` : ''
  const vw = vt ? Math.ceil(g0.measureText(vt).width) + 8 : 0
  const w = 22 + tw + 8, h = 20
  const { c, g } = leinwand(w + vw, h)
  g.fillStyle = FARBE.rot; g.fillRect(0, 0, w, h)
  g.strokeStyle = FARBE.weiss; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, w - 1.5, h - 1.5)
  // Zugfront: abgerundeter Kopf, Frontscheibe, zwei Lampen
  g.fillStyle = FARBE.weiss
  g.beginPath(); g.moveTo(5, 15); g.lineTo(5, 7); g.quadraticCurveTo(5, 3.5, 11, 3.5); g.quadraticCurveTo(17, 3.5, 17, 7); g.lineTo(17, 15); g.closePath(); g.fill()
  g.fillStyle = FARBE.rot; g.fillRect(7, 6, 8, 3.5); g.fillRect(7, 12, 1.8, 1.8); g.fillRect(13.2, 12, 1.8, 1.8)
  g.fillStyle = FARBE.weiss; g.fillRect(6, 16, 10, 1.5)
  g.font = `700 12px ${SCHRIFT}`; g.textBaseline = 'middle'
  g.fillText(linie, 22, h / 2 + 0.5)
  if (vt) {
    g.fillStyle = FARBE.gelb; g.fillRect(w, 0, vw, h)
    g.strokeStyle = FARBE.schwarz; g.lineWidth = 1; g.strokeRect(w + 0.5, 0.5, vw - 1, h - 1)
    g.fillStyle = FARBE.schwarz; g.fillText(vt, w + 4, h / 2 + 0.5)
  }
  return bild(c)
}

/** Kleiner Richtungskeil unter der Plakette (wird mit der Fahrtrichtung gedreht). */
function keil(farbe = FARBE.blau) {
  const { c, g } = leinwand(30, 30)
  g.fillStyle = farbe; g.strokeStyle = FARBE.weiss; g.lineWidth = 1.5
  g.beginPath(); g.moveTo(15, 1); g.lineTo(22, 12); g.lineTo(8, 12); g.closePath(); g.fill(); g.stroke()
  return bild(c)
}

function flugzeug() {
  const { c, g } = leinwand(28, 28)
  g.translate(14, 14)
  g.fillStyle = FARBE.schwarz; g.strokeStyle = FARBE.weiss; g.lineWidth = 1.5
  g.beginPath()
  g.moveTo(0, -12); g.lineTo(2, -4); g.lineTo(11, 2); g.lineTo(11, 4); g.lineTo(2, 1); g.lineTo(1.5, 8); g.lineTo(5, 11); g.lineTo(5, 12.5)
  g.lineTo(0, 11); g.lineTo(-5, 12.5); g.lineTo(-5, 11); g.lineTo(-1.5, 8); g.lineTo(-2, 1); g.lineTo(-11, 4); g.lineTo(-11, 2); g.lineTo(-2, -4); g.closePath()
  g.stroke(); g.fill()
  return bild(c)
}

/** Dreieckiges Gefahrzeichen nach StVO-Art mit Innenzeichen. */
function gefahr(innen: 'baustelle' | 'warnung' | 'sperrung' | 'stau' | 'unfall') {
  const { c, g } = leinwand(26, 24)
  if (innen === 'sperrung') {
    g.fillStyle = FARBE.weiss; g.strokeStyle = FARBE.rot; g.lineWidth = 3
    g.beginPath(); g.arc(13, 12, 10, 0, Math.PI * 2); g.fill(); g.stroke()
    return bild(c)
  }
  g.fillStyle = FARBE.weiss; g.strokeStyle = FARBE.rot; g.lineWidth = 2.5; g.lineJoin = 'miter'
  g.beginPath(); g.moveTo(13, 2); g.lineTo(24, 22); g.lineTo(2, 22); g.closePath(); g.fill(); g.stroke()
  g.fillStyle = FARBE.schwarz
  if (innen === 'warnung') { g.fillRect(12, 9, 2, 7); g.fillRect(12, 17.5, 2, 2) }
  else if (innen === 'stau') { g.fillRect(8, 9, 4, 3); g.fillRect(14, 9, 4, 3); g.fillRect(8, 15, 4, 3); g.fillRect(14, 15, 4, 3) }
  else if (innen === 'unfall') { g.save(); g.translate(13, 15); g.rotate(-0.5); g.fillRect(-5, -2, 7, 4); g.restore(); g.save(); g.translate(13, 15); g.rotate(0.6); g.fillRect(-1, -2, 7, 4); g.restore() }
  else { // Arbeiter mit Schaufel, vereinfacht
    g.beginPath(); g.arc(12, 9.5, 1.6, 0, Math.PI * 2); g.fill()
    g.fillRect(11, 11.5, 2.2, 5); g.fillRect(8, 18, 9, 1.6)
    g.save(); g.translate(14, 13); g.rotate(0.6); g.fillRect(0, -0.6, 5, 1.2); g.restore()
  }
  return bild(c)
}

function pegel() {
  const { c, g } = leinwand(22, 26)
  g.fillStyle = FARBE.weiss; g.fillRect(6, 1, 10, 24); g.strokeStyle = FARBE.blau; g.lineWidth = 1.5; g.strokeRect(6, 1, 10, 24)
  g.fillStyle = FARBE.blau
  for (let y = 3; y < 24; y += 4) g.fillRect(6, y, 5, 1.5)
  g.fillStyle = 'rgba(0,92,169,0.55)'; g.fillRect(6, 15, 10, 10)
  return bild(c)
}

/** Schlägel und Eisen, das Bergbauzeichen. */
function schacht() {
  const { c, g } = leinwand(26, 26)
  g.fillStyle = FARBE.weiss; g.strokeStyle = FARBE.braun; g.lineWidth = 2
  g.fillRect(1, 1, 24, 24); g.strokeRect(1, 1, 24, 24)
  g.strokeStyle = FARBE.schwarz; g.lineWidth = 2.2; g.lineCap = 'butt'
  g.beginPath(); g.moveTo(6, 20); g.lineTo(20, 6); g.moveTo(20, 20); g.lineTo(6, 6); g.stroke()
  g.fillStyle = FARBE.schwarz
  g.save(); g.translate(18.5, 7.5); g.rotate(-Math.PI / 4); g.fillRect(-4.5, -2, 9, 4); g.restore()
  g.save(); g.translate(7.5, 7.5); g.rotate(Math.PI / 4); g.beginPath(); g.moveTo(-5, -1.5); g.lineTo(4, -1.5); g.lineTo(6, 0); g.lineTo(4, 1.5); g.lineTo(-5, 1.5); g.closePath(); g.fill(); g.restore()
  return bild(c)
}

/** Haltestellenzeichen: gelber Kreis mit grünem H. */
function haltestelle() {
  const { c, g } = leinwand(18, 18)
  g.fillStyle = FARBE.gelb; g.strokeStyle = FARBE.gruen; g.lineWidth = 2
  g.beginPath(); g.arc(9, 9, 7.5, 0, Math.PI * 2); g.fill(); g.stroke()
  g.fillStyle = FARBE.gruen; g.font = `700 11px ${SCHRIFT}`; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText('H', 9, 9.5)
  return bild(c)
}

/** Blitzer: graue Säule mit Kameraauge, rot umrandet. */
function blitzer() {
  const { c, g } = leinwand(22, 26)
  g.fillStyle = FARBE.weiss; g.strokeStyle = FARBE.rot; g.lineWidth = 2
  g.fillRect(3, 1, 16, 24); g.strokeRect(3, 1, 16, 24)
  g.fillStyle = FARBE.schwarz; g.fillRect(6, 4, 10, 8)
  g.fillStyle = FARBE.weiss; g.beginPath(); g.arc(11, 8, 2.5, 0, Math.PI * 2); g.fill()
  g.fillStyle = FARBE.schwarz; g.font = `700 8px ${SCHRIFT}`; g.textAlign = 'center'; g.fillText('km/h', 11, 21)
  return bild(c)
}

/** Ladesäule: grünes Feld mit Stecker und Blitz; Schnelllader dunkler. */
function ladesaeule(schnell: boolean) {
  const { c, g } = leinwand(20, 20)
  g.fillStyle = schnell ? '#0e5a2a' : FARBE.gruen; g.fillRect(1, 1, 18, 18)
  g.strokeStyle = FARBE.weiss; g.lineWidth = 1.5; g.strokeRect(1.75, 1.75, 16.5, 16.5)
  g.fillStyle = FARBE.weiss
  g.beginPath(); g.moveTo(11.5, 3.5); g.lineTo(6, 11); g.lineTo(9.5, 11); g.lineTo(8.5, 16.5); g.lineTo(14, 9); g.lineTo(10.5, 9); g.closePath(); g.fill()
  return bild(c)
}

/** Ladesäule belegt oder gestört: graues Feld mit Blitz und rotem Balken unten. */
function ladesaeuleBelegt() {
  const { c, g } = leinwand(20, 20)
  g.fillStyle = FARBE.grau; g.fillRect(1, 1, 18, 18)
  g.strokeStyle = FARBE.weiss; g.lineWidth = 1.5; g.strokeRect(1.75, 1.75, 16.5, 16.5)
  g.fillStyle = FARBE.weiss
  g.beginPath(); g.moveTo(11.5, 3.5); g.lineTo(6, 11); g.lineTo(9.5, 11); g.lineTo(8.5, 16.5); g.lineTo(14, 9); g.lineTo(10.5, 9); g.closePath(); g.fill()
  g.fillStyle = FARBE.rot; g.fillRect(2.5, 15, 15, 2.5)
  return bild(c)
}

function punkt(farbe: string, rahmen = FARBE.weiss) {
  const { c, g } = leinwand(16, 16)
  g.fillStyle = farbe; g.strokeStyle = rahmen; g.lineWidth = 2
  g.beginPath(); g.arc(8, 8, 6, 0, Math.PI * 2); g.fill(); g.stroke()
  return bild(c)
}

/** Veranstaltung: Kalenderblatt in Hinweisblau mit weißem Blatt und zwei Ringen. */
function veranstaltung() {
  const { c, g } = leinwand(20, 20)
  g.fillStyle = FARBE.blau; g.fillRect(1, 2, 18, 17)
  g.strokeStyle = FARBE.weiss; g.lineWidth = 1.5; g.strokeRect(1.75, 2.75, 16.5, 15.5)
  g.fillStyle = FARBE.weiss; g.fillRect(4, 8, 12, 8)
  g.fillStyle = FARBE.blau; g.fillRect(5.5, 9.5, 3, 2.5); g.fillRect(11.5, 12.5, 3, 2.5)
  g.fillStyle = FARBE.weiss; g.fillRect(5, 0.5, 2, 4); g.fillRect(13, 0.5, 2, 4)
  return bild(c)
}

/** Parken: weißes P auf Hinweisblau (Zeichen 314), rechteckig; voll: rot. */
function parken(voll: boolean) {
  const { c, g } = leinwand(20, 20)
  g.fillStyle = voll ? FARBE.rot : FARBE.blau; g.fillRect(1, 1, 18, 18)
  g.strokeStyle = FARBE.weiss; g.lineWidth = 1.5; g.strokeRect(1.75, 1.75, 16.5, 16.5)
  g.fillStyle = FARBE.weiss; g.font = `700 14px ${SCHRIFT}`; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText('P', 10, 10.5)
  return bild(c)
}

export function symboleRegistrieren(map: maplibregl.Map) {
  const add = (id: string, img: ImageData) => { if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: PR }) }
  add('keil', keil())
  add('keil-zug', keil(FARBE.rot))
  add('flugzeug', flugzeug())
  add('baustelle', gefahr('baustelle'))
  add('warnung', gefahr('warnung'))
  add('sperrung', gefahr('sperrung'))
  add('stau', gefahr('stau'))
  add('unfall', gefahr('unfall'))
  add('pegel', pegel())
  add('schacht', schacht())
  add('haltestelle', haltestelle())
  add('blitzer', blitzer())
  add('blitzer-mobil', blitzer())
  add('lade', ladesaeule(false))
  add('lade-schnell', ladesaeule(true))
  add('lade-belegt', ladesaeuleBelegt())
  add('veranstaltung', veranstaltung())
  add('parken', parken(false))
  add('parken-voll', parken(true))
  add('punkt-rot', punkt(FARBE.rot))
  add('punkt-blau', punkt(FARBE.blau))
  add('punkt-braun', punkt(FARBE.braun))
  add('punkt-gruen', punkt(FARBE.gruen))
  // Busplaketten je Liniennummer bei Bedarf
  map.on('styleimagemissing', (e) => {
    // Busplaketten: „bus-3“ oder mit Verspätung „bus-3~4“
    if (e.id.startsWith('bus-')) { const [l, v] = e.id.slice(4).split('~'); add(e.id, busPlakette(l, Number(v ?? 0))) }
    // Zugplaketten: „zug-RE6“ oder mit Verspätung „zug-RE6~7“
    else if (e.id.startsWith('zug-')) { const [l, v] = e.id.slice(4).split('~'); add(e.id, zugPlakette(l, Number(v ?? 0))) }
  })
}

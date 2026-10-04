/** Sonnenstand (NOAA-Näherung) und Schattenwurf der LoD2-Gebäude als Polygone. */
import type * as GeoJSON from 'geojson'

const rad = Math.PI / 180

/** Azimut (rad, von Nord im Uhrzeigersinn) und Höhe (rad) der Sonne. */
export function sonnenstand(d: Date, lat: number, lon: number): { azimut: number; hoehe: number } {
  const jd = d.getTime() / 86400000 + 2440587.5
  const n = jd - 2451545.0
  const L = (280.46 + 0.9856474 * n) % 360
  const g = ((357.528 + 0.9856003 * n) % 360) * rad
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad
  const eps = (23.439 - 0.0000004 * n) * rad
  const dek = Math.asin(Math.sin(eps) * Math.sin(lambda))
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda))
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24
  const ha = ((gmst * 15 + lon) * rad - ra)
  const phi = lat * rad
  const hoehe = Math.asin(Math.sin(phi) * Math.sin(dek) + Math.cos(phi) * Math.cos(dek) * Math.cos(ha))
  const azimut = Math.atan2(-Math.sin(ha), Math.tan(dek) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha))
  return { azimut: (azimut + 2 * Math.PI) % (2 * Math.PI), hoehe }
}

type P = [number, number]

function huelle(pts: P[]): P[] {
  const s = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const kreuz = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: P[] = [], hi: P[] = []
  for (const p of s) { while (lo.length >= 2 && kreuz(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p) }
  for (const p of s.reverse()) { while (hi.length >= 2 && kreuz(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p) }
  return lo.slice(0, -1).concat(hi.slice(0, -1))
}

/**
 * Schatten je Gebäude: Hülle aus Grundriss und um die Schattenlänge verschobenem Grundriss.
 * Näherung (konvexe Hülle), für die Übersicht genau genug; Länge auf 300 m begrenzt.
 */
export function schatten(geb: GeoJSON.FeatureCollection, d: Date, lat: number, bbox?: [number, number, number, number]): GeoJSON.FeatureCollection {
  const { azimut, hoehe } = sonnenstand(d, lat, 7.82)
  if (hoehe <= 0.02) return { type: 'FeatureCollection', features: [] }
  const mProGradLat = 111320, mProGradLon = 111320 * Math.cos(lat * rad)
  const k = 1 / Math.tan(hoehe)
  // Schatten zeigt von der Sonne weg
  const dx = -Math.sin(azimut) / mProGradLon, dy = -Math.cos(azimut) / mProGradLat
  const out: GeoJSON.Feature[] = []
  for (const f of geb.features) {
    const ring = (f.geometry as GeoJSON.Polygon).coordinates[0] as P[]
    if (bbox) { const [x, y] = ring[0]; if (x < bbox[0] || x > bbox[2] || y < bbox[1] || y > bbox[3]) continue }
    const l = Math.min((f.properties as any).h * k, 300)
    const pts: P[] = []
    for (const [x, y] of ring) { pts.push([x, y]); pts.push([x + dx * l, y + dy * l]) }
    const h = huelle(pts)
    h.push(h[0])
    out.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [h] } })
  }
  return { type: 'FeatureCollection', features: out }
}

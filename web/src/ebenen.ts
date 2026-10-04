/** Ebenenkatalog. Jede Ebene ist ein offener Dienst ohne Anmeldung; Lizenz steht dabei und erscheint in der Namensnennung. */

export type Ebene = {
  id: string
  name: string
  gruppe: string
  typ: 'wms' | 'xyz'
  url: string
  layers?: string
  format?: string
  /** WMS-Version, Standard 1.3.0 */
  version?: string
  zusatz?: string
  /** Unveränderliche Karte: Kacheln lokal zwischenspeichern (/api/kachel) und 512 px groß anfordern */
  fest?: boolean
  /** Layer für GetFeatureInfo in der Akte (Klick auf die Karte) */
  abfrage?: string
  lizenz: string
  an?: boolean
  deckkraft?: number
  /** Ebene wird mit der Uhrzeit neu geladen (Sekunden) */
  auffrischen?: number
  hinweis?: string
  /** nicht im Ebenen-Panel (z. B. über die Zeitreise gesteuert) */
  versteckt?: boolean
}

const heute = () => {
  // GIBS hat das Tagesbild meist erst am Folgetag vollständig
  const d = new Date(Date.now() - 24 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

export const GRUPPEN = ['Grundkarte', 'Luftbild und Satellit', 'Historisch', 'Kataster und Vermessung', 'Gelände und Untergrund', 'Umwelt und Planung', 'Wetter'] as const

const GB = 'https://www.wms.nrw.de/geobasis/'
const UM = 'https://www.wms.nrw.de/umwelt/'
const DWD = 'https://maps.dwd.de/geoserver/dwd/wms'
const DWDL = '© Deutscher Wetterdienst (CC BY 4.0)'
const NRW = '© Geobasis NRW (dl-de/zero-2-0)'
const GIBS = (layer: string, lvl = 9, ext = 'jpg') => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${heute()}/GoogleMapsCompatible_Level${lvl}/{z}/{y}/{x}.${ext}`

/** Historische Luftbildjahrgänge mit Inhalt über Hamm (Recherche, wms_nw_hist_dop) */
export const LUFTBILD_JAHRE = [1954, 1975, 1983, 1989, 1996, 2001, 2005, 2009, 2012, 2015, 2018, 2021, 2023]

export const EBENEN: Ebene[] = [
  // Grundkarte
  { id: 'osm', name: 'OpenStreetMap', gruppe: 'Grundkarte', typ: 'xyz', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', lizenz: '© OpenStreetMap-Mitwirkende (ODbL)' },
  { id: 'basemap', name: 'basemap.de (BKG)', gruppe: 'Grundkarte', typ: 'xyz', url: 'https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png', lizenz: '© basemap.de / BKG (CC BY 4.0)' },
  { id: 'basemap_grau', name: 'basemap.de grau (BKG)', gruppe: 'Grundkarte', typ: 'xyz', url: 'https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_grau/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png', lizenz: '© basemap.de / BKG (CC BY 4.0)' },
  { id: 'topplus', name: 'TopPlusOpen (BKG)', gruppe: 'Grundkarte', typ: 'xyz', url: 'https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/{z}/{y}/{x}.png', lizenz: '© BKG (dl-de/by-2-0)' },
  { id: 'dtk', name: 'Topografische Karte NRW (DTK)', gruppe: 'Grundkarte', typ: 'wms', url: GB + 'wms_nw_dtk', layers: 'nw_dtk_col', lizenz: NRW },
  { id: 'abk', name: 'Amtliche Basiskarte (ABK, ab Zoom 16)', gruppe: 'Grundkarte', typ: 'wms', url: GB + 'wms_nw_abk', layers: 'nw_abk_col', lizenz: NRW },

  // Luftbild und Satellit
  { id: 'dop', name: 'Luftbild aktuell (Geobasis NRW)', gruppe: 'Luftbild und Satellit', typ: 'wms', url: GB + 'wms_nw_dop', layers: 'nw_dop_rgb', format: 'image/jpeg', lizenz: NRW, abfrage: 'nw_dop_utm_info' },
  { id: 'vdop', name: 'Luftbild neueste Befliegung (vorläufig)', gruppe: 'Luftbild und Satellit', typ: 'wms', url: GB + 'wms_nw_vdop', layers: 'nw_vdop_rgb', format: 'image/jpeg', lizenz: NRW },
  { id: 'cir', name: 'Infrarot-Luftbild (Vegetation rot)', gruppe: 'Luftbild und Satellit', typ: 'wms', url: GB + 'wms_nw_dop', layers: 'nw_dop_cir', format: 'image/jpeg', lizenz: NRW },
  { id: 'gibs', name: 'Satellit heute, MODIS (NASA)', gruppe: 'Luftbild und Satellit', typ: 'xyz', url: GIBS('MODIS_Terra_CorrectedReflectance_TrueColor'), lizenz: 'NASA EOSDIS GIBS (gemeinfrei)', hinweis: 'Tagesbild mit Wolken, 250 m, bis Zoom 9' },
  { id: 'viirs', name: 'Satellit heute, VIIRS (NASA)', gruppe: 'Luftbild und Satellit', typ: 'xyz', url: GIBS('VIIRS_NOAA20_CorrectedReflectance_TrueColor'), lizenz: 'NASA EOSDIS GIBS (gemeinfrei)' },
  { id: 'nacht', name: 'Nachtlichter (VIIRS, NASA)', gruppe: 'Luftbild und Satellit', typ: 'xyz', url: GIBS('VIIRS_SNPP_DayNightBand_At_Sensor_Radiance', 8, 'png'), lizenz: 'NASA EOSDIS GIBS (gemeinfrei)' },

  // Historisch: die Zeitreise steuert diese Ebenen
  { id: 'uraufnahme', name: 'Preußische Uraufnahme (1836–1850)', gruppe: 'Historisch', typ: 'wms', url: GB + 'wms_nw_uraufnahme', layers: 'nw_uraufnahme_rw', lizenz: NRW, fest: true, hinweis: 'ab Zoom 14' },
  { id: 'neuaufnahme', name: 'Preußische Neuaufnahme (1891–1912)', gruppe: 'Historisch', typ: 'wms', url: GB + 'wms_nw_neuaufnahme', layers: 'nw_neuaufnahme', lizenz: NRW, fest: true, hinweis: 'ab Zoom 12' },
  { id: 'tk25_1940', name: 'TK25 (1936–1945)', gruppe: 'Historisch', typ: 'wms', url: GB + 'wms_nw_tk25_1936-1945', layers: 'nw_tk25_1936-1945', lizenz: NRW, fest: true, hinweis: 'nur Zoom 15–18' },
  ...LUFTBILD_JAHRE.map((j): Ebene => ({ id: `hdop${j}`, name: `Luftbild ${j}`, gruppe: 'Historisch', typ: 'wms', url: GB + 'wms_nw_hist_dop', layers: `nw_hist_dop_${j}`, format: 'image/jpeg', lizenz: NRW, versteckt: true, fest: true })),

  // Kataster und Vermessung
  { id: 'alkis', name: 'Flurstücke, Gebäude, Hausnummern (ALKIS)', gruppe: 'Kataster und Vermessung', typ: 'wms', url: GB + 'wms_nw_alkis', layers: 'adv_alkis_flurstuecke,adv_alkis_gebaeude', abfrage: 'adv_alkis_flurstuecke,adv_alkis_gebaeude', lizenz: NRW, hinweis: 'ab Zoom 17' },
  { id: 'nutzung', name: 'Tatsächliche Nutzung (ALKIS)', gruppe: 'Kataster und Vermessung', typ: 'wms', url: GB + 'wms_nw_alkis', layers: 'adv_alkis_tatsaechliche_nutzung', abfrage: 'adv_alkis_tatsaechliche_nutzung', lizenz: NRW, deckkraft: 0.6 },
  { id: 'afis', name: 'Vermessungspunkte (AFIS)', gruppe: 'Kataster und Vermessung', typ: 'wms', url: GB + 'wms_nw_afis', layers: 'nw_afis_hfp,nw_afis_niv,nw_afis_sfp', abfrage: 'nw_afis_hfp,nw_afis_niv,nw_afis_sfp', lizenz: NRW },
  { id: 'boris', name: 'Bodenrichtwerte (BORIS NRW)', gruppe: 'Kataster und Vermessung', typ: 'wms', url: 'https://www.wms.nrw.de/boris/wms_nw_brw', layers: '17,18,20,21,14,15', abfrage: '17,20,14', lizenz: '© Gutachterausschüsse NRW (dl-de/zero-2-0)', hinweis: 'ab Zoom 13', deckkraft: 0.8 },
  { id: 'grenzen', name: 'Verwaltungsgrenzen', gruppe: 'Kataster und Vermessung', typ: 'wms', url: GB + 'wms_nw_dvg', layers: 'nw_dvg_gem,nw_dvg_krs', lizenz: NRW },

  // Gelände und Untergrund
  { id: 'relief', name: 'Relief (DGM-Schummerung)', gruppe: 'Gelände und Untergrund', typ: 'wms', url: GB + 'wms_nw_dgm-schummerung', layers: 'nw_dgm-schummerung_col', lizenz: NRW, deckkraft: 0.6 },
  { id: 'ndom', name: 'Objekthöhen Gebäude/Bäume (nDOM)', gruppe: 'Gelände und Untergrund', typ: 'wms', url: GB + 'wms_nw_ndom', layers: 'nw_ndom', lizenz: NRW, deckkraft: 0.7 },
  { id: 'bergbau', name: 'Bergbauberechtigungen Steinkohle', gruppe: 'Gelände und Untergrund', typ: 'wms', url: 'https://www.wms.nrw.de/wms/bebu', layers: '15,14', abfrage: '15,14', lizenz: '© Bezirksregierung Arnsberg (dl-de/by-2-0)', deckkraft: 0.5 },
  { id: 'geologie', name: 'Geologie GK100', gruppe: 'Gelände und Untergrund', typ: 'wms', url: 'https://www.wms.nrw.de/gd/wms_nw_inspire-gk100', layers: 'GE.GeologicUnit', abfrage: 'GE.GeologicUnit', lizenz: 'Geowissenschaftliche Daten © Geologischer Dienst NRW 2026 (dl-de/by-2-0)', deckkraft: 0.6 },

  // Umwelt und Planung
  { id: 'hochwasser', name: 'Hochwasser HQ100 Wassertiefen', gruppe: 'Umwelt und Planung', typ: 'wms', url: UM + 'HW_Gefahrenkarte', layers: 'Tiefen_Ueberflutungsgebiet_mw', abfrage: 'Tiefen_Ueberflutungsgebiet_mw', lizenz: '© MUNV NRW (dl-de/by-2-0)', deckkraft: 0.7 },
  { id: 'hochwasser_ex', name: 'Hochwasser extrem', gruppe: 'Umwelt und Planung', typ: 'wms', url: UM + 'HW_Gefahrenkarte', layers: 'Tiefen_Ueberflutungsgebiet_nw', abfrage: 'Tiefen_Ueberflutungsgebiet_nw', lizenz: '© MUNV NRW (dl-de/by-2-0)', deckkraft: 0.6 },
  { id: 'hw_haeufig', name: 'Hochwasser häufig', gruppe: 'Umwelt und Planung', typ: 'wms', url: UM + 'HW_Gefahrenkarte', layers: 'Tiefen_Ueberflutungsgebiet_hw', abfrage: 'Tiefen_Ueberflutungsgebiet_hw', lizenz: '© MUNV NRW (dl-de/by-2-0)', deckkraft: 0.7 },
  { id: 'hw_ohne_hw', name: 'Hochwasser häufig ohne Deiche', gruppe: 'Umwelt und Planung', typ: 'wms', url: UM + 'HW_Gefahrenkarte', layers: 'Grenzen_ueberflutete_Gebiete_ohne_technischen_Hochwasserschutz_hw', lizenz: '© MUNV NRW (dl-de/by-2-0)', deckkraft: 0.8, versteckt: true },
  { id: 'hw_ohne_mw', name: 'Hochwasser HQ100 ohne Deiche', gruppe: 'Umwelt und Planung', typ: 'wms', url: UM + 'HW_Gefahrenkarte', layers: 'Grenzen_ueberflutete_Gebiete_ohne_technischen_Hochwasserschutz_mw', lizenz: '© MUNV NRW (dl-de/by-2-0)', deckkraft: 0.8, versteckt: true },
  { id: 'hw_ohne_nw', name: 'Hochwasser extrem ohne Deiche', gruppe: 'Umwelt und Planung', typ: 'wms', url: UM + 'HW_Gefahrenkarte', layers: 'Grenzen_ueberflutete_Gebiete_ohne_technischen_Hochwasserschutz_nw', lizenz: '© MUNV NRW (dl-de/by-2-0)', deckkraft: 0.8, versteckt: true },
  { id: 'sr_agw', name: 'Starkregen außergewöhnlich (Wassertiefe)', gruppe: 'Umwelt und Planung', typ: 'wms', url: 'https://sgx.geodatenzentrum.de/wms_starkregen', layers: 'nw_tiefe_agw', abfrage: 'nw_tiefe_agw', lizenz: '© BKG, Hinweiskarte Starkregengefahren (dl-de/by-2-0)', deckkraft: 0.75 },
  { id: 'sr_extrem', name: 'Starkregen extrem (Wassertiefe)', gruppe: 'Umwelt und Planung', typ: 'wms', url: 'https://sgx.geodatenzentrum.de/wms_starkregen', layers: 'nw_tiefe_extrem', abfrage: 'nw_tiefe_extrem', lizenz: '© BKG, Hinweiskarte Starkregengefahren (dl-de/by-2-0)', deckkraft: 0.75 },
  { id: 'laerm', name: 'Straßenlärm 24 h (2022)', gruppe: 'Umwelt und Planung', typ: 'wms', url: UM + 'laerm_stufe4', layers: 'STR_DEN', abfrage: 'STR_DEN', lizenz: '© LANUK NRW (dl-de/by-2-0)', deckkraft: 0.6, hinweis: 'ab Zoom 13' },
  { id: 'laerm_bahn', name: 'Bahnlärm 24 h (2022)', gruppe: 'Umwelt und Planung', typ: 'wms', url: UM + 'laerm_stufe4', layers: 'SCB_DEN', abfrage: 'SCB_DEN', lizenz: '© LANUK NRW (dl-de/by-2-0)', deckkraft: 0.6 },
  { id: 'solar', name: 'Solarpotenzial Dächer', gruppe: 'Umwelt und Planung', typ: 'wms', url: UM + 'energieatlas', layers: 'sk_potentiale_photovoltaik_dachflaechen', abfrage: 'sk_potentiale_photovoltaik_dachflaechen', lizenz: '© LANUK NRW (dl-de/by-2-0)', hinweis: 'ab Zoom 17' },
  { id: 'denkmal', name: 'Denkmäler', gruppe: 'Umwelt und Planung', typ: 'wms', url: 'https://www.wms.nrw.de/wms/wms_nw_inspire-denkmal', layers: 'ProtectedSites_Cultural_Surface,ProtectedSites_Cultural_Line,ProtectedSites_Cultural_Point', abfrage: 'ProtectedSites_Cultural_Surface,ProtectedSites_Cultural_Point', lizenz: 'Denkmalbehörden NRW (Bedingungen offen, nur privat)' },

  // Wetter (live)
  { id: 'radar', name: 'Regenradar (DWD)', gruppe: 'Wetter', typ: 'wms', url: DWD, layers: 'dwd:Niederschlagsradar', lizenz: DWDL, deckkraft: 0.7, auffrischen: 300 },
  { id: 'blitze', name: 'Blitzdichte (DWD, 5 min)', gruppe: 'Wetter', typ: 'wms', url: DWD, layers: 'dwd:Blitzdichte', lizenz: DWDL, deckkraft: 0.8, auffrischen: 300 },
  { id: 'meteosat', name: 'Meteosat Wolken (DWD, 3 h)', gruppe: 'Wetter', typ: 'wms', url: DWD, layers: 'dwd:Satellite_meteosat_1km_euat_rgb_day_hrv_and_night_ir108_3h', lizenz: DWDL + ', EUMETSAT', deckkraft: 0.6, auffrischen: 1800 },
  { id: 'pollen', name: 'Pollenflug (DWD)', gruppe: 'Wetter', typ: 'wms', url: DWD, layers: 'dwd:Pollenflug', lizenz: DWDL, deckkraft: 0.5, auffrischen: 3600 },
  { id: 'warnungen', name: 'Unwetterwarnungen (DWD)', gruppe: 'Wetter', typ: 'wms', url: DWD, layers: 'dwd:Warnungen_Gemeinden', abfrage: 'dwd:Warnungen_Gemeinden', lizenz: DWDL, deckkraft: 0.5, auffrischen: 300 },
]

export function kachelUrl(e: Ebene, stempel = ''): string {
  if (e.typ === 'xyz') return e.url
  const v = e.version ?? '1.3.0'
  const crs = v === '1.3.0' ? 'CRS' : 'SRS'
  const fmt = e.format ?? 'image/png'
  const px = e.fest ? 512 : 256
  const basis = `${e.url}?SERVICE=WMS&VERSION=${v}&REQUEST=GetMap&LAYERS=${encodeURIComponent(e.layers ?? '')}&STYLES=&${crs}=EPSG:3857&WIDTH=${px}&HEIGHT=${px}&FORMAT=${encodeURIComponent(fmt)}&TRANSPARENT=true${e.zusatz ?? ''}`
  if (e.fest) return `/api/kachel?bbox={bbox-epsg-3857}&u=${encodeURIComponent(basis)}`
  return `${basis}&BBOX={bbox-epsg-3857}${stempel}`
}

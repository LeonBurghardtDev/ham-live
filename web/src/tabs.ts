/**
 * Tabs oben: je Tab eine Frage. Ein Tab legt Grundkarte, Ebenen, Live-Daten, Zeitleiste und die Karten im Panel fest.
 * Schnellschalter (Chips) blenden innerhalb eines Tabs einzelne Themen ein und aus.
 */

export type Zeitleiste = 'keine' | 'zeitreise' | 'radar' | 'sonne' | 'rueckblick' | 'verkehrtag'

export type Chip = { id: string; name: string; live?: string[]; ebenen?: string[]; an: boolean }

export type Tab = {
  id: string
  name: string
  grund: string
  ebenen: string[]
  chips: Chip[]
  /** Karten im Panel in dieser Reihenfolge (IDs der Quellen) */
  karten: string[]
  zeitleiste: Zeitleiste
  /** ganz: auf das ganze Stadtgebiet einpassen */
  kamera?: { zoom?: number; pitch?: number; mitte?: [number, number]; ganz?: boolean }
  /** Live-Ebenen, die immer an sind (ohne Schalter) */
  live?: string[]
  /** Tafel statt Panel: Kacheln links, kleine Lagekarte rechts */
  tafel?: boolean
  /** Magazin statt Karte (Tab Aktuell) */
  magazin?: boolean
  /** Energieseite statt Kacheln (Tab Energie) */
  energie?: boolean
  webcams?: boolean
  quellen?: boolean
  /** Kalender statt Karte (Tab Termine) */
  kalender?: boolean
  einleitung?: string
}

/** Navigation: fünf Gruppen, je Gruppe ein Menü */
export const NAV_GRUPPEN: { id: string; name: string; tabs: string[] }[] = [
  { id: 'jetzt', name: 'Jetzt', tabs: ['aktuell', 'termine', 'livebilder'] },
  { id: 'unterwegs', name: 'Unterwegs', tabs: ['verkehr', 'tanken'] },
  { id: 'stadt', name: 'Stadt', tabs: ['wegweiser', 'bevoelkerung', 'politik', 'energie'] },
  { id: 'umwelt', name: 'Umwelt', tabs: ['wetter', 'simulation'] },
  { id: 'karten', name: 'Karten', tabs: ['historisch', 'eigene'] },
]
/** Kurzbeschreibung im Menü */
export const TAB_INFO: Record<string, string> = {
  aktuell: 'Meldungen und Lage', termine: 'Veranstaltungskalender', livebilder: 'Webcams in und um Hamm', verkehr: 'Staus, Busse, Züge', tanken: 'Sprit und Ladesäulen',
  wegweiser: 'Notfall, Gesundheit, Bildung', bevoelkerung: 'Zensus 2022 im 100-m-Raster', politik: 'Wahlergebnisse', energie: 'Strom in Hamm', wetter: 'Radar, Luft, Warnungen',
  simulation: 'Hochwasser, Starkregen, Schatten', historisch: 'Karten seit 1840', eigene: 'Alle Ebenen frei wählbar',
}

export const TABS: Tab[] = [
  {
    id: 'aktuell', name: 'Aktuell', grund: 'basemap_grau', ebenen: [], zeitleiste: 'keine', tafel: true, magazin: true,
    chips: [],
    live: ['busse', 'zuege', 'lippewelle', 'baustellen'],
    karten: [],
  },
  {
    id: 'termine', name: 'Termine', grund: 'basemap', ebenen: [], zeitleiste: 'keine', tafel: true, kalender: true,
    chips: [],
    karten: [],
  },
  {
    id: 'verkehr', name: 'Verkehr', grund: 'basemap_grau', ebenen: [], zeitleiste: 'verkehrtag', kamera: { ganz: true, pitch: 0 },
    chips: [
      { id: 'lage', name: 'Verkehrslage', live: ['verkehrslage', 'staumeldungen', 'lippewelle'], an: true },
      { id: 'busse', name: 'Busse', live: ['busse'], an: true },
      { id: 'zuege', name: 'Züge', live: ['zuege'], an: true },
      { id: 'blitzer', name: 'Blitzer', live: ['blitzer', 'blitzer_woche'], an: true },
      { id: 'autobahn', name: 'Autobahn', live: ['autobahn'], an: true },
      { id: 'baustellen', name: 'Baustellen', live: ['baustellen', 'baustellen_nrw'], an: true },
      { id: 'parken', name: 'Parken', live: ['parken'], an: false },
      { id: 'laden', name: 'Ladesäulen', live: ['ladesaeulen', 'ladesaeulen_live'], an: false },
      { id: 'flug', name: 'Flugzeuge', live: ['flug'], an: false },
    ],
    karten: ['staumeldungen', 'verkehrslage', 'lippewelle', 'abfahrten', 'zuege', 'busse', 'buspuenktlichkeit', 'oepnv_stoerungen', 'blitzer_woche', 'baustellen_nrw', 'baustellen', 'autobahn', 'parken', 'ladesaeulen_live', 'flug'],
  },
  {
    id: 'tanken', name: 'Tanken und Laden', grund: 'basemap_grau', ebenen: [], zeitleiste: 'keine', kamera: { ganz: true, pitch: 0 },
    chips: [
      { id: 'sprit', name: 'Tankstellen', live: ['tankstellen'], an: true },
      { id: 'laden', name: 'Ladesäulen', live: ['ladesaeulen', 'ladesaeulen_live'], an: false },
    ],
    karten: ['tankstellen', 'ladesaeulen_live'],
  },
  {
    id: 'quellen', name: 'Quellen und Lizenzen', grund: 'basemap_grau', ebenen: [], zeitleiste: 'keine', tafel: true, quellen: true,
    chips: [],
    karten: [],
  },
  {
    id: 'livebilder', name: 'Live-Bilder', grund: 'basemap_grau', ebenen: [], zeitleiste: 'keine', tafel: true, webcams: true,
    chips: [],
    karten: [],
  },
  {
    id: 'energie', name: 'Energie', grund: 'basemap_grau', ebenen: [], zeitleiste: 'keine', tafel: true, energie: true,
    chips: [],
    karten: [],
  },
  {
    id: 'wegweiser', name: 'Einrichtungen', grund: 'basemap', ebenen: [], zeitleiste: 'keine', kamera: { ganz: true, pitch: 0 },
    chips: [
      { id: 'notfall', name: 'Notfall', live: ['ew_notfall', 'notdienst'], an: true },
      { id: 'gesundheit', name: 'Gesundheit', live: ['ew_gesundheit'], an: false },
      { id: 'bildung', name: 'Bildung', live: ['ew_bildung'], an: false },
      { id: 'alltag', name: 'Alltag', live: ['ew_alltag'], an: false },
      { id: 'sehenswert', name: 'Sehenswertes', live: ['highlights'], an: false },
    ],
    karten: ['notdienst', 'notaufnahmen'],
  },
  {
    id: 'wetter', name: 'Wetter', grund: 'basemap_grau', ebenen: [], zeitleiste: 'radar', kamera: { zoom: 10, pitch: 0 },
    chips: [
      { id: 'radar', name: 'Regenradar', ebenen: ['radar'], an: true },
      { id: 'temperaturen', name: 'Temperaturen', live: ['stadtwetter'], an: true },
      { id: 'warnungen', name: 'Warnungen', ebenen: ['warnungen'], an: true },
      { id: 'blitze', name: 'Blitze', ebenen: ['blitze'], an: false },
      { id: 'wolken', name: 'Wolken (Meteosat)', ebenen: ['meteosat'], an: false },
      { id: 'satellit', name: 'Satellit heute', ebenen: ['gibs'], an: false },
      { id: 'luft', name: 'Luft', live: ['luft'], an: true },
      { id: 'pollen', name: 'Pollen', ebenen: ['pollen'], an: false },
    ],
    karten: ['warnungen', 'luft', 'pegel'],
  },
  {
    id: 'bevoelkerung', name: 'Bevölkerung', grund: 'basemap_grau', ebenen: [], zeitleiste: 'keine', kamera: { ganz: true, pitch: 0 },
    chips: [],
    karten: [],
  },
  {
    id: 'politik', name: 'Politik', grund: 'basemap_grau', ebenen: [], zeitleiste: 'keine', kamera: { ganz: true, pitch: 0 },
    chips: [],
    karten: [],
  },
  {
    id: 'simulation', name: 'Simulation', grund: 'basemap_grau', ebenen: [], zeitleiste: 'keine', kamera: { ganz: true, pitch: 0 },
    chips: [],
    karten: ['lippe', 'pegel'],
  },
  {
    id: 'historisch', name: 'Historisch', grund: 'dop', ebenen: [], zeitleiste: 'zeitreise', kamera: { zoom: 15, pitch: 0 },
    chips: [],
    karten: [],
  },
  {
    id: 'eigene', name: 'Eigene Karte', grund: 'basemap', ebenen: [], zeitleiste: 'keine', kamera: { ganz: true, pitch: 0 },
    chips: [],
    karten: [],
  },
]

/** Grundkarten zur Auswahl im Tab „Eigene Karte“. */
export const GRUNDKARTEN = [
  { id: 'basemap', name: 'Stadtplan' },
  { id: 'basemap_grau', name: 'Stadtplan grau' },
  { id: 'dop', name: 'Luftbild' },
  { id: 'topplus', name: 'Topografie' },
  { id: 'relief', name: 'Relief' },
  { id: 'osm', name: 'OpenStreetMap' },
]

/** Fertige Zusammenstellungen im Tab „Eigene Karte“. */
export const VORLAGEN = [
  { id: 'grundstueck', name: 'Grundstück', grund: 'dop', ebenen: ['alkis', 'boris'], zoom: 18 },
  { id: 'umwelt', name: 'Hochwasser und Lärm', grund: 'basemap_grau', ebenen: ['hochwasser', 'laerm'], zoom: 13 },
  { id: 'untergrund', name: 'Bergbau und Geologie', grund: 'relief', ebenen: ['bergbau', 'geologie'], zoom: 12, live: ['bergbau'] },
  { id: 'solar', name: 'Solarpotenzial', grund: 'dop', ebenen: ['solar'], zoom: 17 },
]

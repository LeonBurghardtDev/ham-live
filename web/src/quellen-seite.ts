/**
 * Seite „Quellen und Lizenzen“: rechtliche Hinweise, alle Live-Quellen mit letztem Abruf, alle erzeugten Datensätze
 * mit Stand (/api/datenstand), alle Kartenebenen, Nachrichten, Radio, Webcams und verwendete Software.
 * Erreichbar über den Link im Kartenhinweis (#quellen) und im Kopf; nicht in der Navigation.
 */
import { EBENEN } from './ebenen'
import { WEBCAMS } from './webcams'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const zeit = (d: Date) => d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const tag = (s: string) => { const d = new Date(s); return isNaN(+d) ? s : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) }

export type LiveEintrag = { name: string; lizenz: string; abruf?: Date; alt?: boolean }
export type Datenstand = { datei: string; bytes: number; geaendert: string; quelle?: string; lizenz?: string; stand?: string; abruf?: string; erzeugt?: string }

/** Beschreibung der erzeugten Datensätze (daten/*.py); Lizenz, falls die Datei sie nicht selbst nennt */
const DATENSAETZE: Record<string, { name: string; lizenz: string }> = {
  'adressen.json': { name: 'Adressen (Ortssuche)', lizenz: 'Geobasis NRW, Gebäudereferenzen (dl-de/zero-2-0)' },
  'buswege.json': { name: 'Buswege zwischen den Halten', lizenz: '© OpenStreetMap-Mitwirkende (ODbL), GTFS Deutschland (CC BY 4.0)' },
  'einrichtungen.geojson': { name: 'Einrichtungen (Gesundheit, Bildung, Alltag)', lizenz: '© OpenStreetMap-Mitwirkende (ODbL), Stadt Hamm (dl-de/by-2-0)' },
  'energie-hamm.json': { name: 'Stromanlagen in Hamm', lizenz: 'Marktstammdatenregister der Bundesnetzagentur (dl-de/by-2-0)' },
  'fahrplan.json': { name: 'Busfahrplan', lizenz: 'GTFS Deutschland, gtfs.de (CC BY 4.0)' },
  'gebaeude.geojson': { name: 'Gebäude in 3D (LoD2)', lizenz: 'Geobasis NRW, 3D-Gebäudemodell LoD2 (dl-de/zero-2-0)' },
  'grenzen.geojson': { name: 'Stadtgrenze und Stadtbezirke', lizenz: '© OpenStreetMap-Mitwirkende (ODbL)' },
  'ladesaeulen.geojson': { name: 'Ladesäulen', lizenz: 'Ladesäulenregister der Bundesnetzagentur (CC BY 4.0)' },
  'orte.json': { name: 'Ortssuche: Orte, Straßen, Haltestellen', lizenz: '© OpenStreetMap-Mitwirkende (ODbL)' },
  'osm-bergbau.geojson': { name: 'Bergbau-Spuren', lizenz: '© OpenStreetMap-Mitwirkende (ODbL)' },
  'osm-blitzer.geojson': { name: 'Feste Blitzer', lizenz: '© OpenStreetMap-Mitwirkende (ODbL)' },
  'osm-denkmal.geojson': { name: 'Denkmäler und Sehenswertes', lizenz: '© OpenStreetMap-Mitwirkende (ODbL)' },
  'osm-notfall.geojson': { name: 'Notfall-Einrichtungen', lizenz: '© OpenStreetMap-Mitwirkende (ODbL)' },
  'parken.geojson': { name: 'Parkhäuser und Parkplätze', lizenz: '© OpenStreetMap-Mitwirkende (ODbL)' },
  'strassen.json': { name: 'Straßenverläufe je Name', lizenz: '© OpenStreetMap-Mitwirkende (ODbL)' },
  'umland.geojson': { name: 'Nachbarorte', lizenz: '© OpenStreetMap-Mitwirkende (ODbL)' },
  'wahlen.json': { name: 'Wahlergebnisse je Bezirk', lizenz: 'Stadt Hamm (dl-de/by-2-0)' },
  'zensus.json': { name: 'Zensus 2022 im 100-m-Gitter', lizenz: 'Statistische Ämter des Bundes und der Länder (dl-de/by-2-0)' },
  'zuege.json': { name: 'Zugfahrplan und Gleiswege', lizenz: 'GTFS Deutschland (CC BY 4.0), © OpenStreetMap-Mitwirkende (ODbL)' },
}

/** Quellen, die nicht als Liste auf einer Kartenseite erscheinen */
const WEITERE: { bereich: string; name: string; lizenz: string; abruf: string }[] = [
  { bereich: 'Nachrichten', name: 'Westfälischer Anzeiger (wa.de), RSS', lizenz: 'nur Überschrift, Bild und Link zum Original, nur privat', abruf: 'alle 10 Minuten' },
  { bereich: 'Nachrichten', name: 'Polizei Dortmund/Hamm (presseportal.de), RSS', lizenz: 'nur Überschrift und Link zum Original, nur privat', abruf: 'alle 10 Minuten' },
  { bereich: 'Nachrichten', name: 'Stadt Hamm, Pressemitteilungen (presse-service.de), RSS', lizenz: 'nur Überschrift und Link zum Original, nur privat', abruf: 'alle 10 Minuten' },
  { bereich: 'Termine', name: 'Veranstaltungskalender der Stadt Hamm (veranstaltungen.hamm.de)', lizenz: 'Termine mit Link zum Original, nur privat', abruf: 'stündlich' },
  { bereich: 'Radio', name: 'Radio Lippe Welle Hamm, Livestream und aktueller Titel', lizenz: 'Stream nur abgespielt, nicht gespeichert, nur privat', abruf: 'Titel alle 30 Sekunden' },
  { bereich: 'Abfuhrtermine', name: 'ASH Hamm über Müllmax', lizenz: 'keine offene Lizenz, nur privat', abruf: 'bei Abfrage' },
  ...WEBCAMS.map((c) => ({ bereich: 'Live-Bilder', name: `${c.name} (${c.quelle})`, lizenz: c.lizenz, abruf: `alle ${c.intervall >= 60 ? Math.round(c.intervall / 60) + ' Minuten' : c.intervall + ' Sekunden'}` })),
]
const SOFTWARE: [string, string][] = [
  ['MapLibre GL JS', 'BSD-3-Clause'], ['Fira Sans', 'SIL Open Font License 1.1'], ['Poppins', 'SIL Open Font License 1.1'],
  ['Vite, TypeScript (nur zum Bauen)', 'MIT, Apache 2.0'], ['Node.js', 'MIT'],
]

export function quellenSeiteHtml(live: LiveEintrag[], daten: Datenstand[] | undefined, magazinStand?: Date): string {
  const liveSortiert = [...live].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const gruppen = [...new Set(EBENEN.map((e) => e.gruppe))]
  return `<div class="seite ql">
    <header class="ql-kopf"><p class="lbl">Rechtliches</p><h1>Quellen und Lizenzen</h1></header>

    <section class="box ql-hinweis">
      <h2>Rechtliche Hinweise</h2>
      <p>HAM:LIVE ist ein privates, nicht kommerzielles Projekt. Es führt öffentlich zugängliche Daten verschiedener Anbieter auf einer Karte zusammen. Alle Daten, Texte, Bilder und Streams gehören den jeweiligen Anbietern; deren Lizenzen und Nutzungsbedingungen gelten und sind unten je Quelle aufgeführt.</p>
      <p>HAM:LIVE ist nicht mit der Stadt Hamm, den genannten Behörden, Verkehrsunternehmen, Sendern oder Medien verbunden und wird von ihnen weder betrieben noch geprüft. Marken und Namen gehören ihren Inhabern.</p>
      <p>Keine Gewähr: Angaben können unvollständig, verspätet oder falsch sein. Schätzungen und abgeleitete Werte (zum Beispiel Stromverbrauch, Zeitverlust im Verkehr, Busposition nach Fahrplan) sind als solche gekennzeichnet. Verbindlich sind allein die Originalquellen. Bei Unwetter, Hochwasser und anderen Gefahren gelten die Warnungen der Behörden (NINA, DWD). Im Notfall: Notruf 112, Polizei 110.</p>
      <p>Quellen ohne offene Lizenz sind mit „nur privat“ gekennzeichnet. Sie werden nur zur privaten Ansicht abgerufen, nicht gespeichert oder weiterverbreitet; Nachrichten erscheinen nur als Überschrift mit Link zum Original.</p>
    </section>

    <section class="box">
      <h2>Live-Daten</h2>
      <p class="ql-text">Zeit des letzten Abrufs in dieser Sitzung. Quellen, die noch nicht geladen wurden, erscheinen nach dem ersten Abruf.</p>
      <table class="ql-tab"><thead><tr><th>Quelle</th><th>Lizenz und Bedingungen</th><th>Zuletzt abgerufen</th></tr></thead><tbody>
      ${liveSortiert.map((q) => `<tr><td>${esc(q.name)}</td><td>${esc(q.lizenz)}</td><td class="${q.alt ? 'ql-alt' : ''}">${q.abruf ? esc(zeit(q.abruf)) + (q.alt ? ', nicht erreichbar' : '') : '–'}</td></tr>`).join('')}
      </tbody></table>
    </section>

    <section class="box">
      <h2>Datensätze</h2>
      <p class="ql-text">Vorab aus offenen Quellen erzeugt (Skripte in daten/). „Stand“ ist das Datum des Abrufs bzw. der Erzeugung.</p>
      ${daten ? `<table class="ql-tab"><thead><tr><th>Datensatz</th><th>Quelle</th><th>Lizenz</th><th>Stand</th></tr></thead><tbody>
      ${daten.map((d) => { const b = DATENSAETZE[d.datei]; return `<tr><td>${esc(b?.name ?? d.datei)}</td><td>${esc(d.quelle ?? '–')}</td><td>${esc(d.lizenz ?? b?.lizenz ?? '–')}</td><td>${esc(tag(d.abruf ?? d.stand ?? d.erzeugt ?? d.geaendert))}</td></tr>` }).join('')}
      </tbody></table>` : '<p class="ql-text">Wird geladen …</p>'}
    </section>

    <section class="box">
      <h2>Weitere Quellen</h2>
      <table class="ql-tab"><thead><tr><th>Bereich</th><th>Quelle</th><th>Lizenz und Bedingungen</th><th>Abruf</th></tr></thead><tbody>
      ${WEITERE.map((w) => `<tr><td>${esc(w.bereich)}</td><td>${esc(w.name)}</td><td>${esc(w.lizenz)}</td><td>${esc(w.bereich === 'Nachrichten' && magazinStand ? zeit(magazinStand) : w.abruf)}</td></tr>`).join('')}
      </tbody></table>
    </section>

    <section class="box">
      <h2>Kartenebenen</h2>
      <p class="ql-text">Kartendienste werden beim Anzeigen direkt beim Anbieter abgerufen.</p>
      ${gruppen.map((g) => `<details class="ql-gruppe"><summary>${esc(g)}<span>${EBENEN.filter((e) => e.gruppe === g).length}</span></summary>
        <table class="ql-tab"><tbody>${EBENEN.filter((e) => e.gruppe === g).map((e) => `<tr><td>${esc(e.name)}</td><td>${esc(e.lizenz)}</td></tr>`).join('')}</tbody></table></details>`).join('')}
    </section>

    <section class="box">
      <h2>Software</h2>
      <table class="ql-tab"><tbody>${SOFTWARE.map(([n, l]) => `<tr><td>${esc(n)}</td><td>${esc(l)}</td></tr>`).join('')}</tbody></table>
    </section>
  </div>`
}

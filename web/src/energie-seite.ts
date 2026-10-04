/**
 * Tab „Energie“ mit rotem Faden (Entwurf designsystem.html, Bild 4):
 * Lagezeile → Stromfluss (woher → Hamm → wofür) → drei gleich gebaute Karten (heute, Solarausbau, in Haushalten).
 * Verbrauch von Hamm geschätzt aus der deutschen Netzlast (siehe ANNAHMEN). Großkraftwerke (Trianel, Gasturbinen)
 * speisen ins Übertragungsnetz; ihre Live-Leistung ist nicht offen und sie zählen nicht zur Versorgung von Hamm.
 */
import { FARBE, type EnergieDaten } from './energie'
import { lageHtml, type Kennzahl } from './magazin'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const zahl = (v: number, n = 0) => v.toLocaleString('de-DE', { maximumFractionDigits: n, minimumFractionDigits: n })
const uhr = (s: number) => new Date(s * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
const tagUhr = (s: number) => {
  const d = new Date(s * 1000)
  return (d.toDateString() === new Date().toDateString() ? '' : d.toLocaleDateString('de-DE', { weekday: 'short' }) + ' ') + uhr(s)
}
const prozent = (v: number) => `${zahl(v * 100, v < 0.1 ? 1 : 0)} %`

/** Annahmen der Verbrauchsschätzung, offen angezeigt */
export const ANNAHMEN = {
  einwohnerHamm: 178_789, // Zensus 2022, 100-m-Gitter innerhalb der Stadtgrenze
  einwohnerDe: 82_719_540, // Zensus 2022
  sektoren: [ // Anteile am deutschen Stromverbrauch (BDEW, gerundet) und Faktor für Hamm je Einwohner
    { name: 'Haushalte', anteil: 0.266, faktor: 1 },
    { name: 'Gewerbe, Handel, Dienste', anteil: 0.274, faktor: 1 },
    { name: 'Industrie', anteil: 0.436, faktor: 0.75 },
    { name: 'Verkehr', anteil: 0.024, faktor: 1.2 },
  ],
  pr: 0.8,
  dauerlauf: [
    { traeger: 'Abfall', name: 'Müllheizkraftwerk', auslastung: 0.8, farbe: '#6b5843' },
    { traeger: 'Biomasse', name: 'Biomasse', auslastung: 0.7, farbe: FARBE.biomasse },
    { traeger: 'Wasser', name: 'Wasserkraft', auslastung: 0.5, farbe: FARBE.wasser },
  ],
  haushaltKWhJahr: 3000,
}
export const hammAnteil = () => (ANNAHMEN.einwohnerHamm / ANNAHMEN.einwohnerDe) * ANNAHMEN.sektoren.reduce((a, s) => a + s.anteil * s.faktor, 0)

const NETZ_FARBE: Record<string, string> = { 'Wind an Land': FARBE.wind, 'Wind auf See': FARBE.windSee, Solar: '#d9b400', Biomasse: FARBE.biomasse, Wasser: FARBE.wasser, Braunkohle: FARBE.braunkohle, Steinkohle: FARBE.kohle, Erdgas: FARBE.gas, Importsaldo: FARBE.import, Sonstige: FARBE.sonstige }
type Anteil = { name: string; mw: number; farbe: string; hamm?: boolean }

export function energieSeiteHtml(d: EnergieDaten): string {
  const de = d.stromDe, h = d.hamm, s = d.solar, w = d.wind
  if (!de || !h) return '<p class="lade" style="padding:24px">Lädt …</p>'
  const faktor = hammAnteil()
  const lastHamm = de.lastMW * faktor
  // Erzeugung in Hamm jetzt
  const lokal: Anteil[] = []
  if (s) lokal.push({ name: 'Photovoltaik', mw: s.jetztMW, farbe: FARBE.solar, hamm: true })
  if (w) lokal.push({ name: 'Windenergie', mw: w.jetztMW, farbe: '#2f7f95', hamm: true })
  for (const x of ANNAHMEN.dauerlauf) {
    const kw = h.traeger[x.traeger]?.bruttoKW ?? 0
    if (kw > 0) lokal.push({ name: x.name, mw: (kw / 1000) * x.auslastung, farbe: x.farbe, hamm: true })
  }
  const lokalMW = Math.min(lastHamm, lokal.reduce((a, x) => a + x.mw, 0))
  const mix = Object.entries(de.jetztMW).filter(([n, v]) => v > 0 && n !== 'Pumpspeicher')
  const mixSumme = mix.reduce((a, [, v]) => a + v, 0)
  const rest = Math.max(0, lastHamm - lokalMW)
  const netz: Anteil[] = mix.map(([n, v]) => ({ name: n === 'Import (Saldo)' ? 'Importsaldo' : n, mw: (rest * v) / mixSumme, farbe: NETZ_FARBE[n === 'Import (Saldo)' ? 'Importsaldo' : n] ?? FARBE.sonstige })).sort((x, y) => y.mw - x.mw)
  // kleine Netzanteile unter „Übrige“ zusammenfassen, damit „Woher“ lesbar bleibt
  const gross = netz.filter((x) => x.mw / lastHamm >= 0.04)
  const klein = netz.filter((x) => x.mw / lastHamm < 0.04)
  if (klein.length) gross.push({ name: 'Sonstige', mw: klein.reduce((a, x) => a + x.mw, 0), farbe: '#9aa1a6' })
  const lokalSichtbar = lokal.filter((x) => x.mw / lastHamm >= 0.005)
  // Heute: Verbrauch aus der Lastkurve, Erzeugung aus Solar-Stunden + Dauerläufern
  const schritt = de.verlauf.zeit.length > 1 ? de.verlauf.zeit[1] - de.verlauf.zeit[0] : 900
  const heuteVerbrauch = de.last.reduce<number>((a, v) => a + (v ?? 0) * faktor * (schritt / 3600), 0)
  const dauerMW = lokal.filter((x) => !x.name.startsWith('Photovoltaik') && !x.name.startsWith('Windenergie')).reduce((a, x) => a + x.mw, 0)
  const heuteLokal = (s?.heuteMWh ?? 0) + dauerMW * de.verlauf.zeit.length * (schritt / 3600)
  const stunden = new Map<number, { last: number[]; solar: number }>()
  de.verlauf.zeit.forEach((t, i) => { const v = de.last[i]; if (v == null) return; const g = Math.floor(t / 3600) * 3600; (stunden.get(g) ?? stunden.set(g, { last: [], solar: 0 }).get(g)!).last.push(v * faktor) })
  for (const x of s?.stunden ?? []) { const e = stunden.get(Math.floor(x.zeit / 3600) * 3600); if (e) e.solar = x.MW }
  const verlauf = [...stunden.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, last: v.last.reduce((a, b) => a + b, 0) / v.last.length, eigen: v.solar + dauerMW }))
  const maxV = Math.max(1, ...verlauf.map((x) => x.last))
  // Solarausbau: installierte Leistung der letzten 24 Monate, rückgerechnet aus dem Zubau
  const monate = h.solar.zubauMonate.slice(-24)
  const ausbau: { monat: string; mw: number }[] = []
  let mwJetzt = (h.traeger['Solar']?.bruttoKW ?? 0) / 1000
  for (let i = monate.length - 1; i >= 0; i--) { ausbau.unshift({ monat: monate[i].monat, mw: mwJetzt }); mwJetzt -= monate[i].kW / 1000 }
  const aMin = (ausbau[0]?.mw ?? 0) * 0.85, aMax = ausbau[ausbau.length - 1]?.mw ?? 1
  const zuwachs = ausbau.length ? (aMax - ausbau[0].mw) / Math.max(1, ausbau[0].mw) : 0
  const sektorSumme = ANNAHMEN.sektoren.reduce((a, x) => a + x.anteil * x.faktor, 0)

  // Lagezeile
  const a = d.ampel, p = d.preis
  const gruen = a?.folge.find((x) => x.signal === 'grün' && x.zeit > Date.now() / 1000)
  const guenstig = p ? p.kurve.zeit.map((t, i) => ({ t, v: p.kurve.reihen[0]?.werte[i] })).filter((x) => x.t > Date.now() / 1000 && x.v != null).sort((x, y) => x.v! - y.v!)[0] : undefined
  const lage: Kennzahl[] = [
    { name: 'Stromverbrauch', wert: `${zahl(lastHamm)} MW`, klein: `Schätzung · heute ${zahl(heuteVerbrauch)} MWh`, ampel: 'neutral' },
    { name: 'Eigenerzeugung', wert: prozent(lokalMW / lastHamm), klein: `${zahl(lokalMW, 1)} MW in Hamm erzeugt`, ampel: lokalMW / lastHamm >= 0.3 ? 'gut' : lokalMW / lastHamm >= 0.15 ? 'mittel' : 'schlecht' },
    ...(s ? [{ name: 'Photovoltaik Hamm', wert: `${zahl(s.jetztMW, 1)} MW`, klein: `heute ${zahl(s.heuteMWh)} MWh`, ampel: s.jetztMW > 10 ? 'gut' : 'neutral' } as Kennzahl] : []),
    ...(w ? [{ name: 'Windenergie Hamm', wert: `${zahl(w.jetztMW, 1)} MW`, klein: `Wind ${zahl(w.vNabe, 1)} m/s in Nabenhöhe`, ampel: w.jetztMW > 10 ? 'gut' : 'neutral' } as Kennzahl] : []),
    ...(a ? [{ name: 'Erneuerbare im Netz', wert: `${Math.round(a.anteil)} %`, klein: gruen ? `Stromampel grün ab ${tagUhr(gruen.zeit)}` : `Stromampel ${a.jetzt}`, ampel: a.jetzt === 'grün' ? 'gut' : a.jetzt === 'gelb' ? 'mittel' : 'schlecht' } as Kennzahl] : []),
    ...(p ? [{ name: 'Day-Ahead-Preis', wert: `${zahl(p.jetzt / 10, 1)} ct/kWh`, klein: guenstig ? `Tiefstwert ${tagUhr(guenstig.t)}` : 'ohne Steuern und Entgelte', ampel: p.jetzt / 10 > 20 ? 'mittel' : 'gut' } as Kennzahl] : []),
  ]
  const balken = (x: Anteil) => {
    const anteil = x.mw / lastHamm
    return `<div class="ef-balken"><i style="width:${Math.max(2, Math.min(100, anteil * 250)).toFixed(1)}%;background:${x.farbe};height:${Math.max(14, Math.min(34, 10 + anteil * 90)).toFixed(0)}px"></i><span>${esc(x.name)}</span><b>${prozent(anteil)}</b></div>`
  }

  return `<div class="seite energie">
    ${lageHtml(lage)}
    <div class="en-haupt">
      <section class="box ef">
        <div class="ef-woher"><p class="lbl">Herkunft</p>
          <p class="ef-gruppe">Erzeugung in Hamm</p>${lokalSichtbar.map(balken).join('')}
          <p class="ef-gruppe">Netzbezug, Strommix Deutschland</p>${gross.map(balken).join('')}</div>
        <div class="ef-mitte"><p class="lbl">Stromverbrauch Hamm, Schätzung</p>
          <div class="ef-zahl">${zahl(lastHamm)}<span> MW</span></div>
          <p>Stand ${uhr(de.stand)} Uhr · heute bisher ${zahl(heuteVerbrauch)} MWh</p>
          <div class="ef-teilung"><span style="--f:var(--hamm-gruen)">Eigenerzeugung ${prozent(lokalMW / lastHamm)}</span><span style="--f:#9aa1a6">Netzbezug ${prozent(rest / lastHamm)}</span></div></div>
        <div class="ef-wofuer"><p class="lbl">Verbrauch nach Sektoren</p>
          ${ANNAHMEN.sektoren.map((x) => `<div class="zeile"><span>${esc(x.name)}</span><b>${prozent((x.anteil * x.faktor) / sektorSumme)}</b></div>`).join('')}
          <p class="ef-fuss">Sektoranteile nach BDEW, Industrieanteil für Hamm angepasst</p></div>
      </section>
      <div class="en-unten">
        <section class="box"><p class="lbl">Lastgang heute</p><h3>Verbrauch und Eigenerzeugung</h3>
          <div class="ev">${verlauf.map((x) => `<div title="${uhr(x.t)}: Verbrauch ${zahl(x.last)} MW, aus Hamm ${zahl(x.eigen, 1)} MW"><i class="ev-last" style="height:${((x.last / maxV) * 100).toFixed(0)}%"></i><i class="ev-eigen" style="height:${((Math.min(x.eigen, x.last) / maxV) * 100).toFixed(0)}%"></i></div>`).join('')}</div>
          <p class="ef-fuss">Fläche: Verbrauch · Grün: Eigenerzeugung · Eigenanteil heute ${prozent(Math.min(1, heuteLokal / Math.max(1, heuteVerbrauch)))}</p></section>
        <section class="box"><p class="lbl">Photovoltaik</p><h3>Installierte Leistung</h3>
          <div class="ev solar">${ausbau.map((x) => `<div title="${esc(x.monat)}: ${zahl(x.mw, 1)} MW"><i style="height:${(((x.mw - aMin) / Math.max(1, aMax - aMin)) * 100).toFixed(0)}%"></i></div>`).join('')}</div>
          <p class="ef-fuss">${zahl(aMax, 1)} MW · +${prozent(zuwachs)} seit ${esc(ausbau[0]?.monat ?? '')} · Ø ${zahl(monate.reduce((a, m) => a + m.anzahl, 0) / Math.max(1, monate.length))} Inbetriebnahmen je Monat</p></section>
        <section class="box"><p class="lbl">Kennwerte</p><h3>Bestand und Erzeugung</h3>
          <div class="zeile"><span>Photovoltaikanlagen</span><b>${zahl(h.traeger['Solar']?.anzahl ?? 0)}</b></div>
          ${h.solar.art['Balkonkraftwerk'] ? `<div class="zeile"><span>davon Steckersolargeräte</span><b>${zahl(h.solar.art['Balkonkraftwerk'].anzahl)}</b></div>` : ''}
          ${h.traeger['Wind'] ? `<div class="zeile"><span>Windenergieanlagen</span><b>${zahl(h.traeger['Wind'].anzahl)} · ${zahl(h.traeger['Wind'].bruttoKW / 1000, 1)} MW</b></div>` : ''}
          <div class="zeile"><span>Batteriespeicher</span><b>${zahl(h.speicher.anzahl)} · ${zahl(h.speicher.kW / 1000, 0)} MW</b></div>
          <div class="zeile"><span>Eigenerzeugung heute</span><b>${zahl(heuteLokal)} MWh</b></div>
          <details class="ef-annahmen"><summary>Methodik</summary>
            <p>Deutsche Netzlast (Energy-Charts) × Anteil Hamm ${zahl(faktor * 100, 3)} %: Einwohner ${zahl(ANNAHMEN.einwohnerHamm)} von ${zahl(ANNAHMEN.einwohnerDe / 1e6, 1)} Mio. (Zensus 2022), Sektoren nach BDEW, Industrie in Hamm × ${zahl(ANNAHMEN.sektoren[2].faktor, 2)}. Solar: installierte Leistung × Einstrahlung (DWD) × ${zahl(ANNAHMEN.pr, 1)}. Müllheizkraftwerk ${prozent(ANNAHMEN.dauerlauf[0].auslastung)}, Biomasse ${prozent(ANNAHMEN.dauerlauf[1].auslastung)} ausgelastet. Großkraftwerke speisen ins Übertragungsnetz und sind nicht berücksichtigt.</p></details></section>
      </div>
    </div>
    <p class="mz-quelle">Energy-Charts, Fraunhofer ISE (CC BY 4.0) · Bundesnetzagentur | SMARD.de (CC BY 4.0) · Marktstammdatenregister (dl-de/by-2-0) · Zensus 2022 (dl-de/by-2-0) · BDEW · DWD über Bright Sky (CC BY 4.0)</p>
  </div>`
}

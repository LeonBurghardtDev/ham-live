// UI-Prüfung (docs/ui-standards.md): jede Seite auf Desktop und Handy plus wichtige Zustände,
// Bilder nach web/.ui-pruefung/, Auffälligkeiten auf der Konsole. Entwicklungsserver muss laufen.
// Aufruf: npm run ui-pruefung [-- verkehr,wetter]
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const URL = process.env.HAM_URL ?? 'http://localhost:5300/'
const OUT = new globalThis.URL('../.ui-pruefung/', import.meta.url)
const nur = process.argv[2]?.split(',')
const TABS = ['aktuell', 'termine', 'livebilder', 'quellen', 'verkehr', 'tanken', 'energie', 'wegweiser', 'bevoelkerung', 'wetter', 'politik', 'simulation', 'historisch', 'eigene']
const GROESSEN = [['desktop', 1440, 900], ['handy', 390, 844]]
await mkdir(OUT, { recursive: true })
const bild = (n) => new globalThis.URL(`${n}.png`, OUT).pathname.replace(/^\/([A-Z]:)/, '$1')

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const klick = (p, sel) => p.evaluate((s) => document.querySelector(s)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), sel)
// Seiten ohne Menüeintrag (Quellen und Lizenzen) über den Anker
const tab = async (p, t) => { if (t === 'quellen') await p.evaluate(() => { location.hash = 'quellen' }); else await klick(p, `#menue [data-tab=${t}]`); await p.waitForTimeout(5000) }

/** Regeln aus den Standards, die sich messen lassen */
const befunde = () => {
  const r = []
  if (document.documentElement.scrollWidth > innerWidth + 1) r.push('horizontaler Überlauf der Seite')
  // Elemente in waagerechten Scrollleisten (Chips, Tagesleiste, Filter) dürfen rechts hinausragen
  const inScroller = (e) => { for (let x = e.parentElement; x; x = x.parentElement) { const o = getComputedStyle(x).overflowX; if (o === 'auto' || o === 'scroll') return true } return false }
  for (const e of document.querySelectorAll('#panel *, #tafel *, #kopf *, #ebenenleiste *, #zeitleiste *, #blatt *')) {
    const s = getComputedStyle(e)
    if (s.display === 'none' || s.visibility === 'hidden' || !e.offsetParent) continue
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 3)) continue
    const rc = e.getBoundingClientRect()
    const text = e.textContent.trim().slice(0, 30)
    if (rc.width > 0 && rc.width < 60 && e.textContent.trim().length > 12 && s.whiteSpace !== 'nowrap') r.push(`zu schmal (${Math.round(rc.width)} px): "${text}"`)
    if (rc.right > innerWidth + 1 && !inScroller(e)) r.push(`ragt rechts hinaus: "${text}"`)
    if (/\b[A-ZÄÖÜ]{7,}\b/.test(e.textContent.replace(/EUMETSAT|COPERNICUS/g, '')) && s.textTransform !== 'uppercase' && e.closest('#panel, #blatt')) r.push(`Großbuchstaben aus der Quelle: "${text}"`)
  }
  return [...new Set(r)].slice(0, 12)
}

let auffaellig = 0
for (const [g, w, h] of GROESSEN) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  const fehler = []
  p.on('pageerror', (e) => fehler.push(String(e)))
  await p.goto(URL)
  await p.waitForTimeout(14000)
  for (const t of TABS) {
    if (nur && !nur.includes(t)) continue
    await tab(p, t)
    const r = await p.evaluate(befunde)
    auffaellig += r.length
    console.log(`${g} ${t}: ${r.length ? '\n  ' + r.join('\n  ') : 'ok'}`)
    await p.screenshot({ path: bild(`${g}-${t}`) })
  }
  if (fehler.length) { auffaellig += fehler.length; console.log(`${g} Seitenfehler:`, fehler.slice(0, 5)) }
  await p.close()
}

// Zustände (nur Desktop): Menü, Panel ganz unten, Alle Meldungen, Rückblick
if (!nur) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  await p.goto(URL); await p.waitForTimeout(14000)
  await p.click('[data-gruppe=unterwegs]'); await p.waitForTimeout(400)
  await p.screenshot({ path: bild('zustand-menue'), clip: { x: 0, y: 0, width: 900, height: 360 } })
  await p.keyboard.press('Escape')
  for (const t of ['verkehr', 'wetter']) {
    await tab(p, t)
    await p.evaluate(() => { const e = document.getElementById('panel'); e.scrollTop = e.scrollHeight }); await p.waitForTimeout(400)
    await p.screenshot({ path: bild(`zustand-${t}-unten`) })
  }
  await tab(p, 'aktuell'); await klick(p, '.mz-mehr'); await p.waitForTimeout(800)
  await p.screenshot({ path: bild('zustand-alle-meldungen') })
  await tab(p, 'historisch'); await klick(p, '[data-m=rueckblick]'); await p.waitForTimeout(4000)
  await p.screenshot({ path: bild('zustand-rueckblick') })
  await p.close()
}
await b.close()
console.log(auffaellig ? `${auffaellig} Auffälligkeiten` : 'keine Auffälligkeiten', '· Bilder in web/.ui-pruefung/')

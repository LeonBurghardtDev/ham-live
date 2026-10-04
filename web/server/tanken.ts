/**
 * Tankerkönig (Spritpreise, CC BY 4.0) mit privatem Schlüssel aus HAM_TANKERKOENIG, local/tankerkoenig.json oder
 * web/local/tankerkoenig.json ({"key": "…"}, gitignored). Der Schlüssel bleibt auf dem Server, der Browser sieht nur /api/tanken.
 * Höchstens alle 5 Minuten eine Abfrage (Nutzungsbedingungen Tankerkönig); die Aufzeichnung nutzt denselben Speicher.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Konfig } from './konfig.ts'
import { json, type Handler } from './http.ts'

export type TankAntwort = { ok: boolean; fehlt?: boolean; fehler?: string; stand?: string; stationen?: any[] }

export function tankerkoenig(k: Konfig) {
  let hit: { t: number; daten: TankAntwort } | undefined
  const schluessel = async () => {
    if (process.env.HAM_TANKERKOENIG) return process.env.HAM_TANKERKOENIG.trim()
    for (const f of [join(k.local, 'tankerkoenig.json'), fileURLToPath(new URL('../local/tankerkoenig.json', import.meta.url))]) {
      try { const s = JSON.parse(await readFile(f, 'utf-8')).key; if (s) return String(s).trim() } catch { /* nächste Datei */ }
    }
    return ''
  }
  /** Preise aller Tankstellen im Umkreis von 15 km um den Marktplatz, höchstens alle 5 Minuten neu */
  const laden = async (): Promise<TankAntwort> => {
    if (hit && Date.now() - hit.t < 300000) return hit.daten
    const key = await schluessel()
    if (!key) return { ok: false, fehlt: true }
    try {
      const r = await fetch(`https://creativecommons.tankerkoenig.de/json/list.php?lat=51.6807&lng=7.8189&rad=15&sort=dist&type=all&apikey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(20000) })
      const d = await r.json()
      const daten: TankAntwort = { ok: !!d.ok, fehler: d.ok ? undefined : d.message, stand: new Date().toISOString(), stationen: d.stations ?? [] }
      if (d.ok) hit = { t: Date.now(), daten }
      return daten
    } catch (e) {
      return hit?.daten ?? { ok: false, fehler: String(e) }
    }
  }
  const handler: Handler = async (_req, res) => json(res, await laden())
  return { laden, handler }
}

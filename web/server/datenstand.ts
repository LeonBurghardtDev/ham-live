/**
 * /api/datenstand: alle erzeugten Datensätze (HAM_DATEN) mit Größe, Änderungszeit und den Angaben, die das
 * Datenskript selbst in die Datei schreibt (quelle, lizenz, stand, abruf, erzeugt). Für die Seite „Quellen und Lizenzen“.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import type { Konfig } from './konfig.ts'
import { json, type Handler } from './http.ts'

type Eintrag = { datei: string; bytes: number; geaendert: string; quelle?: string; lizenz?: string; stand?: string; abruf?: string; erzeugt?: string }

export function datenstandHandler(k: Konfig): Handler {
  // je Datei nur neu lesen, wenn sie sich geändert hat (große GeoJSON-Dateien)
  const merk = new Map<string, { t: number; e: Eintrag }>()
  return async (_req, res) => {
    const dateien = (await readdir(k.daten).catch(() => [] as string[])).filter((f) => /\.(geo)?json$/.test(f)).sort()
    const liste: Eintrag[] = []
    for (const f of dateien) {
      const s = await stat(k.daten + f).catch(() => undefined)
      if (!s?.isFile()) continue
      const alt = merk.get(f)
      if (alt && alt.t === s.mtimeMs) { liste.push(alt.e); continue }
      const e: Eintrag = { datei: f, bytes: s.size, geaendert: s.mtime.toISOString() }
      try {
        const d = JSON.parse(await readFile(k.daten + f, 'utf-8'))
        for (const key of ['quelle', 'lizenz', 'stand', 'abruf', 'erzeugt'] as const) if (typeof d?.[key] === 'string') e[key] = d[key]
      } catch { /* keine Angaben in der Datei */ }
      merk.set(f, { t: s.mtimeMs, e })
      liste.push(e)
    }
    json(res, liste)
  }
}

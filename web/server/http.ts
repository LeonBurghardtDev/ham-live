/** Gemeinsame Typen für die Schnittstellen: ein Handler bekommt Anfrage und Antwort wie bei node:http. */
import type { IncomingMessage, ServerResponse } from 'node:http'

export type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
export type Route = { pfad: string; handler: Handler }
export type Protokoll = { info: (s: string) => void; warn: (s: string) => void }

/** Suchparameter der Anfrage (der Pfad kann je nach Server mit oder ohne Präfix ankommen) */
export const parameter = (req: IncomingMessage) => new URL(req.url ?? '', 'http://x').searchParams

export function json(res: ServerResponse, daten: unknown, status = 200) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(typeof daten === 'string' ? daten : JSON.stringify(daten))
}

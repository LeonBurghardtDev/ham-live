import { defineConfig, type Plugin } from 'vite'
import { konfig } from './server/konfig.ts'
import { hamServer } from './server/routen.ts'

/**
 * Entwicklungsserver: dieselben Schnittstellen wie der Betriebsserver (server/start.ts), eingehängt als Middleware.
 * Aufzeichnung und Kachel-Vorladen laufen nur einmal je Prozess (Vite startet bei Konfigurationsänderungen im selben Prozess neu).
 */
function hamApi(): Plugin {
  return {
    name: 'ham-live-api',
    configureServer(server) {
      const log = { info: (s: string) => server.config.logger.info(s), warn: (s: string) => server.config.logger.warn(s) }
      const ham = hamServer(konfig(server.config.server.port ?? 5300), log)
      for (const r of ham.routen) server.middlewares.use(r.pfad, (req, res) => void Promise.resolve(r.handler(req, res)).catch((e) => { res.statusCode = 500; res.end(String(e)) }))
      ham.hintergrund()
    },
  }
}

export default defineConfig({
  plugins: [hamApi()],
  server: { port: 5300, strictPort: true },
})

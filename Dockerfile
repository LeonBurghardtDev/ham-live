# HAM:LIVE – Frontend bauen, dann schlanker Node-Server ohne Abhängigkeiten (server/start.ts).
# Daten, Aufzeichnung und private Dateien liegen außerhalb des Images (Volumes, siehe compose.yaml und docs/betrieb.md).

FROM node:24-alpine AS bau
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:24-alpine
RUN apk add --no-cache tzdata
ENV NODE_ENV=production \
    TZ=Europe/Berlin \
    PORT=8080 \
    HAM_DATEN=/data/daten \
    HAM_AUFZEICHNUNG=/data/aufzeichnung \
    HAM_LOCAL=/data/local
WORKDIR /app
COPY --from=bau /app/web/dist ./dist
COPY web/server ./server
# der Kachelspeicher liest den Ebenenkatalog des Frontends (nur Daten, keine weiteren Importe)
COPY web/src/ebenen.ts ./src/ebenen.ts
RUN mkdir -p /data/daten /data/aufzeichnung /data/local && chown -R node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/api/gesund >/dev/null || exit 1
CMD ["node", "server/start.ts"]

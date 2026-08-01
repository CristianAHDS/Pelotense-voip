# ============================================================
# VoIP Server — imagem de produção (backend + SQLite)
# O frontend vai para o Netlify; aqui roda apenas o servidor.
# ============================================================

# ---- Build (tsc) ----
# node:24 (igual ao ambiente local) — better-sqlite3@13 exige Node >= 22.
FROM node:24 AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
# `npm install` (em vez de `npm ci`): o lockfile não traz as entradas resolvidas
# das deps opcionais do better-sqlite3 (@emnapi/*) — o install resolve na hora.
RUN npm install --no-audit --no-fund
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---- Runtime ----
FROM node:24-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
ENV NODE_ENV=production
COPY --from=build /app/server/package.json /app/server/package-lock.json ./
# node_modules já compilado (evita npm ci no runtime — fonte do erro).
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist

# O fastify-static serve o client buildado em ../client/dist. Como o front vai
# para o Netlify, criamos um placeholder para o registro do plugin não falhar.
RUN mkdir -p /app/client/dist && printf '<!doctype html><title>VoIP API</title>' > /app/client/dist/index.html

RUN mkdir -p /app/server/data /app/server/certs

EXPOSE 3000/tcp 3001/tcp 3002/udp 3003/tcp 3443/tcp
VOLUME ["/app/server/data", "/app/server/certs"]

CMD ["node", "dist/index.js"]

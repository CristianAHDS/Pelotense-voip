# ============================================================
# VoIP Server — imagem de produção (backend + SQLite)
# O frontend vai para o Netlify; aqui roda apenas o servidor.
# ============================================================

# ---- Build (tsc) ----
FROM node:20-slim AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# ---- Runtime ----
FROM node:20-slim AS runtime
WORKDIR /app/server
ENV NODE_ENV=production
COPY --from=build /app/server/package.json /app/server/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./dist

# O fastify-static serve o client buildado em ../client/dist. Como o front vai
# para o Netlify, criamos um placeholder para o registro do plugin não falhar.
RUN mkdir -p /app/client/dist && printf '<!doctype html><title>VoIP API</title>' > /app/client/dist/index.html

RUN mkdir -p /app/server/data /app/server/certs

EXPOSE 3000/tcp 3001/tcp 3002/udp 3003/tcp 3443/tcp
VOLUME ["/app/server/data", "/app/server/certs"]

CMD ["node", "dist/index.js"]

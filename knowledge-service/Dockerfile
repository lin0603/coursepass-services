FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY server.mjs package.json ./
# Data is NOT baked into the image. Mount the built SQLite at /app/data (volume).
RUN mkdir -p /app/data
ENV PORT=8080
ENV DATA=/app/data/knowledge.sqlite
EXPOSE 8080
CMD ["node", "server.mjs"]

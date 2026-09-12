FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json ./
RUN mkdir -p /app/data
ENV PORT=8080
ENV DATA_DIR=/app/data
EXPOSE 8080
CMD ["node", "src/server.mjs"]

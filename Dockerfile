FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
COPY deploy/snapshot-data.tar.gz /app/deploy/snapshot-data.tar.gz
RUN npm run build && npm prune --omit=dev
RUN mkdir -p /app/deploy/snapshot-data \
    && tar -xzf /app/deploy/snapshot-data.tar.gz -C /app/deploy/snapshot-data \
    && rm /app/deploy/snapshot-data.tar.gz

ENV NODE_ENV=production
EXPOSE 10000
CMD ["node", "dist/server/main.js"]

FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy worker package.json first for layer caching
COPY services/hermes-worker/package*.json ./
RUN npm ci --omit=dev

# Copy worker source and shared packages
COPY services/hermes-worker/ .
COPY packages/ /packages/
COPY db/ /db/
# Copy hermes skills + initial MEMORY.md (hermes/ is also bind-mounted at runtime for lesson persistence)
COPY hermes/ /hermes/

EXPOSE 3001

CMD ["node", "worker.js"]

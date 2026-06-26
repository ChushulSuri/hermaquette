# ── Stage 1: Install deps ─────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Required for better-sqlite3 native module compilation
RUN apk add --no-cache python3 make g++ sqlite-dev

COPY apps/web/package*.json ./
RUN npm ci

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++ sqlite-dev

COPY --from=deps /app/node_modules ./node_modules
COPY apps/web/ .
# Copy db schema so lib/db.ts can apply it at runtime
COPY db/ /db/

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Bake NEXT_PUBLIC_DEMO_TOKEN at build time so the client bundle carries the
# correct value. Passed via docker-compose build.args from DEMO_TOKEN in .env.
ARG NEXT_PUBLIC_DEMO_TOKEN
ENV NEXT_PUBLIC_DEMO_TOKEN=${NEXT_PUBLIC_DEMO_TOKEN}

# Download model-viewer into public/ so it's served locally at runtime
# (avoids a live googleapis CDN dep during the demo recording).
RUN mkdir -p public && \
    wget -q -O public/model-viewer.min.js \
      https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js \
    || echo "model-viewer download failed — component will fall back to CDN"

RUN npm run build

# ── Stage 3: Runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache sqlite-libs wget

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy the standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Ensure data and artifacts dirs exist (volumes will mount over these)
RUN mkdir -p /data /artifacts && chown -R nextjs:nodejs /data /artifacts /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]

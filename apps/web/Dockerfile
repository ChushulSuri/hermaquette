# ── Stage 1: Install deps ─────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Required for better-sqlite3 native module compilation
RUN apk add --no-cache python3 make g++ sqlite-dev

COPY package*.json ./
RUN npm ci

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++ sqlite-dev

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Copy the schema so the standalone bundle can find it at runtime
# (apps/web is built from ./apps/web context, so ../../db won't exist here)
# We embed it as a static asset instead — see lib/db.ts for path resolution
RUN mkdir -p public/schema && cp -r . /tmp/web-src || true

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

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

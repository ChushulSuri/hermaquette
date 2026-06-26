# nikolaik/python-nodejs provides Python 3.11 + Node.js 20 in one image
# (also the image Hermes recommends for its own Docker terminal backend)
FROM nikolaik/python-nodejs:python3.11-nodejs20

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 curl git ripgrep ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Hermes from the pinned submodule
COPY hermes-runtime/ /hermes-runtime/
RUN pip install /hermes-runtime

# Node.js worker dependencies
COPY services/hermes-worker/package*.json ./
RUN npm ci --omit=dev

# Worker source + shared packages
COPY services/hermes-worker/ .
COPY packages/ /packages/
COPY db/ /db/
# Copy hermaquette skills + initial MEMORY.md
# (hermes/ is also bind-mounted at runtime for lesson persistence)
COPY hermes/ /hermes/
COPY hermes/SOUL.md /hermes/SOUL.md
COPY hermes/AGENTS.md /hermes/AGENTS.md

# Hermes home: skills dir pre-created; config written by start.sh at runtime
RUN mkdir -p /root/.hermes/skills

ENV TERMINAL_CWD=/app

RUN chmod +x /app/start.sh

EXPOSE 3001

CMD ["/app/start.sh"]

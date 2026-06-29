# nikolaik/python-nodejs provides Python 3.11 + Node.js 20 in one image
# (also the image Hermes recommends for its own Docker terminal backend)
FROM nikolaik/python-nodejs:python3.11-nodejs20

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 curl git ripgrep ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Hermes from the pinned submodule.
# Some clone setups (Coolify shallow-clone + submodules) leave the submodule
# empty, so fall back to cloning the pinned Hermes commit — deterministic.
COPY hermes-runtime/ /hermes-runtime/
RUN if [ ! -f /hermes-runtime/pyproject.toml ] && [ ! -f /hermes-runtime/setup.py ]; then \
        echo "[Dockerfile] hermes-runtime submodule empty — cloning pinned commit"; \
        rm -rf /hermes-runtime; \
        git clone https://github.com/NousResearch/hermes-agent /hermes-runtime; \
        git -C /hermes-runtime checkout d6269da7fdfe3a80eee60a4675b9e6ef55a71559; \
    fi \
    && pip install /hermes-runtime

# Node.js skill script dependencies (better-sqlite3, stripe, fal SDK, etc.)
COPY services/hermes-agent/package*.json ./
RUN npm ci --omit=dev

# start.sh (no JS worker files remain)
COPY services/hermes-agent/start.sh .
COPY packages/ /app/packages/
COPY db/ /db/
# Copy hermaquette skills + initial MEMORY.md
# (hermes/ is also bind-mounted at runtime for lesson persistence)
COPY hermes/ /hermes/

# Hermes home: skills dir pre-created; config written by start.sh at runtime
RUN mkdir -p /root/.hermes/skills

ENV TERMINAL_CWD=/app

RUN chmod +x /app/start.sh

# Primary gateway port (PID 1 process — no Node worker port 3001)
EXPOSE 8642

CMD ["/app/start.sh"]

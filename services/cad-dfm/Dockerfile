FROM python:3.11-slim

WORKDIR /app

# System dependencies for OCC (build123d), OpenGL (trimesh), and compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1-mesa-glx \
    libgomp1 \
    libgeos-dev \
    libspatialindex-dev \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps (heavy — cached as a layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bundle a free font for engraving text
RUN mkdir -p /fonts && \
    python -c "
import urllib.request
try:
    url = 'https://github.com/liberationfonts/liberation-fonts/raw/main/LiberationSans-Regular.ttf'
    urllib.request.urlretrieve(url, '/fonts/LiberationSans-Regular.ttf')
    print('Font downloaded')
except Exception as e:
    print(f'Font download failed: {e} — will use fallback')
"

ENV FONT_PATH=/fonts/LiberationSans-Regular.ttf
ENV ARTIFACTS_DIR=/artifacts

COPY . .

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "300"]

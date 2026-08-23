FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates ffmpeg gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY requirements.txt ./
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

COPY server.js ./
COPY public ./public

ENV PORT=8080 \
    NODE_ENV=production \
    HF_HUB_DISABLE_SYMLINKS_WARNING=1
EXPOSE 8080

CMD ["node", "server.js"]

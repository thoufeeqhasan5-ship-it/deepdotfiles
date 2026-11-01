# Remotion render service: turns a story (voice, clips, words) into an animated video.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
      libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev libxfixes3 \
      libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund --loglevel=error
RUN npx remotion browser ensure
ADD --chmod=644 https://github.com/google/fonts/raw/main/ofl/archivoblack/ArchivoBlack-Regular.ttf /app/public/ArchivoBlack-Regular.ttf
COPY src ./src
COPY server.mjs ./
ENV REMOTION_DISABLE_TELEMETRY=1
EXPOSE 3000
CMD ["node", "server.mjs"]

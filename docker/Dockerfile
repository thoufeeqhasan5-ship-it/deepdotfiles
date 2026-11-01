# n8n + ffmpeg + brand assets for Deep Dot Files
FROM n8nio/n8n:latest
COPY --from=mwader/static-ffmpeg:8.1 /ffmpeg /usr/local/bin/
COPY --from=mwader/static-ffmpeg:8.1 /ffprobe /usr/local/bin/
COPY --from=mwader/static-ffmpeg:8.1 /etc/fonts /etc/fonts
COPY --from=mwader/static-ffmpeg:8.1 /usr/share/fonts /usr/share/fonts
ADD --chmod=755 https://github.com/google/fonts/raw/main/ofl/archivoblack/ArchivoBlack-Regular.ttf /opt/metro/fonts/ArchivoBlack-Regular.ttf
COPY --chmod=755 logo.png /opt/metro/logo.png

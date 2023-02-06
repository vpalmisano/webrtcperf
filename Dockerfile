FROM ghcr.io/vpalmisano/webrtcperf-base:latest
LABEL org.opencontainers.image.source https://github.com/vpalmisano/webrtcperf

WORKDIR /app
ENV DEBUG_LEVEL=WARN
ENV VIDEO_PATH=/app/video.mp4
ENV CHROMIUM_PATH=/usr/bin/chromium-browser-unstable
ENTRYPOINT ["/app/entrypoint.sh"]

COPY package.json yarn.lock /app/
RUN PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true yarn --production=true

COPY scripts /app/scripts/
COPY app.min.js entrypoint.sh /app/

FROM --platform=$TARGETPLATFORM ubuntu:jammy
LABEL org.opencontainers.image.title webrtcperf
LABEL org.opencontainers.image.description WebRTC performance and quality evaluation tool.
LABEL org.opencontainers.image.source https://github.com/vpalmisano/webrtcperf
LABEL org.opencontainers.image.authors Vittorio Palmisano <vpalmisano@gmail.com>

RUN \
    apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        git \
        python3 \
        bash \
        curl \
        xvfb \
        unzip \
        procps \
        xauth \
        sudo \
        net-tools \
        iproute2 \
        iptables \
        mesa-va-drivers \
        gnupg \
        apt-utils \
        apt-transport-https \
        ca-certificates \
        fonts-liberation \
        fonts-lato \
        fonts-noto-mono \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libc6 \
        libcairo2 \
        libcups2 \
        libdbus-1-3 \
        libexpat1 \
        libfontconfig1 \
        libgbm1 \
        libgcc1 \
        libglib2.0-0 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libstdc++6 \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcomposite1 \
        libxcursor1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxi6 \
        libxrandr2 \
        libxrender1 \
        libxss1 \
        libxtst6 \
        libvulkan1 \
        lsb-release \
        openssl \
        wget \
        xdg-utils \
        libgles1 \
        libgles2 \
        libegl1 \
        libegl1-mesa \
        fonts-noto-color-emoji \
        libu2f-udev \
        libfontconfig1 \
        libfribidi0 \
        libharfbuzz0b \
        libspeex1 \
        libtesseract4 \
        tesseract-ocr-eng \
        libvorbis0a \
        libvorbisenc2 \
        libvorbisfile3 \
        libogg0 \
        libvpx7 \
        libwebpdemux2 \
        libx264-163 \
        libzimg2 \
        libx265-199 \
        libzmq5 \
        xz-utils

RUN \
    mkdir -p /etc/apt/keyrings; \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list; \
    curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -; \
    echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list; \
    wget -q -O- https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2004/x86_64/3bf863cc.pub | gpg --dearmor -o /usr/share/keyrings/nvidia-drivers.gpg; \
    echo 'deb [signed-by=/usr/share/keyrings/nvidia-drivers.gpg] https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2004/x86_64/ /' | sudo tee /etc/apt/sources.list.d/nvidia-drivers.list; \
    apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        nodejs \
        yarn \
        libnvidia-gl-515 \
        nvidia-utils-515

# RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -; \
#   echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list; \
#   apt-get update && apt-get install -y google-chrome-stable && apt-get clean

# chromium-browser-unstable
ENV CHROMIUM_VERSION=136.0.7093.1
ARG TARGETPLATFORM
ENV TARGETPLATFORM=${TARGETPLATFORM:-linux/amd64}
RUN if [ "$TARGETPLATFORM" = "linux/arm64" ]; then ARCH=arm64; else ARCH=amd64; fi; \
    curl -s -Lo /chromium-browser-unstable.deb "https://github.com/vpalmisano/webrtcperf/releases/download/chromium-${CHROMIUM_VERSION}/chromium-browser-unstable_${CHROMIUM_VERSION}-1_${ARCH}.deb" \
    && dpkg -i /chromium-browser-unstable.deb \
    && rm chromium-browser-unstable.deb

RUN apt-get clean \
    && rm -rf /var/cache/apt/* \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/vpalmisano/webrtcperf-ffmpeg:devel /usr/bin/ffmpeg /usr/bin/ffprobe /usr/bin/
COPY --from=ghcr.io/vpalmisano/webrtcperf-ffmpeg:devel /usr/lib/x86_64-linux-gnu*/libvmaf.so* /usr/lib/x86_64-linux-gnu/
COPY --from=ghcr.io/vpalmisano/webrtcperf-ffmpeg:devel /usr/lib/aarch64-linux-gnu*/libvmaf.so* /usr/lib/aarch64-linux-gnu/
COPY --from=ghcr.io/vpalmisano/webrtcperf-ffmpeg:devel /usr/share/model/* /usr/share/model/

# Optional dependencies.
COPY --from=ghcr.io/vpalmisano/webrtcperf-visqol:devel /src/visqol/bazel-bin/visqol /usr/bin/
COPY --from=ghcr.io/vpalmisano/webrtcperf-visqol:devel /src/visqol/model /usr/share/visqol/model

# Default test video.
RUN mkdir -p /app/
RUN curl -s -Lo /app/video.mp4 "https://github.com/vpalmisano/webrtcperf/releases/download/v2.0.4/video.mp4" \
    && ffprobe /app/video.mp4

#
WORKDIR /app
ENV DEBUG_LEVEL=WARN
ENV VIDEO_PATH=/app/video.mp4
ENV CHROMIUM_PATH=/usr/bin/chromium-browser-unstable
ENV NODE_ENV=production
ENTRYPOINT ["/app/entrypoint.sh"]

COPY package.json yarn.lock /app/
ENV PUPPETEER_SKIP_DOWNLOAD=true 
RUN --mount=type=cache,id=webrtcperf-cache-yarn,target=/root/.cache/yarn,sharing=shared \
    yarn install --frozen-lockfile --production --network-timeout 60000 --network-concurrency 1 --cache-folder /root/.cache/yarn

COPY scripts /app/scripts/
COPY app.min.js entrypoint.sh /app/

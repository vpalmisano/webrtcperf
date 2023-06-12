FROM ubuntu:jammy
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
        ffmpeg \
        curl \
        xvfb \
        unzip \
        procps \
        xauth \
        sudo \
        net-tools \
        iproute2 \
        mesa-va-drivers \
        gnupg \
        apt-utils \
        apt-transport-https \
        ca-certificates \
        fonts-liberation \
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
        libu2f-udev

RUN \
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -; \
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
RUN curl -Lo /chromium-browser-unstable.deb "https://github.com/vpalmisano/webrtcperf/releases/download/chromium-115.0.5782/chromium-browser-unstable_115.0.5782.0-1_amd64.deb"
RUN dpkg -i /chromium-browser-unstable.deb && rm chromium-browser-unstable.deb

RUN apt-get clean \
    && rm -rf /var/cache/apt/* \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/
RUN curl -Lo /app/video.mp4 "https://github.com/vpalmisano/webrtcperf/releases/download/v2.0.4/video.mp4" \
    && ffprobe /app/video.mp4

#
WORKDIR /app
ENV DEBUG_LEVEL=WARN
ENV VIDEO_PATH=/app/video.mp4
ENV CHROMIUM_PATH=/usr/bin/chromium-browser-unstable
ENTRYPOINT ["/app/entrypoint.sh"]

COPY package.json yarn.lock /app/
RUN PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true yarn --production=true

COPY scripts /app/scripts/
COPY app.min.js entrypoint.sh /app/

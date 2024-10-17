FROM --platform=$TARGETPLATFORM ubuntu:jammy AS ffmpeg-build
RUN \
    apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ninja-build \
		python3 \
		python3-pip \
        build-essential \
        meson \
        nasm \
        yasm \
        wget \
        libfontconfig-dev \
        libfribidi-dev \
        libharfbuzz-dev \
        libspeex-dev \
        libtesseract-dev \
        libvorbis-dev \
        libvpx-dev \
        libwebp-dev \
        libx264-dev \
        libzimg-dev \
        libx265-dev \
        libssl-dev

ENV VMAF_VERSION=3.0.0
ENV FFMPEG_VERSION=7.1

RUN \
    mkdir -p /src \
    && cd /src \
    && wget -q https://github.com/Netflix/vmaf/archive/refs/tags/v${VMAF_VERSION}.tar.gz \
	&& tar -xzf v${VMAF_VERSION}.tar.gz \
	&& cd vmaf-${VMAF_VERSION}/libvmaf \
	&& meson build --prefix /usr \
	&& ninja -vC build \
	&& ninja -vC build install \
	&& mkdir -p /usr/share/model \
	&& cp -R ../model/* /usr/share/model

RUN \
    mkdir -p /src \
    && cd /src \
    && wget -q https://github.com/FFmpeg/FFmpeg/archive/refs/tags/n${FFMPEG_VERSION}.tar.gz \
	&& tar -xzf n${FFMPEG_VERSION}.tar.gz \
	&& cd FFmpeg-n${FFMPEG_VERSION} \
    && ./configure --prefix=/usr \
        --enable-version3 --disable-shared --enable-gpl --enable-nonfree --enable-static \
        --enable-pthreads --enable-filters --enable-openssl --enable-runtime-cpudetect \
        --enable-libvpx --enable-libx264 --enable-libx265 --enable-libspeex \
        --enable-libtesseract --enable-libfreetype --enable-fontconfig --enable-libzimg \
        --enable-libvmaf --enable-libvorbis --enable-libwebp --enable-libfribidi --enable-libharfbuzz \
    && make -j$(nproc) \
    && make install

RUN rm -rf /src

#
FROM --platform=$TARGETPLATFORM ubuntu:jammy AS visqol-build
RUN \
    apt-get update \
    && apt-get install apt-transport-https curl gnupg git -y \
    && curl -fsSL https://bazel.build/bazel-release.pub.gpg | gpg --dearmor >bazel-archive-keyring.gpg \
    && mv bazel-archive-keyring.gpg /usr/share/keyrings \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/bazel-archive-keyring.gpg] https://storage.googleapis.com/bazel-apt stable jdk1.8" | tee /etc/apt/sources.list.d/bazel.list \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ninja-build \
        python3 \
        python3-pip \
        build-essential \
        bazel-5.3.2 \
        python3-numpy
RUN \
    mkdir -p /src \
    && cd /src \
    && git clone --depth 1 https://github.com/google/visqol \
    && cd visqol \
    && bazel-5.3.2 build :visqol -c opt || true

#
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
        openssl

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
ENV CHROMIUM_VERSION=132.0.6779.1
ARG TARGETPLATFORM
ENV TARGETPLATFORM=${TARGETPLATFORM:-linux/amd64}
RUN if [ "$TARGETPLATFORM" = "linux/arm64" ]; then ARCH=arm64; else ARCH=amd64; fi; \
    curl -s -Lo /chromium-browser-unstable.deb "https://github.com/vpalmisano/webrtcperf/releases/download/chromium-${CHROMIUM_VERSION}/chromium-browser-unstable_${CHROMIUM_VERSION}-1_${ARCH}.deb" \
    && dpkg -i /chromium-browser-unstable.deb \
    && rm chromium-browser-unstable.deb

RUN apt-get clean \
    && rm -rf /var/cache/apt/* \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ffmpeg-build /usr/bin/ffmpeg /usr/bin/ffprobe /usr/bin/
COPY --from=ffmpeg-build /usr/lib/x86_64-linux-gnu*/libvmaf.so* /usr/lib/x86_64-linux-gnu/
COPY --from=ffmpeg-build /usr/lib/aarch64-linux-gnu*/libvmaf.so* /usr/lib/aarch64-linux-gnu/
COPY --from=ffmpeg-build /usr/share/model/* /usr/share/model/

# Optional dependencies.
COPY --from=visqol-build /src/visqol/bazel-bin/visqo[l] /usr/bin/
COPY --from=visqol-build /src/visqol/mode[l] /usr/share/visqol/model

# Default test video.
RUN mkdir -p /app/
RUN curl -s -Lo /app/video.mp4 "https://github.com/vpalmisano/webrtcperf/releases/download/v2.0.4/video.mp4" \
    && ffprobe /app/video.mp4

#
WORKDIR /app
ENV DEBUG_LEVEL=WARN
ENV VIDEO_PATH=/app/video.mp4
ENV CHROMIUM_PATH=/usr/bin/chromium-browser-unstable
ENTRYPOINT ["/app/entrypoint.sh"]

COPY package.json yarn.lock /app/
ENV PUPPETEER_SKIP_DOWNLOAD=true 
RUN yarn install --frozen-lockfile --production || yarn install --frozen-lockfile --production

COPY scripts /app/scripts/
COPY app.min.js entrypoint.sh /app/

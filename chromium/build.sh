#!/bin/bash

export BUILDDIR=${HOME}

function setup() {
    apt install gperf
    # https://chromium.googlesource.com/chromium/src/+/master/docs/linux/build_instructions.md
    cd "${BUILDDIR}" || exit
    git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
    export PATH="$PATH:${BUILDDIR}/depot_tools"
    mkdir -p "${BUILDDIR}"/chromium
    cd "${BUILDDIR}"/chromium || exit
    fetch --nohooks chromium
    cd src || exit
    ./build/install-build-deps.sh
    gclient runhooks
    gn gen out/Default
    gn args out/Default
    cat <<EOF > out/Default/args.gn
# Set build arguments here. See "gn help buildargs".
is_debug = false
is_component_build = false
symbol_level = 0
enable_nacl = false
blink_symbol_level=0
enable_linux_installer = true

media_use_ffmpeg = true
media_use_libvpx = true
proprietary_codecs = true
ffmpeg_branding = "Chrome"
EOF
    cd - || exit
}

function apply_patch() {
    local patch_file=$PWD/use-null-video-decoder.patch
    cd "${BUILDDIR}"/chromium/src/third_party/webrtc || exit
    git apply < "${patch_file}"
    cd - || exit
}

function build() {
    cd "${BUILDDIR}"/chromium/src || exit
    autoninja -C out/Default "chrome/installer/linux:unstable_deb"
    #autoninja -C out/Default "chromedriver"
    cd - || exit
    cp "${BUILDDIR}"/chromium/src/out/Default/*.deb .
    #xz ${BUILDDIR}/chromium/src/out/Default/chromedriver -c > chromedriver.xz
}

function clean() {
    cd "${BUILDDIR}"/chromium/src || exit
    gn clean out/Default
    cd - || exit
}

"$@"

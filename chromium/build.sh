#!/bin/bash

export BUILDDIR=${HOME}

function setup() {
    # https://chromium.googlesource.com/chromium/src/+/master/docs/linux/build_instructions.md
    cd ${BUILDDIR}
    git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
    export PATH="$PATH:${BUILDDIR}/depot_tools"
    mkdir -p ${BUILDDIR}/chromium
    cd ${BUILDDIR}/chromium
    fetch --nohooks chromium
    cd src
    ./build/install-build-deps.sh
    gclient runhooks
    gn gen out/Default
    cat <<EOF > out/Default/args.gn
# Set build arguments here. See `gn help buildargs`.
is_debug = false
is_component_build = false
symbol_level = 0
enable_nacl = true
blink_symbol_level=0
enable_linux_installer = true

media_use_ffmpeg = true
media_use_libvpx = true
proprietary_codecs = true
ffmpeg_branding = "Chrome"
EOF
    cd -
}

function apply_patch() {
    local patch_file=$PWD/use-null-video-decoder.patch
    cd ${BUILDDIR}/chromium/src/third_party/webrtc
    git apply < ${patch_file}
    cd -
}

function build() {
    cd ${BUILDDIR}/chromium/src
    autoninja -C out/Default "chrome/installer/linux:unstable_deb"
    #autoninja -C out/Default "chromedriver"
    cd -
    cp ${BUILDDIR}/chromium/src/out/Default/*.deb .
    #xz ${BUILDDIR}/chromium/src/out/Default/chromedriver -c > chromedriver.xz
}

function clean() {
    cd ${BUILDDIR}/chromium/src
    gn clean out/Default
    cd -
}

$@

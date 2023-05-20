#!/bin/bash
set -ex

export DIR=$(dirname $(realpath "${BASH_SOURCE:-$0}"))
export BUILDDIR=${HOME}/chromium
export CHROMIUM_SRC=${BUILDDIR}/src/chromium/src
export PATCH_FILE=${DIR}/max-video-decoders.patch
export PATH="$PATH:${BUILDDIR}/depot_tools"

function setup() {
    sudo apt install -y gperf
    # https://chromium.googlesource.com/chromium/src/+/master/docs/linux/build_instructions.md
    mkdir -p ${BUILDDIR}
    cd ${BUILDDIR}
    if [ ! -d depot_tools ]; then
        git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
    fi
    mkdir -p cd ${BUILDDIR}/src/chromium
    cd ${BUILDDIR}/src/chromium
    fetch --nohooks chromium
    cd src
    ./build/install-build-deps.sh
    gclient runhooks
    gn gen out/Default
    gn args out/Default
    cat <<EOF > out/Default/args.gn
# Set build arguments here. See "gn help buildargs".

is_debug=false
is_component_build=false
symbol_level=0
enable_nacl=false
blink_symbol_level=0
v8_symbol_level=0
enable_linux_installer=true
is_official_build=true

media_use_ffmpeg=true
media_use_libvpx=true
proprietary_codecs=true
ffmpeg_branding="Chrome"

chrome_pgo_phase=0
disable_fieldtrial_testing_config=true
enable_mse_mpeg2ts_stream_parser=true
enable_reading_list=false
enable_remoting=false
enable_reporting=false
enable_service_discovery=false
enable_widevine=false
exclude_unwind_tables=true
google_api_key=""
google_default_client_id=""
google_default_client_secret=""
treat_warnings_as_errors=false
use_official_google_api_keys=false
use_unofficial_version_number=false
use_kerberos=false

cc_wrapper="CCACHE_SLOPPINESS=time_macros ccache"
EOF
}

function apply_patch() {
    cd ${CHROMIUM_SRC}/third_party/webrtc
    git checkout .
    git apply < ${PATCH_FILE}
    git diff --compact-summary
}

function remove_patch() {
    cd ${CHROMIUM_SRC}/third_party/webrtc
    git checkout .
}

function update() {
    remove_patch
    cd ${CHROMIUM_SRC}
    git checkout .
    git switch main
    git pull origin main
    gclient sync -D --force --reset
    apply_patch
}

function build() {
    cd ${CHROMIUM_SRC}
    time ionice -c3 nice -n19 autoninja -C out/Default "chrome/installer/linux:unstable_deb"
    mv out/Default/*.deb ${DIR}
}

function clean() {
    cd ${CHROMIUM_SRC}
    gn clean out/Default
}

#
export BRANCH=5735
export CEF_USE_GN=1
export GN_DEFINES='cc_wrapper="CCACHE_SLOPPINESS=time_macros ccache" is_official_build=true proprietary_codecs=true ffmpeg_branding=Chrome use_gnome_keyring=false use_system_libdrm=false use_sysroot=true use_allocator=none symbol_level=1 is_cfi=false use_thin_lto=false'
export CEF_ARCHIVE_FORMAT=tar.bz2

function update_cef() {
    #sudo ./src/chromium/src/build/install-build-deps.sh
    cd ${BUILDDIR}
    curl https://bitbucket.org/chromiumembedded/cef/raw/master/tools/automate/automate-git.py -o automate-git.py
    python automate-git.py \
        --download-dir=${BUILDDIR}/src \
        --depot-tools-dir=${BUILDDIR}/depot_tools \
        --branch=${BRANCH} \
        --build-target=cefsimple \
        --with-pgo-profiles \
        --x64-build \
        --no-debug-build \
        --force-clean \
        --no-build
}

function build_cef() {
    apply_patch
    cd ${BUILDDIR}
    time ionice -c3 nice -n19 python automate-git.py \
        --download-dir=${BUILDDIR}/src \
        --depot-tools-dir=${BUILDDIR}/depot_tools \
        --branch=${BRANCH} \
        --build-target=cefsimple \
        --with-pgo-profiles \
        --x64-build \
        --no-debug-build \
        --no-update \
        --force-build
    cp src/chromium/src/cef/binary_distrib/*.tar.bz2 ${DIR}
}

$@

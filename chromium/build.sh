#!/bin/bash
set -ex

export DIR=$(dirname $(realpath "${BASH_SOURCE:-$0}"))
export BUILDDIR=${HOME}/chromium
export CHROMIUM_SRC=${BUILDDIR}/src/chromium/src
export PATH="$PATH:${BUILDDIR}/depot_tools"
export PLATFORM=$(uname -s)
if [ $(uname -m) = "arm64" ]; then
    export TARGET_ARCH=arm64
else
    export TARGET_ARCH=x64
fi

# https://chromium.googlesource.com/chromium/src/+refs
export VERSION="151.0.7894.3"
export DEFAULT_BRANCH="tags/${VERSION}"

function setup() {
    if [ "${PLATFORM}" = "Linux" ]; then
        which gperf || sudo apt install -y gperf
    fi
    # https://chromium.googlesource.com/chromium/src/+/master/docs/linux/build_instructions.md
    mkdir -p ${BUILDDIR}
    cd ${BUILDDIR}
    if [ ! -d depot_tools ]; then
        git clone --depth 1 https://chromium.googlesource.com/chromium/tools/depot_tools.git
    fi
    mkdir -p cd ${BUILDDIR}/src/chromium
    cd ${BUILDDIR}/src/chromium
    fetch --nohooks --no-history chromium
    cd src
    if [ "${PLATFORM}" = "Linux" ]; then
        ./build/install-build-deps.sh
        ./build/linux/sysroot_scripts/install-sysroot.py --arch=arm
    fi
    gclient runhooks
    gn gen out/Default
    configure
}

function configure() {
    ARCH=${1:-${TARGET_ARCH}}
    cat <<EOF > out/Default/args.gn
# Set build arguments here. See "gn help buildargs".

target_cpu="$ARCH"
arm_thumb=1

is_debug=false
is_component_build=false
symbol_level=0
enable_nacl=false
blink_symbol_level=0
v8_symbol_level=0
is_official_build=true

media_use_ffmpeg=true
media_use_libvpx=true
proprietary_codecs=true
ffmpeg_branding="Chrome"

cc_wrapper="CCACHE_SLOPPINESS=time_macros ccache"

chrome_pgo_phase=0
disable_fieldtrial_testing_config=true
enable_mse_mpeg2ts_stream_parser=true
enable_reading_list=false
enable_remoting=false
enable_reporting=false
enable_service_discovery=true
enable_widevine=false
exclude_unwind_tables=true
google_api_key=""
google_default_client_id=""
google_default_client_secret=""
treat_warnings_as_errors=false
use_official_google_api_keys=false
use_unofficial_version_number=false
use_kerberos=false
rtc_use_h264 = true
rtc_build_examples = false
rtc_enable_avx2 = true
EOF

    if [ "${PLATFORM}" = "Linux" ]; then
        cat <<EOF >> out/Default/args.gn
enable_linux_installer=true
enable_vulkan=true
EOF
    else
        cat <<EOF >> out/Default/args.gn
enable_mac_installer=true
EOF
    fi
}

function apply_patch() {
    local branch=${1:-${DEFAULT_BRANCH}}
    local filepath=${DIR}/max-video-decoders_$(echo ${branch} | sed s/'tags\/'//).patch
    if [ ! -f ${filepath} ]; then
        echo "INFO: patch file not found: ${filepath}, using default patch"
        filepath=${DIR}/max-video-decoders_latest.patch
    fi
    cd ${CHROMIUM_SRC}/third_party/webrtc
    git apply < ${filepath}
    git diff --compact-summary
}

function remove_patch() {
    cd ${CHROMIUM_SRC}/third_party/webrtc
    git reset --hard HEAD
}

function update() {
    local branch=${1:-${DEFAULT_BRANCH}}
    local arch=${2:-${TARGET_ARCH}}
    echo "update chromium build to ${branch} for ${arch}"
    remove_patch
    cd ${BUILDDIR}/depot_tools
    git checkout main
    git pull
    cd ${CHROMIUM_SRC}
    git rebase --abort || true
    gclient sync -D --reset --no-history --revision=${branch}
    apply_patch ${branch}
    configure ${arch}
}

function build() {
    cd ${CHROMIUM_SRC}
    if [ "${PLATFORM}" = "Linux" ]; then
        time ionice -c3 nice -n19 autoninja -C out/Default "chrome/installer/linux:unstable_deb"
        mv out/Default/*.deb ${DIR}
        autoninja -C out/Default video_replay
    else
        time nice -n19 autoninja -C out/Default chrome chrome/installer/mac
        rm -rf out/Default/Chromium
        mkdir out/Default/Chromium
        mv out/Default/Chromium.app out/Default/Chromium
        out/Default/Chromium\ Packaging/pkg-dmg --source out/Default/Chromium --target ${DIR}/Chromium_${VERSION}_${TARGET_ARCH}.dmg
    fi
}

function clean() {
    cd ${CHROMIUM_SRC}
    gn clean out/Default
}

#
export CEF_BRANCH=5735
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
        --branch=${CEF_BRANCH} \
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
        --branch=${CEF_BRANCH} \
        --build-target=cefsimple \
        --with-pgo-profiles \
        --x64-build \
        --no-debug-build \
        --no-update \
        --force-build
    cp src/chromium/src/cef/binary_distrib/*.tar.bz2 ${DIR}
}

$@

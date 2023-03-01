#!/bin/bash
set -ex

export DIR=$(dirname $(realpath "${BASH_SOURCE:-$0}"))
export BUILDDIR=${HOME}
export PATCH_FILE=${DIR}/max-video-decoders.patch

function setup() {
    sudo apt install -y gperf
    # https://chromium.googlesource.com/chromium/src/+/master/docs/linux/build_instructions.md
    cd ${BUILDDIR}
    if [ ! -d depot_tools ]; then
        git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
    fi
    export PATH="$PATH:${BUILDDIR}/depot_tools"
    mkdir -p ${BUILDDIR}/chromium
    cd ${BUILDDIR}/chromium
    fetch --nohooks chromium
    cd src
    ./build/install-build-deps.sh
    gclient runhooks
    gn gen out/Default
    gn args out/Default
    cat <<EOF > out/Default/args.gn
# Set build arguments here. See "gn help buildargs".
is_debug = false
is_component_build = false
symbol_level = 1
enable_nacl = false
blink_symbol_level=0
v8_symbol_level=0
enable_linux_installer = true

media_use_ffmpeg = true
media_use_libvpx = true
proprietary_codecs = true
ffmpeg_branding = "Chrome"

build_with_tflite_lib=false
chrome_pgo_phase=0
clang_use_chrome_plugins=false
disable_fieldtrial_testing_config=true
enable_hangout_services_extension=false
enable_js_type_check=false
enable_mdns=false
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

is_official_build=true
symbol_level=1
blink_enable_generated_code_formatting=false
is_cfi=false
use_gnome_keyring=false
use_vaapi=true
use_ozone=true
use_goma=false
enable_vr=false
enable_iterator_debugging=false
optimize_webui=true
use_gio=true
use_lld=true
is_clang=true
use_kerberos=false
use_cups=true
v8_enable_backtrace=true
EOF
}

function apply_patch() {
    cd ${BUILDDIR}/chromium/src/third_party/webrtc
    git apply < ${PATCH_FILE}
    git diff --compact-summary
}

function remove_patch() {
    cd ${BUILDDIR}/chromium/src/third_party/webrtc
    git stash
}

function update() {
    remove_patch
    cd ${BUILDDIR}/chromium/src
    git switch main
    git pull origin main
    git rebase-update
    gclient sync -D
    apply_patch
}

function build() {
    cd ${BUILDDIR}/chromium/src
    ionice -c3 nice -n19 autoninja -C out/Default "chrome/installer/linux:unstable_deb"
    mv out/Default/*.deb ${DIR}
}

function clean() {
    cd ${BUILDDIR}/chromium/src
    gn clean out/Default
}

$@

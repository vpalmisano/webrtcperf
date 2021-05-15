# WebRTC stress test
A tool for running concurrent WebRTC sessions using chromium web browser in headless mode.

Components used:
- NodeJS application.
- Puppeteer library for controlling chromium instances.
- A patched version of chromium (see `./chromium` directory): setting the 
`USE_NULL_VIDEO_DECODER` environment variable disables the video decoding, 
lowering the CPU requirements when running multiple browser sessions.
- RTC stats logging with [ObserveRTC](https://github.com/ObserveRTC/observer-js).

## Configuration options

| Environment variable | Default value | Description |
| :------------------- | :------------ | :---------- |
| URL                  | ''            | The page url to load (mandatory). |
| URL_QUERY            | ''            | The query string to append to the page url; the following template variables are replaced: `$p` the process pid, `$s` the session index, `$S` the total sessions, `$t` the tab index, `$T` the total tabs per session, `$i` the tab absolute index. |
| SCRIPT_PATH          | ''            | A javascript file path; if set, the file content will be injected inside the DOM of each opened tab page; the following global variables are attached to the `window` object: `WEBRTC_STRESS_TEST_SESSION` the session number; `WEBRTC_STRESS_TEST_TAB` the tab number inside the session; `WEBRTC_STRESS_TEST_INDEX` the tab absolute index. |
| PRELOAD_SCRIPT_PATH  | ''            | A javascript file path to be preloaded to each  opened tab page. |
| VIDEO_PATH           | ''            | The fake video path; if set, the video will be used as fake media source. The docker pre-built image contains a 2 minutes video sequence stored at `/app/video.mp4` extracted from this [YouTube video](https://www.youtube.com/watch?v=o8NPllzkFhE). The temporary files containing the raw video and audio are stored at `${VIDEO_CACHE_PATH}/video.${VIDEO_FORMAT}` and `${VIDEO_CACHE_PATH}/audio.wav`. |
| VIDEO_WIDTH          | 1280          | The fake video resize width. |
| VIDEO_HEIGHT         | 720           | The fake video resize height. |
| VIDEO_FRAMERATE      | 25            | The fake video framerate. |
| VIDEO_SEEK           | 0             | The fake video seek position in seconds. |
| VIDEO_DURATION       | 120           | The fake video duration in seconds. |
| VIDEO_CACHE_RAW      | `true`        | If the temporary video and audio raw files can be reused across multiple runs. |
| VIDEO_CACHE_PATH     | `/tmp/webrtc-stress-test` | The path where the video and audio raw files are stored. |
| VIDEO_FORMAT         | `y4m`         | The fake video file format presented to the browser. Can be `y4m` or `mjpeg`. |
| CHROMIUM_PATH        | `/usr/bin/chromium-browser-unstable` | The Chromium executable path. |
| WINDOW_WIDTH         | 1920          | The browser window width. |
| WINDOW_HEIGHT        | 1080          | The browser window height. |
| USE_NULL_VIDEO_DECODER | `false`     | Disables the video decoding. This affects the RTC video jitter buffer stats. |
| AUDIO_RED_FOR_OPUS   | `false`       | Enables RED for OPUS codec. |
| DISPLAY              | ''            | If set to a valid Xserver `DISPLAY` string, the headless mode is disabled. |
| SESSIONS             | 1             | The number of browser sessions to start. |
| TABS_PER_SESSION     | 1             | The number of tabs to open in each browser session. |
| SPAWN_PERIOD         | 1000          | The sessions spawn period in ms. |
| ENABLE_PAGE_LOG      | `false`       | If `true`, the pages logs will be printed on console. |
| SHOW_STATS           | `true`        | If statistics should be displayed on console output. |
| STATS_PATH           | ''            | The log file directory path; if set, the log data will be written in a .csv file inside this directory; if the directory path does not exist, it will be created. |
| STATS_INTERVAL       | 1             | The log interval in seconds. |
| ENABLE_RTC_STATS     | `true`        | Enables the collection of RTC stats using ObserveRTC |
| DEBUG                | ''            | Enables the debug messages; see [debug-level](https://github.com/commenthol/debug-level#readme) for syntax. |
| GET_USER_MEDIA_OVERRIDES | ''        | A JSON string with the `getUserMedia` constraints to override for each tab in each session; e.g. `[null, {"video": {"width": 360, "height": 640}}]` overrides the `video` settings for the second tab in the first session. |
| RUN_DURATION         | 0             | If greater than 0, the test will stop after the provided number of seconds. |
| THROTTLE_CONFIG      | ''            | A JSON string with a valid [sitespeedio/throttle](https://github.com/sitespeedio/throttle#use-directly-in-nodejs) configuration (e.g. `{"up": 1000, "down": 1000, "rtt": 200}`). When used with docker, run `sudo modprobe ifb numifbs=1` first and add the `--cap-add=NET_ADMIN` docker option. |

## Statistics

Example output:

```
-- Mon, 08 Mar 2021 11:41:48 GMT -------------------------------------------------------------------
                          name    count      sum     mean   stddev      25p      min      max
                           cpu        1    67.66    67.66     0.00    67.66    67.66    67.66 %
                        memory        1   801.13   801.13     0.00   801.13   801.13   801.13 MB
                          tabs        1        1        1        0        1        1        1
-- Inbound audio -----------------------------------------------------------------------------------
                      received        1     0.02     0.02     0.00     0.02     0.02     0.02 MB
                          rate        1     0.53     0.53     0.00     0.53     0.53     0.53 Kbps
                          lost        1              0.00     0.00     0.00     0.00     0.00 %
                        jitter        1              0.00     0.00     0.00     0.00     0.00 s
          avgJitterBufferDelay        1             85.27     0.00    85.27    85.27    85.27 ms
-- Inbound video -----------------------------------------------------------------------------------
                      received        2    26.62    13.31    13.22    13.31     0.09    26.53 MB
                          rate        2   838.72   419.36   411.30   419.36     8.06   830.66 Kbps
                          lost        1              0.00     0.00     0.00     0.00     0.00 %
                        jitter        1              1.88     0.37     1.77     0.98     2.65 s
          avgJitterBufferDelay        1             90.86     0.00    90.86    90.86    90.86 ms
                         width        1              1280        0     1280     1280     1280 px
                        height        1               720        0      720      720      720 px
-- Outbound audio ----------------------------------------------------------------------------------
                          sent        1     0.50     0.50     0.00     0.50     0.50     0.50 MB
                 retransmitted        1     0.00     0.00     0.00     0.00     0.00     0.00 MB
                          rate        1     0.00     0.00     0.00     0.00     0.00     0.00 Kbps
-- Outbound video ----------------------------------------------------------------------------------
                          sent        3    43.62    14.54     7.70    10.06     4.68    23.49 MB
                 retransmitted        3     0.00     0.00     0.00     0.00     0.00     0.00 MB
                          rate        3     0.00     0.00     0.00     0.00     0.00     0.00 Kbps
 qualityLimitResolutionChanges        3        0        0        0        0        0        0
                         width        1              1280        0     1280     1280     1280 px
                        height        1               720        0      720      720      720 px
                           fps        1                25        0       25       25       25 fps
```

Statistics values:

| Name                      | Count        | Desscription |
| :------------------------ | :----------- | :----------- |
| cpu                       | Total sessions | The browser process cpu usage. |
| memory                    | Total sessions | The browser process memory usage. |
| tabs                      | Total sessions | The browser current opened tabs. |
| received                  | Total inbound streams | The `bytesReceived` value for each stream. |
| sent                      | Total outbound streams | The `bytesSent` value for each stream. |
| retransmitted             | Total outbound streams | The `retransmittedBytesSent` value for each stream. |
| rate                      | Total streams | The stream bitrate. |
| lost                      | Total streams | The stream [lost packets](https://www.w3.org/TR/webrtc-stats/#dom-rtcreceivedrtpstreamstats-packetslost) %. |
| jitter                    | Total streams | The stream [jitter](https://www.w3.org/TR/webrtc-stats/#dom-rtcreceivedrtpstreamstats-jitter) in seconds. |
| avgJitterBufferDelay      | Total decoded tracks | The inbound average [jitter buffer delay](https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats-jitterbufferdelay). |
| qualityLimitResolutionChanges   | Total outbound video streams | The `qualityLimitationResolutionChanges` [value](https://w3c.github.io/webrtc-stats/#dom-rtcoutboundrtpstreamstats-qualitylimitationresolutionchanges) for each outbound video stream. |
| width                     | Total sent or received videos | The sent or received video width. |
| height                    | Total sent or received videos | The sent or received video height. |
| fps                       | Total sent | The sent video frames per second. |

## Examples

### Mediasoup demo


Starts one send-receive participant:

```sh
docker pull vpalmisano/webrtc-stress-test:latest
docker run -it --rm --name=webrtc-stress-test-publisher \
    -v /dev/shm:/dev/shm \
    -e VIDEO_PATH=/app/video.mp4 \
    -e URL=$MEDIASOUP_DEMO_URL \
    -e URL_QUERY='roomId=test&displayName=Publisher-$s-$t' \
    -e SESSIONS=1 \
    -e TABS_PER_SESSION=1 \
    vpalmisano/webrtc-stress-test:latest
```

Starts 10 receive-only participants:

```sh
docker pull vpalmisano/webrtc-stress-test:latest
docker run -it --rm --name=webrtc-stress-test-viewer \
    -v /dev/shm:/dev/shm \
    -e VIDEO_PATH=/app/video.mp4 \
    -e URL=$MEDIASOUP_DEMO_URL \
    -e URL_QUERY='roomId=test&displayName=Viewer-$s-$t&produce=false' \
    -e SESSIONS=1 \
    -e TABS_PER_SESSION=10 \
    vpalmisano/webrtc-stress-test:latest
```
### Edumeet

Starts one send-receive participant, with a random audio activation pattern:

```sh
docker pull vpalmisano/webrtc-stress-test:latest
docker run -it --rm --name=webrtc-stress-test-publisher \
    -v /dev/shm:/dev/shm \
    -e VIDEO_PATH=/app/video.mp4 \
    -e URL=$EDUMEET_URL \
    -e URL_QUERY='displayName=Publisher $s-$t' \
    -e SCRIPT_PATH=/app/scripts/edumeet-sendrecv.js \
    -e SESSIONS=1 \
    -e TABS_PER_SESSION=1 \
    vpalmisano/webrtc-stress-test:latest
```

Starts 10 receive-only participants:

```sh
docker pull vpalmisano/webrtc-stress-test:latest
docker run -it --rm --name=webrtc-stress-test-viewer \
    -v /dev/shm:/dev/shm \
    -e URL=$EDUMEET_URL \
    -e URL_QUERY='displayName=Viewer $s-$t' \
    -e SCRIPT_PATH=/app/scripts/edumeet-recv.js \
    -e SESSIONS=1 \
    -e TABS_PER_SESSION=10 \
    vpalmisano/webrtc-stress-test:latest
```

### Jitsi

Starts one send-receive participant:

```sh
docker pull vpalmisano/webrtc-stress-test:latest
docker run -it --rm --name=webrtc-stress-test-publisher \
    -v /dev/shm:/dev/shm \
    -e VIDEO_PATH=/app/video.mp4 \
    -e URL=$JITSI_ROOM_URL \
    -e URL_QUERY='#config.prejoinPageEnabled=false&userInfo.displayName=Participant-$s-$t' \
    -e SESSIONS=1 \
    -e TABS_PER_SESSION=1 \
    vpalmisano/webrtc-stress-test:latest
```

Starts 10 receive-only participants:

```sh
docker pull vpalmisano/webrtc-stress-test:latest
docker run -it --rm --name=webrtc-stress-test-publisher \
    -v /dev/shm:/dev/shm \
    -e URL=$JITSI_ROOM_URL \
    -e URL_QUERY='#config.prejoinPageEnabled=false&userInfo.displayName=Participant-$s-$t' \
    -e SESSIONS=1 \
    -e TABS_PER_SESSION=10 \
    vpalmisano/webrtc-stress-test:latest
```

### QuavStreams

```sh
docker pull vpalmisano/webrtc-stress-test:latest
docker run -it --rm --name=webrtc-stress-test-publisher \
    -v /dev/shm:/dev/shm \
    -e VIDEO_PATH=/app/video.mp4 \
    -e URL=$QUAVSTREAMS_ROOM_URL \
    -e URL_QUERY='displayName=Participant-$s-$t&publish={"video":true,"audio":true}' \
    -e SESSIONS=1 \
    -e TABS_PER_SESSION=1 \
    vpalmisano/webrtc-stress-test:latest
```

```sh
docker pull vpalmisano/webrtc-stress-test:latest
docker run -it --rm --name=webrtc-stress-test-publisher \
    -v /dev/shm:/dev/shm \
    -e URL=$QUAVSTREAMS_ROOM_URL \
    -e URL_QUERY='displayName=Viewer-$s-$t' \
    -e SESSIONS=1 \
    -e TABS_PER_SESSION=1 \
    vpalmisano/webrtc-stress-test:latest
```


## Running from source code

```sh
git clone https://github.com/vpalmisano/webrtc-stress-test.git

cd webrtc-stress-test

# build the chromium customized version
# cd chromium
# ./build.sh setup
# ./build.sh apply_patch
# ./build.sh build
# install the package (on Ubuntu/Debian)
# dpkg -i ./chromium-browser-unstable_<version>-1_amd64.deb
# cd ..

# sendrecv test
URL=https://127.0.0.1:3443/test \
URL_QUERY='displayName=SendRecv $s/$S-$t/$T' \
VIDEO_PATH=./video.mp4 \
SCRIPT_PATH=./scripts/edumeet-sendrecv.js \
SESSIONS=1 \
TABS_PER_SESSION=1 \
DEBUG=DEBUG:* \
ENABLE_PAGE_LOG=true \
USE_NULL_VIDEO_DECODER=true \
    yarn start:dev index.js

# recv only
URL=https://127.0.0.1:3443/test \
URL_QUERY='displayName=Recv $s/$S-$t/$T' \
SCRIPT_PATH=./scripts/edumeet-recv.js \
SESSIONS=1 \
TABS_PER_SESSION=1 \
DEBUG=DEBUG:* \
ENABLE_PAGE_LOG=true \
USE_NULL_VIDEO_DECODER=true \
    yarn start:dev index.js
```

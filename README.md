# WebRTC stress test
A tool for running concurrent webrtc session using chromium web browser in headless mode.

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
| URL_QUERY            | ''            | The query string to append to the page url; the following template variables are avaialable: `$p` the process pid, `$s` the session index, `$S` the total sessions, `$t` the tab index, `$T` the total tabs per session. |
| SCRIPT_PATH          | ''            | A javascript file path; if set, the file content will be injected inside the DOM of each opened tab page; the following global variables are attached to the `window` object: `WEBRTC_STRESS_TEST_SESSION` the session number; `WEBRTC_STRESS_TEST_TAB` the tab number. |
| VIDEO_PATH           | ''            | The fake video path; if set, the video will be used as fake media source; the docker image contains a 2 minutes video sequence stored at `/app/video.mp4` extracted from this [YouTube video](https://www.youtube.com/watch?v=o8NPllzkFhE).  |
| VIDEO_WIDTH          | 1280          | The fake video resize width. |
| VIDEO_HEIGHT         | 720           | The fake video resize height. |
| VIDEO_FRAMERATE      | 25            | The fake video framerate. |
| WINDOW_WIDTH         | 1920          | The browser window width. |
| WINDOW_HEIGHT        | 1080          | The browser window height. |
| USE_NULL_VIDEO_DECODER | `false`     | Disables the video decoding. This affects the RTC video jitter buffer stats. |
| DISPLAY              | ''            | If set to a valid Xserver `DISPLAY` string, the headless mode is disabled. |
| SESSIONS             | 1             | The number of browser sessions to start. |
| TABS_PER_SESSION     | 1             | The number of tabs to open in each browser session. |
| SPAWN_PERIOD         | 1000          | The sessions spawn period in ms. |
| ENABLE_PAGE_LOG      | `false`       | If `true`, the pages logs will be printed on console. |
| SHOW_STATS           | `true`        | If statistics should be displayed on console output. |
| STATS_PATH           | ''            | The log file directory path; if set, the log data will be written in a .csv file inside this directory; if the directory path does not exist, it will be created. |
| STATS_INTERVAL       | 1             | The log interval in seconds. |
| DEBUG                | ''            | Enables the debug messages; see [debug-level](https://github.com/commenthol/debug-level#readme) for syntax. |

## Statistics

Example output:

```
                      cpu [1] sum: 53.23 mean: 53.23 stdev: 0.00 25p: 53.23 min: 53.23 max: 53.23 [%]
                   memory [1] sum: 781.04 mean: 781.04 stdev: 0.00 25p: 781.04 min: 781.04 max: 781.04 [MB]
            bytesReceived [1] sum: 0.07 mean: 0.07 stdev: 0.00 25p: 0.07 min: 0.07 max: 0.07 [MB]
             recvBitrates [1] sum: 0.01 mean: 0.01 stdev: 0.00 25p: 0.01 min: 0.01 max: 0.01 [Kbps]
                bytesSent [4] sum: 34.61 mean: 8.65 stdev: 7.11 25p: 2.03 min: 0.41 max: 18.55 [MB]
             sendBitrates [4] sum: 1.39 mean: 0.35 stdev: 0.29 25p: 0.08 min: 0.00 max: 0.74 [Kbps]
avgAudioJitterBufferDelay [1] sum: 0.02 mean: 0.02 stdev: 0.00 25p: 0.02 min: 0.02 max: 0.02 [ms]
avgVideoJitterBufferDelay [1] sum: 0.08 mean: 0.08 stdev: 0.00 25p: 0.08 min: 0.08 max: 0.08 [ms]
```

Statistics values:

| Name                      | Counter [N]  | Desscription |
| :------------------------ | :----------- | :----------- |
| cpu                       | Total sessions | The browser process cpu usage. |
| memory                    | Total Sessions | The browser process memory usage. |
| bytesReceived             | Total inbound streams | The `bytesReceived` value for each established peer connection. |
| recvBitrates              | Total inbound streams | The `bytesReceived` evaluated bitrates |
| bytesSent                 | Total outbound streams | The `bytesSent` value for each established peer connection. |
| sendBitrates              | Total outbound streams | The `bytesSent` evaluated bitrates |
| avgAudioJitterBufferDelay | Total audio tracks | The audio average jitter buffer delay. |
| avgVideoJitterBufferDelay | Total video tracks | The video average jitter buffer delay; calculated only if `USE_NULL_VIDEO_DECODER=false`. |


## Edumeet examples

Starts one send-receive participant, with a random audio activation pattern:

```sh
docker pull vpalmisano/webrtc-stress-test:latest
docker run -it --rm --name=webrtc-stress-test-publisher \
    --net=host \
    -v /dev/shm:/dev/shm \
    -e VIDEO_PATH=/app/video.mp4 \
    -e URL=$EDUMEET_URL \
    -e URL_QUERY='displayName=Publisher $s-$t' \
    -e SCRIPT_PATH=/app/scripts/edumeet-sendrecv.js \
    -e SESSIONS=1 \
    -e TABS_PER_SESSION=1 \
    -e USE_NULL_VIDEO_DECODER=true \
    vpalmisano/webrtc-stress-test:latest
```

Starts 10 receive-only participants:

```sh
docker pull vpalmisano/webrtc-stress-test:latest
docker run -it --rm --name=webrtc-stress-test-viewer \
    --net=host \
    -v /dev/shm:/dev/shm \
    -e URL=$EDUMEET_URL \
    -e URL_QUERY='displayName=Viewer $s-$t' \
    -e SCRIPT_PATH=/app/scripts/edumeet-recv.js \
    -e SESSIONS=1 \
    -e TABS_PER_SESSION=10 \
    -e USE_NULL_VIDEO_DECODER=true \
    vpalmisano/webrtc-stress-test:latest
```

## QuavStreams examples

```sh
docker pull vpalmisano/webrtc-stress-test:latest
docker run -it --rm --name=webrtc-stress-test-publisher \
    --net=host \
    -v /dev/shm:/dev/shm \
    -e VIDEO_PATH=/app/video.mp4 \
    -e URL=$QUAVSTREAMS_ROOM_URL \
    -e URL_QUERY='displayName=Publisher-$s-$t&publish={"video":true,"audio":true}' \
    -e SESSIONS=1 \
    -e TABS_PER_SESSION=1 \
    vpalmisano/webrtc-stress-test:latest
```

```sh
docker pull vpalmisano/webrtc-stress-test:latest
docker run -it --rm --name=webrtc-stress-test-publisher \
    --net=host \
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
# ./build setup
# ./build setup
# ./build apply_patch
# ./build build
# cd ..

# sendrecv test
URL=https://127.0.0.1:3443/test \
URL_QUERY='displayName=SendRecv $s/$S-$t/$T' \
VIDEO_PATH=./video.mp4 \
SCRIPT_PATH=./scripts/edumeet-sendrecv.js \
SESSIONS=1 \
TABS_PER_SESSION=1 \
DEBUG=DEBUG:* \
USE_NULL_VIDEO_DECODER=true \
    yarn start:dev index.js

# recv only
URL=https://127.0.0.1:3443/test \
URL_QUERY='displayName=Recv $s/$S-$t/$T' \
SCRIPT_PATH=./scripts/edumeet-recv.js \
SESSIONS=1 \
TABS_PER_SESSION=1 \
DEBUG=DEBUG:* \
USE_NULL_VIDEO_DECODER=true \
    yarn start:dev index.js
```

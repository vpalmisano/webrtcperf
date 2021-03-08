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
| URL_QUERY            | ''            | The query string to append to the page url; the following template variables are avaialable: `$p` the process pid, `$s` the session index, `$S` the total sessions, `$t` the tab index, `$T` the total tabs per session. |
| SCRIPT_PATH          | ''            | A javascript file path; if set, the file content will be injected inside the DOM of each opened tab page; the following global variables are attached to the `window` object: `WEBRTC_STRESS_TEST_SESSION` the session number; `WEBRTC_STRESS_TEST_TAB` the tab number. |
| VIDEO_PATH           | ''            | The fake video path; if set, the video will be used as fake media source; the docker image contains a 2 minutes video sequence stored at `/app/video.mp4` extracted from this [YouTube video](https://www.youtube.com/watch?v=o8NPllzkFhE).  |
| CHROMIUM_PATH        | `/usr/bin/chromium-browser-unstable` | The Chromium executable path. |
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
| ENABLE_RTC_STATS     | `true`        | Enables the collection of RTC stats using ObserveRTC |
| DEBUG                | ''            | Enables the debug messages; see [debug-level](https://github.com/commenthol/debug-level#readme) for syntax. |

## Statistics

Example output:

```
                          name    total      sum     mean   stddev      25p      min      max                                                                                                                                      
                           cpu        1    69.33    69.33     0.00    69.33    69.33    69.33 %                                                                                                                                    
                        memory        1   773.52   773.52     0.00   773.52   773.52   773.52 MB                                                                                                                                   
                 bytesReceived        3     0.25     0.08     0.11     0.01     0.00     0.23 MB                                                                                                                                   
                  recvBitrates        3   634.62   211.54   298.69     0.33     0.00   633.96 Kbps                                                                                                                                 
     avgAudioJitterBufferDelay        1     0.10     0.10     0.00     0.10     0.10     0.10 ms                                                                                                                                   
     avgVideoJitterBufferDelay        1     0.04     0.04     0.00     0.04     0.04     0.04 ms                                                                                                                                   
                     bytesSent        4     2.20     0.55     0.44     0.14     0.05     1.15 MB                                                                                                                                   
        retransmittedBytesSent        4     0.00     0.00     0.00     0.00     0.00     0.00 MB
       qLimitResolutionChanges        3        0        0        0        0        0        0
                  sendBitrates        4  1396.25   349.06   276.29    89.75    30.96   729.73 Kbps
```

Statistics values:

| Name                      | Count        | Desscription |
| :------------------------ | :----------- | :----------- |
| cpu                       | Total sessions | The browser process cpu usage. |
| memory                    | Total Sessions | The browser process memory usage. |
| bytesReceived             | Total inbound streams | The `bytesReceived` value for each inbound stream. |
| recvBitrates              | Total inbound streams | The `bytesReceived` inbound streams bitrates |
| avgAudioJitterBufferDelay | Total inbound audio tracks | The inbound audio average jitter buffer delay. |
| avgVideoJitterBufferDelay | Total inbound video tracks | The inbound video average jitter buffer delay; calculated only if `USE_NULL_VIDEO_DECODER=false`. |
| bytesSent                 | Total outbound streams | The `bytesSent` value for each outbound stream. |
| retransmittedBytesSent    | Total outbound streams | The `retransmittedBytesSent` value for each outbound stream. |
| qLimitResolutionChanges   | Total outbound streams | The `qualityLimitationResolutionChanges` value for each outbound stream. |
| sendBitrates              | Total outbound streams | The `bytesSent - retransmittedBytesSent` outbound streams rates. |


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
    vpalmisano/webrtc-stress-test:latest
```

## Jitsi examples

Starts one send-receive participant:

```sh
docker pull vpalmisano/webrtc-stress-test:latest
docker run -it --rm --name=webrtc-stress-test-publisher \
    --net=host \
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
    --net=host \
    -v /dev/shm:/dev/shm \
    -e URL=$JITSI_ROOM_URL \
    -e URL_QUERY='#config.prejoinPageEnabled=false&userInfo.displayName=Participant-$s-$t' \
    -e SESSIONS=1 \
    -e TABS_PER_SESSION=10 \
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
    -e URL_QUERY='displayName=Participant-$s-$t&publish={"video":true,"audio":true}' \
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

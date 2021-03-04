# WebRTC stress test
A tool for running concurrent webrtc session using chromium web browser in headless mode.

Components used:
- NodeJS application.
- Puppeteer library for controlling chromium instances.
- A patched version of chromium (see `./chromium` directory): setting the 
`USE_NULL_VIDEO_DECODER` environment variable the video decoding 
is disabled, lowering the CPU requirements when running multiple instances.

## Running from source code

```sh
git clone https://github.com/vpalmisano/webrtc-stress-test.git

URL=https://127.0.0.1:3443/test \
VIDEO_PATH=./video.mp4 \
SCRIPT_PATH=./scripts/edumeet-sendrecv.js \
SESSIONS=1 \
TABS_PER_SESSION=1 \
DEBUG=DEBUG:* \
USE_NULL_VIDEO_DECODER=1 \
    yarn start:dev index.js
```

## Usage with Docker

```sh
docker run -it --rm --name=webrtc-stress-test --net=host \
    -v /dev/shm:/dev/shm \
    -e URL=https://EDUMEET_HOSTNAME:3443/test \
    -e SCRIPT_PATH=/app/scripts/edumeet-sendrecv.js \
    -e SESSIONS=4 \
    -e TABS_PER_SESSION=1 \
    -e DEBUG='DEBUG:*' \
    vpalmisano/webrtc-stress-test:latest
```

## Configuration options

| Environment variable | Default value | Description |
| :------------------- | :------------ | :---------- |
| URL                  |               | The page url to load |
| VIDEO_PATH           |               | The fake video path; if set, the video will be used as fake media source |
| VIDEO_WIDTH          | 1280          | The fake video resize width |
| VIDEO_HEIGHT         | 720           | The fake video resize height |
| VIDEO_FRAMERATE      | 25            | The fake video framerate |
| WINDOW_WIDTH         | 1920          | The browser window width |
| WINDOW_HEIGHT        | 1080          | The browser window height |
| DISPLAY              |               | If set to a valid Xserver `DISPLAY` string, the headless mode is disabled |
| SESSIONS             | 1             | The number of browser sessions to start |
| TABS_PER_SESSION     | 1             | The number of tabs to open in each browser session |
| SPAWN_PERIOD         | 1000          | The sessions spawn period in ms |
| SHOW_STATS           | true          | If statistics should be displayed on console output |
| LOG_PATH             |               | The log file directory path; if set, the log data will be written in a .csv file inside this directory; if the directory path does not exist, it will be created |
| LOG_INTERVAL         | 1             | The log interval in seconds |
| SCRIPT_PATH          |               | A javascript file path; if set, the file content will be injected inside the DOM of each opened tab page |

## Edumeet examples

Starts one send-receive participant, with a random audio activation pattern:

```sh
docker run -it --rm --name=webrtc-stress-test --net=host \
    -v /dev/shm:/dev/shm \
    -e URL=https://EDUMEET_HOSTNAME:3443/test \
    -e SCRIPT_PATH=/app/scripts/edumeet-sendrecv.js \
    -e SESSIONS=1 \
    -e TABS_PER_SESSION=1 \
    -e DEBUG='DEBUG:*' \
    vpalmisano/webrtc-stress-test:latest
```

Starts 10 receive-only participants:

```sh
docker run -it --rm --name=webrtc-stress-test --net=host \
    -v /dev/shm:/dev/shm \
    -e URL=https://EDUMEET_HOSTNAME:3443/test \
    -e SCRIPT_PATH=/app/scripts/edumeet-recv.js \
    -e SESSIONS=1 \
    -e TABS_PER_SESSION=10 \
    -e DEBUG='DEBUG:*' \
    vpalmisano/webrtc-stress-test:latest
```

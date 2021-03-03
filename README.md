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
SCRIPT_PATH=./scripts/edumeet.js \
WORKERS=1 \
SESSIONS_PER_WORKER=4 \
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
    -e SCRIPT_PATH=/app/scripts/edumeet.js \
    -e SESSIONS_PER_WORKER=4 \
    -e TABS_PER_SESSION=1 \
    -e DEBUG='DEBUG:*' \
    vpalmisano/webrtc-stress-test:latest
```

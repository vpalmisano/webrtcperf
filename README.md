![logo](media/logo.svg "WebRTC Perf")
# WebRTC Perf
[GitHub page](https://github.com/vpalmisano/webrtcperf) | [Documentation](https://vpalmisano.github.io/webrtcperf)

WebRTC performance and quality evaluation tool.
It allows to validate the audio/video quality and the client CPU/memory usage
when multiple connections join the same WebRTC service.

Main features:
- A NodeJS application/library using Puppeteer for controlling chromium instances.
- It can be executed:
  - using the pre built Docker image; this is the suggested way to run the tool
    without installing any dependency;
  - from sources (using git pull or npm install);
  - using the pre built executables generated for each platform.
- It allows to inject custom Javascript source files that will run into the
browser page context for automating some tasks (e.g. pressing a button to join
a conference room).
- It allows to throttle the networking configuration, limiting the ingress/egress
available bandwidth, the RTT or the packet loss %.
- It uses a patched version of chromium (see `./chromium` directory) that allows
to disable the video decoding, lowering the CPU requirements when running multiple
browser sessions.
- It contains an RTC stats logging module that allows to collect metrics and
send them to a Prometheus Pushgateway server for live visualization with Grafana.
- It allows to override getUserMedia and getDisplayMedia calls.
- It allows to define alert rules and generate reports.

## Install
The tool can be executed from sources, using the pre built executables or using the Docker image.

Using Npm:

```bash
echo '@vpalmisano:registry=https://npm.pkg.github.com' >> ~/.npmrc

npm install -g @vpalmisano/webrtcperf

# Install FFMpeg:
sudo apt install ffmpeg # Linux
# or:
brew install ffmpeg # MacOS

# Run a Jitsi test:
webrtcperf \
    --url="https://meet.jit.si/${JITSI_ROOM_URL}#config.prejoinPageEnabled=false" \
    --display='' \
    --show-page-log=false
# Press <q> to stop.
```

Using Docker:

```bash
docker pull ghcr.io/vpalmisano/webrtcperf
docker run -it --rm \
    -v /dev/shm:/dev/shm \
    ghcr.io/vpalmisano/webrtcperf \
    --url="https://meet.jit.si/$JITSI_ROOM_URL#config.prejoinPageEnabled=false" \
    --show-page-log=false \
    --sessions=1 \
    --tabs-per-session=1
```

Stop the tool pressing `q` (normal browser close) or `x` (it will close the
process immediately).

## Configuration options

See the [config documentation](https://vpalmisano.github.io/webrtcperf/types/Config.html).

## Statistics

Example output:

```
-- Mon, 06 Feb 2023 20:46:34 GMT -------------------------------------------------------------------
                          name    count      sum     mean   stddev       5p      95p      min      max
                    System CPU        1             15.89     0.00    15.89    15.89    15.89    15.89 %
                    System GPU        1              0.00     0.00     0.00     0.00     0.00     0.00 %
                 System Memory        1             72.18     0.00    72.18    72.18    72.18    72.18 %
                      CPU/page        1    84.42    84.42     0.00    84.42    84.42    84.42    84.42 %
                   Memory/page        1  1206.90  1206.90     0.00  1206.90  1206.90  1206.90  1206.90 MB
                         Pages        1        1        1        0        1        1        1        1
                        Errors        1        0        0        0        0        0        0        0
                      Warnings        1        0        0        0        0        0        0        0
              Peer Connections        1        2        2        0        2        2        2        2
-- Inbound audio -----------------------------------------------------------------------------------
                          rate        2    28.73    14.36    14.36     0.00    28.73     0.00    28.73 Kbps
                          lost        1              0.00     0.00     0.00     0.00     0.00     0.00 %
                        jitter        2              0.00     0.00     0.00     0.00     0.00     0.00 s
          avgJitterBufferDelay        1             35.29     0.00    35.29    35.29    35.29    35.29 ms
-- Inbound video -----------------------------------------------------------------------------------
                      received        2     2.66     1.33     1.32     0.01     2.64     0.01     2.64 MB
                          rate        2   967.41   483.71   483.71     0.00   967.41     0.00   967.41 Kbps
                          lost        1              0.00     0.00     0.00     0.00     0.00     0.00 %
                        jitter        2              0.01     0.01     0.01     0.02     0.01     0.02 s
          avgJitterBufferDelay        1             50.48     0.00    50.48    50.48    50.48    50.48 ms
                         width        2               960      320      640     1280      640     1280 px
                        height        2               540      180      360      720      360      720 px
                           fps        1                15        0       15       15       15       15 fps
-- Outbound audio ----------------------------------------------------------------------------------
                          rate        2    42.84    21.42    21.42     0.00    42.84     0.00    42.84 Kbps
                          lost        1              0.00     0.00     0.00     0.00     0.00     0.00 %
                 roundTripTime        1             0.001    0.000    0.001    0.001    0.001    0.001 s
-- Outbound video ----------------------------------------------------------------------------------
                          sent        2     3.25     1.62     1.58     0.04     3.21     0.04     3.21 MB
                          rate        2  1131.25   565.63   565.63     0.00  1131.25     0.00  1131.25 Kbps
                          lost        1              0.00     0.00     0.00     0.00     0.00     0.00 %
                 roundTripTime        1             0.001    0.000    0.001    0.001    0.001    0.001 s
 qualityLimitResolutionChanges        2        2        1        1        0        2        0        2
          qualityLimitationCpu        2        0        0        0        0        0        0        0 %
    qualityLimitationBandwidth        2       20       10       10        0       20        0       20 %
           sentActiveEncodings        2                 2        1        1        3        1        3 encodings
                sentMaxBitrate        2  3700.00  1850.00   350.00  1500.00  2200.00  1500.00  2200.00 Kbps
                         width        2               640      640        0     1280        0     1280 px
                        height        2               360      360        0      720        0      720 px
                           fps        2                12       12        0       25        0       25 fps
              pliCountReceived        2                 1        0        1        2        1        2
```

Statistics values:

| Name                      | Count        | Description |
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

## Prometheus / Grafana
See the [prometheus stack](prometheus-stack/README.md).

## Examples

### Mediasoup demo

Starts one send-receive participant:

```sh
docker run -it --rm --name=webrtcperf-publisher \
    -v /dev/shm:/dev/shm \
    ghcr.io/vpalmisano/webrtcperf \
    --url=$MEDIASOUP_DEMO_URL \
    --url-query='roomId=test&displayName=Publisher($s-$t)' \
    --sessions=1 \
    --tabs-per-session=1
```

Starts 10 receive-only participants:

```sh
docker run -it --rm --name=webrtcperf-viewer \
    -v /dev/shm:/dev/shm \
    ghcr.io/vpalmisano/webrtcperf \
    --url=$MEDIASOUP_DEMO_URL \
    --url-query='roomId=test&displayName=Viewer($s-$t)&produce=false' \
    --sessions=1 \
    --tabs-per-session=10
```

### Edumeet

Starts one send-receive participant, with a random audio activation pattern:

```sh
docker run -it --rm \
    -v /dev/shm:/dev/shm \
    -v $PWD/examples:/scripts:ro \
    ghcr.io/vpalmisano/webrtcperf \
    --url=$EDUMEET_URL \
    --url-query='displayName=Publisher($s-$t)' \
    --script-path=/scripts/edumeet-sendrecv.js \
    --sessions=1 \
    --tabs-per-session=1
```

Starts 10 receive-only participants:

```sh
docker run -it --rm \
    -v /dev/shm:/dev/shm \
    -v $PWD/examples:/scripts:ro \
    ghcr.io/vpalmisano/webrtcperf \
    --url=$EDUMEET_URL \
    --url-query='displayName=Viewer($s-$t)' \
    --script-path=/scripts/edumeet-recv.js \
    --sessions=1 \
    --tabs-per-session=10
```

### Jitsi

Starts one send-receive participant:

```sh
docker run -it --rm \
    -v /dev/shm:/dev/shm \
    ghcr.io/vpalmisano/webrtcperf \
    --url=$JITSI_ROOM_URL \
    --url-query='#config.prejoinPageEnabled=false&userInfo.displayName=Participant($s-$t)' \
    --sessions=1 \
    --tabs-per-session=1
```

Starts 10 receive-only participants:

```sh
docker run -it --rm \
    -v /dev/shm:/dev/shm \
    ghcr.io/vpalmisano/webrtcperf \
    --url=$ROOM_URL \
    --url-query='#config.prejoinPageEnabled=false&userInfo.displayName=Participant($s-$t)' \
    --sessions=1 \
    --tabs-per-session=10
```

## Running from source code

The `DEBUG_LEVEL` environment variable can be used to enable debug messages;
see [debug-level](https://github.com/commenthol/debug-level#readme) for syntax.

```sh
git clone https://github.com/vpalmisano/webrtcperf.git

cd webrtcperf

# Optional: build the chromium customized version
# cd chromium
# ./build.sh setup
# ./build.sh apply_patch
# ./build.sh build
# install the package (on Ubuntu/Debian)
# dpkg -i ./chromium-browser-unstable_<version>-1_amd64.deb
# cd ..

yarn build

# sendrecv test
DEBUG_LEVEL=DEBUG:* yarn start \
    --url=https://127.0.0.1:3443/test \
    --url-query='displayName=SendRecv($s/$S-$t/$T)' \
    --script-path=./examples/edumeet-sendrecv.js \
    --sessions=1 \
    --tabs-per-session=1

# recv only
DEBUG_LEVEL=DEBUG:* yarn start \
    --url=https://127.0.0.1:3443/test \
    --url-query='displayName=Recv($s/$S-$t/$T)' \
    --script-path=./examples/edumeet-recv.js \
    --sessions=1 \
    --tabs-per-session=10
```

## Authors
- Vittorio Palmisano [[github](https://github.com/vpalmisano)]

## License
[AGPL](./LICENSE)

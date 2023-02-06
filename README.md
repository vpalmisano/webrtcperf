# WebRTC Perf
[GitHub page](https://github.com/vpalmisano/webrtcperf)

A tool that allows to run concurrent WebRTC sessions using chromium web browser.
It could be used to validate the audio/video quality and the client CPU/memory usage
when multiple connections join the same WebRTC service.

Main features:
- NodeJS application/library using Puppeteer for controlling chromium instances.
- It can be executed from sources, using the pre built Docker image or with the
executables generated for each platform.
- It allows to inject custom Javascript source files that will run into the
browser page context for automating some tasks (e.g. pressing a button to join
a conference room).
- It allows to throttle the networking configuration, limiting the ingress/egress
available bandwdith, the RTT or the packet loss %.
- It uses a patched version of chromium (see `./chromium` directory) that allows
to disable the video decoding, lowering the CPU requirements when running multiple
browser sessions.
- RTC stats logging module that allows to send stats to Prometheus Pushgateway
for visualization with Grafana.
- Alert rules and report generation.

## Install
The tool can be executed from sources, using the pre built executables or using the Docker image.

Using `npm`:

```bash
npm install -g @vpalmisano/webrtcperf

# Run a Jitsi test:
webrtcperf \
    --url="https://meet.jit.si/${ROOM_NAME}#config.prejoinPageEnabled=false" \
    --display='' \
    --show-page-log=false
# Press <q> to stop.
```

Stop the tool pressing `q` (normal browser close) or `x` (it will close the
process immediately).

## Configuration options

See the [config documentation](https://vpalmisano.github.io/webrtcperf/types/Config.html).

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

## Prometheus / Grafana
See the [prometheus stack](prometheus-stack/README.md).

## Examples

### Mediasoup demo

Starts one send-receive participant:

```sh
docker pull vpalmisano/webrtcperf:latest
docker run -it --rm --name=webrtcperf-publisher \
    -v /dev/shm:/dev/shm \
    vpalmisano/webrtcperf:latest \
    --url=$MEDIASOUP_DEMO_URL \
    --url-query='roomId=test&displayName=Publisher($s-$t)' \
    --sessions=1 \
    --tabs-per-session=1
```

Starts 10 receive-only participants:

```sh
docker pull vpalmisano/webrtcperf:latest
docker run -it --rm --name=webrtcperf-viewer \
    -v /dev/shm:/dev/shm \
    vpalmisano/webrtcperf:latest \
    --url=$MEDIASOUP_DEMO_URL \
    --url-query='roomId=test&displayName=Viewer($s-$t)&produce=false' \
    --sessions=1 \
    --tabs-per-session=10
```

### Edumeet

Starts one send-receive participant, with a random audio activation pattern:

```sh
docker pull vpalmisano/webrtcperf:latest
docker run -it --rm \
    -v /dev/shm:/dev/shm \
    -v $PWD/examples:/scripts:ro \
    vpalmisano/webrtcperf:latest \
    --url=$EDUMEET_URL \
    --url-query='displayName=Publisher($s-$t)' \
    --script-path=/scripts/edumeet-sendrecv.js \
    --sessions=1 \
    --tabs-per-session=1
```

Starts 10 receive-only participants:

```sh
docker pull vpalmisano/webrtcperf:latest
docker run -it --rm \
    -v /dev/shm:/dev/shm \
    -v $PWD/examples:/scripts:ro \
    vpalmisano/webrtcperf:latest \
    --url=$EDUMEET_URL \
    --url-query='displayName=Viewer($s-$t)' \
    --script-path=/scripts/edumeet-recv.js \
    --sessions=1 \
    --tabs-per-session=10
```

### Jitsi

Starts one send-receive participant:

```sh
docker pull vpalmisano/webrtcperf:latest
docker run -it --rm \
    -v /dev/shm:/dev/shm \
    vpalmisano/webrtcperf:latest \s
    --url=$JITSI_ROOM_URL \
    --url-query='#config.prejoinPageEnabled=false&userInfo.displayName=Participant($s-$t)' \
    --sessions=1 \
    --tabs-per-session=1
```

Starts 10 receive-only participants:

```sh
docker pull vpalmisano/webrtcperf:latest
docker run -it --rm \
    -v /dev/shm:/dev/shm \
    vpalmisano/webrtcperf:latest \
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

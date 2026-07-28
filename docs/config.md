
The configuration properties are applied in the following order (from higher to
lower precedence):

- arguments passed to the executable in kebab case (e.g. `--url-query`);
- environment variables in uppercase snake format (e.g. `URL_QUERY`);
- `config.json` configuration file;
- default values.

## url
The page url to load.

*Type*: `string`

*Default*: `""`

## urlQuery
The query string to append to the page url; the following template variables are replaced: `$p` the process pid, `$s` the session index, `$S` the total sessions, `$t` the tab index, `$T` the total tabs per session, `$i` the tab absolute index.

*Type*: `string`

*Default*: `""`

## customUrlHandler
This argument specifies the file path for the custom page URL handler that will be exported by default. The custom page URL handler allows you to define custom URLs that can be used to open your application. The handler function will be called with the following variables: - sessions: the total number of sessions; - tabsPerSession: the total number of tabs per session; - id: the session global index (0-indexed); - index: the tab global index (0-indexed); - tabIndex: the tab index in the current session (0-indexed); - pid: the process pid; - env: the environment variables object; - params: the script parameters object. You can use these variables to create custom URL schemes that suit your application's needs.

*Type*: `string`

*Default*: `""`

## videoPath
The fake video path; if set, the video will be used as fake media source. It accepts a single path or a comma-separated list of videos paths that will be used in round-robin by the started sessions. The docker pre-built image contains a 2 minutes video sequence stored at `/app/video.mp4`. It accepts a local file, an http endpoint or a string starting with
`generate:` (example: `generate:null` will generate a black video with silent audio). The temporary files containing the raw video and audio will be stored at `${VIDEO_CACHE_PATH}/video.${VIDEO_FORMAT}` and `${VIDEO_CACHE_PATH}/audio.wav`.

*Type*: `string`

*Default*: `"https://github.com/vpalmisano/webrtcperf/releases/download/videos-1.0/kt.mp4"`

## videoWidth
The fake video resize width.

*Type*: `positive int`

*Default*: `1280`

## videoHeight
The fake video resize height.

*Type*: `positive int`

*Default*: `720`

## videoFramerate
The fake video framerate.

*Type*: `positive int`

*Default*: `25`

## videoSeek
The fake audio/video seek position in seconds.

*Type*: `positive int`

*Default*: `0`

## videoDuration
The fake audio/video duration in seconds.

*Type*: `positive int`

*Default*: `120`

## videoCacheRaw
If the temporary video and audio raw files can be reused across multiple runs.

*Type*: `boolean`

*Default*: `true`

## videoCachePath
The path where the video and audio raw files are stored.

*Type*: `string`

*Default*: `"$HOME/.webrtcperf/cache"`

## videoFormat
The fake video file format presented to the browser.

*Type*: `[
  "y4m",
  "mjpeg"
]`

*Default*: `"y4m"`

## useFakeMedia
If true, the audio/video/screenshare will be generated using the browser fake device.
Otherwise, the audio and video streams will be captured from a video element attached to the page, 
while the screenshare will be captured from a new browser tab.

*Type*: `boolean`

*Default*: `true`

## runDuration
If greater than 0, the test will stop after the provided number of seconds.

*Type*: `positive int`

*Default*: `0`

## throttleConfig
A JSON5 string with a valid throttler configuration (https://github.com/vpalmisano/throttler). Example: 
  ```javascript
  [{
    sessions: '0-1',
    device: 'eth0',
    protocol: 'udp',
    skipSourcePorts: "443",
    skipDestinationPorts: "443",
    filter: "--sports 443 --dports 443",
    match: 'nbyte("ababa" at 12 layer 1)',
    capture: 'capture.pcap',
    up: {
      rate: 1000,
      delay: 50,
      loss: 5,
      queue: 10,
    },
    down: [
      { rate: 2000, delay: 50, delayJitter: 10, delayJitterCorrelation: 25, loss: 2, lossBurst: 2, queue: 20 },
      { rate: 1000, delay: 50, loss: 2, queue: 20, at: 60 },
    ]
  }]
  ```
- The sessions field represents the sessions IDs range that will be affected by the rule, e.g.: "0-10", "2,4" or simply "2".
- The device, protocol, up, down fields are optional. When device is not set, the default route device will be used. If protocol is specified ('udp' or 'tcp'), only the packets with the specified protocol will be affected by the shaping rules.
- The capture field is optional and specifies the pcap file to save the captured packets.
- With skipSourcePorts and skipDestinationPorts you can specify a comma-separated list of ports that will not be affected by the shaping rules.
- The filter field is optional and specifies the additional IPTables filter to apply for filtering the packets.
- The match field is optional and specifies the additional match rule to apply for filtering the packets (https://man7.org/linux/man-pages/man8/tc-ematch.8.html).
- The up and down fields are optional and they specify the upstream and downstream shaping rules. The possible options for the up and down rules could be:
  - rate: the shaping rate in Kbps;
  - delay: the shaping delay in milliseconds;
  - delayJitter: the shaping delay jitter in milliseconds;
  - delayJitterCorrelation: the shaping delay jitter correlation in milliseconds;
  - loss: the packet loss percentage;
  - lossBurst: the packet loss burst percentage;
  - queue: the shaping queue size in packets;
  - at: the time in seconds when the shaping rule will be applied (default: 0).
The up and down rules can be specified as a single object or an array of objects.
When using an array of objects, specify a different "at" value for each of them, in order to apply a sequence of actions; please note that only the specified properties will override previous ones, so you can omit the values that you don't want to change.       

*Type*: `string`

*Default*: `""`

## useBrowserThrottling
If true, the network will be throttled using the browser internal throttling mechanism.

*Type*: `boolean`

*Default*: `true`

## randomAudioPeriod
If not zero, it specifies the maximum period in seconds after which a new random active session is selected, enabling the getUserMedia audio tracks in that session and disabling all of the others.

*Type*: `positive int`

*Default*: `0`

## randomAudioProbability
When using random audio period, it defines the probability % that the selected audio will be activated (value: 0-100).

*Type*: `positive int`

*Default*: `100`

## randomAudioRange
When using random audio period, it defines the session indexes to be included into the random selection (default: include all the sessions).

*Type*: `index`

*Default*: `"true"`

## chromiumPath
The Chromium executable path.

*Type*: `string`

*Default*: `""`

## chromiumVersion
The Chromium version. It will be downloaded if the chromium path is not provided.

*Type*: `string`

*Default*: `"150.0.7871.24"`

## chromiumUrl
The remote Chromium URL (`http://HOST:PORT`).
If provided, the remote instance will be used instead of running a local
chromium process.

*Type*: `string`

*Default*: `""`

## chromiumFieldTrials
Chromium additional field trials.

*Type*: `string`

*Default*: `""`

## windowWidth
The browser window width.

*Type*: `positive int`

*Default*: `1920`

## windowHeight
The browser window height.

*Type*: `positive int`

*Default*: `1080`

## deviceScaleFactor
The browser device scale factor.

*Type*: `float`

*Default*: `1`

## maxVideoDecoders
Specifies the maximum number of concurrent WebRTC video decoder instances that can be created on the same host.
If set it will disable the received video resolution and jitter buffer stats. This option is supported only when using the custom chromium build. The total decoders count is stored into the virtual file `/dev/shm/chromium-video-decoders`

*Type*: `number`

*Default*: `-1`

## maxVideoDecodersRange
It applies the max video decoders option to the sessions included into this list (default: include all the sessions)

*Type*: `index`

*Default*: `"true"`

## incognito
Runs the browser in incognito mode.

*Type*: `boolean`

*Default*: `false`

## display
If unset, the browser will run in headless mode, otherwise it will run in normal windowed mode.
When running on MacOS or Windows, set it to any not-empty string.
On Linux, set it to a valid X server `DISPLAY` string (e.g. `:0`).

*Type*: `string`

*Default*: `""`

## sessions
The number of browser sessions to start.

*Type*: `positive int`

*Default*: `0`

## tabsPerSession
The number of tabs to open in each browser session.

*Type*: `positive int`

*Default*: `1`

## startSessionId
The starting ID assigned to sessions.

*Type*: `positive int`

*Default*: `0`

## startTimestamp
The start timestamp (in milliseconds). If 0, the value will be calculated using `Date.now()`

*Type*: `positive int`

*Default*: `0`

## enableDetailedStats
If detailed participant metrics values should be collected.

*Type*: `index`

*Default*: `"0-24"`

## spawnRate
The pages spawn rate (pages/s).

*Type*: `float`

*Default*: `1`

## showPageLog
If `true`, the pages console logs will be shown on console. Set to false to disable the page logs.

*Type*: `boolean`

*Default*: `false`

## pageLogFilter
If set, only the logs with the matching text will be printed on the console. Regexp string allowed.

*Type*: `string`

*Default*: `""`

## pageLogPath
If set, the page console logs will be saved on the selected file path.

*Type*: `string`

*Default*: `""`

## enableBrowserLogging
It enables the Chromium browser logging for the specified session indexes. It requires the pageLogPath option to be set.

*Type*: `index`

*Default*: `""`

## enableRtpDump
It enables the RTP dump for the specified session indexes. It requires the enableBrowserLogging option to be set. The text2pcap utility is required to convert the RTP dump to pcap format.

*Type*: `index`

*Default*: `""`

## userAgent
The user agent override.

*Type*: `string`

*Default*: `"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.24 Safari/537.36"`

## scriptPath
One or more JavaScript file paths (comma-separated). If set, the files contents will be executed inside each opened tab page; the following global variables will be attached to the `webrtcperf` global object: `WEBRTC_PERF_SESSION` the session number (0-indexed); `WEBRTC_PERF_TAB` the tab number inside the same session (0-indexed); `WEBRTC_PERF_INDEX` the page absolute index (0-indexed).
Suggested values for automated testing:
- meet.google.com: https://raw.githubusercontent.com/vpalmisano/webrtcperf/refs/heads/devel/examples/google-meet.js
- meet.livekit.io: https://raw.githubusercontent.com/vpalmisano/webrtcperf/refs/heads/devel/examples/livekit.js


*Type*: `string`

*Default*: `""`

## scriptParams
Additional parameters (in JSON format) that will be exposed into
the page context as `webrtcperf.params`.

*Type*: `string`

*Default*: `""`

## disabledVideoCodecs
A string with the video codecs to disable (comma-separated); e.g. `vp9,av1`

*Type*: `string`

*Default*: `""`

## localStorage
A JSON string with the `localStorage` object to be set on page load.

*Type*: `string`

*Default*: `""`

## sessionStorage
A JSON string with the `sessionStorage` object to be set on page load.

*Type*: `string`

*Default*: `""`

## clearCookies
If true, all the page cookies are cleared.

*Type*: `boolean`

*Default*: `false`

## enableGpu
It enables the GPU acceleration (experimental). Set to "desktop" to use the host X server instance.

*Type*: `string`

*Default*: `""`

## blockedUrls
A comma-separated list of request URLs that will be automatically blocked.

*Type*: `string`

*Default*: `""`

## extraHeaders
A dictionary of headers keyed by the url in JSON5 format (e.g. `{ "https://url.com/*": { "header-name": "value" } }`).

*Type*: `string`

*Default*: `""`

## responseModifiers
A dictionary of content replacements keyed by the url in JSON5 format.
Examples:
- replace strings using a regular expression:
  `{ "https://url.com/*": [{ search: "searchString": replace: "anotherString" }] }`
- completely replace the content:
  `{ "https://url.com/file.js": [{ file: "path/to/newFile.js" }] }`


*Type*: `string`

*Default*: `""`

## downloadResponses
An array of url responses that will be saved to the disk, keyed by the url in JSON5 format.
Example: `[{ urlPattern: "https://url.com/*", output: "save/directory" }]`


*Type*: `string`

*Default*: `""`

## extraCSS
A string with a CSS styles to inject into each page. Rules containing "important" will be replaced with "!important".

*Type*: `string`

*Default*: `""`

## cookies
A string with an array of [CookieParam](https://pptr.dev/api/puppeteer.cookieparam) to set into each page in JSON5 format.

*Type*: `string`

*Default*: `""`

## overridePermissions
A comma-separated list of permissions to grant to the opened url.

*Type*: `string`

*Default*: `""`

## hardwareConcurrency
When set, it overrides the navigator.hardwareConcurrency property.

*Type*: `positive int`

*Default*: `0`

## debuggingPort
The chrome debugging port. If this value != 0, the chrome instance will listen on the provided port + the start-session-id value.

*Type*: `positive int`

*Default*: `0`

## debuggingAddress
The chrome debugging listening address. If unset, the network default interface address will be used.

*Type*: `string`

*Default*: `"127.0.0.1"`

## emulateCpuThrottling
The emulated CPU throttling factor. If set, the page will be throttled to the specified factor.

*Type*: `positive int`

*Default*: `0`

## showStats
If the statistics should be displayed on the console output.

*Type*: `boolean`

*Default*: `true`

## statsPath
The log file path; if set, the stats will be written in a .csv file inside that file.

*Type*: `string`

*Default*: `""`

## detailedStatsPath
The log file path; if set, the detailed stats will be written in a .csv file inside that file. Use `webrtcperf --plot <detailed-stats-file> <output-file>.html` to generate a HTML plot.

*Type*: `string`

*Default*: `""`

## statsInterval
The stats collect interval in seconds. It should be lower than the Prometheus scraping interval.

*Type*: `positive int`

*Default*: `15`

## rtcStatsTimeout
The timeout in seconds after which the RTC stats coming from inactive hosts are removed. It should be higher than the `statsInterval` value.

*Type*: `positive int`

*Default*: `60`

## customMetrics
A dictionary of custom metrics keys in JSON5 format (e.g. '{ statName1: { labels: ["label1"] } }').

*Type*: `string`

*Default*: `""`

## prometheusPushgateway
If set, logs are sent to the specified Prometheus Pushgateway service (example: "http://127.0.0.1:9091").

*Type*: `string`

*Default*: `""`

## prometheusPushgatewayJobName
The Prometheus Pushgateway job name.

*Type*: `string`

*Default*: `"default"`

## prometheusPushgatewayAuth
The Prometheus Pushgateway basic auth (username:password).

*Type*: `string`

*Default*: `""`

## prometheusPushgatewayGzip
Allows to use gzip encoded pushgateway requests.

*Type*: `boolean`

*Default*: `true`

## alertRules
Alert rules definition (in JSON format).

*Type*: `string`

*Default*: `""`

## alertRulesOutput
The alert rules report output filename. If the file ends with .log extension, a detailed log will be generated, otherwise a JSON report will be generated.

*Type*: `string`

*Default*: `""`

## alertRulesFailPercentile
The alert rules report fails percentile (0-100). With the default value the alert will be successful only when at least 95% of the checks pass.

*Type*: `positive int`

*Default*: `95`

## pushStatsUrl
The URL to push the collected stats.

*Type*: `string`

*Default*: `""`

## pushStatsId
The ID of the collected stats to push.

*Type*: `string`

*Default*: `"default"`

## serverPort
The HTTP server listening port.

*Type*: `positive int`

*Default*: `0`

## serverSecret
The HTTP server basic auth secret. The auth user name is set to `admin` by default.

*Type*: `string`

*Default*: `"secret"`

## serverUseHttps
If true, the server will use the HTTPS protocol.

*Type*: `boolean`

*Default*: `false`

## serverData
An optional path that the HTTP server will expose with the /data endpoint.

*Type*: `string`

*Default*: `""`

## vmafPath
When set, it runs the VMAF calculator for the video files saved under the provided directory path.

*Type*: `string`

*Default*: `""`

## vmafPreview
If true, for each VMAF comparison it creates a side-by-side video with the reference and degraded versions.

*Type*: `boolean`

*Default*: `false`

## vmafKeepIntermediateFiles
If true, the VMAF intermediate files will not be deleted.

*Type*: `boolean`

*Default*: `false`

## vmafKeepSourceFiles
If true, the VMAF source files will not be deleted.

*Type*: `boolean`

*Default*: `true`

## vmafSkipDuplicated
If true, the VMAF will skip duplicated recognized frames.

*Type*: `boolean`

*Default*: `false`

## vmafCrop
If set, the reference and degraded videos will be cropped using the specified configuration in JSON5 format. Crop configuration should be expressed using the ffmpeg crop filter syntax (https://ffmpeg.org/ffmpeg-filters.html#crop). E.g. `{ "Participant-000001_recv-by_Participant-000000": { ref: { w: "iw-10", h: "ih-5" }, deg: { w: "200", h: "200" } } }`

*Type*: `string`

*Default*: `""`

## vmafPrepareVideo
When set, it prepares the selected video applying a timestamp overlay on top of it. The filename must be provided in the format `<video path>,<ID>`, where the selected ID will be used unique video identifier in the overlay.

*Type*: `string`

*Default*: `""`

## vmafProcessVideo
When set, it runs the VMAF video preprocessor, that converts a video file into the IVF format with timestamps matching the overlay recognition. The filename must contain a `recv` or `send` string to identify if the video was a reference (send) or a degraded version (recv), e.g. `Participant1_recv.mp4`.

*Type*: `string`

*Default*: `""`

## vmafVideoCrop
If set, the vmaf prepared/processed video will be cropped using the specified configuration in JSON5 format. Crop configuration should be expressed using the ffmpeg crop filter syntax (https://ffmpeg.org/ffmpeg-filters.html#crop). E.g. `{ w: "iw-10", h: "ih-5", x: "10", y: '5' }`

*Type*: `string`

*Default*: `""`

## visqolPath
When set, it runs the visqol calculator for the audio files saved under the provided directory path.

*Type*: `string`

*Default*: `""`

## visqolKeepSourceFiles
If true, the visqol source files will not be deleted.

*Type*: `boolean`

*Default*: `true`



---


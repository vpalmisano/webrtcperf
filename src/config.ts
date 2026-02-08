import convict, { addFormats, SchemaObj } from 'convict'
import { z } from 'zod'
import { ipaddress, url } from 'convict-format-with-validator'
import { existsSync } from 'fs'
import os from 'os'
import path, { join } from 'path'
import json5 from 'json5'
import yaml from 'yaml'
import toml from 'toml'
import fs from 'fs'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const puppeteer = require('puppeteer-core')

import { downloadUrl, logger } from './utils'
const log = logger('webrtcperf:config')

const float = {
  name: 'float',
  coerce: (v: string) => parseFloat(v),
  validate: (v: number) => {
    if (!Number.isFinite(v)) throw new Error(`Invalid float: ${v}`)
  },
}

const index = {
  name: 'index',
  coerce: (v: unknown) => v,
  validate: (v: boolean | string | number) => {
    if (typeof v === 'string') {
      if (v === 'true' || v === 'false' || v === '') return
      if (v.includes('-')) {
        v.split('-').forEach(n => {
          if (isNaN(parseInt(n)) || !isFinite(parseInt(n))) throw new Error(`Invalid string index: ${n}`)
        })
        return
      }
      if (v.includes(',')) {
        v.split(',').forEach(n => {
          if (isNaN(parseInt(n)) || !isFinite(parseInt(n))) throw new Error(`Invalid string index: ${n}`)
        })
        return
      }
      if (isNaN(parseInt(v)) || !isFinite(parseInt(v))) throw new Error(`Invalid string index: ${v}`)
      return
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      return
    }
    throw new Error(`Invalid index: "${v}" (type: ${typeof v})`)
  },
}

addFormats({ ipaddress, url, float, index })

convict.addParser([
  { extension: 'json', parse: json5.parse },
  { extension: ['yml', 'yaml'], parse: yaml.parse },
  { extension: 'toml', parse: toml.parse },
])

const configSchema = {
  url: {
    doc: `The page url to load.`,
    format: String,
    default: '',
    nullable: true,
    env: 'URL',
    arg: 'url',
  },
  urlQuery: {
    doc: `The query string to append to the page url; the following template \
variables are replaced: \`$p\` the process pid, \`$s\` the session index, \
\`$S\` the total sessions, \`$t\` the tab index, \`$T\` the total tabs per \
session, \`$i\` the tab absolute index.`,
    format: String,
    default: '',
    nullable: true,
    env: 'URL_QUERY',
    arg: 'url-query',
  },
  customUrlHandler: {
    doc: `This argument specifies the file path for the custom page URL handler that will be exported by default. \
The custom page URL handler allows you to define custom URLs that can be used to open your application. \
The handler function will be called with the following variables: \
- sessions: the total number of sessions; \
- tabsPerSession: the total number of tabs per session; \
- id: the session global index (0-indexed); \
- index: the tab global index (0-indexed); \
- tabIndex: the tab index in the current session (0-indexed); \
- pid: the process pid; \
- env: the environment variables object; \
- params: the script parameters object. \
You can use these variables to create custom URL schemes that suit your application's needs.`,
    format: String,
    default: '',
    nullable: true,
    env: 'CUSTOM_URL_HANDLER',
    arg: 'custom-url-handler',
  },
  // fake video/audio
  videoPath: {
    doc: `The fake video path; if set, the video will be used as fake \
media source. It accepts a single path or a comma-separated list of videos \
paths that will be used in round-robin by the started sessions. \
The docker pre-built image contains a 2 minutes video sequence stored at \
\`/app/video.mp4\`. \
It accepts a local file, an http endpoint or a string starting with
\`generate:\` (example: \`generate:null\` will generate a black video with \
silent audio). \
The temporary files containing the raw video and audio will be stored at \
\`\${VIDEO_CACHE_PATH}/video.\${VIDEO_FORMAT}\` and \
\`\${VIDEO_CACHE_PATH}/audio.wav\`.`,
    format: String,
    default: 'https://github.com/vpalmisano/webrtcperf/releases/download/videos-1.0/kt.mp4',
    env: 'VIDEO_PATH',
    arg: 'video-path',
  },
  videoWidth: {
    doc: `The fake video resize width.`,
    format: 'nat',
    default: 1280,
    env: 'VIDEO_WIDTH',
    arg: 'video-width',
  },
  videoHeight: {
    doc: `The fake video resize height.`,
    format: 'nat',
    default: 720,
    env: 'VIDEO_HEIGHT',
    arg: 'video-height',
  },
  videoFramerate: {
    doc: `The fake video framerate.`,
    format: 'nat',
    default: 25,
    env: 'VIDEO_FRAMERATE',
    arg: 'video-framerate',
  },
  videoSeek: {
    doc: `The fake audio/video seek position in seconds.`,
    format: 'nat',
    default: 0,
    env: 'VIDEO_SEEK',
    arg: 'video-seek',
  },
  videoDuration: {
    doc: `The fake audio/video duration in seconds.`,
    format: 'nat',
    default: 120,
    env: 'VIDEO_DURATION',
    arg: 'video-duration',
  },
  videoCacheRaw: {
    doc: `If the temporary video and audio raw files can be reused across \
multiple runs.`,
    format: 'Boolean',
    default: true,
    env: 'VIDEO_CACHE_RAW',
    arg: 'video-cache-raw',
  },
  videoCachePath: {
    doc: `The path where the video and audio raw files are stored.`,
    format: String,
    default: join(os.homedir(), '.webrtcperf/cache'),
    env: 'VIDEO_CACHE_PATH',
    arg: 'video-cache-path',
  },
  videoFormat: {
    doc: `The fake video file format presented to the browser.`,
    format: ['y4m', 'mjpeg'],
    default: 'y4m',
    env: 'VIDEO_FORMAT',
    arg: 'video-format',
  },
  useFakeMedia: {
    doc: `If true, the audio/video/screenshare will be generated using the browser fake device.
Otherwise, the audio and video streams will be captured from a video element attached to the page, 
while the screenshare will be captured from a new browser tab.`,
    format: 'Boolean',
    default: true,
    env: 'USE_FAKE_MEDIA',
    arg: 'use-fake-media',
  },
  //
  runDuration: {
    doc: `If greater than 0, the test will stop after the provided number of \
seconds.`,
    format: 'nat',
    default: 0,
    env: 'RUN_DURATION',
    arg: 'run-duration',
  },
  throttleConfig: {
    doc: `A JSON5 string with a valid throttler configuration (https://github.com/vpalmisano/throttler). \
Example: \

  \`\`\`javascript
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
  \`\`\`
- The sessions field represents the sessions IDs range that will be affected by the rule, e.g.: "0-10", "2,4" or simply "2".
- The device, protocol, up, down fields are optional. When device is not set, the default route device will be used. If protocol is specified ('udp' or 'tcp'), \
only the packets with the specified protocol will be affected by the shaping rules.
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
When using an array of objects, specify a different "at" value for each of them, in order to apply a sequence of actions; please note that only the specified properties will override previous ones, so you can omit the values that you don't want to change. \
  \
    `,
    format: String,
    nullable: true,
    default: '',
    env: 'THROTTLE_CONFIG',
    arg: 'throttle-config',
  },
  useBrowserThrottling: {
    doc: `If true, the network will be throttled using the browser internal throttling mechanism.`,
    format: 'Boolean',
    default: os.platform() !== 'linux',
    env: 'USE_BROWSER_THROTTLING',
    arg: 'use-browser-throttling',
  },
  randomAudioPeriod: {
    doc: `If not zero, it specifies the maximum period in seconds after which \
a new random active session is selected, enabling the getUserMedia audio tracks in \
that session and disabling all of the others.`,
    format: 'nat',
    default: 0,
    env: 'RANDOM_AUDIO_PERIOD',
    arg: 'random-audio-period',
  },
  randomAudioProbability: {
    doc: `When using random audio period, it defines the probability % that \
the selected audio will be activated (value: 0-100).`,
    format: 'nat',
    default: 100,
    env: 'RANDOM_AUDIO_PROBABILITY',
    arg: 'random-audio-probability',
  },
  randomAudioRange: {
    doc: `When using random audio period, it defines the session indexes \
to be included into the random selection (default: include all the sessions).`,
    format: 'index',
    default: 'true',
    nullable: true,
    env: 'RANDOM_AUDIO_RANGE',
    arg: 'random-audio-range',
  },
  // Session config
  chromiumPath: {
    doc: `The Chromium executable path.`,
    format: String,
    nullable: true,
    default: '',
    env: 'CHROMIUM_PATH',
    arg: 'chromium-path',
  },
  chromiumVersion: {
    doc: `The Chromium version. It will be downloaded if the chromium \
path is not provided.`,
    format: String,
    nullable: false,
    default: puppeteer.PUPPETEER_REVISIONS.chrome,
    env: 'CHROMIUM_VERSION',
    arg: 'chromium-version',
  },
  chromiumUrl: {
    doc: `The remote Chromium URL (\`http://HOST:PORT\`).
If provided, the remote instance will be used instead of running a local
chromium process.`,
    format: String,
    default: '',
    nullable: true,
    env: 'CHROMIUM_URL',
    arg: 'chromium-url',
  },
  chromiumFieldTrials: {
    doc: `Chromium additional field trials.`,
    format: String,
    nullable: true,
    default: '',
    env: 'CHROMIUM_FIELD_TRIALS',
    arg: 'chromium-field-trials',
  },
  windowWidth: {
    doc: `The browser window width.`,
    format: 'nat',
    default: 1920,
    env: 'WINDOW_WIDTH',
    arg: 'window-width',
  },
  windowHeight: {
    doc: `The browser window height.`,
    format: 'nat',
    default: 1080,
    env: 'WINDOW_HEIGHT',
    arg: 'window-height',
  },
  deviceScaleFactor: {
    doc: `The browser device scale factor.`,
    format: 'float',
    default: 1,
    env: 'DEVICE_SCALE_FACTOR',
    arg: 'device-scale-factor',
  },
  maxVideoDecoders: {
    doc: `Specifies the maximum number of concurrent WebRTC video decoder \
instances that can be created on the same host.
If set it will disable the received video resolution and jitter buffer stats. \
This option is supported only when using the custom chromium build. \
The total decoders count is stored into the virtual file \`/dev/shm/chromium-video-decoders\``,
    format: Number,
    default: -1,
    env: 'MAX_VIDEO_DECODERS',
    arg: 'max-video-decoders',
  },
  maxVideoDecodersRange: {
    doc: `It applies the max video decoders option to the sessions included into this list (default: include all the sessions)`,
    format: 'index',
    default: 'true',
    nullable: true,
    env: 'MAX_VIDEO_DECODERS_RANGE',
    arg: 'max-video-decoders-range',
  },
  incognito: {
    doc: `Runs the browser in incognito mode.`,
    format: 'Boolean',
    default: false,
    env: 'INCOGNITO',
    arg: 'incognito',
  },
  display: {
    doc: `If unset, the browser will run in headless mode, otherwise it will run in normal windowed mode.
When running on MacOS or Windows, set it to any not-empty string.
On Linux, set it to a valid X server \`DISPLAY\` string (e.g. \`:0\`).`,
    format: String,
    default: '',
    nullable: true,
    arg: 'display',
  },
  /* audioRedForOpus: {
    doc: `Enables RED for OPUS codec (experimental).`,
    format: 'Boolean',
    default: false,
    env: 'AUDIO_RED_FOR_OPUS',
    arg: 'audio-red-for-opus',
  }, */
  sessions: {
    doc: `The number of browser sessions to start.`,
    format: 'nat',
    default: 0,
    env: 'SESSIONS',
    arg: 'sessions',
  },
  tabsPerSession: {
    doc: `The number of tabs to open in each browser session.`,
    format: 'nat',
    default: 1,
    env: 'TABS_PER_SESSION',
    arg: 'tabs-per-session',
  },
  startSessionId: {
    doc: `The starting ID assigned to sessions.`,
    format: 'nat',
    default: 0,
    env: 'START_SESSION_ID',
    arg: 'start-session-id',
  },
  startTimestamp: {
    doc: `The start timestamp (in milliseconds). If 0, the value will be \
calculated using \`Date.now()\``,
    format: 'nat',
    default: 0,
    env: 'START_TIMESTAMP',
    arg: 'start-timestamp',
  },
  enableDetailedStats: {
    doc: `If detailed participant metrics values should be collected.`,
    format: 'index',
    default: '0-24',
    nullable: true,
    env: 'ENABLE_DETAILED_STATS',
    arg: 'enable-detailed-stats',
  },
  spawnRate: {
    doc: `The pages spawn rate (pages/s).`,
    format: 'float',
    default: 1,
    env: 'SPAWN_RATE',
    arg: 'spawn-rate',
  },
  showPageLog: {
    doc: `If \`true\`, the pages console logs will be shown on console. Set to false to disable the page logs.`,
    format: 'Boolean',
    default: false,
    env: 'SHOW_PAGE_LOG',
    arg: 'show-page-log',
  },
  pageLogFilter: {
    doc: `If set, only the logs with the matching text will be printed \
on the console. Regexp string allowed.`,
    format: String,
    default: '',
    nullable: true,
    env: 'PAGE_LOG_FILTER',
    arg: 'page-log-filter',
  },
  pageLogPath: {
    doc: `If set, the page console logs will be saved on the selected file path.`,
    format: String,
    default: '',
    nullable: true,
    env: 'PAGE_LOG_PATH',
    arg: 'page-log-path',
  },
  enableBrowserLogging: {
    doc: `It enables the Chromium browser logging for the specified session indexes. It requires the pageLogPath option to be set.`,
    format: 'index',
    nullable: true,
    default: '',
    env: 'ENABLE_BROWSER_LOGGING',
    arg: 'enable-browser-logging',
  },
  enableRtpDump: {
    doc: `It enables the RTP dump for the specified session indexes. It requires the enableBrowserLogging option to be set. The text2pcap utility is required to convert the RTP dump to pcap format.`,
    format: 'index',
    nullable: true,
    default: '',
    env: 'ENABLE_RTP_DUMP',
    arg: 'enable-rtp-dump',
  },
  userAgent: {
    doc: `The user agent override.`,
    format: String,
    default: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${puppeteer.PUPPETEER_REVISIONS.chrome} Safari/537.36`,
    nullable: true,
    env: 'USER_AGENT',
    arg: 'user-agent',
  },
  scriptPath: {
    doc: `One or more JavaScript file paths (comma-separated). \
If set, the files contents will be executed inside each opened tab page; \
the following global variables will be attached to the \`webrtcperf\` global object: \
\`WEBRTC_PERF_SESSION\` the session number (0-indexed); \
\`WEBRTC_PERF_TAB\` the tab number inside the same session (0-indexed); \
\`WEBRTC_PERF_INDEX\` the page absolute index (0-indexed).
Suggested values for automated testing:
- meet.google.com: https://raw.githubusercontent.com/vpalmisano/webrtcperf/refs/heads/devel/examples/google-meet.js
- meet.livekit.io: https://raw.githubusercontent.com/vpalmisano/webrtcperf/refs/heads/devel/examples/livekit.js
`,
    format: String,
    default: '',
    env: 'SCRIPT_PATH',
    arg: 'script-path',
  },
  scriptParams: {
    doc: `Additional parameters (in JSON format) that will be exposed into
the page context as \`webrtcperf.params\`.`,
    format: String,
    nullable: true,
    default: '',
    env: 'SCRIPT_PARAMS',
    arg: 'script-params',
  },
  disabledVideoCodecs: {
    doc: `A string with the video codecs to disable (comma-separated); e.g. \`vp9,av1\``,
    format: String,
    nullable: true,
    default: '',
    env: 'DISABLED_VIDEO_CODECS',
    arg: 'disabled-video-codecs',
  },
  localStorage: {
    doc: `A JSON string with the \`localStorage\` object to be set on page \
load.`,
    format: String,
    nullable: true,
    default: '',
    env: 'LOCAL_STORAGE',
    arg: 'local-storage',
  },
  sessionStorage: {
    doc: `A JSON string with the \`sessionStorage\` object to be set on page \
load.`,
    format: String,
    nullable: true,
    default: '',
    env: 'SESSION_STORAGE',
    arg: 'session-storage',
  },
  clearCookies: {
    doc: `If true, all the page cookies are cleared.`,
    format: 'Boolean',
    default: false,
    env: 'CLEAR_COOKIES',
    arg: 'clear-cookies',
  },
  enableGpu: {
    doc: `It enables the GPU acceleration (experimental). Set to "desktop" to \
use the host X server instance.`,
    format: String,
    nullable: true,
    default: '',
    env: 'ENABLE_GPU',
    arg: 'enable-gpu',
  },
  blockedUrls: {
    doc: `A comma-separated list of request URLs that will be automatically \
blocked.`,
    format: String,
    nullable: true,
    default: '',
    env: 'BLOCKED_URLS',
    arg: 'blocked-urls',
  },
  extraHeaders: {
    doc: `A dictionary of headers keyed by the url in JSON5 format (e.g. \
\`{ "https://url.com/*": { "header-name": "value" } }\`).`,
    format: String,
    nullable: true,
    default: '',
    env: 'EXTRA_HEADERS',
    arg: 'extra-headers',
  },
  responseModifiers: {
    doc: `A dictionary of content replacements keyed by the url in JSON5 format.
Examples:
- replace strings using a regular expression:
  \`{ "https://url.com/*": [{ search: "searchString": replace: "anotherString" }] }\`
- completely replace the content:
  \`{ "https://url.com/file.js": [{ file: "path/to/newFile.js" }] }\`
`,
    format: String,
    nullable: true,
    default: '',
    env: 'RESPONSE_MODIFIERS',
    arg: 'response-modifiers',
  },
  downloadResponses: {
    doc: `An array of url responses that will be saved to the disk, keyed by the url in JSON5 format.
Example: \`[{ urlPattern: "https://url.com/*", output: "save/directory" }]\`
`,
    format: String,
    nullable: true,
    default: '',
    env: 'DOWNLOAD_RESPONSES',
    arg: 'download-responses',
  },
  extraCSS: {
    doc: `A string with a CSS styles to inject into each page. \
Rules containing "important" will be replaced with "!important".`,
    format: String,
    nullable: true,
    default: '',
    env: 'EXTRA_CSS',
    arg: 'extra-css',
  },
  cookies: {
    doc: `A string with an array of [CookieParam](https://pptr.dev/api/puppeteer.cookieparam) to set into each page in JSON5 format.`,
    format: String,
    nullable: true,
    default: '',
    env: 'COOKIES',
    arg: 'cookies',
  },
  overridePermissions: {
    doc: `A comma-separated list of permissions to grant to the opened url.`,
    format: String,
    nullable: true,
    default: '',
    env: 'OVERRIDE_PERMISSIONS',
    arg: 'override-permissions',
  },
  hardwareConcurrency: {
    doc: `When set, it overrides the navigator.hardwareConcurrency property.`,
    format: 'nat',
    default: 0,
    env: 'HARDWARE_CONCURRENCY',
    arg: 'hardware-concurrency',
  },
  debuggingPort: {
    doc: `The chrome debugging port. If this value != 0, the chrome instance \
will listen on the provided port + the start-session-id value.`,
    format: 'nat',
    default: 0,
    env: 'DEBUGGING_PORT',
    arg: 'debugging-port',
  },
  debuggingAddress: {
    doc: `The chrome debugging listening address. If unset, the network default interface address will be used.`,
    format: String,
    nullable: true,
    default: '127.0.0.1',
    env: 'DEBUGGING_ADDRESS',
    arg: 'debugging-address',
  },
  emulateCpuThrottling: {
    doc: `The emulated CPU throttling factor. If set, the page will be throttled to the specified factor.`,
    format: 'nat',
    default: 0,
    env: 'EMULATE_CPU_THROTTLING',
    arg: 'emulate-cpu-throttling',
  },
  // stats config
  showStats: {
    doc: `If the statistics should be displayed on the console output.`,
    format: 'Boolean',
    default: true,
    env: 'SHOW_STATS',
    arg: 'show-stats',
  },
  statsPath: {
    doc: `The log file path; if set, the stats will be written in \
a .csv file inside that file.`,
    format: String,
    default: '',
    env: 'STATS_PATH',
    arg: 'stats-path',
  },
  detailedStatsPath: {
    doc: `The log file path; if set, the detailed stats will be written in \
a .csv file inside that file. \
Use \`webrtcperf --plot <detailed-stats-file> <output-file>.html\` to generate a HTML plot.`,
    format: String,
    default: '',
    env: 'DETAILED_STATS_PATH',
    arg: 'detailed-stats-path',
  },
  statsInterval: {
    doc: `The stats collect interval in seconds. It should be lower than the \
Prometheus scraping interval.`,
    format: 'nat',
    default: 15,
    env: 'STATS_INTERVAL',
    arg: 'stats-interval',
  },
  rtcStatsTimeout: {
    doc: `The timeout in seconds after which the RTC stats coming from inactive\
 hosts are removed. It should be higher than the \`statsInterval\` value.`,
    format: 'nat',
    default: 60,
    env: 'RTC_STATS_TIMEOUT',
    arg: 'rtc-stats-timeout',
  },
  customMetrics: {
    doc: `A dictionary of custom metrics keys in JSON5 format (e.g. \
'{ statName1: { labels: ["label1"] } }').`,
    format: String,
    nullable: true,
    default: '',
    env: 'CUSTOM_METRICS',
    arg: 'custom-metrics',
  },
  //
  prometheusPushgateway: {
    doc: `If set, logs are sent to the specified Prometheus Pushgateway \
service (example: "http://127.0.0.1:9091").`,
    format: 'String',
    default: '',
    nullable: true,
    env: 'PROMETHEUS_PUSHGATEWAY',
    arg: 'prometheus-pushgateway',
  },
  prometheusPushgatewayJobName: {
    doc: `The Prometheus Pushgateway job name.`,
    format: 'String',
    default: 'default',
    env: 'PROMETHEUS_PUSHGATEWAY_JOB_NAME',
    arg: 'prometheus-pushgateway-job-name',
  },
  prometheusPushgatewayAuth: {
    doc: `The Prometheus Pushgateway basic auth (username:password).`,
    format: 'String',
    default: '',
    nullable: true,
    env: 'PROMETHEUS_PUSHGATEWAY_AUTH',
    arg: 'prometheus-pushgateway-auth',
  },
  prometheusPushgatewayGzip: {
    doc: `Allows to use gzip encoded pushgateway requests.`,
    format: 'Boolean',
    default: true,
    env: 'PROMETHEUS_PUSHGATEWAY_GZIP',
    arg: 'prometheus-pushgateway-gzip',
  },
  //
  alertRules: {
    doc: `Alert rules definition (in JSON format).`,
    format: String,
    nullable: true,
    default: '',
    env: 'ALERT_RULES',
    arg: 'alert-rules',
  },
  alertRulesOutput: {
    doc: `The alert rules report output filename. If the file ends with .log extension, a detailed log will be generated, otherwise a JSON report will be generated.`,
    format: String,
    nullable: true,
    default: '',
    env: 'ALERT_RULES_OUTPUT',
    arg: 'alert-rules-output',
  },
  alertRulesFailPercentile: {
    doc: `The alert rules report fails percentile (0-100). With the default value the \
alert will be successful only when at least 95% of the checks pass.`,
    format: 'nat',
    nullable: false,
    default: 95,
    env: 'ALERT_RULES_FAIL_PERCENTILE',
    arg: 'alert-rules-fail-percentile',
  },
  pushStatsUrl: {
    doc: `The URL to push the collected stats.`,
    format: String,
    nullable: true,
    default: '',
    env: 'PUSH_STATS_URL',
    arg: 'push-stats-url',
  },
  pushStatsId: {
    doc: `The ID of the collected stats to push.`,
    format: String,
    nullable: true,
    default: 'default',
    env: 'PUSH_STATS_ID',
    arg: 'push-stats-id',
  },
  // server config
  serverPort: {
    doc: `The HTTP server listening port.`,
    format: 'nat',
    nullable: true,
    default: 0,
    env: 'SERVER_PORT',
    arg: 'server-port',
  },
  serverSecret: {
    doc: `The HTTP server basic auth secret. The auth user name is set to \`admin\` by default.`,
    format: String,
    default: 'secret',
    env: 'SERVER_SECRET',
    arg: 'server-secret',
  },
  serverUseHttps: {
    doc: `If true, the server will use the HTTPS protocol.`,
    format: 'Boolean',
    default: false,
    env: 'SERVER_USE_HTTPS',
    arg: 'server-use-https',
  },
  serverData: {
    doc: `An optional path that the HTTP server will expose with the /data endpoint.`,
    format: String,
    nullable: true,
    default: '',
    env: 'SERVER_DATA',
    arg: 'server-data',
  },
  // VMAF config
  vmafPath: {
    doc: `When set, it runs the VMAF calculator for the video files saved under the provided directory path.`,
    format: String,
    nullable: true,
    default: '',
    env: 'VMAF_PATH',
    arg: 'vmaf-path',
  },
  vmafPreview: {
    doc: `If true, for each VMAF comparison it creates a side-by-side video with \
the reference and degraded versions.`,
    format: 'Boolean',
    default: false,
    env: 'VMAF_PREVIEW',
    arg: 'vmaf-preview',
  },
  vmafKeepIntermediateFiles: {
    doc: `If true, the VMAF intermediate files will not be deleted.`,
    format: 'Boolean',
    default: false,
    env: 'VMAF_KEEP_INTERMEDIATE_FILES',
    arg: 'vmaf-keep-intermediate-files',
  },
  vmafKeepSourceFiles: {
    doc: `If true, the VMAF source files will not be deleted.`,
    format: 'Boolean',
    default: true,
    env: 'VMAF_KEEP_SOURCE_FILES',
    arg: 'vmaf-keep-source-files',
  },
  vmafSkipDuplicated: {
    doc: `If true, the VMAF will skip duplicated recognized frames.`,
    format: 'Boolean',
    default: false,
    env: 'VMAF_SKIP_DUPLICATED',
    arg: 'vmaf-skip-duplicated',
  },
  vmafCrop: {
    doc: `If set, the reference and degraded videos will be cropped using the specified configuration in JSON5 format. \
Crop configuration should be expressed using the ffmpeg crop filter syntax (https://ffmpeg.org/ffmpeg-filters.html#crop). \
E.g. \`{ "Participant-000001_recv-by_Participant-000000": { ref: { w: "iw-10", h: "ih-5" }, deg: { w: "200", h: "200" } } }\``,
    format: String,
    nullable: true,
    default: '',
    env: 'VMAF_CROP',
    arg: 'vmaf-crop',
  },
  vmafPrepareVideo: {
    doc: `When set, it prepares the selected video applying a timestamp overlay on top of it. \
The filename must be provided in the format \`<video path>,<ID>\`, where the selected ID will be used unique video identifier in the overlay.`,
    format: String,
    nullable: true,
    default: '',
    env: 'VMAF_PREPARE_VIDEO',
    arg: 'vmaf-prepare-video',
  },
  vmafProcessVideo: {
    doc: `When set, it runs the VMAF video preprocessor, that converts a video file into the IVF format with timestamps matching the overlay recognition. \
The filename must contain a \`recv\` or \`send\` string to identify if the video was a reference (send) or a degraded version (recv), e.g. \`Participant1_recv.mp4\`.`,
    format: String,
    nullable: true,
    default: '',
    env: 'VMAF_PROCESS_VIDEO',
    arg: 'vmaf-process-video',
  },
  vmafVideoCrop: {
    doc: `If set, the vmaf prepared/processed video will be cropped using the specified configuration in JSON5 format. \
Crop configuration should be expressed using the ffmpeg crop filter syntax (https://ffmpeg.org/ffmpeg-filters.html#crop). \
E.g. \`{ w: "iw-10", h: "ih-5", x: "10", y: '5' }\``,
    format: String,
    nullable: true,
    default: '',
    env: 'VMAF_VIDEO_CROP',
    arg: 'vmaf-video-crop',
  },
  // VISQOL config
  visqolPath: {
    doc: `When set, it runs the visqol calculator for the audio files saved under the provided directory path.`,
    format: String,
    nullable: true,
    default: '',
    env: 'VISQOL_PATH',
    arg: 'visqol-path',
  },
  visqolKeepSourceFiles: {
    doc: `If true, the visqol source files will not be deleted.`,
    format: 'Boolean',
    default: true,
    env: 'VISQOL_KEEP_SOURCE_FILES',
    arg: 'visqol-keep-source-files',
  },
}

type ConfigDocs = Record<string, { doc: string; format: string; default: string }>

/**
 * Formats the schema documentation, calling the same function recursively.
 * @param docs the documentation object to extend
 * @param property the root property
 * @param schema the config schema fragment
 * @return the documentation object
 */
function formatDocs(
  docs: ConfigDocs,
  property: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
): ConfigDocs {
  if (schema._cvtProperties) {
    Object.entries(schema._cvtProperties).forEach(([name, value]) => {
      formatDocs(docs, `${property ? `${property}.` : ''}${name}`, value)
    })
    return docs
  }

  if (property) {
    docs[property] = {
      doc: schema.doc,
      format: JSON.stringify(schema.format, null, 2),
      default: JSON.stringify(schema.default, null, 2),
    }
  }
  return docs
}

/**
 * It returns the formatted configuration docs.
 */
export function getConfigDocs(): ConfigDocs {
  return formatDocs({}, null, convict(configSchema).getSchema())
}

/**
 * Returns a Zod schema for the config object, with all parameters optional and described.
 * Uses the config default values when a field is omitted. Useful for MCP tools and other
 * consumers that need validated partial config.
 */
export function getConfigZodSchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const schema = convict(configSchema).getSchema()
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, value] of Object.entries(schema._cvtProperties)) {
    const prop = value as SchemaObj & { doc?: string; format?: unknown; default?: unknown }
    const doc = prop.doc ?? key
    const def = prop.default
    const format = prop.format
    let zodType: z.ZodTypeAny
    if (format === String || format === 'string') {
      zodType = z.string()
    } else if (format === 'nat' || format === Number) {
      zodType = z.number()
    } else if (format === 'float') {
      zodType = z.number()
    } else if (format === 'Boolean' || format === 'boolean') {
      zodType = z.boolean()
    } else if (format === 'index') {
      zodType = z.union([z.string(), z.number(), z.boolean()])
    } else if (Array.isArray(format)) {
      zodType = z.enum(format as [string, ...string[]])
    } else {
      zodType = z.union([z.string(), z.number(), z.boolean()])
    }
    shape[key] = def !== undefined ? zodType.default(def).describe(doc) : zodType.optional().describe(doc)
  }
  return z.object(shape)
}

const _schemaProperties = convict(configSchema).getProperties()

/** [[include:config.md]] */
export type Config = typeof _schemaProperties

/**
 * Loads the config object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadConfig(filePath?: string, values?: any): Promise<Config[]> {
  const configs: Config[] = []
  if (filePath) {
    if (filePath.startsWith('http')) {
      log.debug(`Loading config from url: ${filePath}`)
      const res = await downloadUrl(filePath)
      if (!res?.data) {
        throw new Error(`Failed to download configuration from: ${filePath}`)
      }
      values =
        res.contentType === 'application/x-yaml'
          ? yaml.parse(res.data)
          : res.contentType === 'application/toml'
            ? toml.parse(res.data)
            : json5.parse(res.data)
    } else {
      if (!existsSync(filePath)) {
        throw new Error(`Config file not found: ${filePath}`)
      }
      log.debug(`Loading config from local file: ${filePath}`)
      if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
        const module = await import(/* webpackIgnore: true */ path.resolve(filePath))
        values = await module.default(process.argv)
      } else {
        const data = String(await fs.promises.readFile(filePath))
        values =
          filePath.endsWith('.yml') || filePath.endsWith('.yaml')
            ? yaml.parse(data)
            : filePath.endsWith('.toml')
              ? toml.parse(data)
              : json5.parse(data)
      }
    }
  }
  if (!Array.isArray(values)) {
    values = [values || {}]
  }
  for (const value of values) {
    const schema = convict(configSchema)
    schema.load(value || {})
    schema.validate({ allowed: 'strict' })
    configs.push(schema.getProperties())
  }
  log.debug('Using config:', configs)
  return configs
}

function getFunctionDeclaration() {
  const properties: Record<string, { type: string; description: string; nullable?: boolean }> = {}
  const required: string[] = []
  const schema = convict(configSchema).getSchema()

  Object.entries(schema._cvtProperties).forEach(([name, value]) => {
    const { format, doc, nullable } = value as SchemaObj
    properties[name] = {
      type: format as string,
      description: doc as string,
      nullable,
    }
  })

  return {
    name: 'webrtcperf',
    description: 'Starts a webrtcperf test.',
    parameters: {
      type: 'object',
      properties,
      required,
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GoogleGenAI } = require('@google/genai')

export async function loadConfigFromPrompt(prompt: string) {
  log.debug(`loadConfigFromPrompt: "${prompt}"`)
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set. Please set it to use the Google GenAI API.')
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      tools: [
        {
          functionDeclarations: [getFunctionDeclaration()],
        },
      ],
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  })
  if (response.functionCalls && response.functionCalls.length > 0) {
    const functionCall = response.functionCalls[0]
    log.debug('Using function call:', functionCall.name, functionCall.args)
    return functionCall.args
  } else {
    throw new Error('No function call found in the response. Please check the prompt and try again.')
  }
}

import convict, { addFormats } from 'convict'
import { ipaddress, url } from 'convict-format-with-validator'
import { existsSync } from 'fs'
import os from 'os'
import { join } from 'path'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const puppeteer = require('puppeteer-core')

import { logger } from './utils'
const log = logger('app:config')

const float = {
  name: 'float',
  coerce: (v: string) => parseFloat(v),
  validate: (v: number) => {
    if (!Number.isFinite(v)) throw new Error(`Invalid float: ${v}`)
  },
}

addFormats({ ipaddress, url, float })

// config schema
const configSchema = convict({
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
The custom page URL handler allows you to define custom URLs that can be used to open your application, \
and provides the following variables for customization: \`$p\`: the process pid, \`$s\`: the session index, \
\`$S\`: the total sessions, \`$t\`: the tab index, \`$T\`: the total tabs per session, \`$i\`: the tab absolute index.
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
media source. \
The docker pre-built image contains a 2 minutes video sequence stored at \
\`/app/video.mp4\`. \
It accepts a local file, an http endpoint or a string starting with
\`generate:\` (example: \`generate:null\` will generate a black video with \
silent audio). \
The temporary files containing the raw video and audio will be stored at \
\`\${VIDEO_CACHE_PATH}/video.\${VIDEO_FORMAT}\` and \
\`\${VIDEO_CACHE_PATH}/audio.wav\`.`,
    format: String,
    default:
      'https://github.com/vpalmisano/webrtcperf/releases/download/v2.0.4/video.mp4',
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
  runDuration: {
    doc: `If greater than 0, the test will stop after the provided number of \
seconds.`,
    format: 'nat',
    default: 0,
    env: 'RUN_DURATION',
    arg: 'run-duration',
  },
  throttleConfig: {
    doc: `A JSON5 string with a valid network throttling configuration, e.g.: \

  \`\`\`javascript
  {
    up: {
      rate: 1000
      rtt: 50
      loss: '5%'
      queue: 10
      protocol: 'udp'
      at: 60
    },
    down: {
      rate: 2000
      rtt: 50
      loss: '5%'
      queue: 20
      protocol: 'udp'
      at: 60
    }
  }
  \`\`\`

When used with docker, run \`sudo modprobe ifb numifbs=1\` first and add the \
\`--cap-add=NET_ADMIN\` docker option.`,
    format: String,
    nullable: true,
    default: '',
    env: 'THROTTLE_CONFIG',
    arg: 'throttle-config',
  },
  randomAudioPeriod: {
    doc: `If not zero, it specifies the maximum period in seconds after which \
a new random active tab is selected, enabling the getUserMedia audio tracks in \
that tab and disabling all of the other tabs.`,
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
    doc: `When using random audio period, it defines the number of pages \
to be included into the random selection.`,
    format: 'nat',
    default: 0,
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
  chromiumRevision: {
    doc: `The Chromium revision number. It will be downloaded if the chromium \
path is not provided.`,
    format: String,
    nullable: false,
    default: puppeteer.default.browserRevision,
    env: 'CHROMIUM_REVISION',
    arg: 'chromium-revision',
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
    doc: `Chromium additional field trials (comma-separated).`,
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
    format: 'nat',
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
  maxVideoDecodersAt: {
    doc: `Applies the maxVideoDecoders option starting from this session \`ID\`.`,
    format: Number,
    default: -1,
    env: 'MAX_VIDEO_DECODERS_AT',
    arg: 'max-video-decoders-at',
  },
  incognito: {
    doc: `Runs the browser in incognito mode.`,
    format: 'Boolean',
    default: false,
    env: 'INCOGNITO',
    arg: 'incognito',
  },
  display: {
    doc: `If unset, the browser will run in headless mode.
When running on MacOS or Windows, set it to any not-empty string.
On Linux, set it to a valid X server \`DISPLAY\` string (e.g. \`:0\`).`,
    format: String,
    default: '',
    nullable: true,
    env: 'DISPLAY',
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
    default: 1,
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
  spawnRate: {
    doc: `The pages spawn rate (pages/s).`,
    format: 'float',
    default: 1,
    env: 'SPAWN_RATE',
    arg: 'spawn-rate',
  },
  showPageLog: {
    doc: `If \`true\`, the pages console logs will be shown on console.`,
    format: 'Boolean',
    default: true,
    env: 'SHOW_PAGE_LOG',
    arg: 'show-page-log',
  },
  pageLogFilter: {
    doc: `If set, only the logs with the matching text will be printed \
on console. Regexp string allowed.`,
    format: String,
    default: '',
    nullable: true,
    env: 'PAGE_LOG_FILTER',
    arg: 'page-log-filter',
  },
  pageLogPath: {
    doc: `If set, page console logs will be saved on the selected file path.`,
    format: String,
    default: '',
    nullable: true,
    env: 'PAGE_LOG_PATH',
    arg: 'page-log-path',
  },
  userAgent: {
    doc: `The user agent override.`,
    format: String,
    default: '',
    nullable: true,
    env: 'USER_AGENT',
    arg: 'user-agent',
  },
  scriptPath: {
    doc: `One or more JavaScript file paths (comma-separated). \
If set, the files contents will be executed inside each opened tab page; \
the following global variables will be attached to the \`window\` object: \
\`WEBRTC_STRESS_TEST_SESSION\` the session number (1-indexed); \
\`WEBRTC_STRESS_TEST_TAB\` the tab number inside the same session (1-indexed); \
\`WEBRTC_STRESS_TEST_INDEX\` the page absolute index (1-indexed). \
`,
    format: String,
    default: '',
    env: 'SCRIPT_PATH',
    arg: 'script-path',
  },
  scriptParams: {
    doc: `Additional parameters (in JSON format) that will be exposed into
the page context as \`window.PARAMS\`.`,
    format: String,
    nullable: true,
    default: '',
    env: 'SCRIPT_PARAMS',
    arg: 'script-params',
  },
  getUserMediaOverride: {
    doc: `A JSON string with the \`getUserMedia\` constraints to override for \
each tab in each session; \
e.g. \`{"video": {"width": 360, "height": 640}}\``,
    format: String,
    nullable: true,
    default: '',
    env: 'GET_USER_MEDIA_OVERRIDE',
    arg: 'get-user-media-override',
  },
  getDisplayMediaOverride: {
    doc: `A JSON string with the \`getDisplayMedia\` constraints to override \
for each tab in each session; \
e.g. \`{"video": {"width": 360, "height": 640}}\``,
    format: String,
    nullable: true,
    default: '',
    env: 'GET_DISPLAY_MEDIA_OVERRIDE',
    arg: 'get-display-media-override',
  },
  getDisplayMediaType: {
    doc: `The fake display type to use for \`getDisplayMedia\`. It could be \`monitor\`, \`window\` or \`browser\`,`,
    format: String,
    default: 'monitor',
    env: 'GET_DISPLAY_MEDIA_TYPE',
    arg: 'get-display-media-type',
  },
  getDisplayMediaCrop: {
    doc: `An HTML selector used for cropping the \`getDisplayMedia\` video track.`,
    format: String,
    nullable: true,
    default: '',
    env: 'GET_DISPLAY_MEDIA_CROP',
    arg: 'get-display-media-crop',
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
  enableBrowserLogging: {
    doc: `It enables the Chromium browser logging to standard output.`,
    format: 'Boolean',
    default: false,
    env: 'ENABLE_BROWSER_LOGGING',
    arg: 'enable-browser-logging',
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
    doc: `A dictionary of headers keyed by the url in JSON format (e.g. \
\`{ "https://url.com": { "header-name": "value" } }\`).`,
    format: String,
    nullable: true,
    default: '',
    env: 'EXTRA_HEADERS',
    arg: 'extra-headers',
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
    doc: `A string with the cookies to set into each page in JSON format.`,
    format: String,
    nullable: true,
    default: '',
    env: 'COOKIES',
    arg: 'cookies',
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
    doc: `The chrome debugging listen address. Valid only if \`debugging-port\` \
is provided.`,
    format: String,
    nullable: true,
    default: '127.0.0.1',
    env: 'DEBUGGING_ADDRESS',
    arg: 'debugging-address',
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
    doc: `The log file directory path; if set, the log data will be written in \
a .csv file inside this directory; if the directory path does not exist, it \
will be created.`,
    format: String,
    default: '',
    env: 'STATS_PATH',
    arg: 'stats-path',
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
  alertRulesFilename: {
    doc: `The alert rules report output filename.`,
    format: String,
    nullable: true,
    default: '',
    env: 'ALERT_RULES_FILENAME',
    arg: 'alert-rules-filename',
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
})

type ConfigDocs = Record<
  string,
  { doc: string; format: string; default: string }
>

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
    docs[property] =
      // eslint-disable-line no-param-reassign
      {
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
  return formatDocs({}, null, configSchema.getSchema())
}

const schemaProperties = configSchema.getProperties()

/** [[include:config.md]] */
export type Config = typeof schemaProperties

/**
 * Loads the config object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadConfig(filePath?: string, values?: any): Config {
  if (filePath && existsSync(filePath)) {
    log.debug(`Loading config from ${filePath}`)
    configSchema.loadFile(filePath)
  } else if (values) {
    log.debug('Loading config from values.')
    configSchema.load(values)
  } else {
    log.debug('Using default values.')
    configSchema.load({})
  }

  configSchema.validate({ allowed: 'strict' })
  const config = configSchema.getProperties()

  log.debug('Using config:', config)
  return config
}

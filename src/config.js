const log = require('debug-level')('app:config');
const convict = require('convict');
const fs = require('fs');

convict.addFormat(require('convict-format-with-validator').ipaddress);

const configSchema = convict({
  url: {
    doc: `The page url to load (mandatory).`,
    format: String,
    default: '',
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
    env: 'URL_QUERY',
    arg: 'url-query',
  },
  // fake video/audio
  videoPath: {
    doc: `A javascript file path; if set, the file content will be injected \
inside the DOM of each opened tab page; the following global variables are \
attached to the \`window\` object: \`WEBRTC_STRESS_TEST_SESSION\` the session \
number; \`WEBRTC_STRESS_TEST_TAB\` the tab number inside the session; \
\`WEBRTC_STRESS_TEST_INDEX\` the tab absolute index.`,
    format: String,
    default: '',
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
    default: '/tmp/webrtc-stress-test',
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
  //
  chromiumPath: {
    doc: `The Chromium executable path.`,
    format: String,
    default: '/usr/bin/chromium-browser-unstable',
    env: 'CHROMIUM_PATH',
    arg: 'chromium-path',
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
  useNullVideoDecoder: {
    doc: `Disables the video decoding. This affects the RTC video jitter \
buffer stats.`,
    format: 'Boolean',
    default: false,
    env: 'USE_NULL_VIDEO_DECODER',
    arg: 'use-null-video-decoder',
  },
  display: {
    doc: `If set to a valid Xserver \`DISPLAY\` string, the headless mode is \
disabled.`,
    format: String,
    default: null,
    nullable: true,
    env: 'DISPLAY',
    arg: 'display',
  },
  audioRedForOpus: {
    doc: `Enables RED for OPUS codec (experimental).`,
    format: 'Boolean',
    default: false,
    env: 'AUDIO_RED_FOR_OPUS',
    arg: 'audio-red-for-opus',
  },
  //
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
  spawnPeriod: {
    doc: `The sessions spawn period in ms.`,
    format: 'nat',
    default: 1000,
    env: 'SPAWN_PERIOD',
    arg: 'spawn-period',
  },
  enablePageLog: {
    doc: ` If \`true\`, the pages logs will be printed on console.`,
    format: 'Boolean',
    default: false,
    env: 'ENABLE_PAGE_LOG',
    arg: 'enable-page-log',
  },
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
    doc: `The log interval in seconds.`,
    format: 'nat',
    default: 2,
    env: 'STATS_INTERVAL',
    arg: 'stats-interval',
  },
  enableRtcStats: {
    doc: `Enables the collection of RTC stats using ObserveRTC.`,
    format: 'Boolean',
    default: true,
    env: 'ENABLE_RTC_STATS',
    arg: 'enable-rtc-stats',
  },
  rtcStatsTimeout: {
    doc: `The timeout in seconds after wich the RTC stats coming from inactive \
streams are removed.`,
    format: 'nat',
    default: 30,
    env: 'RTC_STATS_TIMEOUT',
    arg: 'rtc-stats-timeout',
  },
  //
  scriptPath: {
    doc: `A javascript file path; if set, the file content will be injected \
inside the DOM of each opened tab page; the following global variables are \
attached to the \`window\` object: \
\`WEBRTC_STRESS_TEST_SESSION\` the session number; \
\`WEBRTC_STRESS_TEST_TAB\` the tab number inside the session; \
\`WEBRTC_STRESS_TEST_INDEX\` the tab absolute index.`,
    format: String,
    default: '',
    env: 'SCRIPT_PATH',
    arg: 'script-path',
  },
  preloadScriptPath: {
    doc: `A javascript file path to be preloaded to each  opened tab page.`,
    format: String,
    default: '',
    env: 'PRELOAD_SCRIPT_PATH',
    arg: 'preload-script-path',
  },
  getUserMediaOverrides: {
    doc: `A JSON string with the \`getUserMedia\` constraints to override for \
each tab in each session; \
e.g. \`[null, {"video": {"width": 360, "height": 640}}]\` \
overrides the \`video\` settings for the second tab in the first session.`,
    format: Array,
    nullable: true,
    default: null,
    env: 'GET_USER_MEDIA_OVERRIDES',
    arg: 'get-user-media-overrides',
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
    doc: `A JSON string with a valid [sitespeedio/throttle](https://github.com/sitespeedio/throttle#use-directly-in-nodejs) \
configuration (e.g. \`{"up": 1000, "down": 1000, "rtt": 200}\`). \
When used with docker, run \`sudo modprobe ifb numifbs=1\` first and add the \
\`--cap-add=NET_ADMIN\` docker option.`,
    format: '*',
    nullable: true,
    default: null,
    env: 'THROTTLE_CONFIG',
    arg: 'throttle-config',
  },
});

/**
 * Formats the schema documentation, calling the same function recursively.
 * @param {Object} docs the documentation object to extend
 * @param {String} property the root property
 * @param {Object} schema the config schema fragment
 * @return {Object} the documentation object
 */
function formatDocs(docs, property, schema) {
  if (schema._cvtProperties) {
    Object.entries(schema._cvtProperties).forEach(([name, value]) => {
      formatDocs(docs, `${property ? `${property}.` : ''}${name}`, value);
    });

    return docs;
  }

  if (property) {
    docs[property] = // eslint-disable-line no-param-reassign
     {
       doc: schema.doc,
       format: JSON.stringify(schema.format, null, 2),
       default: JSON.stringify(schema.default, null, 2),
     };
  }

  return docs;
}

/**
 * It returns the formatted configuration docs.
 * @return {Object}
 */
function getConfigDocs() {
  return formatDocs({}, null, configSchema.getSchema());
}

// load configs
if (fs.existsSync('./config.json')) {
  log.info(`Loading config from './config.json'`);
  configSchema.loadFile('./config.json');
} else {
  log.warn('No config file found, using defaults.');
  configSchema.load({});
}

try {
  configSchema.validate({allowed: 'strict'});
} catch (error) {
  console.error(`Config error: ${error.message}`);
  process.exit(-1);
}

const config = configSchema.getProperties();
log.info('Using config:', config);

module.exports = {
  configSchema,
  getConfigDocs,
  config,
};

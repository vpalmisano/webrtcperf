import { getSessionThrottleValues, throttleLauncher, throttleNotifier } from '@vpalmisano/throttler'
import assert from 'assert'
import EventEmitter from 'events'
import fs from 'fs'
import JSON5 from 'json5'
import { LoremIpsum } from 'lorem-ipsum'
import NodeCache from 'node-cache'
import os from 'os'
import path from 'path'
import puppeteer, {
  Browser,
  BrowserContext,
  CDPSession,
  CookieParam,
  ElementHandle,
  ImageFormat,
  KeyInput,
  Metrics,
  Page,
  Permission,
} from 'puppeteer-core'
import {
  type Interception,
  RequestInterceptionManager,
  getUrlPatternRegExp,
} from 'puppeteer-intercept-and-modify-requests'
import { gunzipSync } from 'zlib'

import { RtcStats, rtcStatKey, updateRtcStats } from './rtcstats'
import { FastStats } from './stats'
import {
  /* PeerConnectionExternal,
  PeerConnectionExternalMethod, */
  checkChromeExecutable,
  downloadUrl,
  enabledForSession,
  getProcessStats,
  getSystemStats,
  hideAuth,
  increaseKey,
  jsonFetchRequest,
  type JsonFetchOptions,
  logger,
  portForwarder,
  resolveIP,
  resolvePackagePath,
  runShellCommand,
  sha256,
  sleep,
  waitStopProcess,
} from './utils'
import { MediaPath } from './media'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: chalk } = require('chalk-template')

// eslint-disable-next-line @typescript-eslint/no-require-imports
const NavigatorHardwareConcurrency = require('puppeteer-extra-plugin-stealth/evasions/navigator.hardwareConcurrency')

const log = logger('webrtcperf:session')

declare global {
  let webrtcperf: {
    getActiveAudioTracks: () => MediaStreamTrack[]
    collectPeerConnectionStats: () => Promise<{
      stats: RtcStats[]
      signalingHost?: string
      participantName?: string
      activePeerConnections: number
      peerConnectionConnectionTime: number
      peerConnectionDisconnectionTime: number
      peerConnectionsCreated: number
      peerConnectionsConnected: number
      peerConnectionsDisconnected: number
      peerConnectionsFailed: number
      peerConnectionsClosed: number
      peerConnectionsDelay: number
    }>
    collectAudioEndToEndStats: () => {
      delay: number
      startFrameDelay: number
    }
    collectVideoEndToEndStats: () => {
      videoDelay: number
      videoStartFrameDelay: number
      screenDelay: number
      screenStartFrameDelay: number
    }
    collectCpuPressure: () => number
    collectQuestionAnswerDelay: () => number
    collectVideoStats: () => {
      width: number
      height: number
      bufferedTime: number
      playingTime: number
      bufferingTime: number
      bufferingEvents: number
    }
    getParticipantName: () => string
    startFakeScreenshare: () => Promise<void>
    stopFakeScreenshare: () => void
  }
  let collectCustomMetrics: () => Promise<Record<string, number | string>>
}

const PageLogColors = {
  error: 'red',
  warn: 'yellow',
  info: 'cyan',
  log: 'grey',
  debug: 'white',
  requestfailed: 'magenta',
}

type PageLogColorsKey = 'error' | 'warn' | 'info' | 'log' | 'debug' | 'requestfailed'

type SessionStats = Record<string, number | Record<string, number>>

export interface SessionParams {
  /** The chromium running instance url. */
  chromiumUrl: string
  /** The chromium executable path. */
  chromiumPath: string
  /** Chromium additional field trials. */
  chromiumFieldTrials: string
  /** The browser width. */
  windowWidth: number
  /** The browser height. */
  windowHeight: number
  /** The browser device scale factor. */
  deviceScaleFactor: number
  /**
   * If unset, the browser will run in headless mode.
   * When running on Linux, set to a valid X display variable (e.g. `:0`).
   */
  display: string
  /** Enables RED for OPUS codec (experimental).  */
  /* audioRedForOpus: boolean */
  /** The page URL. */
  url: string
  /** The page URL query. */
  urlQuery: string
  /** Custom URL handler. */
  customUrlHandler: string
  customUrlHandlerFn?: CustomUrlHandlerFn
  mediaPath?: MediaPath
  videoWidth: number
  videoHeight: number
  videoFramerate: number
  useFakeMedia: boolean
  enableGpu: string
  enableBrowserLogging: string
  enableRtpDump: string
  startTimestamp: number
  sessions: number
  tabsPerSession: number
  spawnPeriod: number
  statsInterval: number
  disabledVideoCodecs: string
  localStorage: string
  sessionStorage: string
  clearCookies: boolean
  scriptPath: string
  showPageLog: boolean
  pageLogFilter: string
  pageLogPath: string
  userAgent: string
  id: number
  throttleIndex: number
  useBrowserThrottling: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluateAfter?: any[]
  exposedFunctions?: string
  scriptParams: string
  blockedUrls: string
  extraHeaders: string
  responseModifiers: string
  downloadResponses: string
  extraCSS: string
  cookies: string
  overridePermissions: string
  hardwareConcurrency: number
  debuggingPort: number
  debuggingAddress: string
  randomAudioPeriod: number
  maxVideoDecoders: number
  maxVideoDecodersRange: string
  incognito: boolean
  serverPort: number
  serverSecret: string
  serverUseHttps: boolean
  emulateCpuThrottling: number
}

export type CustomUrlHandlerFn = (params: {
  id: number
  sessions: number
  tabIndex: number
  tabsPerSession: number
  index: number
  pid: number
  env: Record<string, string>
  params: Record<string, unknown>
}) => Promise<string>

/**
 * Implements a test session instance running on a browser instance.
 */
export class Session extends EventEmitter {
  private readonly chromiumUrl: string
  private readonly chromiumPath?: string
  private readonly chromiumFieldTrials?: string
  private readonly windowWidth: number
  private readonly windowHeight: number
  private readonly deviceScaleFactor: number
  private readonly display: string
  /* private readonly audioRedForOpus: boolean */
  public readonly mediaPath?: MediaPath
  private readonly videoWidth: number
  private readonly videoHeight: number
  private readonly videoFramerate: number
  private readonly useFakeMedia: boolean
  private readonly enableGpu: string
  private readonly enableBrowserLogging: boolean
  private readonly enableRtpDump: boolean
  private readonly startTimestamp: number
  private readonly sessions: number
  private readonly tabsPerSession: number
  private readonly spawnPeriod: number
  private readonly statsInterval: number
  private readonly disabledVideoCodecs: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly localStorage?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly sessionStorage?: any
  private readonly clearCookies: boolean
  private readonly scriptPath: string
  private readonly showPageLog: boolean
  private readonly pageLogFilter: string
  private readonly pageLogPath: string
  private readonly userAgent: string
  private readonly evaluateAfter: {
    // eslint-disable-next-line
    pageFunction: Function
    // eslint-disable-next-line
    args: any
  }[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly exposedFunctions: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly scriptParams: any
  private readonly blockedUrls: string[]
  private readonly extraHeaders?: Record<string, Record<string, string>>
  private readonly responseModifiers: Record<
    string,
    {
      search?: string | RegExp
      replace?: string
      file?: string
      headers?: Record<string, string>
    }[]
  > = {}
  private readonly downloadResponses: { urlPattern: RegExp; output: string; append?: boolean }[] = []
  private readonly extraCSS: string
  private readonly cookies: CookieParam[] = []
  private readonly overridePermissions: Permission[] = []
  private readonly hardwareConcurrency: number
  private readonly debuggingPort: number
  private readonly debuggingAddress: string
  private readonly randomAudioPeriod: number
  private readonly maxVideoDecoders: number
  private readonly maxVideoDecodersRange: string
  private readonly incognito: boolean
  private readonly serverPort: number
  private readonly serverSecret: string
  private readonly serverUseHttps: boolean
  private readonly emulateCpuThrottling: number

  private running = false
  private browser?: Browser
  private context?: BrowserContext
  private stopPortForwarder?: () => void

  /** The numeric id assigned to the session. */
  readonly id: number
  /** The throttle configuration index assigned to the session. */
  readonly throttleIndex: number
  /** If true, the network will be throttled using the browser internal throttling mechanism. */
  readonly useBrowserThrottling: boolean
  /** The test page url. */
  readonly url: string
  /** The url query. */
  readonly urlQuery: string
  /**
   * The custom URL handler. This is the path to a JavaScript module (.mjs) exporting the function.
   * The function itself takes an object as input with the following parameters:
   *
   * @typedef {Object} CustomUrlHandler
   * @property {string} id - The identifier for the URL.
   * @property {string} sessions - The number of sessions.
   * @property {string} tabIndex - The index of the current tab.
   * @property {string} tabsPerSession - The number of tabs per session.
   * @property {string} index - The index for the URL.
   * @property {string} pid - The process identifier for the URL.
   *
   * @type {string} path - The path to the JavaScript file containing the function:
   *   (params: CustomUrlHandler) => Promise<string>
   */
  readonly customUrlHandler: string
  /**
   * Imported custom URL handler function.
   * @typedef {Object} CustomUrlHandler
   * @property {number} id - The identifier for the URL.
   * @property {number} sessions - The number of sessions.
   * @property {number} tabIndex - The index of the current tab.
   * @property {number} tabsPerSession - The number of tabs per session.
   * @property {number} index - The index for the URL.
   * @property {number} pid - The process identifier for the URL.
   * @property {Record<string, string>} env - The process environment.
   *
   * @type {string} path - The path to the JavaScript file containing the function:
   *   (params: CustomUrlHandler) => Promise<string>
   */
  public customUrlHandlerFn?: CustomUrlHandlerFn
  /** The latest stats extracted from page. */
  stats: SessionStats = {}
  /** The browser opened pages. */
  readonly pages = new Map<number, Page>()
  readonly httpResourcesStats = new Map<
    number,
    {
      sentBytes: number
      recvBytes: number
      recvLatency: FastStats
      wsSentBytes: number
      wsRecvBytes: number
      wsRecvLatency: FastStats
    }
  >()
  /** The browser opened pages metrics. */
  readonly pagesMetrics = new Map<number, Metrics>()
  /** The page warnings count. */
  pageWarnings = 0
  /** The page errors count. */
  pageErrors = 0
  private screensharePage?: Page

  private static readonly jsonFetchCache = new NodeCache({
    stdTTL: 30,
    checkperiod: 15,
  })

  constructor({
    chromiumUrl,
    chromiumPath,
    chromiumFieldTrials,
    windowWidth,
    windowHeight,
    deviceScaleFactor,
    display,
    /* audioRedForOpus, */
    url,
    urlQuery,
    customUrlHandler,
    customUrlHandlerFn,
    mediaPath,
    videoWidth,
    videoHeight,
    videoFramerate,
    useFakeMedia,
    enableGpu,
    enableBrowserLogging,
    enableRtpDump,
    startTimestamp,
    sessions,
    tabsPerSession,
    spawnPeriod,
    statsInterval,
    disabledVideoCodecs,
    localStorage,
    sessionStorage,
    clearCookies,
    scriptPath,
    showPageLog,
    pageLogFilter,
    pageLogPath,
    userAgent,
    id,
    throttleIndex,
    useBrowserThrottling,
    evaluateAfter,
    exposedFunctions,
    scriptParams,
    blockedUrls,
    extraHeaders,
    responseModifiers,
    downloadResponses,
    extraCSS,
    cookies,
    overridePermissions,
    hardwareConcurrency,
    debuggingPort,
    debuggingAddress,
    randomAudioPeriod,
    maxVideoDecoders,
    maxVideoDecodersRange,
    incognito,
    serverPort,
    serverSecret,
    serverUseHttps,
    emulateCpuThrottling,
  }: SessionParams) {
    super()
    log.debug('constructor', { id })
    this.id = id
    this.chromiumUrl = chromiumUrl
    this.chromiumPath = chromiumPath || undefined
    this.chromiumFieldTrials = chromiumFieldTrials || undefined
    this.windowWidth = windowWidth || 1920
    this.windowHeight = windowHeight || 1080
    this.deviceScaleFactor = deviceScaleFactor || 1
    this.debuggingPort = debuggingPort || 0
    this.debuggingAddress = debuggingAddress || ''
    this.display = display
    /* this.audioRedForOpus = !!audioRedForOpus */
    this.url = url
    this.urlQuery = urlQuery
    if (!this.urlQuery && url.includes('?')) {
      const parts = url.split('?', 2)
      this.url = parts[0]
      this.urlQuery = parts[1]
    }
    this.customUrlHandler = customUrlHandler
    this.customUrlHandlerFn = customUrlHandlerFn
    this.mediaPath = mediaPath
    this.videoWidth = videoWidth
    this.videoHeight = videoHeight
    this.videoFramerate = videoFramerate
    this.useFakeMedia = useFakeMedia
    this.enableGpu = enableGpu
    this.enableBrowserLogging = enabledForSession(this.id, enableBrowserLogging)
    this.enableRtpDump = enabledForSession(this.id, enableRtpDump)
    this.startTimestamp = startTimestamp || Date.now()
    this.sessions = sessions || 1
    this.tabsPerSession = tabsPerSession || 1
    assert(this.tabsPerSession >= 1, 'tabsPerSession should be >= 1')
    this.spawnPeriod = spawnPeriod || 1000
    this.statsInterval = statsInterval || 10
    if (disabledVideoCodecs) {
      this.disabledVideoCodecs = disabledVideoCodecs
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length)
    } else {
      this.disabledVideoCodecs = []
    }
    if (localStorage) {
      try {
        this.localStorage = JSON5.parse(localStorage)
      } catch (err: unknown) {
        log.error(`error parsing localStorage: ${(err as Error).stack}`)
        this.localStorage = null
      }
    }
    if (sessionStorage) {
      try {
        this.sessionStorage = JSON5.parse(sessionStorage)
      } catch (err: unknown) {
        log.error(`error parsing sessionStorage: ${(err as Error).stack}`)
        this.sessionStorage = null
      }
    }
    this.clearCookies = clearCookies
    this.scriptPath = scriptPath
    this.showPageLog = showPageLog
    this.pageLogFilter = pageLogFilter
    this.pageLogPath = pageLogPath
    this.userAgent = userAgent
    this.randomAudioPeriod = randomAudioPeriod
    this.maxVideoDecoders = maxVideoDecoders
    this.maxVideoDecodersRange = maxVideoDecodersRange
    this.incognito = incognito
    this.serverPort = serverPort
    this.serverSecret = serverSecret
    this.serverUseHttps = serverUseHttps
    this.emulateCpuThrottling = emulateCpuThrottling

    this.throttleIndex = throttleIndex
    this.useBrowserThrottling = useBrowserThrottling
    this.evaluateAfter = evaluateAfter || []
    this.exposedFunctions = exposedFunctions || {}
    if (scriptParams) {
      try {
        this.scriptParams = JSON5.parse(scriptParams)
      } catch (err) {
        log.error(`error parsing scriptParams '${scriptParams}': ${(err as Error).stack}`)
        throw err
      }
    } else {
      this.scriptParams = {}
    }
    this.blockedUrls = (blockedUrls || '')
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length)
    // Always block sentry.io.
    this.blockedUrls.push('ingest.sentry.io')

    if (extraHeaders) {
      try {
        this.extraHeaders = JSON5.parse(extraHeaders)
      } catch (err) {
        log.error(`error parsing extraHeaders: ${(err as Error).stack}`)
        this.extraHeaders = undefined
      }
    } else {
      this.extraHeaders = undefined
    }

    if (responseModifiers) {
      try {
        const parsed = JSON5.parse(responseModifiers)
        Object.entries(parsed).forEach(([url, replacements]) => {
          if (!Array.isArray(replacements)) {
            throw new Error(
              `responseModifiers replacements should be an array of { search, replace, body, headers } objects: ${replacements}`,
            )
          }
          this.responseModifiers[url] = replacements.map(({ search, regexp, replace, file, headers }) => ({
            search: regexp ? new RegExp(regexp, 'g') : search,
            replace,
            file,
            headers,
          }))
        })
      } catch (err) {
        throw new Error(`error parsing responseModifiers "${responseModifiers}": ${(err as Error).stack}`)
      }
    }

    if (downloadResponses) {
      try {
        const parsed = JSON5.parse(downloadResponses)
        if (!Array.isArray(parsed)) throw new Error(`downloadResponses should be an array: ${downloadResponses}`)
        parsed.forEach(({ urlPattern, output, append }) => {
          this.downloadResponses.push({ urlPattern: getUrlPatternRegExp(urlPattern), output, append })
        })
      } catch (err) {
        throw new Error(`error parsing downloadResponses "${downloadResponses}": ${(err as Error).stack}`)
      }
    }

    this.extraCSS = extraCSS

    if (cookies) {
      try {
        this.cookies = JSON5.parse(cookies)
      } catch (err) {
        log.error(`error parsing cookies: ${(err as Error).stack}`)
      }
    }

    if (overridePermissions) {
      this.overridePermissions = overridePermissions
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length) as Permission[]
    }

    this.hardwareConcurrency = hardwareConcurrency
  }

  /**
   * Returns the chromium browser launch args
   * @return the args list
   */
  getBrowserArgs(env: Record<string, string>): string[] {
    // https://peter.sh/experiments/chromium-command-line-switches/
    // https://source.chromium.org/chromium/chromium/src/+/main:testing/variations/fieldtrial_testing_config.json;l=8877?q=%20fieldtrial_testing_config.json&ss=chromium
    const args = [
      '--no-sandbox',
      '--no-zygote',
      '--ignore-certificate-errors',
      '--no-user-gesture-required',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-infobars',
      '--no-default-browser-check',
      '--allow-running-insecure-content',
      `--unsafely-treat-insecure-origin-as-secure=http://${new URL(this.url || 'http://localhost').host}`,
      '--disable-web-security',
      '--disable-features=IsolateOrigins,Translate,CalculateNativeWinOcclusion',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-site-isolation-trials',
      '--enable-usermedia-screen-capturing',
      '--allow-http-screen-capture',
      `--remote-debugging-port=${this.debuggingPort ? this.debuggingPort + this.id : 0}`,
      '--enable-features=VaapiVideoDecoder,VaapiVideoEncoder,VaapiVideoDecodeLinuxGL,ElementCapture',
      `--window-size=${this.windowWidth},${this.windowHeight}`,
    ]

    let fieldTrials = this.chromiumFieldTrials || ''

    if (this.pageLogPath && this.enableBrowserLogging) {
      const pageLogDir = path.dirname(this.pageLogPath)
      const eventLogPath = path.resolve(pageLogDir, `webrtc-event-logging-${this.id}`)
      fs.mkdirSync(eventLogPath, { recursive: true })
      args.push('--enable-logging', '--vmodule=*/webrtc/*=5', '--v=0', `--webrtc-event-logging=${eventLogPath}`)
      fieldTrials = 'WebRTC-RtcEventLogNewFormat/Disabled/' + fieldTrials
      if (this.enableRtpDump) {
        fieldTrials = 'WebRTC-Debugging-RtpDump/Enabled/' + fieldTrials
      }
      env.CHROME_LOG_FILE = path.resolve(pageLogDir, `chrome-${this.id}.log`)
    }

    if (this.maxVideoDecoders !== -1 && enabledForSession(this.id, this.maxVideoDecodersRange)) {
      fieldTrials = `WebRTC-MaxVideoDecoders/${this.maxVideoDecoders}/` + fieldTrials
    }
    if (fieldTrials.length) {
      args.push(`--force-fieldtrials=${fieldTrials}`)
    }

    if (this.mediaPath) {
      if (this.useFakeMedia) {
        log.debug(`${this.id} using chromium as fake media source`)
        args.push(
          '--use-fake-ui-for-media-stream',
          `--use-fake-device-for-media-stream=display-media-type=browser,fps=30`,
          `--use-file-for-fake-video-capture=${this.mediaPath.video}`,
          `--use-file-for-fake-audio-capture=${this.mediaPath.audio}`,
        )
      } else {
        log.debug(`${this.id} using ${this.mediaPath} as fake media source`)
        args.push(
          '--auto-accept-camera-and-microphone-capture',
          `--auto-select-tab-capture-source-by-title=webrtcperf-screenshare`,
          '--mute-audio',
        )
      }
    }

    if (this.enableGpu) {
      args.push(
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization',
        '--enable-zero-copy',
        '--disable-gpu-sandbox',
        '--enable-vulkan',
      )
      if (this.enableGpu === 'egl') {
        args.push('--use-gl=egl')
      } else {
        args.push('--use-gl=angle', '--use-angle=vulkan')
      }
    } else {
      args.push(
        // Disables webgl support.
        '--disable-3d-apis',
        '--disable-site-isolation-trials',
        // '--renderer-process-limit=2',
        // '--single-process',
      )
    }

    return args
  }

  /**
   * Start
   */
  async start(): Promise<void> {
    if (this.running) {
      return
    }
    this.running = true
    if (this.browser) {
      log.warn(`${this.id} start: already running`)
      return
    }
    log.debug(`${this.id} start`)

    if (this.chromiumUrl) {
      // connect to a remote chrome instance
      try {
        this.browser = await puppeteer.connect({
          browserURL: this.chromiumUrl,
          defaultViewport: {
            width: this.windowWidth,
            height: this.windowHeight,
            deviceScaleFactor: this.deviceScaleFactor,
            isMobile: false,
            hasTouch: false,
            isLandscape: true,
          },
        })
      } catch (err) {
        log.error(`${this.id} browser connect error: ${(err as Error).stack}`)
        return this.stop(err as Error)
      }
    } else {
      // run a browser instance locally
      let executablePath = this.chromiumPath
      if (!executablePath || !fs.existsSync(executablePath)) {
        executablePath = await checkChromeExecutable()
        log.debug(`using executablePath=${executablePath}`)
      }

      // Create the process wrapper.
      if (this.throttleIndex > -1 && os.platform() === 'linux') {
        executablePath = await throttleLauncher(executablePath, this.throttleIndex)
      }

      const env = { ...process.env } as Record<string, string>
      if (!this.display) {
        delete env.DISPLAY
      } else {
        env.DISPLAY = this.display
      }

      const args = this.getBrowserArgs(env)
      const ignoreDefaultArgs = [
        '--disable-dev-shm-usage',
        '--remote-debugging-port',
        //'--hide-scrollbars',
        '--enable-automation',
        '--window-size',
      ]

      log.debug(`[session ${this.id}] Using args:\n  ${args.join('\n  ')}`)
      const defaultArgs = await puppeteer.defaultArgs()
      log.debug(`[session ${this.id}] Default args:\n  ${defaultArgs.join('\n  ')}`)

      try {
        this.browser = await puppeteer.launch({
          browser: 'chrome',
          headless: this.display ? false : true,
          executablePath,
          handleSIGINT: false,
          env,
          // dumpio: this.enableBrowserLogging,
          // devtools: true,
          defaultViewport: {
            width: this.windowWidth,
            height: this.windowHeight,
            deviceScaleFactor: this.deviceScaleFactor,
            isMobile: false,
            hasTouch: false,
            isLandscape: false,
          },
          ignoreDefaultArgs,
          args,
        })
        const version = await this.browser.version()
        log.debug(`[session ${this.id}] Using chrome version: ${version}`)
      } catch (err) {
        log.error(`[session ${this.id}] Browser launch error: ${(err as Error).stack}`)
        return this.stop(err as Error)
      }
    }

    assert(this.browser, 'BrowserNotCreated')

    if (this.debuggingPort && this.debuggingAddress !== '127.0.0.1') {
      this.stopPortForwarder = await portForwarder(this.debuggingPort + this.id, this.debuggingAddress)
    }

    this.browser.once('disconnected', () => {
      log.debug('browser disconnected')
      return this.stop(new Error('Browser disconnected'))
    })

    // get GPU infos from chrome://gpu page
    /* if (this.enableGpu) {
      try {
        const page = await this.browser.newPage()
        await page.goto('chrome://gpu')
        const data = await page.evaluate(() =>
          [
            // eslint-disable-next-line no-undef
            ...document.querySelectorAll('ul.feature-status-list > li > span'),
          ].map(
            (e, i) =>
              `${i % 2 === 0 ? '\n- ' : ''}${(e as HTMLSpanElement).innerText}`,
          ),
        )
        await page.close()
        console.log(`GPU infos:${data.join('')}`)
      } catch (err) {
        log.warn(`${this.id} error getting gpu info: %j`, err)
      }
    } */

    // open pages
    for (let i = 0; i < this.tabsPerSession; i++) {
      this.openPage(i).catch(err => log.error(`openPage error: ${(err as Error).stack}`))
      if (i < this.tabsPerSession - 1) {
        await sleep(this.spawnPeriod)
      }
    }
  }

  private setupPageCmd(index: number, tabIndex: number, url: string) {
    let cmd = `\
webrtcperf = {};
webrtcperf.config = {
  START_TIMESTAMP: ${this.startTimestamp},
  WEBRTC_PERF_URL: "${hideAuth(url)}",
  WEBRTC_PERF_SESSION: ${this.id},
  WEBRTC_PERF_TAB_INDEX: ${tabIndex},
  WEBRTC_PERF_INDEX: ${index},
  STATS_INTERVAL: ${this.statsInterval},
  VIDEO_WIDTH: ${this.videoWidth},
  VIDEO_HEIGHT: ${this.videoHeight},
  VIDEO_FRAMERATE: ${this.videoFramerate},
};
try {
  webrtcperf.params = JSON.parse('${JSON.stringify(this.scriptParams)}' || '{}');
} catch (err) {
  console.error('[webrtcperf] Error parsing scriptParams:', err);
  webrtcperf.params = {};
};

const webrtcperf_getServerUrl = (path, protocol = 'http', query = '') => {
  return protocol + "${this.serverUseHttps ? 's' : ''}://localhost:${this.serverPort}/" + path + "?auth=${this.serverSecret}" + (query ? "&" + query : '')
}
  `

    if (this.serverPort) {
      cmd += `\
webrtcperf.config.SAVE_MEDIA_URL = webrtcperf_getServerUrl("", "ws", "action=write-stream");
    `
      if (this.mediaPath?.mp4 && !this.useFakeMedia) {
        cmd += `\
webrtcperf.config.MEDIA_URL = webrtcperf_getServerUrl("cache/${path.basename(this.mediaPath.mp4)}");
    `
      }
    }

    if (this.disabledVideoCodecs.length) {
      log.debug('Using disabledVideoCodecs:', this.disabledVideoCodecs)
      cmd += `webrtcperf.config.GET_CAPABILITIES_DISABLED_VIDEO_CODECS = JSON.parse('${JSON.stringify(
        this.disabledVideoCodecs,
      )}');\n`
    }

    return cmd
  }

  /**
   * openPage
   * @param tabIndex
   */
  async openPage(tabIndex: number): Promise<void> {
    if (!this.browser) {
      return
    }
    const index = this.id + tabIndex
    let saveFile: fs.promises.FileHandle | undefined = undefined
    let url = this.url

    if (!url) {
      if (this.customUrlHandler && !this.customUrlHandlerFn) {
        const customUrlHandlerPath = path.resolve(process.cwd(), this.customUrlHandler)
        if (!fs.existsSync(customUrlHandlerPath)) {
          throw new Error(`Custom url handler script not found: "${customUrlHandlerPath}"`)
        }
        this.customUrlHandlerFn = (await import(/* webpackIgnore: true */ customUrlHandlerPath)).default
      }
      if (!this.customUrlHandlerFn) {
        throw new Error(`Custom url handler function not set`)
      }
      url = await this.customUrlHandlerFn({
        id: this.id,
        sessions: this.sessions,
        tabIndex,
        tabsPerSession: this.tabsPerSession,
        index,
        pid: process.pid,
        env: { ...process.env } as Record<string, string>,
        params: this.scriptParams,
      })
      log.debug(`customUrlHandlerFn: ${url}`)
    }

    if (!url) {
      throw new Error(`Page URL not set`)
    }

    if (this.urlQuery) {
      url += `?${this.urlQuery
        .replace(/\$s/g, String(this.id))
        .replace(/\$S/g, String(this.sessions))
        .replace(/\$t/g, String(tabIndex))
        .replace(/\$T/g, String(this.tabsPerSession))
        .replace(/\$i/g, String(index))
        .replace(/\$p/g, String(process.pid))}`
    }

    log.debug(`opening page ${index} (session: ${this.id} tab: ${tabIndex}): ${hideAuth(url)}`)

    if (this.incognito) {
      this.context = await this.browser.createBrowserContext()
    } else {
      this.context = this.browser.defaultBrowserContext()
    }

    if (this.overridePermissions.length) {
      await this.context.overridePermissions(new URL(url).origin, this.overridePermissions)
    }

    const page = await this.getNewPage(tabIndex)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pageCDPSession = (page as any)._client() as CDPSession

    await page.setBypassCSP(true)

    if (this.userAgent) {
      await page.setUserAgent(this.userAgent)
    }

    await Promise.all(
      Object.keys(this.exposedFunctions).map(
        async (name: string) =>
          await page.exposeFunction(name, (...args: unknown[]) => this.exposedFunctions[name](...args)),
      ),
    )

    await page.exposeFunction('webrtcperf_stopSession', () => this.stop())

    // Export config to page.
    let cmd = this.setupPageCmd(index, tabIndex, url)
    if (this.localStorage) {
      log.debug('Using localStorage:', this.localStorage)
      Object.entries(this.localStorage).map(([key, value]) => {
        cmd += `window.localStorage.setItem('${key}', ${JSON.stringify(value)});\n`
      })
    }
    if (this.sessionStorage) {
      log.debug('Using sessionStorage:', this.sessionStorage)
      Object.entries(this.sessionStorage).map(([key, value]) => {
        cmd += `window.sessionStorage.setItem('${key}', ${JSON.stringify(value)});\n`
      })
    }
    cmd += `
Object.defineProperty(window.screen, 'width', { value: ${this.windowWidth}, writable: false });
Object.defineProperty(window.screen, 'height', { value: ${this.windowHeight}, writable: false });
Object.defineProperty(window.screen, 'availWidth', { value: ${this.windowWidth}, writable: false });
Object.defineProperty(window.screen, 'availHeight', { value: ${this.windowHeight}, writable: false });
Object.defineProperty(window.screen.orientation, 'type', { value: 'landscape-primary', writable: false });
    `
    log.debug('init command:', cmd)
    await page.evaluateOnNewDocument(cmd)

    // Clear cookies.
    if (this.clearCookies) {
      try {
        await pageCDPSession.send('Network.clearBrowserCookies')
      } catch (err) {
        log.error(`clearCookies error: ${(err as Error).stack}`)
      }
    }

    page.on('dialog', async dialog => {
      log.debug(`page ${index + 1} dialog ${dialog.type()}: ${dialog.message()}`)
      try {
        await dialog.accept()
      } catch (err) {
        log.debug(`dialog accept error: ${(err as Error).message}`)
      }
      try {
        await dialog.dismiss()
      } catch (err) {
        log.debug(`dialog dismiss error: ${(err as Error).message}`)
      }
    })

    page.once('close', () => {
      log.debug(`page ${index + 1} closed`)
      this.pages.delete(index)
      this.httpResourcesStats.delete(index)
      this.pagesMetrics.delete(index)

      if (saveFile) {
        saveFile.close().catch(err => {
          log.error(`saveFile close error: ${(err as Error).stack}`)
        })
        saveFile = undefined
      }

      if (this.browser && this.running) {
        setTimeout(
          () => this.openPage(index).catch(err => log.error(`openPage after close error: ${(err as Error).stack}`)),
          1000,
        )
      }
    })

    // Enable request interception.
    let setRequestInterceptionState = true

    await pageCDPSession.send('Network.setBypassServiceWorker', {
      bypass: true,
    })

    const interceptManager = new RequestInterceptionManager(pageCDPSession, {
      onError: error => {
        log.error('Request interception error:', error)
      },
    })

    const interceptions: Interception[] = []

    // Blocked URLs.
    this.blockedUrls.forEach(blockedUrl => {
      interceptions.push({
        urlPattern: blockedUrl,
        modifyRequest: () => ({ errorReason: 'BlockedByClient' }),
      })
    })

    // Add extra headers.
    if (this.extraHeaders) {
      Object.entries(this.extraHeaders).forEach(([url, obj]) => {
        const headers = Object.entries(obj).map(([name, value]) => ({
          name,
          value,
        }))
        interceptions.push({
          urlPattern: url,
          modifyRequest: ({ event }) => {
            log.debug(`adding extraHeaders in: ${event.request.url}`, headers)
            return { headers }
          },
        })
      })
    }

    // Response modifiers.
    Object.entries(this.responseModifiers).forEach(([url, replacements]) => {
      interceptions.push({
        urlPattern: url,
        modifyResponse: async ({ event, body }) => {
          const responseHeaders = event.responseHeaders || []
          for (const { search, replace, file, headers } of replacements) {
            if (search && replace) {
              log.debug(`using responseModifiers in: ${event.request.url}: ${search.toString()} => ${replace}`)
              body = body?.replace(search, replace)
            } else if (file) {
              log.debug(`using responseModifiers in: ${event.request.url}: ${file}`)
              body = await fs.promises.readFile(file, 'utf8')
            }
            if (headers) {
              for (const [name, value] of Object.entries(headers)) {
                responseHeaders.push({
                  name,
                  value,
                })
              }
            }
          }
          return { body, responseHeaders }
        },
      })
    })

    await interceptManager.intercept(...interceptions)

    // Download responses.
    if (this.downloadResponses.length) {
      page.on('response', async response => {
        if (!response.ok()) return
        const url = response.url()
        for (const { urlPattern, output, append } of this.downloadResponses) {
          if (!urlPattern.test(url)) continue
          try {
            const data = await response.buffer()
            if (data.byteLength > 0) {
              if (append) {
                const savePath = output.replaceAll('${id}', this.id.toString())
                if (!fs.existsSync(path.dirname(savePath))) {
                  await fs.promises.mkdir(path.dirname(output), { recursive: true })
                }
                log.debug(`appending response body ${data.byteLength} to: ${savePath}`)
                await fs.promises.appendFile(savePath, data)
              } else {
                if (!fs.existsSync(output)) {
                  await fs.promises.mkdir(output, { recursive: true })
                }
                const savePath = path.join(output, `${path.basename(new URL(url).pathname)}`)
                log.debug(`saving response body ${data.byteLength} to: ${savePath}`)
                await fs.promises.writeFile(savePath, data)
              }
            }
          } catch (err) {
            log.error(`downloadResponses error: ${(err as Error).stack}`)
          }
        }
      })
    }

    // Allow to change the setRequestInterception state from page.
    const setRequestInterceptionFunction = async (value: boolean) => {
      if (value === setRequestInterceptionState) {
        return
      }
      log.debug(`setRequestInterception to ${value}`)
      try {
        if (!value) {
          await interceptManager.disable()
        } else {
          await interceptManager.enable()
        }
        setRequestInterceptionState = value
      } catch (err) {
        log.error(`setRequestInterception error: ${(err as Error).stack}`)
      }
    }

    await page.exposeFunction('setRequestInterception', setRequestInterceptionFunction)

    await page.exposeFunction('jsonFetch', async (options: JsonFetchOptions, cacheKey = '', cacheTimeout = 0) => {
      if (cacheKey) {
        const ret = Session.jsonFetchCache.get(cacheKey)
        if (ret) {
          return ret
        }
      }
      try {
        const { status, data, headers } = await jsonFetchRequest(options)
        if (options.responseType === 'stream') {
          if (options.downloadPath && !fs.existsSync(options.downloadPath)) {
            log.debug(`jsonFetch saving file to: ${options.downloadPath}`, headers['content-disposition'])
            await fs.promises.mkdir(path.dirname(options.downloadPath), {
              recursive: true,
            })
            const writer = fs.createWriteStream(options.downloadPath)
            await new Promise<void>((resolve, reject) => {
              writer.on('error', err => reject(err))
              writer.on('close', () => resolve())
              data.pipe(writer)
            })
          }
          if (cacheKey) {
            Session.jsonFetchCache.set(cacheKey, { status }, cacheTimeout)
          }
          return { status, headers }
        } else {
          if (cacheKey) {
            Session.jsonFetchCache.set(cacheKey, { status, data }, cacheTimeout)
          }
          return { status, headers, data }
        }
      } catch (err) {
        const error = (err as Error).message
        log.warn(`jsonFetch error: ${error}`)
        return { status: 500, error }
      }
    })

    await page.exposeFunction('readLocalFile', (filePath: string, encoding?: BufferEncoding) => {
      filePath = path.resolve(process.cwd(), filePath)
      return fs.promises.readFile(filePath, encoding)
    })

    if (this.pageLogPath) {
      const dirPath = path.dirname(this.pageLogPath)
      await page.exposeFunction(
        'webrtcperf_writeFile',
        (paramPath: string, data: string | Buffer | Uint8Array, append = false) => {
          const filePath = path.resolve(dirPath, paramPath)
          if (append) {
            return fs.promises.appendFile(filePath, data)
          } else {
            return fs.promises.writeFile(filePath, data)
          }
        },
      )
    }

    await page.exposeFunction('webrtcperf_emulateCpuThrottling', (factor: number | null) => {
      return page.emulateCPUThrottling(factor)
    })

    if (this.emulateCpuThrottling) {
      log.debug(`emulateCpuThrottling: ${this.emulateCpuThrottling}`)
      await page.emulateCPUThrottling(this.emulateCpuThrottling)
    }

    // PeerConnectionExternal
    /* await page.exposeFunction(
      'createPeerConnectionExternal',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (options: any) => {
        const pc = new PeerConnectionExternal(options)
        return { id: pc.id }
      },
    )

    await page.exposeFunction(
      'callPeerConnectionExternalMethod',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (id: number, name: PeerConnectionExternalMethod, arg: any) => {
        const pc = PeerConnectionExternal.get(id)
        if (pc) {
          return pc[name](arg)
        }
      },
    )*/

    // Simulate keypress
    await page.exposeFunction('keypressText', async (selector: string, text: string, delay = 20) => {
      await page.type(selector, text, { delay })
    })

    // Simulate mouse clicks
    await page.exposeFunction('mouseClick', async (selector: string, x = 0, y = 0) => {
      await page.click(selector, { offset: { x, y } })
    })

    const lorem = new LoremIpsum({
      sentencesPerParagraph: {
        max: 4,
        min: 1,
      },
      wordsPerSentence: {
        max: 16,
        min: 2,
      },
    })

    await page.exposeFunction('loremIpsum', (count = 1) => lorem.generateSentences(count))

    await page.exposeFunction(
      'keypressRandomText',
      async (selector: string, count = 1, prefix = '', suffix = '', delay = 0) => {
        const c = prefix + lorem.generateSentences(count) + suffix
        const frames = await page.frames()
        for (const frame of frames) {
          const el = await frame.$(selector)
          if (el) {
            await el.focus()
            await frame.type(selector, c, { delay })
          }
        }
      },
    )

    await page.exposeFunction('uploadFileFromUrl', async (fileUrl: string, selector: string) => {
      const filename = sha256(fileUrl) + '.' + fileUrl.split('.').slice(-1)[0]
      const filePath = path.join(os.homedir(), '.webrtcperf/uploads', filename)
      if (!fs.existsSync(filePath)) {
        await downloadUrl(fileUrl, undefined, filePath)
      }
      log.debug(`uploadFileFromUrl: ${filePath}`)
      const frames = await page.frames()
      for (const frame of frames) {
        const el = await frame.$(selector)
        if (el) {
          await (el as ElementHandle<HTMLInputElement>).uploadFile(filePath)
          break
        }
      }
    })

    // add extra styles
    if (this.extraCSS) {
      log.debug(`Add extraCSS: ${this.extraCSS}`)
      try {
        await page.evaluateOnNewDocument(
          (css: string) => {
            document.addEventListener('DOMContentLoaded', () => {
              const style = document.createElement('style')
              style.setAttribute('id', 'webrtcperf-extra-style')
              style.setAttribute('type', 'text/css')
              style.innerHTML = css

              document.head.appendChild(style)
            })
          },
          this.extraCSS.replace(/important/g, '!important'),
        )
      } catch (err) {
        log.error(`Add extraCSS error: ${(err as Error).stack}`)
      }
    }

    // add cookies
    if (this.cookies) {
      try {
        await page.setCookie(...this.cookies)
      } catch (err) {
        log.error(`Set cookies error: ${(err as Error).stack}`)
      }
    }

    // Page logs and errors.
    if (this.pageLogPath) {
      try {
        await fs.promises.mkdir(path.dirname(this.pageLogPath), {
          recursive: true,
        })
        saveFile = await fs.promises.open(this.pageLogPath, 'a')
      } catch (err) {
        log.error(`error opening page log file: ${this.pageLogPath}: ${(err as Error).stack}`)
      }
    }

    await page.exposeFunction('webrtcperf_serializedConsoleLog', async (type: PageLogColorsKey, text: string) => {
      if (this.showPageLog || saveFile) {
        try {
          await this.onPageMessage(index, type, text, saveFile)
        } catch (err) {
          log.error(`serializedConsoleLog error: ${(err as Error).stack}`)
        }
      }
    })

    if (this.showPageLog || saveFile) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      page.on('pageerror', async (error: any) => {
        const text = `pageerror: ${error?.message?.message || error?.message || error} - ${error?.message?.stack || error?.stack}`
        await this.onPageMessage(index, 'error', text, saveFile)
      })

      page.on('requestfailed', async request => {
        const err = (request.failure()?.errorText || '').trim()
        if (err === 'net::ERR_ABORTED') {
          return
        }
        const text = `${request.method()} ${request.url()}: ${err}`
        await this.onPageMessage(index, 'requestfailed', text, saveFile)
      })
    }

    await page.exposeFunction('webrtcperf_startFakeScreenshare', async () => {
      if (!this.browser) return
      let screensharePage = page
      if (!this.useFakeMedia) {
        if (!this.screensharePage) {
          screensharePage = this.screensharePage = await this.browser.newPage()
          await this.screensharePage.evaluateOnNewDocument(this.setupPageCmd(index, tabIndex, 'about:blank'))
          await this.screensharePage.evaluateOnNewDocument(
            fs.readFileSync(resolvePackagePath('node_modules/@vpalmisano/webrtcperf-js/dist/webrtcperf.js'), 'utf8'),
          )
          await screensharePage.exposeFunction(
            'webrtcperf_keypressText',
            async (selector: string, text: string, delay = 20) => {
              await screensharePage.type(selector, text, { delay })
            },
          )
          await screensharePage.exposeFunction('webrtcperf_keyPress', async (key: KeyInput) => {
            await screensharePage.keyboard.press(key)
          })
          await screensharePage.goto(
            `http${this.serverUseHttps ? 's' : ''}://localhost:${this.serverPort}/empty-page?auth=${this.serverSecret}&title=webrtcperf-screenshare`,
          )
        }
      }
      await screensharePage.evaluate(() => webrtcperf.startFakeScreenshare())
    })

    await page.exposeFunction('webrtcperf_stopFakeScreenshare', async () => {
      if (!this.useFakeMedia && this.screensharePage) {
        await this.screensharePage.close()
        this.screensharePage = undefined
      } else {
        await page.evaluate(() => webrtcperf.stopFakeScreenshare())
      }
    })

    await page.exposeFunction('webrtcperf_reload', () => {
      return page.reload()
    })

    // HTTP stats.
    this.setupPageNetworkStats(pageCDPSession, index)

    // Hardware concurrency.
    if (this.hardwareConcurrency) {
      const plugin = NavigatorHardwareConcurrency({ hardwareConcurrency: this.hardwareConcurrency })
      await plugin.onPageCreated(page)
    }

    // Network throttling.
    if (this.throttleIndex > -1 && (process.platform !== 'linux' || this.useBrowserThrottling)) {
      log.debug(`Using internal network throttling`)
      await pageCDPSession.send('Network.emulateNetworkConditions', {
        offline: false,
        uploadThroughput: 100000000 / 8,
        downloadThroughput: 100000000 / 8,
        latency: 0,
        packetLoss: 0,
        packetQueueLength: 0,
      })
    }

    // Load page script.
    {
      const filePath = resolvePackagePath('node_modules/@vpalmisano/webrtcperf-js/dist/webrtcperf.js')
      if (!fs.existsSync(filePath)) {
        throw new Error(`@vpalmisano/webrtcperf-js script not found: ${filePath}`)
      }
      log.debug(`loading @vpalmisano/webrtcperf-js script from: ${filePath}`)
      await page.evaluateOnNewDocument(fs.readFileSync(filePath, 'utf8'))
    }

    // Execute external script(s).
    if (this.scriptPath) {
      if (this.scriptPath.startsWith('base64:gzip:')) {
        const data = Buffer.from(this.scriptPath.replace('base64:gzip:', ''), 'base64')
        const code = gunzipSync(data).toString()
        log.debug(`loading script from ${code.length} bytes`)
        await page.evaluateOnNewDocument(code)
      } else {
        for (const filePath of this.scriptPath.split(',')) {
          if (!filePath.trim()) {
            continue
          }
          if (filePath.startsWith('http')) {
            log.debug(`loading custom script from url: ${filePath}`)
            const res = await downloadUrl(filePath)
            if (!res?.data) {
              throw new Error(`Failed to download script from: ${filePath}`)
            }
            await page.evaluateOnNewDocument(res.data)
          } else {
            if (!fs.existsSync(filePath)) {
              log.warn(`custom script not found: ${filePath}`)
              continue
            }
            log.debug(`loading custom script from file: ${filePath}`)
            await page.evaluateOnNewDocument(fs.readFileSync(filePath, 'utf8'))
          }
        }
      }
    }

    log.debug(`Page ${index + 1} "${url}" loading`)
    const pageLoadTime = Date.now()

    // open the page url
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60 * 1000,
      })
    } catch (error) {
      log.error(`Page ${index + 1} "${url}" load error: ${(error as Error).stack}`)
      await page.close()
      return
    }

    // add to pages map
    this.pages.set(index, page)

    // Handle network internal throttling.
    if (this.throttleIndex > -1 && (process.platform !== 'linux' || this.useBrowserThrottling)) {
      const onThrottleChange = async () => {
        if (page.isClosed()) return
        try {
          await this.applyNetworkThrottling(pageCDPSession)
        } catch (err) {
          log.error(`applyNetworkThrottling error: ${(err as Error).stack}`)
        }
      }
      await onThrottleChange()
      throttleNotifier.on('change', onThrottleChange)
      page.once('close', () => throttleNotifier.off('change', onThrottleChange))
    }

    if (this.pageLogPath && this.enableRtpDump) {
      page.once('close', async () => {
        const dirPath = path.dirname(this.pageLogPath)
        const logFilePath = path.join(dirPath, `chrome-${this.id}.log`)
        if (fs.existsSync(logFilePath)) {
          const pcapFilePath = path.join(dirPath, `chrome-${this.id}.pcap`)
          try {
            await runShellCommand(`\
grep RTP_DUMP ${logFilePath} | text2pcap -D -u 1000,2000 -t %H:%M:%S.%f - ${pcapFilePath};
grep -v RTP_DUMP ${logFilePath} > ${logFilePath}.tmp;
mv ${logFilePath}.tmp ${logFilePath};
`)
            log.info(`rtp dump saved to: ${pcapFilePath}`)
          } catch (err) {
            log.error(`error converting rtp dump to pcap: ${(err as Error).stack}`)
          }
        }
      })
    }

    log.debug(`Page ${index + 1} "${url}" loaded in ${(Date.now() - pageLoadTime) / 1000}s`)

    for (let i = 0; i < this.evaluateAfter.length; i++) {
      await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.evaluateAfter[i].pageFunction as any,
        ...this.evaluateAfter[i].args,
      )
    }
  }

  private setupPageNetworkStats(pageCDPSession: CDPSession, index: number) {
    const resourcesStats = {
      sentBytes: 0,
      recvBytes: 0,
      recvLatency: new FastStats({ store_data: false }),
      wsSentBytes: 0,
      wsRecvBytes: 0,
      wsRecvLatency: new FastStats({ store_data: false }),
    }
    this.httpResourcesStats.set(index, resourcesStats)

    const pendingRequests = new Map<string, { url: string; timestamp: number }>()
    pageCDPSession.on('Network.requestWillBeSent', event => {
      if (event.request.url.startsWith('data:')) return
      const { requestId, request, timestamp } = event
      const sentBytes = request.postDataEntries?.reduce((acc, entry) => acc + (entry.bytes?.length || 0), 0)
      //log.log('Network.requestWillBeSent', event.type, request.url, sentBytes)
      if (sentBytes) resourcesStats.sentBytes += sentBytes
      pendingRequests.set(requestId, { url: request.url, timestamp })
    })

    pageCDPSession.on('Network.responseReceived', event => {
      const request = pendingRequests.get(event.requestId)
      if (!request) return
      const { response } = event
      if (response.fromDiskCache) {
        pendingRequests.delete(event.requestId)
        return
      }
      resourcesStats.recvBytes += response.encodedDataLength
    })

    pageCDPSession.on('Network.dataReceived', event => {
      const request = pendingRequests.get(event.requestId)
      if (!request) return
      resourcesStats.recvBytes += event.encodedDataLength
    })

    pageCDPSession.on('Network.loadingFinished', event => {
      const request = pendingRequests.get(event.requestId)
      if (!request) return
      pendingRequests.delete(event.requestId)
      const { timestamp } = event
      resourcesStats.recvLatency.push(timestamp - request.timestamp)
    })

    pageCDPSession.on('Network.webSocketCreated', event => {
      pendingRequests.set(event.requestId, { url: event.url, timestamp: Date.now() })
    })

    pageCDPSession.on('Network.webSocketHandshakeResponseReceived', event => {
      const request = pendingRequests.get(event.requestId)
      if (!request) return
      pendingRequests.delete(event.requestId)
      resourcesStats.wsRecvLatency.push((Date.now() - request.timestamp) / 1000)
    })

    pageCDPSession.on('Network.webSocketFrameSent', event => {
      resourcesStats.wsSentBytes += event.response.payloadData.length
    })

    pageCDPSession.on('Network.webSocketFrameReceived', event => {
      resourcesStats.wsRecvBytes += event.response.payloadData.length
    })
  }

  private async applyNetworkThrottling(pageCDPSession: CDPSession) {
    const throttleUpValues = getSessionThrottleValues(this.throttleIndex, 'up')
    const throttleDownValues = getSessionThrottleValues(this.throttleIndex, 'down')
    const params = {
      offline: false,
      uploadThroughput: throttleUpValues.rate || -1,
      downloadThroughput: throttleDownValues.rate || -1,
      latency: Math.max(throttleUpValues.delay || 0, throttleDownValues.delay || 0),
      packetLoss: Math.max(throttleUpValues.loss || 0, throttleDownValues.loss || 0),
      packetQueueLength: Math.max(throttleUpValues.queue || 0, throttleDownValues.queue || 0),
    }
    log.debug(`Apply internal network throttling: ${JSON.stringify(params)}`)
    await pageCDPSession.send('Network.emulateNetworkConditions', {
      ...params,
      uploadThroughput: params.uploadThroughput !== -1 ? params.uploadThroughput / 8 : -1,
      downloadThroughput: params.downloadThroughput !== -1 ? params.downloadThroughput / 8 : -1,
    })
  }

  private async getNewPage(tabIndex: number): Promise<Page> {
    log.debug(`getNewPage ${tabIndex}`)
    assert(this.context, 'NoBrowserContextCreated')
    return await this.context.newPage()
  }

  private async onPageMessage(
    index: number,
    type: PageLogColorsKey,
    text: string,
    saveFile?: fs.promises.FileHandle,
  ): Promise<void> {
    if (text.endsWith('net::ERR_BLOCKED_BY_CLIENT.Inspector')) {
      return
    }
    const isBlocked = this.blockedUrls.some(
      blockedUrl => (type === 'requestfailed' || text.search('FetchError') !== -1) && text.search(blockedUrl) !== -1,
    )
    if (isBlocked) {
      return
    }
    const color = PageLogColors[type] || 'grey'
    const filter = this.pageLogFilter ? new RegExp(this.pageLogFilter, 'ig') : null
    if (!filter || text.match(filter)) {
      const errorOrWarning = ['error', 'warning'].includes(type)
      const isWebrtcPerf = text.startsWith('[webrtcperf')
      if (saveFile) {
        if (!errorOrWarning && !isWebrtcPerf && text.length > 1024) {
          text = text.slice(0, 1024) + `... +${text.length - 1024} bytes`
        }
        await saveFile.write(`${new Date().toISOString()} [page ${index}] (${type}) ${text}\n`)
      }
      if (this.showPageLog) {
        if (!errorOrWarning && !isWebrtcPerf && text.length > 256) {
          text = text.slice(0, 256) + `... +${text.length - 256} bytes`
        }
        console.log(chalk`{bold [page ${index}]} {${color} (${type}) ${text}}`)
      }
      if (type === 'error') {
        this.pageErrors += 1
      } else if (type === 'warn') {
        this.pageWarnings += 1
      }
    }
  }

  /**
   * updateStats
   */
  async updateStats(): Promise<SessionStats> {
    if (!this.browser) {
      this.stats = {}
      return this.stats
    }

    const collectedStats: SessionStats = {}

    try {
      const processStats = await getProcessStats()
      Object.assign(collectedStats, {
        nodeCpu: processStats.cpu,
        nodeMemory: processStats.memory,
      })
    } catch (err) {
      log.error(`node getProcessStats error: ${(err as Error).stack}`)
    }

    try {
      const systemStats = getSystemStats()
      if (systemStats) {
        collectedStats.usedCpu = systemStats.usedCpu
        collectedStats.usedMemory = systemStats.usedMemory
        collectedStats.usedGpu = systemStats.usedGpu
        if (collectedStats.usedCpu > 90) {
          log.warn(`High system CPU usage: ${collectedStats.usedCpu.toFixed(2)}%`)
        }
        if (collectedStats.usedMemory > 90) {
          log.warn(`High system memory usage: ${collectedStats.usedMemory.toFixed(2)}%`)
        }
      }
    } catch (err) {
      log.error(`node getSystemStats error: ${(err as Error).stack}`)
    }

    const browserProcess = this.browser.process()
    if (browserProcess) {
      try {
        const processStats = await getProcessStats(browserProcess.pid, true)
        Object.assign(collectedStats, processStats)
      } catch (err) {
        log.error(`getProcessStats error: ${(err as Error).stack}`)
      }
    }

    const pages: Record<string, number> = {}
    const peerConnections: Record<string, number> = {}
    const peerConnectionConnectionTime: Record<string, number> = {}
    const peerConnectionDisconnectionTime: Record<string, number> = {}
    const peerConnectionsCreated: Record<string, number> = {}
    const peerConnectionsClosed: Record<string, number> = {}
    const peerConnectionsConnected: Record<string, number> = {}
    const peerConnectionsDisconnected: Record<string, number> = {}
    const peerConnectionsFailed: Record<string, number> = {}
    const peerConnectionsDelay: Record<string, number> = {}
    const audioEndToEndDelayStats: Record<string, number> = {}
    const audioStartFrameDelayStats: Record<string, number> = {}
    const videoEndToEndDelayStats: Record<string, number> = {}
    const screenEndToEndDelayStats: Record<string, number> = {}
    const videoStartFrameDelayStats: Record<string, number> = {}
    const screenStartFrameDelayStats: Record<string, number> = {}
    const httpSentBytesStats: Record<string, number> = {}
    const httpRecvBytesStats: Record<string, number> = {}
    const httpRecvLatencyStats: Record<string, number> = {}
    const wsSentBytesStats: Record<string, number> = {}
    const wsRecvBytesStats: Record<string, number> = {}
    const wsRecvLatencyStats: Record<string, number> = {}
    const pageCpu: Record<string, number> = {}
    const pageMemory: Record<string, number> = {}
    const cpuPressureStats: Record<string, number> = {}
    const questionAnswerDelayStats: Record<string, number> = {}

    const videoWidth: Record<string, number> = {}
    const videoHeight: Record<string, number> = {}
    const videoBufferedTime: Record<string, number> = {}
    const videoPlayingTime: Record<string, number> = {}
    const videoBufferingTime: Record<string, number> = {}
    const videoBufferingEvents: Record<string, number> = {}

    const throttleUpValuesRate: Record<string, number> = {}
    const throttleUpValuesDelay: Record<string, number> = {}
    const throttleUpValuesLoss: Record<string, number> = {}
    const throttleUpValuesQueue: Record<string, number> = {}
    const throttleDownValuesRate: Record<string, number> = {}
    const throttleDownValuesDelay: Record<string, number> = {}
    const throttleDownValuesLoss: Record<string, number> = {}
    const throttleDownValuesQueue: Record<string, number> = {}

    const customStats: Record<string, Record<string, number | string>> = {}

    await Promise.allSettled(
      [...this.pages.entries()].map(async ([pageIndex, page]) => {
        try {
          // Collect stats from the page.
          const {
            peerConnectionStats,
            audioEndToEndDelay,
            videoEndToEndDelay,
            cpuPressure,
            questionAnswerDelay,
            videoStats,
            customMetrics,
          } = await page.evaluate(async () => ({
            peerConnectionStats: await webrtcperf.collectPeerConnectionStats(),
            audioEndToEndDelay: webrtcperf.collectAudioEndToEndStats(),
            videoEndToEndDelay: webrtcperf.collectVideoEndToEndStats(),
            cpuPressure: webrtcperf.collectCpuPressure(),
            questionAnswerDelay: webrtcperf.collectQuestionAnswerDelay(),
            videoStats: webrtcperf.collectVideoStats(),
            customMetrics: 'collectCustomMetrics' in window ? collectCustomMetrics() : null,
          }))
          const { participantName } = peerConnectionStats

          const httpResourcesStats = this.httpResourcesStats.get(pageIndex)

          // Get host from the first collected remote address.
          if (!peerConnectionStats.signalingHost && peerConnectionStats.stats.length) {
            const values = Object.values(peerConnectionStats.stats[0])
            if (values.length) {
              peerConnectionStats.signalingHost = await resolveIP(values[0].remoteAddress as string)
            }
          }
          const { stats, activePeerConnections, signalingHost } = peerConnectionStats

          // Calculate stats keys.
          const hostKey = rtcStatKey({
            hostName: signalingHost,
            participantName,
          })
          const pageKey = rtcStatKey({
            pageIndex,
            hostName: signalingHost,
            participantName,
          })

          // Set pages counter.
          increaseKey(pages, hostKey, 1)

          // Set peerConnections counters.
          increaseKey(peerConnections, pageKey, activePeerConnections)
          increaseKey(peerConnectionConnectionTime, pageKey, peerConnectionStats.peerConnectionConnectionTime)
          increaseKey(peerConnectionDisconnectionTime, pageKey, peerConnectionStats.peerConnectionDisconnectionTime)
          increaseKey(peerConnectionsCreated, pageKey, peerConnectionStats.peerConnectionsCreated)
          increaseKey(peerConnectionsClosed, pageKey, peerConnectionStats.peerConnectionsClosed)
          increaseKey(peerConnectionsConnected, pageKey, peerConnectionStats.peerConnectionsConnected)
          increaseKey(peerConnectionsDisconnected, pageKey, peerConnectionStats.peerConnectionsDisconnected)
          increaseKey(peerConnectionsFailed, pageKey, peerConnectionStats.peerConnectionsFailed)
          increaseKey(peerConnectionsDelay, pageKey, peerConnectionStats.peerConnectionsDelay)

          // E2E stats.
          if (audioEndToEndDelay) {
            audioEndToEndDelayStats[pageKey] = audioEndToEndDelay.delay
            audioStartFrameDelayStats[pageKey] = audioEndToEndDelay.startFrameDelay
          }
          if (videoEndToEndDelay) {
            videoEndToEndDelayStats[pageKey] = videoEndToEndDelay.videoDelay
            videoStartFrameDelayStats[pageKey] = videoEndToEndDelay.videoStartFrameDelay
            screenEndToEndDelayStats[pageKey] = videoEndToEndDelay.screenDelay
            screenStartFrameDelayStats[pageKey] = videoEndToEndDelay.screenStartFrameDelay
          }

          // HTTP stats.
          if (httpResourcesStats) {
            if (httpResourcesStats.sentBytes > 0) httpSentBytesStats[pageKey] = httpResourcesStats.sentBytes
            if (httpResourcesStats.recvBytes > 0) httpRecvBytesStats[pageKey] = httpResourcesStats.recvBytes
            if (httpResourcesStats.recvLatency.length)
              httpRecvLatencyStats[pageKey] = httpResourcesStats.recvLatency.amean()
            if (httpResourcesStats.wsSentBytes > 0) wsSentBytesStats[pageKey] = httpResourcesStats.wsSentBytes
            if (httpResourcesStats.wsRecvBytes > 0) wsRecvBytesStats[pageKey] = httpResourcesStats.wsRecvBytes
            if (httpResourcesStats.wsRecvLatency.length)
              wsRecvLatencyStats[pageKey] = httpResourcesStats.wsRecvLatency.amean()
          }

          if (cpuPressure !== undefined) cpuPressureStats[pageKey] = cpuPressure
          if (questionAnswerDelay !== undefined) questionAnswerDelayStats[pageKey] = questionAnswerDelay
          if (videoStats) {
            videoWidth[pageKey] = videoStats.width
            videoHeight[pageKey] = videoStats.height
            videoBufferedTime[pageKey] = videoStats.bufferedTime
            videoPlayingTime[pageKey] = videoStats.playingTime
            videoBufferingTime[pageKey] = videoStats.bufferingTime
            videoBufferingEvents[pageKey] = videoStats.bufferingEvents
          }

          // Collect RTC stats.
          for (const s of stats) {
            for (const [trackId, value] of Object.entries(s)) {
              try {
                updateRtcStats(collectedStats as RtcStats, pageIndex, trackId, value, signalingHost, participantName)
              } catch (err) {
                log.error(`updateRtcStats error for ${trackId}: ${(err as Error).stack}`, err)
              }
            }
          }

          // Collect custom metrics.
          if (customMetrics) {
            for (const [name, value] of Object.entries(customMetrics)) {
              if (!customStats[name]) {
                customStats[name] = {}
              }
              customStats[name][pageKey] = value
            }
          }

          // Collect page metrics
          /* const metrics = await page.metrics()
        if (metrics.Timestamp) {
          const lastMetrics = this.pagesMetrics.get(pageIndex)
          if (lastMetrics?.Timestamp) {
            const elapsedTime = metrics.Timestamp - lastMetrics.Timestamp
            if (elapsedTime > 10) {
              const durationDiff =
                metricsTotalDuration(metrics) -
                metricsTotalDuration(lastMetrics)
              const usage = (100 * durationDiff) / elapsedTime
              pageCpu[pageKey] = usage
              pageMemory[pageKey] = (metrics.JSHeapUsedSize || 0) / 1e6
              this.pagesMetrics.set(pageIndex, metrics)
            }
          } else {
            this.pagesMetrics.set(pageIndex, metrics)
          }
        } */
          pageCpu[pageKey] = (collectedStats.cpu as number) / this.tabsPerSession
          pageMemory[pageKey] = (collectedStats.memory as number) / this.tabsPerSession

          // Collect throttle metrics
          const throttleUpValues = getSessionThrottleValues(this.throttleIndex, 'up')
          throttleUpValuesRate[pageKey] = throttleUpValues.rate || 0
          throttleUpValuesDelay[pageKey] = throttleUpValues.delay || 0
          throttleUpValuesLoss[pageKey] = throttleUpValues.loss || 0
          throttleUpValuesQueue[pageKey] = throttleUpValues.queue || 0

          const throttleDownValues = getSessionThrottleValues(this.throttleIndex, 'down')
          throttleDownValuesRate[pageKey] = throttleDownValues.rate || 0
          throttleDownValuesDelay[pageKey] = throttleDownValues.delay || 0
          throttleDownValuesLoss[pageKey] = throttleDownValues.loss || 0
          throttleDownValuesQueue[pageKey] = throttleDownValues.queue || 0
        } catch (err) {
          const error = err as Error
          if (error.message.includes('Execution context was destroyed, most likely because of a navigation.')) {
            log.warn(`collectPeerConnectionStats for page ${pageIndex} error: ${error.message}`)
          } else {
            log.error(`collectPeerConnectionStats for page ${pageIndex} error: ${error.stack}`)
          }
        }
      }),
    )

    Object.assign(collectedStats, {
      pages,
      errors: this.pageErrors,
      warnings: this.pageWarnings,
      peerConnections,
      peerConnectionConnectionTime,
      peerConnectionDisconnectionTime,
      peerConnectionsConnected,
      peerConnectionsCreated,
      peerConnectionsClosed,
      peerConnectionsDisconnected,
      peerConnectionsFailed,
      peerConnectionsDelay,
      audioEndToEndDelay: audioEndToEndDelayStats,
      audioStartFrameDelay: audioStartFrameDelayStats,
      videoEndToEndDelay: videoEndToEndDelayStats,
      videoStartFrameDelay: videoStartFrameDelayStats,
      screenEndToEndDelay: screenEndToEndDelayStats,
      screenStartFrameDelay: screenStartFrameDelayStats,
      httpSentBytes: httpSentBytesStats,
      httpRecvBytes: httpRecvBytesStats,
      httpRecvLatency: httpRecvLatencyStats,
      wsSentBytes: wsSentBytesStats,
      wsRecvBytes: wsRecvBytesStats,
      wsRecvLatency: wsRecvLatencyStats,
      cpuPressure: cpuPressureStats,
      questionAnswerDelay: questionAnswerDelayStats,
      videoWidth,
      videoHeight,
      videoBufferedTime,
      videoPlayingTime,
      videoBufferingTime,
      videoBufferingEvents,
      pageCpu,
      pageMemory,
      throttleUpRate: throttleUpValuesRate,
      throttleUpDelay: throttleUpValuesDelay,
      throttleUpLoss: throttleUpValuesLoss,
      throttleUpQueue: throttleUpValuesQueue,
      throttleDownRate: throttleDownValuesRate,
      throttleDownDelay: throttleDownValuesDelay,
      throttleDownLoss: throttleDownValuesLoss,
      throttleDownQueue: throttleDownValuesQueue,
      ...customStats,
    })

    if (pages.size < this.pages.size) {
      log.warn(`updateStats collected pages ${pages.size} < ${this.pages.size}`)
    }

    this.stats = collectedStats
    return this.stats
  }

  /**
   * stop
   */
  async stop(error?: Error): Promise<void> {
    if (!this.running) {
      return
    }
    this.running = false
    log.debug(`${this.id} stop${error ? ` (error: ${error.message})` : ''}`)

    if (this.stopPortForwarder) {
      this.stopPortForwarder()
    }

    if (this.browser) {
      // close the opened tabs
      log.debug(`${this.id} closing ${this.pages.size} pages`)
      await Promise.allSettled(
        [...this.pages.values()].map(page => {
          return page.close({ runBeforeUnload: true })
        }),
      )
      if (this.pages.size > 0) {
        const now = Date.now()
        const maxWaitTime = 1000 * this.pages.size
        while (this.pages.size > 0 && Date.now() - now < maxWaitTime) {
          log.debug(`${this.id} waiting for ${this.pages.size} pages to close`)
          await sleep(200)
        }
        if (this.pages.size > 0) {
          log.warn(`${this.id} timeout closing ${this.pages.size} pages`)
        }
      }

      if (this.screensharePage) {
        await this.screensharePage.close()
        this.screensharePage = undefined
      }

      this.browser.removeAllListeners()
      if (this.chromiumUrl) {
        log.debug(`${this.id} disconnect from browser`)
        try {
          await this.browser.disconnect()
        } catch (err) {
          log.warn(`${this.id} browser disconnect error: ${(err as Error).message}`)
        }
      } else {
        const pid = this.browser.process()?.pid
        if (pid) {
          log.debug(`${this.id} closing browser (pid: ${pid})`)
          try {
            await this.browser.close()
          } catch (err) {
            log.error(`${this.id} browser close error: ${(err as Error).stack}`)
          }
          await waitStopProcess(pid, 5000)
        }
      }
      this.pages.clear()
      this.pagesMetrics.clear()
      this.browser = undefined
    }

    this.emit('stop', this.id, error)
  }

  /**
   * pageScreenshot
   * @param {number} pageIndex
   * @param {String} format The image format (png|jpeg|webp).
   * @return {String}
   */
  async pageScreenshot(pageIndex = 0, format = 'webp'): Promise<string> {
    log.debug(`pageScreenshot ${this.id}-${pageIndex}`)
    const index = this.id + pageIndex
    const page = this.pages.get(index)
    if (!page) {
      throw new Error(`Page ${index} not found`)
    }
    const filePath = `/tmp/screenshot-${index}.${format}` as `${string}.${ImageFormat}`
    await page.screenshot({
      path: filePath,
      fullPage: true,
    })
    return filePath
  }
}

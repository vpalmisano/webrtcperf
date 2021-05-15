const log = require('debug-level')('app:session');
const EventEmitter = require('events');
const fs = require('fs');
const puppeteer = require('puppeteer');
const chalk = require('chalk');
const requestretry = require('requestretry');
//
const {getProcessStats} = require('./stats');
const {RTC_STATS_NAMES, rtcStats, purgeRtcStats} = require('./rtcstats');

const {config} = require('./config');

module.exports = class Session extends EventEmitter {
  /**
   * Session
   * @param {*} id
   */
  constructor({id}) {
    super();
    log.debug('constructor', {id});
    this.id = id;
    //
    this.stats = {
      cpu: 0,
      memory: 0,
      tabs: 0,
    };
    RTC_STATS_NAMES.forEach((name) => {
      this.stats[name] = {};
    });
    this.updateStatsTimeout = null;
    this.browser = null;
    this.pages = new Map();
  }

  /**
   * Start
   */
  async start() {
    log.debug(`${this.id} start`);

    const env = {...process.env};

    if (!config.useNullVideoDecoder) {
      delete (env.USE_NULL_VIDEO_DECODER);
    } else {
      env.USE_NULL_VIDEO_DECODER = '1';
    }

    if (!config.display) {
      delete (env.DISPLAY);
    } else {
      env.DISPLAY = config.display;
    }

    try {
      // log.debug('defaultArgs:', puppeteer.defaultArgs());
      this.browser = await puppeteer.launch({
        headless: !config.display,
        executablePath: config.chromiumPath,
        env,
        // devtools: true,
        ignoreHTTPSErrors: true,
        defaultViewport: {
          width: config.windowWidth,
          height: config.windowHeight,
          deviceScaleFactor: 1,
          isMobile: false,
          hasTouch: false,
          isLandscape: false,
        },
        ignoreDefaultArgs: [
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
        args: [
          // https://peter.sh/experiments/chromium-command-line-switches/
          /* puppeteer settings:
          '--disable-background-networking',
          '--disable-client-side-phishing-detection',
          '--disable-default-apps',
          '--disable-features=Translate',
          '--disable-ipc-flooding-protection',
          '--disable-popup-blocking',
          '--disable-extensions',
          '--disable-sync',
          '--no-first-run',
          '--enable-automation',
          '--password-store=basic',
          '--enable-blink-features=IdleDetection',
          '--hide-scrollbars',
          '--mute-audio', */
          '--no-sandbox',
          '--no-zygote',
          // `--window-size=320,160`,
          '--ignore-certificate-errors',
          '--no-user-gesture-required',
          '--autoplay-policy=no-user-gesture-required',
          '--disable-infobars',
          // '--ignore-gpu-blacklist',
          `${'--force-fieldtrials=' +
            'AutomaticTabDiscarding/Disabled' +
            '/WebRTC-Vp9DependencyDescriptor/Enabled' +
            '/WebRTC-DependencyDescriptorAdvertised/Enabled'}${
            config.audioRedForOpus ?
              '/WebRTC-Audio-Red-For-Opus/Enabled' : ''}`,
          // '--renderer-process-limit=1',
          // '--single-process',
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
        ].concat(
          config.videoPath ? [
            `--use-file-for-fake-video-capture=${
              config.videoCachePath}/video.${config.videoFormat}`,
            `--use-file-for-fake-audio-capture=${
              config.videoCachePath}/audio.wav`,
          ] : [
            // '--use-fake-codec-for-peer-connection'
          ]),
        /* .concat(!process.env.DISPLAY ? ['--headless'] : []) */
        /* .concat(['about:blank']) */
      });

      this.browser.once('disconnected', () => {
        log.warn('browser disconnected');
        this.stop();
      });

      // open pages
      for (let i = 0; i < config.tabsPerSession; i++) {
        setTimeout(() => this.openPage(i), i * config.spawnPeriod);
      }

      // collect stats
      this.updateStatsTimeout = setTimeout(this.updateStats.bind(this),
          config.statsInterval * 1000);
    } catch (err) {
      console.error(`${this.id} start error:`, err);
      this.stop();
    }
  }

  /**
   * openPage
   * @param {int} tabIndex
   */
  async openPage(tabIndex) {
    if (!this.browser) {
      return;
    }

    const index = (this.id * config.tabsPerSession) + tabIndex;

    let url = config.url;

    if (config.urlQuery) {
      url += `?${config.urlQuery
          .replace(/\$s/g, this.id + 1)
          .replace(/\$S/g, config.sessions)
          .replace(/\$t/g, tabIndex + 1)
          .replace(/\$T/g, config.tabsPerSession)
          .replace(/\$i/g, index + 1)
          .replace(/\$p/g, process.pid)}`;
    }

    log.info(`opening page ${this.id + 1}-${tabIndex + 1}: ${url}`);
    const page = await this.browser.newPage();

    //
    await page.exposeFunction('traceRtcStats', (sampleList) => {
      // log.debug('traceRtcStats', util.inspect(sampleList, { depth: null }));
      const now = Date.now();
      for (const sample of sampleList) {
        try {
          rtcStats(this.stats, now, index, sample);
        } catch (err) {
          console.error(err);
        }
      }
    });

    await page.evaluateOnNewDocument(
        `window.WEBRTC_STRESS_TEST_SESSION = ${this.id + 1};` +
        `window.WEBRTC_STRESS_TEST_TAB_INDEX = ${tabIndex + 1};` +
        `window.WEBRTC_STRESS_TEST_INDEX = ${index + 1};` +
        `window.STATS_INTERVAL = ${config.statsInterval};`);

    //

    if (config.getUserMediaOverrides &&
        index < config.getUserMediaOverrides.length) {
      const override = config.getUserMediaOverrides[index];
      log.debug('Using getUserMedia override:', override);
      await page.evaluateOnNewDocument(`
window.GET_USER_MEDIA_OVERRIDE = JSON.parse('${JSON.stringify(override)}');
      `);
    }

    // load a preload script
    if (config.preloadScriptPath) {
      await page.evaluateOnNewDocument(
          await fs.promises.readFile(config.preloadScriptPath, 'utf8'));
    }

    // load observertc
    if (config.enableRtcStats) {
      await page.evaluateOnNewDocument(
          (await requestretry('https://cdn.jsdelivr.net/gh/vpalmisano/observer-js@custom-stats/dist/v0.6.2/observer.min.js')).body);
      await page.evaluateOnNewDocument(
          await fs.promises.readFile('./observertc.js', 'utf8'));
    }

    //
    page.once('domcontentloaded', async () => {
      log.debug(`page ${this.id + 1}-${tabIndex + 1} domcontentloaded`);

      // add external script
      if (config.scriptPath) {
        await page.addScriptTag({
          path: config.scriptPath,
          type: 'text/javascript',
        });
      }

      // enable perf
      // https://chromedevtools.github.io/devtools-protocol/tot/Cast/
      // const client = await page.target().createCDPSession();
      // await client.send('Performance.enable', { timeDomain: 'timeTicks' });

      // add to pages map
      this.pages.set(index, {page/* , client */});
      this.stats.tabs = this.pages.size;
    });

    page.on('close', () => {
      log.info(`page ${this.id + 1}-${tabIndex + 1} closed`);
      this.pages.delete(index);
      this.stats.tabs = this.pages.size;

      if (this.browser) {
        setTimeout(() => this.openPage(index), config.spawnPeriod);
      }
    });

    if (config.enablePageLog) {
      page.on('console', (msg) => console.log(
          chalk`{yellow {bold [page ${this.id + 1}-${tabIndex + 1}]} ${
            msg.text()}}`));
    }

    // open the page url
    await page.goto(url, {
      waitUntil: 'load',
      timeout: 60 * 1000,
    });

    // select the first blank page
    const pages = await this.browser.pages();
    await pages[0].bringToFront();
  }

  /**
   * updateStats
   */
  async updateStats() {
    if (!this.browser) {
      return;
    }

    const {pid} = this.browser.process();
    // log.debug('updateStats', pid);

    Object.assign(this.stats, await getProcessStats(pid, true));

    //
    /* for(const [index, { page, client }] of this.pages.entries()) {
      const metrics = await client.send('Performance.getMetrics');
      const pageMetrics = {};
      for (const m of metrics.metrics) {
        if (['LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration',
             'V8CompileDuration', 'TaskDuration',
             'TaskOtherDuration', 'ThreadTime', 'ProcessTime',
             'JSHeapUsedSize', 'JSHeapTotalSize'].includes(m.name)) {
          pageMetrics[m.name] = m.value;
        }
      }
      log.info(`page-${index}:`, pageMetrics);
    } */

    purgeRtcStats(this.stats);

    //
    this.updateStatsTimeout = setTimeout(this.updateStats.bind(this),
        config.statsInterval * 1000);
  }

  /**
   * stop
   */
  async stop() {
    log.debug(`${this.id} stop`);

    if (this.updateStatsTimeout) {
      clearTimeout(this.updateStatsTimeout);
      this.updateStatsTimeout = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err) {
        console.error('browser close error:', err);
      }
      this.browser = null;
      this.pages.clear();
      this.stats.tabs = 0;
    }

    this.emit('stop');
  }
};

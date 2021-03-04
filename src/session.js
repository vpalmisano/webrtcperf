/* eslint no-cond-assign:0, no-console:0 */
'use strict';

const log = require('debug-level')('app:session');
const EventEmitter = require('events');
const fs = require('fs');
const puppeteer = require('puppeteer');
const chalk = require('chalk');
//
const { getProcessStats } = require('./stats');
const config = require('../config');

module.exports = class Session extends EventEmitter {
  constructor ({ id }) {
    super();
    log.debug('constructor', { id });
    this.id = id;
    //
    this.stats = {
      cpu: 0,
      memory: 0,
      googActualEncBitrates: {},
      bytesReceived: {},
      bytesSent: {},
    };
    this.updateStatsTimeout = null;
    this.browser = null;
    this.pages = new Map();
  }

  async start(){
    log.debug(`${this.id} start`);

    try {
      // log.debug('defaultArgs:', puppeteer.defaultArgs());
      this.browser = await puppeteer.launch({ 
        headless: !process.env.DISPLAY,
        executablePath: '/usr/bin/chromium-browser-unstable',
        //devtools: true,
        ignoreHTTPSErrors: true,
        defaultViewport: {
          width: config.WINDOW_WIDTH,
          height: config.WINDOW_HEIGHT,
          deviceScaleFactor: 1,
          isMobile: false,
          hasTouch: false,
          isLandscape: false
        },
        //ignoreDefaultArgs: true,
        args: [ 
          //'--disable-gpu',
          /* '--disable-background-networking',
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
          //`--window-size=${config.WINDOW_WIDTH},${config.WINDOW_HEIGHT}`,
          //'--disable-dev-shm-usage',
          '--ignore-certificate-errors',
          '--no-user-gesture-required',
          '--autoplay-policy=no-user-gesture-required',
          '--disable-infobars',
          '--enable-precise-memory-info',
          '--ignore-gpu-blacklist',
          '--force-fieldtrials=AutomaticTabDiscarding/Disabled' //'/WebRTC-Vp9DependencyDescriptor/Enabled/WebRTC-DependencyDescriptorAdvertised/Enabled',
        ].concat(
          config.VIDEO_PATH ? [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--use-file-for-fake-video-capture=/tmp/video.y4m',
            '--use-file-for-fake-audio-capture=/tmp/audio.wav'
          ] : []
        )
        /* .concat(!process.env.DISPLAY ? ['--headless'] : []) */
        /* .concat(['about:blank']) */
      });

      this.browser.once('disconnected', () => {
        log.warn('browser disconnected');
        this.stop();
      });

      // open pages
      for (let i=0; i<config.TABS_PER_SESSION; i++) {
        setTimeout(async () => {
          await this.openPage(i);
        }, i * config.SPAWN_PERIOD);
      }

      // collect stats
      this.updateStatsTimeout = setTimeout(this.updateStats.bind(this), config.STATS_INTERVAL * 1000);

    } catch(err) {
      log.error(`${this.id} start error:`, err);
      this.stop();
    }
  }

  async openPage(index) {
    let url = config.URL;
    if (config.URL_QUERY) {
      url += '?' + config.URL_QUERY
        .replace(/\$s/g, this.id + 1)
        .replace(/\$S/g, config.SESSIONS)
        .replace(/\$t/g, index + 1)
        .replace(/\$T/g, config.TABS_PER_SESSION)
        .replace(/\$p/g, process.pid)
        ;
    }
    log.info(`${this.id} opening page: ${url}`);
    const page = await this.browser.newPage();
    //
    await page.exposeFunction('traceRtcStats', (method, name, data) => {
      if (method === 'getstats') {
        //log.debug('traceRtcStats', method, name, data);
        /* example data:
         {
          "Conn-0-1-0":{"timestamp":0,"requestsSent":"9","bytesReceived":"1043993","responsesReceived":"9","bytesSent":"16501","packetsSent":"348"},
          "ssrc_587646961_recv":{"timestamp":0,"packetsReceived":"963","googFrameRateReceived":"25","bytesReceived":"954996"},
          "ssrc_1234_recv":{"timestamp":0,"googPlisSent":"34"},
          "ssrc_183419048_recv":{"timestamp":0,"googDecodingCTN":"1386","googSpeechExpandRate":"0","totalSamplesDuration":"13.86","googDecodingPLCCNG":"303",
              "googCurrentDelayMs":"80","googExpandRate":"1","googPreemptiveExpandRate":"0","googDecodingMuted":"302"},
          "timestamp":1614877831891}
         */
        //
        if (data.bweforvideo && data.bweforvideo.googActualEncBitrate) {
          this.stats.googActualEncBitrates[name] = data.bweforvideo.googActualEncBitrate;
        }
        // transport stats
        if (data['Conn-0-1-0']) {
          const { bytesReceived, bytesSent } = data['Conn-0-1-0'];
          if (bytesReceived !== undefined) {
            this.stats.bytesReceived[name] = bytesReceived;
          } else {
            this.stats.bytesReceived[name] = 0;
          }
          if (bytesSent !== undefined) {
            this.stats.bytesSent[name] = bytesSent;
          } else {
            this.stats.bytesSent[name] = 0;
          }
        }
      }
    });
    //
    page.once('domcontentloaded', async () => {
      log.debug(`${this.id} page domcontentloaded`);
      
      // load rtcstats
      await page.addScriptTag({
        content: String(await fs.promises.readFile('./node_modules/rtcstats/rtcstats.js')).replace('module.exports = function', 'function rtcstats'),
        type: 'text/javascript'
      });
      await page.addScriptTag({
        content: `rtcstats(window.traceRtcStats, ${config.STATS_INTERVAL * 1000}, ['', 'webkit', 'moz']);`,
        type: 'text/javascript'
      });

      // add external script
      if (config.SCRIPT_PATH) {
        await page.addScriptTag({
          content: `window.WEBRTC_STRESS_TEST_SESSION = ${this.id + 1};`
                  +`window.WEBRTC_STRESS_TEST_TAB = ${index + 1};`,
          type: 'text/javascript'
        });
        await page.addScriptTag({
          content: String(await fs.promises.readFile(config.SCRIPT_PATH)),
          type: 'text/javascript'
        });
      }

      // enable perf
      //const client = await page.target().createCDPSession();
      //await client.send('Performance.enable', { timeDomain: 'timeTicks' });

      // add to pages map
      this.pages.set(index, { page/* , client */ });
    });
    page.on('close', () => {
      log.info(`${this.id} page closed: ${url}`);
      this.pages.delete(index);
      setTimeout(async () => {
        await this.openPage(index);
      }, config.SPAWN_PERIOD);
    });
    if (config.ENABLE_PAGE_LOG) {
      page.on('console', (msg) => console.log(chalk`{yellow {bold [page ${this.id}-${index}]} ${msg.text()}}`));
    }
    await page.goto(url);
    // select the first blank page
    const pages = await this.browser.pages();
    await pages[0].bringToFront();
  }

  async updateStats() {
    if (!this.browser) {
      return;
    }
    const pid = this.browser.process().pid;
    //log.debug('updateStats', pid);
    Object.assign(this.stats, await getProcessStats(pid, true));
    //
    /* for(const [index, { page, client }] of this.pages.entries()) {
      const metrics = await client.send('Performance.getMetrics');
      const pageMetrics = {};
      for (const m of metrics.metrics) {
        if (['LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'V8CompileDuration', 'TaskDuration',
             'TaskOtherDuration', 'ThreadTime', 'ProcessTime', 'JSHeapUsedSize', 'JSHeapTotalSize'].includes(m.name)) {
          pageMetrics[m.name] = m.value;
        }
      }
      log.info(`page-${index}:`, pageMetrics);
    } */
    //
    this.updateStatsTimeout = setTimeout(this.updateStats.bind(this), config.STATS_INTERVAL * 1000);
  }

  async stop(){
    log.debug(`${this.id} stop`);
    //
    if (this.updateStatsTimeout) {
      clearTimeout(this.updateStatsTimeout);
      this.updateStatsTimeout = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch(err) {
        log.error('browser close error:', err);
      }
      this.browser = null;
      this.pages = new Map();
    }
    //
    this.emit('stop');
  }

}

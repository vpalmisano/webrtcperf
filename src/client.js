/* eslint no-cond-assign:0, no-console:0 */
'use strict';

const log = require('debug-level')('app:client');
const EventEmitter = require('events');
const fs = require('fs');
const puppeteer = require('puppeteer');
//
const { getProcessStats } = require('./stats');
const config = require('../config');

module.exports = class RtcClient extends EventEmitter {
  constructor ({ id }) {
    super();
    log.debug('constructor', { id });
    this.id = id;
    //
    this.browser = null;
    this.pages = new Map();
  }

  async start(){
    log.debug('start');

    try {
      log.debug('defaultArgs:', puppeteer.defaultArgs());
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
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          '--enable-precise-memory-info',
          '--ignore-gpu-blacklist',
          '--force-fieldtrials=AutomaticTabDiscarding/Disabled' //'/WebRTC-Vp9DependencyDescriptor/Enabled/WebRTC-DependencyDescriptorAdvertised/Enabled',
        ]/* .concat(
          !process.env.DISPLAY ? ['--headless'] : []
        ) */.concat(
          config.VIDEO_PATH && config.PUBLISH_VIDEO ? ['--use-file-for-fake-video-capture=/tmp/video.y4m'] : []
        ).concat(
          config.VIDEO_PATH && config.PUBLISH_AUDIO ? ['--use-file-for-fake-audio-capture=/tmp/audio.wav'] : []
        )/* .concat(['about:blank']) */
      });

      this.browser.once('disconnected', () => {
        log.warn('browser disconnected');
        this.stop();
      });

      for (let i=0; i<config.TABS_PER_SESSION; i++) {
        setTimeout(async () => {
          await this.openPage(i);
        }, i*config.SPAWN_PERIOD);
      }

    } catch(err) {
      log.error('start error:', err);
      this.stop();
    }
  }

  async openPage(index) {
    const url = `${config.URL}?displayName=User-${this.id}.${index}`;
    log.info(`opening page: ${url}`);
    const page = await this.browser.newPage();
    page.once('domcontentloaded', async () => {
      log.debug('page domcontentloaded');
      if (config.SCRIPT_PATH) {
        await page.addScriptTag({
          content: String(await fs.promises.readFile(config.SCRIPT_PATH)),
          type: 'text/javascript'
        });
      }
      //
      const client = await page.target().createCDPSession();
      await client.send('Performance.enable', { timeDomain: 'timeTicks' });
      this.pages.set(index, { page, client });
    });
    page.on('close', () => {
      log.info(`page closed: ${url}`);
      this.pages.delete(index);
      setTimeout(async () => {
        await this.openPage(index);
      }, config.SPAWN_PERIOD);
    });
    //page.on('console', (msg) => log.debug('[PAGE] ', msg.text()));
    await page.goto(url);
    // select the first blank page
    const pages = await this.browser.pages();
    await pages[0].bringToFront();
  }

  async getStats() {
    if (!this.browser) {
      return {};
    }
    const pid = this.browser.process().pid;
    //log.debug('getStats', pid);
    const stats = await getProcessStats(pid, true);
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
    return stats;
  }

  async stop(){
    log.debug('stop');
    //
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
    process.exit(0);
  }

}

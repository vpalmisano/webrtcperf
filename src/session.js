/* eslint no-cond-assign:0, no-console:0 */
'use strict';

const log = require('debug-level')('app:session');
const EventEmitter = require('events');
const fs = require('fs');
const util = require('util');
const puppeteer = require('puppeteer');
const chalk = require('chalk');
const requestretry = require('requestretry');
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
      timestamps: {},
      // inbound
      audioBytesReceived: {},
      audioRecvBitrates: {},
      audioAvgJitterBufferDelay: {},
      videoBytesReceived: {},
      videoRecvBitrates: {},
      videoAvgJitterBufferDelay: {},
      // outbound
      audioBytesSent: {},
      audioRetransmittedBytesSent: {},
      audioSendBitrates: {},
      videoBytesSent: {},
      videoRetransmittedBytesSent: {},
      videoSendBitrates: {},
      qualityLimitationResolutionChanges: {},
    };
    this.updateStatsTimeout = null;
    this.browser = null;
    this.pages = new Map();
  }

  async start(){
    log.debug(`${this.id} start`);

    const env = {...process.env};
    if (!config.USE_NULL_VIDEO_DECODER) {
      delete(env.USE_NULL_VIDEO_DECODER);
    }

    try {
      // log.debug('defaultArgs:', puppeteer.defaultArgs());
      this.browser = await puppeteer.launch({ 
        headless: !env.DISPLAY,
        executablePath: config.CHROMIUM_PATH,
        env,
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
        ignoreDefaultArgs: [
          '--disable-dev-shm-usage'
        ],
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
          '--ignore-certificate-errors',
          '--no-user-gesture-required',
          '--autoplay-policy=no-user-gesture-required',
          '--disable-infobars',
          '--enable-precise-memory-info',
          '--ignore-gpu-blacklist',
          '--force-fieldtrials=AutomaticTabDiscarding/Disabled/WebRTC-Vp9DependencyDescriptor/Enabled/WebRTC-DependencyDescriptorAdvertised/Enabled',
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
        setTimeout(() => this.openPage(i), i * config.SPAWN_PERIOD);
      }

      // collect stats
      this.updateStatsTimeout = setTimeout(this.updateStats.bind(this), config.STATS_INTERVAL * 1000);

    } catch(err) {
      console.error(`${this.id} start error:`, err);
      this.stop();
    }
  }

  async openPage(tabIndex) {
    const index = (this.id * config.TABS_PER_SESSION) + tabIndex;

    let url = config.URL;
    
    if (config.URL_QUERY) {
      url += '?' + config.URL_QUERY
        .replace(/\$s/g, this.id + 1)
        .replace(/\$S/g, config.SESSIONS)
        .replace(/\$t/g, tabIndex + 1)
        .replace(/\$T/g, config.TABS_PER_SESSION)
        .replace(/\$i/g, index + 1)
        .replace(/\$p/g, process.pid)
        ;
    }

    log.info(`${this.id} opening page: ${url}`);
    const page = await this.browser.newPage();
    
    //
    await page.exposeFunction('traceRtcStats', (sampleList) => {
      //log.debug('traceRtcStats', util.inspect(sampleList, { depth: null }));
      const now = Date.now();

      for (const sample of sampleList) {
        const { peerConnectionId, receiverStats, senderStats } = sample;
        // log.debug('traceRtcStats', util.inspect(sample, { depth: null }));

        // receiver
        let { inboundRTPStats, tracks } = receiverStats;
        for (const stat of inboundRTPStats) {
          // log.debug('traceRtcStats', util.inspect(stat, { depth: null }));
          /*
          {                                                                                                                                                                                                      
            bytesReceived: 923,                                                                                                                                                                                  
            codecId: 'RTCCodec_0_Inbound_100',                                                                                                                                                                   
            fecPacketsDiscarded: 0,                                                                                                                                                                              
            fecPacketsReceived: 0,                                                                                                                                                                               
            headerBytesReceived: 1204,                                                                                                                                                                           
            id: 'RTCInboundRTPAudioStream_362585473',
            isRemote: false,
            jitter: 0,
            lastPacketReceivedTimestamp: 3167413.454,
            mediaType: 'audio',
            packetsLost: 0,
            packetsReceived: 43,
            ssrc: 362585473,
            trackId: 'RTCMediaStreamTrack_receiver_3',
            transportId: 'RTCTransport_0_1'
          },
          {
            bytesReceived: 626796,
            codecId: 'RTCCodec_0_Inbound_101',
            decoderImplementation: 'libvpx',
            firCount: 0,
            framesDecoded: 146,
            headerBytesReceived: 19584,
            id: 'RTCInboundRTPVideoStream_605881643',
            isRemote: false,
            jitter: 1.706,
            keyFramesDecoded: 1,
            lastPacketReceivedTimestamp: 3438093.449,
            mediaType: 'video',
            nackCount: 0,
            packetsLost: 0,
            packetsReceived: 612,
            pliCount: 1,
            qpSum: 2374,
            ssrc: 605881643,
            totalDecodeTime: 0.15,
            totalInterFrameDelay: 6.368999999999999,
            totalSquaredInterFrameDelay: 0.2946809999999993,
            trackId: 'RTCMediaStreamTrack_receiver_3',
            transportId: 'RTCTransport_0_1'
          }
          {
            bytesReceived: 15488,
            decoderImplementation: 'unknown',
            firCount: 0,
            framesDecoded: 0,
            headerBytesReceived: 832,
            id: 'RTCInboundRTPVideoStream_1234',
            isRemote: false,
            jitter: 0.132,
            keyFramesDecoded: 0,
            lastPacketReceivedTimestamp: 3438092.641,
            mediaType: 'video',
            nackCount: 0,
            packetsLost: 0,
            packetsReceived: 26,
            pliCount: 29,
            ssrc: 1234,
            totalDecodeTime: 0,
            totalInterFrameDelay: 0,
            totalSquaredInterFrameDelay: 0,
            trackId: 'RTCMediaStreamTrack_receiver_4',
            transportId: 'RTCTransport_0_1'
          }
          */
          const key = `${index}_${peerConnectionId}_${stat.id}`;
          
          if (stat.mediaType === 'audio') {
            // calculate rate
            if (this.stats.timestamps[key]) {
              this.stats.audioRecvBitrates[key] = 8000 * 
                (stat.bytesReceived - this.stats.audioBytesReceived[key]) 
                / (now - this.stats.timestamps[key]);
            }
            // update values
            this.stats.timestamps[key] = now;
            this.stats.audioBytesReceived[key] = stat.bytesReceived;
          } else if (stat.mediaType === 'video' && stat.decoderImplementation !== 'unknown') {
            // calculate rate
            if (this.stats.timestamps[key]) {
              this.stats.videoRecvBitrates[key] = 8000 * 
                (stat.bytesReceived - this.stats.videoBytesReceived[key]) 
                / (now - this.stats.timestamps[key]);
            }
            // update values
            this.stats.timestamps[key] = now;
            this.stats.videoBytesReceived[key] = stat.bytesReceived;
          }
        }

        for (const stat of tracks) {
          //log.debug('traceRtcStats', util.inspect(stat, { depth: null }));
          /*
            {
              concealedSamples: 0,
              concealmentEvents: 0,
              detached: false,
              ended: false,
              id: 'RTCMediaStreamTrack_receiver_5',
              insertedSamplesForDeceleration: 120,
              jitterBufferDelay: 2659.2,
              jitterBufferEmittedCount: 29760,
              mediaType: 'audio',
              remoteSource: true,
              removedSamplesForAcceleration: 0,
              silentConcealedSamples: 0,
              totalSamplesReceived: 228000
            }
          */

          const key = `${index}_${peerConnectionId}_${stat.id}`;
          if (stat.jitterBufferEmittedCount) {
            // https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats-jitterbufferdelay
            let avgjitterBufferDelay = stat.jitterBufferDelay / stat.jitterBufferEmittedCount;
            if (stat.mediaType === 'audio') {
              this.stats.audioAvgJitterBufferDelay[key] = avgjitterBufferDelay;
            } else if (stat.mediaType === 'video') {
              this.stats.videoAvgJitterBufferDelay[key] = avgjitterBufferDelay;
            }
            this.stats.timestamps[key] = now;
          }

        }

        // sender
        let { outboundRTPStats } = senderStats;
        for (const stat of outboundRTPStats) {
          /*
            {                                                                                                                                                                                                      
              bytesSent: 245987,                                                                                                                                                                                   
              codecId: 'RTCCodec_0_Outbound_96',                                                                                                                                                                   
              encoderImplementation: 'libvpx',                                                                                                                                                                     
              firCount: 0,                                                                                                                                                                                         
              framesEncoded: 80,                                                                                                                                                                                   
              headerBytesSent: 23032,                                                                                                                                                                              
              id: 'RTCOutboundRTPVideoStream_505023861',                                                                                                                                                           
              isRemote: false,                                                                                                                                                                                     
              keyFramesEncoded: 1,                                                                                                                                                                                 
              mediaSourceId: 'RTCVideoSource_1',                                                                                                                                                                   
              mediaType: 'video',                                                                                                                                                                                  
              nackCount: 0,                                                                                                                                                                                        
              packetsSent: 322,                                                                                                                                                                                    
              pliCount: 0,                                                                                                                                                                                         
              qpSum: 5389,                                                                                                                                                                                         
              qualityLimitationReason: 'none',                                                                                                                                                                     
              qualityLimitationResolutionChanges: 1,                                                                                                                                                               
              remoteId: 'RTCRemoteInboundRtpVideoStream_505023861',                                                                                                                                                
              retransmittedBytesSent: 0,                                                                                                                                                                           
              retransmittedPacketsSent: 0,                                                                                                                                                                         
              ssrc: 505023861,                                                                                                                                                                                     
              totalEncodeTime: 0.424,                                                                                                                                                                              
              totalEncodedBytesTarget: 0,                                                                                                                                                                          
              totalPacketSendDelay: 9.825,                                                                                                                                                                         
              trackId: 'RTCMediaStreamTrack_sender_1',                                                                                                                                                             
              transportId: 'RTCTransport_0_1'                                                                                                                                                                      
            },    
            {                                                                                                                                                                                                      
              bytesSent: 76599,                                                                                                                                                                                    
              codecId: 'RTCCodec_1_Outbound_111',                                                                                                                                                                  
              headerBytesSent: 28700,                                                                                                                                                                              
              id: 'RTCOutboundRTPAudioStream_534975921',                                                                                                                                                           
              isRemote: false,
              mediaSourceId: 'RTCAudioSource_2',
              mediaType: 'audio',
              packetsSent: 1025,
              remoteId: 'RTCRemoteInboundRtpAudioStream_534975921',
              retransmittedBytesSent: 0,
              retransmittedPacketsSent: 0,
              ssrc: 534975921,
              trackId: 'RTCMediaStreamTrack_sender_2',
              transportId: 'RTCTransport_0_1'
            }
          */
          const key = `${index}_${peerConnectionId}_${stat.id}`;
          
          if (stat.mediaType === 'audio') {
            // calculate rate
            if (this.stats.timestamps[key]) {
              this.stats.audioSendBitrates[key] = 8000 * 
                (
                  (stat.bytesSent - stat.retransmittedBytesSent) 
                  - (this.stats.audioBytesSent[key] - this.stats.audioRetransmittedBytesSent[key])
                )
                / (now - this.stats.timestamps[key]);
            }
            // update values
            this.stats.timestamps[key] = now;
            this.stats.audioBytesSent[key] = stat.bytesSent;
            this.stats.audioRetransmittedBytesSent[key] = stat.retransmittedBytesSent;
          } else if (stat.mediaType === 'video') {
            // calculate rate
            if (this.stats.timestamps[key]) {
              this.stats.videoSendBitrates[key] = 8000 * 
                (
                  (stat.bytesSent - stat.retransmittedBytesSent) 
                  - (this.stats.videoBytesSent[key] - this.stats.videoRetransmittedBytesSent[key])
                )
                / (now - this.stats.timestamps[key]);
            }
            // update values
            this.stats.timestamps[key] = now;
            this.stats.videoBytesSent[key] = stat.bytesSent;
            this.stats.videoRetransmittedBytesSent[key] = stat.retransmittedBytesSent;
            // https://w3c.github.io/webrtc-stats/#dom-rtcoutboundrtpstreamstats-qualitylimitationresolutionchanges
            this.stats.qualityLimitationResolutionChanges[key] = stat.qualityLimitationResolutionChanges;
          }

        }

      }

      // purge stats with expired timeout
      for (const [key, timestamp] of Object.entries(this.stats.timestamps)) {
        if (now - timestamp > 1000 * config.RTC_STATS_TIMEOUT) {
          log.debug(`expired stat ${key}`);
          //
          delete(this.stats.timestamps[key]);
          delete(this.stats.audioBytesReceived[key]);
          delete(this.stats.audioRecvBitrates[key]);
          delete(this.stats.audioAvgJitterBufferDelay[key]);
          delete(this.stats.videoBytesReceived[key]);
          delete(this.stats.videoRecvBitrates[key]);
          delete(this.stats.videoAvgJitterBufferDelay[key]);
          //
          delete(this.stats.audioBytesSent[key]);
          delete(this.stats.audioSendBitrates[key]);
          delete(this.stats.audioRetransmittedBytesSent[key]);
          delete(this.stats.videoBytesSent[key]);
          delete(this.stats.videoSendBitrates[key]);
          delete(this.stats.videoRetransmittedBytesSent[key]);
          delete(this.stats.qualityLimitationResolutionChanges[key]);
        }
      }

    });

    await page.evaluateOnNewDocument(
       `window.WEBRTC_STRESS_TEST_SESSION = ${this.id + 1};`
      +`window.WEBRTC_STRESS_TEST_TAB_INDEX = ${tabIndex + 1};`
      +`window.WEBRTC_STRESS_TEST_INDEX = ${index + 1};`
      +`window.STATS_INTERVAL = ${config.STATS_INTERVAL};`
    );

    //
    
    if (index < config.GET_USER_MEDIA_OVERRIDES.length) {
      const override = config.GET_USER_MEDIA_OVERRIDES[index];
      log.debug('Using getUserMedia override:', override);
      await page.evaluateOnNewDocument(`
        window.GET_USER_MEDIA_OVERRIDE = JSON.parse('${JSON.stringify(override)}');
      `);
    }

    // load observertc
    if (config.ENABLE_RTC_STATS) {
      await page.evaluateOnNewDocument((await requestretry('https://observertc.github.io/observer-js/dist/v0.6.1/observer.min.js')).body);
      await page.evaluateOnNewDocument(await fs.promises.readFile('./observertc.js', 'utf8'));
    }
   
    //
    page.once('domcontentloaded', async () => {
      log.debug(`${this.id} page domcontentloaded`);
     
      // add external script
      if (config.SCRIPT_PATH) {
        await page.addScriptTag({
          path: config.SCRIPT_PATH,
          type: 'text/javascript'
        });
      }

      // enable perf
      // https://chromedevtools.github.io/devtools-protocol/tot/Cast/
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

    // open the page url
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
    
    if (this.updateStatsTimeout) {
      clearTimeout(this.updateStatsTimeout);
      this.updateStatsTimeout = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch(err) {
        console.error('browser close error:', err);
      }
      this.browser = null;
      this.pages = new Map();
    }

    this.emit('stop');
  }

}

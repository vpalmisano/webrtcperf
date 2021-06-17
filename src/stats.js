const log = require('debug-level')('app:stats');
const fs = require('fs');
const path = require('path');
const pidusage = require('pidusage');
const psTree = require('ps-tree');
const moment = require('moment');
const {sprintf} = require('sprintf-js');
const {Stats} = require('fast-stats');
const chalk = require('chalk');
const promClient = require('prom-client');
//
const {RTC_STATS_NAMES} = require('./rtcstats');
const {config} = require('./config');

/**
 * getProcessChildren
 * @param {int} pid
 * @return {Promise}
 */
function getProcessChildren(pid) {
  return new Promise((resolve, reject) => {
    psTree(pid, (err, children) => {
      if (err) {
        return reject(err);
      }
      resolve(children.map((c) => c.PID));
    });
  });
}

module.exports.getProcessStats = async function(pid = null, children = false) {
  const pidStats = await pidusage(pid || process.pid);
  const stat = {
    cpu: pidStats.cpu,
    memory: pidStats.memory / 1e6,
  };
  if (pid && children) {
    try {
      const childrenPids = await getProcessChildren(pid || process.pid);
      if (childrenPids && childrenPids.length) {
        const pidStats = await pidusage(childrenPids);
        for (const p of childrenPids) {
          stat.cpu += pidStats[p].cpu;
          stat.memory += pidStats[p].memory / 1e6;
        }
      }
    } catch (err) {
      console.error('getProcessStats error:', err);
    }
  }
  return stat;
};

/**
 * StatsWriter
 */
class StatsWriter {
  /**
   * StatsWriter
   * @param {string} fname
   * @param {Array} columns
   */
  constructor(fname = 'stats.log', columns) {
    this.fname = fname;
    this.columns = columns;
    this._header_written = false;
  }

  /**
   * push
   * @param {*} dataColumns
   */
  async push(dataColumns) {
    if (!this._header_written) {
      let data = 'datetime';
      this.columns.forEach((column) => {
        data += `,${column.name}`;
      });
      await fs.promises.mkdir(path.dirname(this.fname), {recursive: true});
      await fs.promises.writeFile(this.fname, `${data}\n`);
      this._header_written = true;
    }
    //
    let data = `${moment().format('YYYY/MM/DD HH:mm:ss')}`;
    this.columns.forEach((column, i) => {
      data += `,${dataColumns[i]}`;
    });
    return await fs.promises.appendFile(this.fname, `${data}\n`);
  }
}

/**
 * formatStatsColumns
 * @param {*} column
 * @return {Array}
 */
function formatStatsColumns(column) {
  return [
    {name: `${column}_length`},
    {name: `${column}_sum`},
    {name: `${column}_mean`},
    {name: `${column}_stdev`},
    {name: `${column}_25p`},
    {name: `${column}_min`},
    {name: `${column}_max`},
  ];
}

/**
 * formatStats
 * @param {*} s
 * @param {*} forWriter
 * @return {Array}
 */
function formatStats(s, forWriter = false) {
  if (forWriter) {
    return [
      (s.length || 0),
      (s.sum || 0).toLocaleString('en-US',
          {minimumFractionDigits: 0, maximumFractionDigits: 3}),
      (s.amean() || 0).toLocaleString('en-US',
          {minimumFractionDigits: 0, maximumFractionDigits: 3}),
      (s.stddev() || 0).toLocaleString('en-US',
          {minimumFractionDigits: 0, maximumFractionDigits: 3}),
      (s.percentile(25) || 0).toLocaleString('en-US',
          {minimumFractionDigits: 0, maximumFractionDigits: 3}),
      (s.min || 0).toLocaleString('en-US',
          {minimumFractionDigits: 0, maximumFractionDigits: 3}),
      (s.max || 0).toLocaleString('en-US',
          {minimumFractionDigits: 0, maximumFractionDigits: 3}),
    ];
  }

  return {
    length: s.length || 0,
    sum: s.sum || 0,
    mean: s.amean() || 0,
    stddev: s.stddev() || 0,
    p25: s.percentile(25) || 0,
    min: s.min || 0,
    max: s.max || 0,
  };
}

/**
 * sprintfStatsTitle
 * @param {*} name
 * @return {String}
 */
function sprintfStatsTitle(name) {
  return sprintf(chalk`-- {bold %(name)s} %(fill)s\n`, {
    name,
    fill: '-'.repeat(100 - name.length - 4),
  });
}

/**
 * sprintfStatsHeader
 * @return {String}
 */
function sprintfStatsHeader() {
  return sprintfStatsTitle((new Date()).toUTCString()) +
        // eslint-disable-next-line
        sprintf(chalk`{bold %(name)\' 30s} {bold %(length)\' 8s} {bold %(sum)\' 8s} {bold %(mean)\' 8s} {bold %(stddev)\' 8s} {bold %(p25)\' 8s} {bold %(min)\' 8s} {bold %(max)\' 8s}\n`, {
          name: 'name',
          length: 'count',
          sum: 'sum',
          mean: 'mean',
          stddev: 'stddev',
          p25: '25p',
          min: 'min',
          max: 'max',
        });
}

/**
 * sprintfStats
 * @param {*} name
 * @param {*} stats
 * @param {*} param2
 * @return {Srting}
 */
function sprintfStats(name, stats, {
  format, unit, scale, hideSum,
} = {
  format: '.2f', unit: '', scale: 1, hideSum: false,
}) {
  if (!stats || !stats.length) {
    return '';
  }
  if (!scale) {
    scale = 1;
  }
  stats = formatStats(stats);
  return sprintf(
      chalk`{red {bold %(name)\' 30s}}` +
            chalk` {bold %(length)\' 8d}` +
            (hideSum ? '         ' : chalk` {bold %(sum)\' 8${format}}`) +
            chalk` {bold %(mean)\' 8${format}}` +
            chalk` {bold %(stddev)\' 8${format}}` +
            chalk` {bold %(p25)\' 8${format}}` +
            chalk` {bold %(min)\' 8${format}}` +
            chalk` {bold %(max)\' 8${format}}%(unit)s\n`, {
        name,
        length: stats.length,
        sum: stats.sum * scale,
        mean: stats.mean * scale,
        stddev: stats.stddev * scale,
        p25: stats.p25 * scale,
        min: stats.min * scale,
        max: stats.max * scale,
        unit: unit ? chalk` {red {bold ${unit}}}` : '',
      });
}

const STATS = [
  'cpu',
  'memory',
  'tabs',
].concat(RTC_STATS_NAMES);

module.exports.Stats = class {
  /**
   * Stats
   * @param {*} sessions
   */
  constructor(sessions) {
    this.sessions = sessions;
    this.statsWriter = null;
    this.statsInterval = null;
    this.gateway = null;
    this.metrics = {};
  }

  /**
   * start
   */
  async start() {
    log.debug('stop');

    if (config.statsPath) {
      const logPath = path.join(config.statsPath,
          `${moment().format('YYYY-MM-DD_HH.mm.ss')}.csv`);
      log.info(`Logging into ${logPath}`);
      const headers = STATS.reduce(
          (v, name) => v.concat(formatStatsColumns(name)), []);
      this.statsWriter = new StatsWriter(logPath, headers);
    }

    if (config.prometheusPushgateway) {
      const register = new promClient.Registry();
      this.gateway = new promClient.Pushgateway(config.prometheusPushgateway, {
        timeout: 5000,
      }, register);

      promClient.collectDefaultMetrics({prefix: 'wst_', register});

      /**
       * It creates a Gauge
       * @param {string} name gauge name
       * @param {string} suffix gauge suffix
       * @return {Gauge} gauge
       */
      function _createGauge(name, suffix) {
        return new promClient.Gauge({
          name: `wst_${name}_${suffix}`,
          help: `webrtc-stress-test ${name} ${suffix}`,
          labelNames: [],
          registers: [register],
        });
      }

      STATS.forEach((name) => {
        this.metrics[name] = {
          length: _createGauge(name, 'length'),
          sum: _createGauge(name, 'sum'),
          mean: _createGauge(name, 'mean'),
          stddev: _createGauge(name, 'stddev'),
          p25: _createGauge(name, 'p25'),
          min: _createGauge(name, 'min'),
          max: _createGauge(name, 'max'),
        };
      });

      await new Promise((resolve) => {
        this.gateway.delete({jobName: config.prometheusPushgatewayJobName},
            (err, resp, body) => {
              if (err) {
                log.error(`Pushgateway delete error: ${err.message}`);
              }
              resolve();
            });
      });
    }

    /**
     * aggregateStats
     * @param {*} obj
     * @param {*} stat
     */
    function aggregateStats(obj, stat) {
      if (typeof obj === 'number') {
        stat.push(obj);
      } else {
        Object.values(obj).forEach((v) => stat.push(v));
      }
    }

    this.statsInterval = setInterval(async () => {
      // log.debug('statsInterval');

      if (!this.sessions || !this.sessions.size) {
        return;
      }

      // collect stats
      const stats = STATS.reduce((obj, name) => {
        obj[name] = new Stats();
        return obj;
      }, {});

      [...this.sessions.values()].forEach((session) => {
        if (!session.stats) {
          return;
        }
        STATS.forEach((name) => aggregateStats(session.stats[name],
            stats[name]));
      });

      // display stats on console
      if (config.showStats) {
        const out = sprintfStatsHeader() +
                    sprintfStats('cpu', stats.cpu, {format: '.2f', unit: '%'}) +
                    sprintfStats('memory', stats.memory,
                        {format: '.2f', unit: 'MB', scale: 1}) +
                    sprintfStats('tabs', stats.tabs, {format: 'd', unit: ''}) +
                    sprintfStatsTitle('Inbound audio') +
                    sprintfStats('received', stats.audioBytesReceived, {
                      format: '.2f', unit: 'MB', scale: 1e-6}) +
                    sprintfStats('rate', stats.audioRecvBitrates, {
                      format: '.2f', unit: 'Kbps', scale: 1e-3}) +
                    sprintfStats('lost', stats.audioPacketsLost, {
                      format: '.2f', unit: '%', hideSum: true}) +
                    sprintfStats('jitter', stats.audioJitter, {
                      format: '.2f', unit: 's', hideSum: true}) +
                    sprintfStats('avgJitterBufferDelay',
                        stats.audioAvgJitterBufferDelay, {
                          format: '.2f', unit: 'ms', scale: 1e3, hideSum: true,
                        }) +
                    sprintfStatsTitle('Inbound video') +
                    sprintfStats('received', stats.videoBytesReceived, {
                      format: '.2f', unit: 'MB', scale: 1e-6}) +
                    sprintfStats('rate', stats.videoRecvBitrates, {
                      format: '.2f', unit: 'Kbps', scale: 1e-3}) +
                    sprintfStats('lost', stats.videoPacketsLost, {
                      format: '.2f', unit: '%', hideSum: true}) +
                    sprintfStats('jitter', stats.videoJitter, {
                      format: '.2f', unit: 's', hideSum: true}) +
                    sprintfStats('avgJitterBufferDelay',
                        stats.videoAvgJitterBufferDelay, {
                          format: '.2f', unit: 'ms', scale: 1e3, hideSum: true,
                        }) +
                    sprintfStats('width', stats.videoFrameWidth, {
                      format: 'd', unit: 'px', hideSum: true}) +
                    sprintfStats('height', stats.videoFrameHeight, {
                      format: 'd', unit: 'px', hideSum: true}) +
                    sprintfStatsTitle('Outbound audio') +
                    sprintfStats('sent', stats.audioBytesSent, {
                      format: '.2f', unit: 'MB', scale: 1e-6}) +
                    sprintfStats('retransmitted',
                        stats.audioRetransmittedBytesSent, {
                          format: '.2f', unit: 'MB', scale: 1e-6}) +
                    sprintfStats('rate', stats.audioSendBitrates, {
                      format: '.2f', unit: 'Kbps', scale: 1e-3}) +
                    sprintfStatsTitle('Outbound video') +
                    sprintfStats('sent', stats.videoBytesSent, {
                      format: '.2f', unit: 'MB', scale: 1e-6}) +
                    sprintfStats('retransmitted',
                        stats.videoRetransmittedBytesSent, {
                          format: '.2f', unit: 'MB', scale: 1e-6}) +
                    sprintfStats('rate', stats.videoSendBitrates, {
                      format: '.2f', unit: 'Kbps', scale: 1e-3}) +
                    sprintfStats('qualityLimitResolutionChanges',
                        stats.qualityLimitationResolutionChanges, {
                          format: 'd', unit: ''}) +
                    sprintfStats('width', stats.videoSourceWidth, {
                      format: 'd', unit: 'px', hideSum: true}) +
                    sprintfStats('height', stats.videoSourceHeight, {
                      format: 'd', unit: 'px', hideSum: true}) +
                    sprintfStats('fps', stats.videoSourceFps, {
                      format: 'd', unit: 'fps', hideSum: true});

        if (!config.enablePageLog) {
          console.clear();
        }
        console.log(out);
      }
      // write stats to file
      if (this.statsWriter) {
        const values = STATS.reduce(
            (v, name) => v.concat(formatStats(stats[name], true)), []);
        await this.statsWriter.push(values);
      }

      // send to pushgateway
      if (this.gateway) {
        Object.entries(this.metrics).forEach(([name, metric]) => {
          const {length, sum, mean, stddev, p25, min, max} =
              formatStats(stats[name]);
          metric.length.set(length);
          metric.sum.set(sum);
          metric.mean.set(mean);
          metric.stddev.set(stddev);
          metric.p25.set(p25);
          metric.min.set(min);
          metric.max.set(max);
        });

        await new Promise((resolve) => {
          this.gateway.push({jobName: config.prometheusPushgatewayJobName},
              (err, resp, body) => {
                if (err) {
                  log.error(`Pushgateway push error: ${err.message}`);
                }
                resolve();
              });
        });
      }
    }, config.statsInterval * 1000);
  }

  /**
   * stop
   */
  async stop() {
    log.debug('stop');
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.sessions = null;
    this.statsWriter = null;

    // delete metrics
    if (this.gateway) {
      await new Promise((resolve) => {
        this.gateway.delete({jobName: config.prometheusPushgatewayJobName},
            (err, resp, body) => {
              if (err) {
                log.error(`Pushgateway delete error: ${err.message}`);
              }
              resolve();
            });
      });

      this.gateway = null;
      this.metrics = {};
    }
  }
};

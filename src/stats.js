const log = require('debug-level')('app:stats');
const fs = require('fs');
const path = require('path');
const pidusage = require('pidusage');
const psTree = require('ps-tree');
const moment = require('moment');
const sprintf = require('sprintf-js').sprintf;
const { Stats } = require('fast-stats');
const chalk = require('chalk');
//
const config = require('../config');

function getProcessChildren(pid) {
    return new Promise((resolve, reject) => {
        psTree(pid, (err, children) => { 
            if (err) {
                return reject(err);
            }
            resolve(children.map(c => c.PID));
        });
    });
}

const getProcessStats = module.exports.getProcessStats = async function (pid = null, children = false) {
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
        } catch(err) {
            console.error('getProcessStats error:', err);
        }
    }
    return stat;
}

class StatsWriter {
    constructor(fname='stats.log', columns){
        this.fname = fname;
        this.columns = columns;
        this._header_written = false;
    }
  
    async push(dataColumns){
        if (!this._header_written) {
            let data = 'datetime';
            this.columns.forEach((column) => {
                data += `,${column.name}`;
            });
            await fs.promises.mkdir(path.dirname(this.fname), { recursive: true });
            await fs.promises.writeFile(this.fname, data+'\n');
            this._header_written = true;
        }
        //
        let data = `${moment().format('YYYY/MM/DD HH:mm:ss')}`;
        this.columns.forEach((column, i) => {
            data += ','+dataColumns[i];
        });
        return await fs.promises.appendFile(this.fname, data+'\n');
    } 
}

function formatStatsColumns(column) {
    return [
        { name: column + '_length' },
        { name: column + '_sum' },
        { name: column + '_mean' },
        { name: column + '_stdev' },
        { name: column + '_25p' },
        { name: column + '_min' },
        { name: column + '_max' }
    ];
}

function formatStats(s, forWriter = false) {
    if (forWriter) {
        return [
            (s.length || 0),
            (s.sum || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3}),
            (s.amean() || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3}),
            (s.stddev() || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3}),
            (s.percentile(25) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3}),
            (s.min || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3}),
            (s.max || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3}),
        ];
    }

    return {
        length: s.length || 0,
        sum:    s.sum || 0,
        mean:   s.amean() || 0,
        stddev: s.stddev() || 0,
        p25:    s.percentile(25) || 0,
        min:    s.min || 0,
        max:    s.max || 0,
    };
}

function sprintfStatsTitle(name) {
    return sprintf(chalk`-- {bold %(name)s} %(fill)s\n`, { 
        name,
        fill: '-'.repeat(100 - name.length - 4)
    });
}

function sprintfStatsHeader() {
    return sprintfStatsTitle((new Date()).toUTCString()) +
        sprintf(chalk`{bold %(name)\' 30s} {bold %(length)\' 8s} {bold %(sum)\' 8s} {bold %(mean)\' 8s} {bold %(stddev)\' 8s} {bold %(p25)\' 8s} {bold %(min)\' 8s} {bold %(max)\' 8s}\n`, {
        name: 'name',
        length: 'count',
        sum: 'sum',
        mean: 'mean',
        stddev: 'stddev',
        p25: '25p',
        min: 'min',
        max: 'max'
    });
}

function sprintfStats(name, stats, { format, unit, scale, hideSum } = { format: '.2f', unit: '', scale: 1, hideSum: false }) {
    if (!stats || !stats.length) {
        return '';
    }
    if (!scale) {
        scale = 1;
    }
    stats = formatStats(stats);
    return sprintf(
            chalk`{red {bold %(name)\' 30s}}`
            + chalk` {bold %(length)\' 8d}`
            + (hideSum ? '         ' : chalk` {bold %(sum)\' 8${format}}`)
            + chalk` {bold %(mean)\' 8${format}}`
            + chalk` {bold %(stddev)\' 8${format}}`
            + chalk` {bold %(p25)\' 8${format}}`
            + chalk` {bold %(min)\' 8${format}}`
            + chalk` {bold %(max)\' 8${format}}%(unit)s\n`, {
        name,
        length: stats.length,
        sum: stats.sum * scale,
        mean: stats.mean * scale,
        stddev: stats.stddev * scale,
        p25: stats.p25 * scale,
        min: stats.min * scale,
        max: stats.max * scale,
        unit: unit ? chalk` {red {bold ${unit}}}` : ''
    });
}

const STATS = [
    'cpu',
    'memory',
    'tabs',
    // inbound
    'audioPacketsLost',
    'audioJitter',
    'audioBytesReceived',
    'audioRecvBitrates',
    'audioAvgJitterBufferDelay',
    'videoPacketsLost',
    'videoJitter',
    'videoBytesReceived',
    'videoRecvBitrates',
    'videoAvgJitterBufferDelay',
    // outbound
    'audioBytesSent',
    'audioRetransmittedBytesSent',
    'audioSendBitrates',
    'videoBytesSent',
    'videoRetransmittedBytesSent',
    'videoSendBitrates',
    'qualityLimitationResolutionChanges',
];

module.exports.Stats = class {
    constructor(sessions) {
        this.sessions = sessions;
        this.statsWriter = null;
        this.statsInterval = null;
    }

    async start() {
        log.debug('stop');

        if (config.STATS_PATH) {
            let logPath = path.join(config.STATS_PATH, `${moment().format('YYYY-MM-DD_HH.mm.ss')}.csv`);
            log.info(`Logging into ${logPath}`);
            const headers = STATS.reduce((v, name) => v.concat(formatStatsColumns(name)), []);
            this.statsWriter = new StatsWriter(logPath, headers);
        }
    
        function aggregateStats(obj, stat) {
            if (typeof obj === 'number') {
                stat.push(obj)
            } else {
                Object.values(obj).forEach(v => stat.push(v));
            }
        }
    
        this.statsInterval = setInterval(async () => {
            // log.debug('statsInterval');

            if (!this.sessions.length) {
                return;
            }
    
            // collect stats
            const stats = STATS.reduce((obj, name) => { 
                obj[name] = new Stats(); 
                return obj; 
            }, {});
            
            this.sessions.forEach(session => {
                if (!session.stats) {
                    return;
                }
                STATS.forEach(name => aggregateStats(session.stats[name], stats[name]));
            });
    
            // display stats on console
            if (config.SHOW_STATS) {
                let out = sprintfStatsHeader()
                    + sprintfStats('cpu', stats.cpu, { format: '.2f', unit: '%' })
                    + sprintfStats('memory', stats.memory, { format: '.2f', unit: 'MB', scale: 1 })
                    + sprintfStats('tabs', stats.tabs, { format: 'd', unit: '' })
                    + sprintfStatsTitle('Inbound audio')
                    + sprintfStats('received', stats.audioBytesReceived, { format: '.2f', unit: 'MB', scale: 1e-6 })
                    + sprintfStats('rate', stats.audioRecvBitrates, { format: '.2f', unit: 'Kbps', scale: 1e-3 })
                    + sprintfStats('lost', stats.audioPacketsLost, { format: '.2f', unit: '%' })
                    + sprintfStats('jitter', stats.audioJitter, { format: '.2f', unit: 's', hideSum: true })
                    + sprintfStats('avgJitterBufferDelay', stats.audioAvgJitterBufferDelay, { format: '.2f', unit: 'ms', scale: 1e3, hideSum: true })
                    + sprintfStatsTitle('Inbound video')
                    + sprintfStats('received', stats.videoBytesReceived, { format: '.2f', unit: 'MB', scale: 1e-6 })
                    + sprintfStats('rate', stats.videoRecvBitrates, { format: '.2f', unit: 'Kbps', scale: 1e-3 })
                    + sprintfStats('lost', stats.videoPacketsLost, { format: '.2f', unit: '%' })
                    + sprintfStats('jitter', stats.videoJitter, { format: '.2f', unit: 's', hideSum: true })
                    + sprintfStats('avgJitterBufferDelay', stats.videoAvgJitterBufferDelay, { format: '.2f', unit: 'ms', scale: 1e3, hideSum: true })
                    + sprintfStatsTitle('Outbound audio')
                    + sprintfStats('sent', stats.audioBytesSent, { format: '.2f', unit: 'MB', scale: 1e-6 })
                    + sprintfStats('retransmitted', stats.audioRetransmittedBytesSent, { format: '.2f', unit: 'MB', scale: 1e-6 })
                    + sprintfStats('rate', stats.audioSendBitrates, { format: '.2f', unit: 'Kbps', scale: 1e-3 })
                    + sprintfStatsTitle('Outbound video')
                    + sprintfStats('sent', stats.videoBytesSent, { format: '.2f', unit: 'MB', scale: 1e-6 })
                    + sprintfStats('retransmitted', stats.videoRetransmittedBytesSent, { format: '.2f', unit: 'MB', scale: 1e-6 })
                    + sprintfStats('rate', stats.videoSendBitrates, { format: '.2f', unit: 'Kbps', scale: 1e-3 })
                    + sprintfStats('qualityLimitResolutionChanges', stats.qualityLimitationResolutionChanges, { format: 'd', unit: '' })
                    ;
                console.log(out);
            }
            // write stats to file
            if (this.statsWriter) {
                const values = STATS.reduce((v, name) => v.concat(formatStats(stats[name], true)), []);
                await this.statsWriter.push(values);
            }
        }, config.STATS_INTERVAL * 1000);
    }

    stop() {
        log.debug('stop');
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
        this.sessions = [];
        this.statsWriter = null;
    }

}
const fs = require('fs');
const path = require('path');
const pidusage = require('pidusage');
const psTree = require('ps-tree');
const moment = require('moment');
const sprintf = require('sprintf-js').sprintf;
const chalk = require('chalk');

const getProcessChildren = module.exports.getProcessChildren = function(pid) {
    return new Promise((resolve, reject) => {
        psTree(pid, (err, children) => { 
            if (err) {
                return reject(err);
            }
            resolve(children.map(c => c.PID));
        });
    });
}

const getProcessStats = module.exports.getProcessStats = async function(pid = null, children = false) {
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

module.exports.StatsWriter = class StatsWriter {
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

const formatStatsColumns = module.exports.formatStatsColumns = function(column) {
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

const formatStats = module.exports.formatStats = function(s, forWriter = false) {
    if (forWriter) {
        return [
            (s.length || 0),
            (s.sum || 0).toFixed(3),
            (s.amean() || 0).toFixed(3),
            (s.stddev() || 0).toFixed(3),
            (s.percentile(25) || 0).toFixed(3),
            (s.min || 0).toFixed(3),
            (s.max || 0).toFixed(3),
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

module.exports.sprintfStatsHeader = function() {
    return '-'.repeat(100) + '\n' +
        sprintf(chalk`{bold %(name)\' 30s} {bold %(length)\' 8s} {bold %(sum)\' 8s} {bold %(mean)\' 8s} {bold %(stddev)\' 8s} {bold %(p25)\' 8s} {bold %(min)\' 8s} {bold %(max)\' 8s}\n`, {
        name: 'name',
        length: 'total',
        sum: 'sum',
        mean: 'mean',
        stddev: 'stddev',
        p25: '25p',
        min: 'min',
        max: 'max'
    });
}

module.exports.sprintfStats = function(name, stats, { format, unit, scale } = { format: '.2f', unit: '', scale: 1 }) {
    if (!stats || !stats.length) {
        return '';
    }
    if (!scale) {
        scale = 1;
    }
    stats = formatStats(stats);
    return sprintf(chalk`{red {bold %(name)\' 30s}} {bold %(length)\' 8d} {bold %(sum)\' 8${format}} {bold %(mean)\' 8${format}} {bold %(stddev)\' 8${format}} {bold %(p25)\' 8${format}} {bold %(min)\' 8${format}} {bold %(max)\' 8${format}}%(unit)s\n`, {
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

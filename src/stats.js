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

const formatStats = module.exports.formatStats = function(s) {
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

module.exports.sprintfStats = function(name, stats, { format, unit, leftPadSize, scale } = { format: '.2f', unit: '', leftPadSize: 0, scale: 1 }) {
  if (!stats || !stats.length) {
      return '';
  }
  if (!scale) {
      scale = 1;
  }
  stats = formatStats(stats);
  return sprintf(chalk`{red {bold %s%s}} [{bold %d}] sum: {bold %${format}} mean: {bold %${format}} stdev: {bold %${format}} 25p: {bold %${format}} min: {bold %${format}} max: {bold %${format}}%s\n`, 
      ' '.repeat(leftPadSize || 0),
      name,
      stats.length,
      stats.sum * scale,
      stats.mean * scale,
      stats.stddev * scale,
      stats.p25 * scale,
      stats.min * scale,
      stats.max * scale,
      unit ? chalk` [{red {bold ${unit}}}]` : ''
  );
}

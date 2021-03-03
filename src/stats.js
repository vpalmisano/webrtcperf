const fs = require('fs');
const pidusage = require('pidusage');
const psTree = require('ps-tree');
const moment = require('moment');

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


module.exports.StatsWriter = class StatsWriter{
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

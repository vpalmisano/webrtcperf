/*jshint node:true */
'use strict';

const log = require('debug-level')('app:master');
const fs = require('fs');
const sprintf = require('sprintf-js').sprintf;
const Stats = require('fast-stats').Stats;
const cluster = require('cluster');
const Exec = require('child_process').exec;
const moment = require('moment');

const { StatsWriter } = require('./stats');
const config = require('../config');

function ExecAsync(cmd) {
    return new Promise((resolve, reject) => {
        Exec(cmd, {}, (error, stdout, stderr) => {
            if (error) {
                console.error('ExecAsync error:', error, stderr);
                return reject(error);
            }
            log.debug('ExecAsync exited:', stdout, stderr);
            resolve(stdout);
        });
    });
}

let logPath;
if (config.LOG_PATH) {
    logPath  = path.join(config.LOG_PATH, `${moment().format('YYYY-MM-DD_HH.mm.ss')}`);
}

module.exports = async function() {
    log.debug('config', config);
    log.info(`Starting ${config.WORKERS} workers with ${config.SESSIONS_PER_WORKER} instances`);

    let workers = new Map();
    let workersStats = {};

    async function startWorkers(){
        if (config.VIDEO_PATH && config.PUBLISH_VIDEO) {
            if (!fs.existsSync('/tmp/video.y4m')) {
                console.log(`Converting ${config.VIDEO_PATH} to y4m...`);
                await ExecAsync(`ffmpeg -y -i "${config.VIDEO_PATH}" -s ${config.VIDEO_WIDTH}:${config.VIDEO_HEIGHT} -r ${config.VIDEO_FRAMERATE} -an /tmp/video.y4m`);
            }
        }
        if (config.VIDEO_PATH && config.PUBLISH_AUDIO) {
            if (!fs.existsSync('/tmp/audio.wav')) {
                console.log(`Converting ${config.VIDEO_PATH} to wav...`);
                await ExecAsync(`ffmpeg -y -i "${config.VIDEO_PATH}" -vn /tmp/audio.wav`);
            }
        }
        // Forks workers
        for (let i=0; i<config.WORKERS; i++) {
            setTimeout(() => {
                const worker = cluster.fork();
                workers.set(worker.id, worker);
                console.log(`Spawned worker-${worker.id} (total: ${workers.size})`);
            }, i * config.RECV_SPAWN_PERIOD);
        }
    }

    cluster.on('message', function(worker, data){
        // log.info(`worker: ${worker.id} id: ${data.id}`, data);
        // updates worker stats
        if(!workersStats[worker.id]){
            workersStats[worker.id] = {};
        }
        workersStats[worker.id][data.id] = data;
    });

    cluster.on('exit', (worker, code, signal) => {
        console.log('worker-%d exited (%s)', worker.id, signal || code);
        workers.delete(worker.id);
        delete(workersStats[worker.id]);
        //
        setTimeout(() => {
            const worker = cluster.fork();
            workers.set(worker.id, worker);
            console.log(`Re-spawned worker-${worker.id}  (total: ${workers.size})`);
        }, 5000 * (1 + Math.random()));
    });

    //
    let statsWriter = null;
    if (logPath) {
        statsWriter = new StatsWriter(`${logPath}.csv`, [
            { name: 'instances' },
            //
            { name: 'cpu_sum' },
            { name: 'cpu_mean' },
            { name: 'cpu_stdev' },
            { name: 'cpu_25p' },
            { name: 'cpu_min' },
            { name: 'cpu_max' },
            //
            { name: 'mem_sum' },
            { name: 'mem_mean' },
            { name: 'mem_stdev' },
            { name: 'mem_25p' },
            { name: 'mem_min' },
            { name: 'mem_max' },
        ]);
    }

    setInterval(async () => {
        //
        if (!Object.keys(workersStats).length) {
            return;
        }
        //
        let cpus = new Stats();
        Object.keys(workersStats).forEach(k => Object.keys(workersStats[k]).forEach(d => cpus.push(workersStats[k][d].cpu)));
        //
        let mems = new Stats();
        Object.keys(workersStats).forEach(k => Object.keys(workersStats[k]).forEach(d => mems.push(workersStats[k][d].memory)));
        //
        let out = '';
        if (config.SHOW_STATS) {
            if (cpus.length) {
                out += sprintf('%-03d       cpu: %-3.2f mean: %-3.2f (stdev: %-3.2f, 25p: %-3.2f, min: %-3.2f, max: %-3.2f) [%%]\n',
                    cpus.length,
                    cpus.sum,
                    cpus.amean(),
                    cpus.stddev(),
                    cpus.percentile(25),
                    cpus.min,
                    cpus.max
                );
            }
            if (mems.length) {
                out += sprintf('          mem: %-3.2f mean: %-3.2f (stdev: %-3.2f, 25p: %-3.2f, min: %-3.2f, max: %-3.2f) [MB]\n',
                    mems.sum,
                    mems.amean(),
                    mems.stddev(),
                    mems.percentile(25),
                    mems.min,
                    mems.max
                );
            }
            console.log(out);
            //
            if (statsWriter && cpus.length) {
                await statsWriter.push([
                    cpus.length,
                    //
                    cpus.sum.toFixed(3),
                    cpus.amean().toFixed(3),
                    cpus.stddev().toFixed(3),
                    cpus.percentile(25).toFixed(3),
                    cpus.min.toFixed(3),
                    cpus.max.toFixed(3),
                    //
                    mems.sum.toFixed(3),
                    mems.amean().toFixed(3),
                    mems.stddev().toFixed(3),
                    mems.percentile(25).toFixed(3),
                    mems.min.toFixed(3),
                    mems.max.toFixed(3),
                ]);
            }
        }
    }, config.LOG_INTERVAL * 1000);

    //
    await startWorkers();
}
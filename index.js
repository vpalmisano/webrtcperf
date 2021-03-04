/*jshint node:true */
'use strict';

const log = require('debug-level')('app');
const fs = require('fs');
const path = require('path');
const sprintf = require('sprintf-js').sprintf;
const Stats = require('fast-stats').Stats;
const Exec = require('child_process').exec;
const moment = require('moment');
//
const Session = require('./src/session');
const { StatsWriter } = require('./src/stats');
const config = require('./config');

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

//
async function main() {
    let sessions = [];

    let statsWriter = null;
    if (config.LOG_PATH) {
        let logPath = path.join(config.LOG_PATH, `${moment().format('YYYY-MM-DD_HH.mm.ss')}.csv`);
        console.log(`Logging into ${logPath}`);
        statsWriter = new StatsWriter(logPath, [
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
        if (!sessions.length) {
            return;
        }
        // collect stats
        const cpus = new Stats();
        const mems = new Stats();
        sessions.forEach(session => {
            if (session.stats) {
                cpus.push(session.stats.cpu);
                mems.push(session.stats.memory);
            }
        });
        // display stats on console
        if (config.SHOW_STATS) {
            let out = '';
            if (cpus.length) {
                out += sprintf('%-03d cpu: %-3.2f mean: %-3.2f (stdev: %-3.2f, 25p: %-3.2f, min: %-3.2f, max: %-3.2f) [%%]\n',
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
                out += sprintf('    mem: %-3.2f mean: %-3.2f (stdev: %-3.2f, 25p: %-3.2f, min: %-3.2f, max: %-3.2f) [MB]\n',
                    mems.sum,
                    mems.amean(),
                    mems.stddev(),
                    mems.percentile(25),
                    mems.min,
                    mems.max
                );
            }
            console.log(out);
        }
        // write stats to file
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
    }, config.LOG_INTERVAL * 1000);

    // prepare fake video and audio
    if (config.VIDEO_PATH) {
        if (!fs.existsSync('/tmp/video.y4m')) {
            console.log(`Converting ${config.VIDEO_PATH} to y4m...`);
            await ExecAsync(`ffmpeg -y -i "${config.VIDEO_PATH}" -s ${config.VIDEO_WIDTH}:${config.VIDEO_HEIGHT} -r ${config.VIDEO_FRAMERATE} -an /tmp/video.y4m`);
        }
        if (!fs.existsSync('/tmp/audio.wav')) {
            console.log(`Converting ${config.VIDEO_PATH} to wav...`);
            await ExecAsync(`ffmpeg -y -i "${config.VIDEO_PATH}" -vn /tmp/audio.wav`);
        }
    }

    // starts the sessions
    for (let i=0; i < config.SESSIONS; i++) {
        setTimeout(async id => {
            let session = new Session({ id });
            await session.start();
            sessions.push(session);
        }, i * config.SPAWN_PERIOD, `${process.pid}-${i}`);
    }

    // catch signals
    [`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`].forEach((eventType) => {
        process.on(eventType, async () => {
            log.info(`Caught event ${eventType}`);
            try {
                await Promise.allSettled(sessions.map(session => session.stop()));
            } catch(err) {}
            sessions = [];
            process.exit(0);
        });
    });
   
}

main().catch(err => {
    console.error(err);
    process.exit(-1);
});

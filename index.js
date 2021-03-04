/*jshint node:true */
'use strict';

const log = require('debug-level')('app');
const fs = require('fs');
const path = require('path');
const sprintf = require('sprintf-js').sprintf;
const Stats = require('fast-stats').Stats;
const Exec = require('child_process').exec;
const moment = require('moment');
const chalk = require('chalk');
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
    if (config.STATS_PATH) {
        let logPath = path.join(config.STATS_PATH, `${moment().format('YYYY-MM-DD_HH.mm.ss')}.csv`);
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
            //
            { name: 'googActualEncBitrates_sum' },
            { name: 'googActualEncBitrates_mean' },
            { name: 'googActualEncBitrates_stdev' },
            { name: 'googActualEncBitrates_25p' },
            { name: 'googActualEncBitrates_min' },
            { name: 'googActualEncBitrates_max' },
            //
            { name: 'bytesReceived_length' },
            { name: 'bytesReceived_sum' },
            { name: 'bytesReceived_mean' },
            { name: 'bytesReceived_stdev' },
            { name: 'bytesReceived_25p' },
            { name: 'bytesReceived_min' },
            { name: 'bytesReceived_max' },
            //
            { name: 'bytesSent_length' },
            { name: 'bytesSent_sum' },
            { name: 'bytesSent_mean' },
            { name: 'bytesSent_stdev' },
            { name: 'bytesSent_25p' },
            { name: 'bytesSent_min' },
            { name: 'bytesSent_max' },
        ]);
    }

    setInterval(async () => {
        if (!sessions.length) {
            return;
        }

        // collect stats
        const cpus = new Stats();
        const mems = new Stats();
        const googActualEncBitrates = new Stats();
        const bytesReceived = new Stats();
        const bytesSent = new Stats();

        sessions.forEach(session => {
            if (session.stats) {
                cpus.push(session.stats.cpu);
                mems.push(session.stats.memory);
                Object.values(session.stats.googActualEncBitrates)
                    .forEach(v => googActualEncBitrates.push(v / 1000));
                Object.values(session.stats.bytesReceived)
                    .forEach(v => bytesReceived.push(v / 1e6));
                Object.values(session.stats.bytesSent)
                    .forEach(v => bytesSent.push(v / 1e6));
                /*
                googActualEncBitrates.push(Object.values(session.stats.googActualEncBitrates).reduce((o, v) => o += v / 1000, 0));
                bytesReceived.push(Object.values(session.stats.bytesReceived).reduce((o, v) => o += v / 1e6, 0));
                bytesSent.push(Object.values(session.stats.bytesSent).reduce((o, v) => o += v / 1e6, 0));
                */
            }
        });

        // display stats on console
        if (config.SHOW_STATS) {
            let out = '';
            if (cpus.length) {
                out += sprintf(chalk`{bold %-03d} cpu: {bold %-3.2f%%} mean: %-3.2f%% (stdev: %-3.2f, 25p: %-3.2f%%, min: %-3.2f%%, max: %-3.2f%%)\n`,
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
                out += sprintf(chalk`    mem: {bold %-3.2f} mean: %-3.2f (stdev: %-3.2f, 25p: %-3.2f, min: %-3.2f, max: %-3.2f) [MB]\n`,
                    mems.sum,
                    mems.amean(),
                    mems.stddev(),
                    mems.percentile(25),
                    mems.min,
                    mems.max
                );
            }
            if (googActualEncBitrates.length) {
                out += sprintf(chalk`{bold %-03d} googActualEncBitrate: {bold %-3.2f} mean: %-3.2f (stdev: %-3.2f, 25p: %-3.2f, min: %-3.2f, max: %-3.2f) [Kbps]\n`,
                    googActualEncBitrates.length,
                    googActualEncBitrates.sum,
                    googActualEncBitrates.amean(),
                    googActualEncBitrates.stddev(),
                    googActualEncBitrates.percentile(25),
                    googActualEncBitrates.min,
                    googActualEncBitrates.max
                );
            }
            if (bytesReceived.length) {
                out += sprintf(chalk`{bold %-03d}        bytesReceived: {bold %-3.2f} mean: %-3.2f (stdev: %-3.2f, 25p: %-3.2f, min: %-3.2f, max: %-3.2f) [MB]\n`,
                    bytesReceived.length,
                    bytesReceived.sum,
                    bytesReceived.amean(),
                    bytesReceived.stddev(),
                    bytesReceived.percentile(25),
                    bytesReceived.min,
                    bytesReceived.max
                );
            }
            if (bytesSent.length) {
                out += sprintf(chalk`{bold %-03d}            bytesSent: {bold %-3.2f} mean: %-3.2f (stdev: %-3.2f, 25p: %-3.2f, min: %-3.2f, max: %-3.2f) [MB]\n`,
                    bytesSent.length,
                    bytesSent.sum,
                    bytesSent.amean(),
                    bytesSent.stddev(),
                    bytesSent.percentile(25),
                    bytesSent.min,
                    bytesSent.max
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
                //
                googActualEncBitrates.sum.toFixed(3),
                googActualEncBitrates.amean().toFixed(3),
                googActualEncBitrates.stddev().toFixed(3),
                googActualEncBitrates.percentile(25).toFixed(3),
                googActualEncBitrates.min.toFixed(3),
                googActualEncBitrates.max.toFixed(3),
                //
                bytesReceived.length,
                bytesReceived.sum.toFixed(3),
                bytesReceived.amean().toFixed(3),
                bytesReceived.stddev().toFixed(3),
                bytesReceived.percentile(25).toFixed(3),
                bytesReceived.min.toFixed(3),
                bytesReceived.max.toFixed(3),
                //
                bytesSent.length,
                bytesSent.sum.toFixed(3),
                bytesSent.amean().toFixed(3),
                bytesSent.stddev().toFixed(3),
                bytesSent.percentile(25).toFixed(3),
                bytesSent.min.toFixed(3),
                bytesSent.max.toFixed(3),
            ]);
        }
    }, config.STATS_INTERVAL * 1000);

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
        }, i * config.SPAWN_PERIOD, i);
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

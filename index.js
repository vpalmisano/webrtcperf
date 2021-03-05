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
const { StatsWriter, formatStatsColumns, formatStats, sprintfStats } = require('./src/stats');
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
            ...formatStatsColumns('cpu'),
            ...formatStatsColumns('mem'),
            ...formatStatsColumns('bytesReceived'),
            ...formatStatsColumns('recvBitrates'),
            ...formatStatsColumns('bytesSent'),
            ...formatStatsColumns('sendBitrate'),
        ]);
    }

    setInterval(async () => {
        if (!sessions.length) {
            return;
        }

        // collect stats
        const cpus = new Stats();
        const mems = new Stats();
        const bytesReceived = new Stats();
        const recvBitrates = new Stats();
        const bytesSent = new Stats();
        const sendBitrates = new Stats();
        const avgAudioJitterBufferDelay = new Stats();
        const avgVideoJitterBufferDelay = new Stats();
        
        sessions.forEach(session => {
            if (!session.stats) {
                return;
            }
            cpus.push(session.stats.cpu);
            mems.push(session.stats.memory);
            Object.values(session.stats.bytesReceived).forEach(v => bytesReceived.push(v));
            Object.values(session.stats.recvBitrates).forEach(v => recvBitrates.push(v));
            Object.values(session.stats.bytesSent).forEach(v => bytesSent.push(v));
            Object.values(session.stats.sendBitrates).forEach(v => sendBitrates.push(v));
            Object.values(session.stats.avgAudioJitterBufferDelay).forEach(v => avgAudioJitterBufferDelay.push(v));
            Object.values(session.stats.avgVideoJitterBufferDelay).forEach(v => avgVideoJitterBufferDelay.push(v));
        });

        // display stats on console
        if (config.SHOW_STATS) {
            let out = ''
                + sprintfStats(`                      cpu`, cpus, { format: '.2f', unit: '%' })
                + sprintfStats(`                   memory`, mems, { format: '.2f', unit: 'MB', scale: 1 })
                + sprintfStats(`            bytesReceived`, bytesReceived, { format: '.2f', unit: 'MB', scale: 1e-6 })
                + sprintfStats(`             recvBitrates`, recvBitrates, { format: '.2f', unit: 'Kbps', scale: 1e-3 })
                + sprintfStats(`                bytesSent`, bytesSent, { format: '.2f', unit: 'MB', scale: 1e-6 })
                + sprintfStats(`             sendBitrates`, sendBitrates, { format: '.2f', unit: 'Kbps', scale: 1e-3 })
                + sprintfStats(`avgAudioJitterBufferDelay`, avgAudioJitterBufferDelay, { format: '.2f', unit: 'ms', scale: 1 })
                + sprintfStats(`avgVideoJitterBufferDelay`, avgVideoJitterBufferDelay, { format: '.2f', unit: 'ms', scale: 1 })
                +              '-------------------------';
            console.log(out);
        }
        // write stats to file
        if (statsWriter && cpus.length) {
            await statsWriter.push([
                ...formatStats(cpus, true),
                ...formatStats(mems, true),
                ...formatStats(bytesReceived, true),
                ...formatStats(recvBitrates, true),
                ...formatStats(bytesSent, true),
                ...formatStats(sendBitrates, true),
                ...formatStats(avgAudioJitterBufferDelay, true),
                ...formatStats(avgVideoJitterBufferDelay, true),
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

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
const { StatsWriter, formatStatsColumns, formatStats, sprintfStats, 
    sprintfStatsHeader, sprintfStatsTitle } = require('./src/stats');
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

    const STATS = [
        'cpu',
        'memory',
        // inbound
        'audioBytesReceived',
        'audioRecvBitrates',
        'audioAvgJitterBufferDelay',
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
    ]

    let statsWriter = null;
    if (config.STATS_PATH) {
        let logPath = path.join(config.STATS_PATH, `${moment().format('YYYY-MM-DD_HH.mm.ss')}.csv`);
        console.log(`Logging into ${logPath}`);
        const headers = STATS.reduce((v, name) => v.concat(formatStatsColumns(name)), []);
        statsWriter = new StatsWriter(logPath, headers);
    }

    function aggregateStats(obj, stat) {
        if (typeof obj === 'number') {
            stat.push(obj)
        } else {
            Object.values(obj).forEach(v => stat.push(v));
        }
    }

    setInterval(async () => {
        if (!sessions.length) {
            return;
        }

        // collect stats
        const stats = STATS.reduce((obj, name) => { 
            obj[name] = new Stats(); 
            return obj; 
        }, {});
        
        sessions.forEach(session => {
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
                + sprintfStatsTitle('Inbound audio')
                + sprintfStats('received', stats.audioBytesReceived, { format: '.2f', unit: 'MB', scale: 1e-6 })
                + sprintfStats('rate', stats.audioRecvBitrates, { format: '.2f', unit: 'Kbps', scale: 1e-3 })
                + sprintfStats('avgJitterBufferDelay', stats.audioAvgJitterBufferDelay, { format: '.2f', unit: 'ms', scale: 1e3 })
                + sprintfStatsTitle('Inbound video')
                + sprintfStats('received', stats.videoBytesReceived, { format: '.2f', unit: 'MB', scale: 1e-6 })
                + sprintfStats('rate', stats.videoRecvBitrates, { format: '.2f', unit: 'Kbps', scale: 1e-3 })
                + sprintfStats('avgJitterBufferDelay', stats.videoAvgJitterBufferDelay, { format: '.2f', unit: 'ms', scale: 1e3 })
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
        if (statsWriter) {
            const values = STATS.reduce((v, name) => v.concat(formatStats(stats[name], true)), []);
            await statsWriter.push(values);
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

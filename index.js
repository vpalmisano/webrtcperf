/*jshint node:true */
'use strict';

const log = require('debug-level')('app');
const path = require('path');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
//
const RtcClient = require('./src/client');
const master = require('./src/master');
const config = require('./config');

if (cluster.isMaster) {
    master()
    .catch(err => {
        console.error('Master error:', err);
        process.exit(-1);
    });
} else {
    // child process
    let workers = [];
    let i = 0;
    while (i < config.SESSIONS_PER_WORKER) {
        setTimeout(async id => {
            let consumer = new RtcClient({ id });
            await consumer.start();
            workers.push(consumer);
        }, i * config.SPAWN_PERIOD, `${process.pid}-${i}`);
        i += 1;
    }

    setInterval(async () => {
        // collects and sends stats
        workers.forEach(async worker => {
            if (worker.getStats) {
                const stats = await worker.getStats();
                stats.id = worker.id;
                // sends to parent process
                process.send(stats);
            }
        });
    }, config.LOG_INTERVAL * 1000);
    
    [`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`].forEach((eventType) => {
        process.on(eventType, async () => {
            log.info(`Caught event ${eventType}`);
            try {
                await Promise.allSettled(workers.map(worker => worker.stop()));
            } catch(err) {}
            workers = [];
            process.exit(0);
        });
    });
}

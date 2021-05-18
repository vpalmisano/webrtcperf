const log = require('debug-level')('app');
const throttle = require('@sitespeed.io/throttle');
//
const Session = require('./src/session');
const {Stats} = require('./src/stats');
const {prepareFakeMedia} = require('./src/media');
const {config, configError} = require('./src/config');

if (configError) {
  console.error(`Config error: ${configError}`);
  process.exit(-1);
}

/**
 * Main function
 */
async function main() {
  const sessions = new Map();

  const stats = new Stats(sessions);
  await stats.start();

  // prepare fake video and audio
  if (config.videoPath) {
    await prepareFakeMedia();
  }

  // throttle configuration
  if (config.throttleConfig) {
    console.log('Using the throttle config:', config.throttleConfig);
    await throttle.start(config.throttleConfig);
  }

  // starts the sessions
  const startSession = async (id) => {
    const session = new Session({id});
    session.once('stop', () => {
      console.warn(`Session ${id} stopped, reloading...`);
      sessions.delete(id);
      setTimeout(startSession, config.spawnPeriod, id);
    });
    await session.start();
    sessions.set(id, session);
  };

  for (let i = 0; i < config.sessions; i++) {
    setTimeout(startSession, i * config.spawnPeriod, i);
  }

  // stop function
  const stop = async () => {
    console.log('Exiting...');

    stats.stop();

    try {
      await Promise.allSettled([...sessions.values()].map((session) => {
        session.removeAllListeners();
        session.stop();
      }));
    } catch (err) {}

    sessions.clear();

    if (config.throttleConfig) {
      try {
        await throttle.stop();
      } catch (err) {}
    }

    process.exit(0);
  };

  // stop after a configured duration
  if (config.runDuration > 0) {
    setTimeout(stop, config.runDuration * 1000);
  }

  // catch signals
  ['exit', 'SIGINT', 'SIGUSR1', 'SIGUSR2', 'uncaughtException', 'SIGTERM']
      .forEach((eventType) => {
        process.on(eventType, () => {
          log.info(`Caught event ${eventType}`);
          stop();
        });
      });
}

main().catch((err) => {
  console.error(err);
  process.exit(-1);
});

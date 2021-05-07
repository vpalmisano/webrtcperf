const log = require('debug-level')('app');
const throttle = require('@sitespeed.io/throttle');
//
const Session = require('./src/session');
const {Stats} = require('./src/stats');
const {prepareFakeMedia} = require('./src/media');
const config = require('./config');

/**
 * Main function
 */
async function main() {
  let sessions = new Map();

  const stats = new Stats(sessions);
  await stats.start();

  // prepare fake video and audio
  if (config.VIDEO_PATH) {
    await prepareFakeMedia({
      path: config.VIDEO_PATH,
      width: config.VIDEO_WIDTH,
      height: config.VIDEO_HEIGHT,
      framerate: config.VIDEO_FRAMERATE,
      seek: config.VIDEO_SEEK,
      duration: config.VIDEO_DURATION,
      cacheRaw: config.VIDEO_CACHE_RAW,
      cachePath: config.VIDEO_CACHE_PATH,
    });
  }

  // throttle configuration
  if (config.THROTTLE_CONFIG) {
    console.log('Using the throttle config:', config.THROTTLE_CONFIG);
    await throttle.start(config.THROTTLE_CONFIG);
  }

  // starts the sessions
  const startSession = async (id) => {
    const session = new Session({id});
    session.once('stop', () => {
      console.warn(`Session ${id} stopped, reloading...`);
      sessions.delete(id);
      setTimeout(startSession, config.SPAWN_PERIOD, id);
    });
    await session.start();
    sessions.set(id, session);
  };

  for (let i = 0; i < config.SESSIONS; i++) {
    setTimeout(startSession, i * config.SPAWN_PERIOD, i);
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

    if (config.THROTTLE_CONFIG) {
      try {
        await throttle.stop();
      } catch (err) {}
    }

    process.exit(0);
  };

  // stop after a configured duration
  if (config.RUN_DURATION > 0) {
    setTimeout(stop, config.RUN_DURATION * 1000);
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

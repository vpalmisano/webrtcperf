const log = require('debug-level')('app:media');
const fs = require('fs');
const {exec} = require('child_process');

/**
 * execAsync
 * @param {*} cmd
 * @return {Promise}
 */
function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, {}, (error, stdout, stderr) => {
      if (error) {
        console.error('ExecAsync error:', error, stderr);
        return reject(error);
      }
      log.debug('ExecAsync exited:', stdout, stderr);
      resolve(stdout);
    });
  });
}

module.exports.prepareFakeMedia = async function({
  path, width, height, framerate, seek, duration, cacheRaw, cachePath, format,
}) {
  log.info('prepareFakeMedia', {
    path, width, height, framerate, seek, duration, cacheRaw, cachePath, format,
  });
  if (!path) {
    throw new Error('empty video path');
  }
  if (!fs.existsSync(path)) {
    throw new Error(`video not found: ${path}`);
  }

  await fs.promises.mkdir(cachePath, {recursive: true});

  const videoPath = `${cachePath}/video.${format}`;
  if (!fs.existsSync(videoPath) || !cacheRaw) {
    console.log(`Converting ${path} to ${videoPath}`);
    await execAsync(
        `ffmpeg -y -i "${path}" -s ${width}:${height} -r ${framerate}` +
        ` -ss ${seek} -t ${duration} -an ${videoPath}`);
  }

  const audioPath = `${cachePath}/audio.wav`;
  if (!fs.existsSync(audioPath) || !cacheRaw) {
    console.log(`Converting ${path} to ${audioPath}`);
    await execAsync(
        `ffmpeg -y -i "${path}" -ss ${seek} -t ${duration} -vn ${audioPath}`);
  }
};

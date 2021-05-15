const log = require('debug-level')('app:media');
const fs = require('fs');
const {exec} = require('child_process');
const {config} = require('./config');

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

module.exports.prepareFakeMedia = async function() {
  const {
    videoPath,
    videoWidth,
    videoHeight,
    videoFramerate,
    videoSeek,
    videoDuration,
    videoCacheRaw,
    videoCachePath,
    videoFormat,
  } = config;
  log.info('prepareFakeMedia', {
    videoPath, videoWidth, videoHeight, videoFramerate, videoSeek,
    videoDuration, videoCacheRaw, videoCachePath, videoFormat,
  });
  if (!videoPath) {
    throw new Error('empty video path');
  }
  if (!fs.existsSync(videoPath)) {
    throw new Error(`video not found: ${videoPath}`);
  }

  await fs.promises.mkdir(videoCachePath, {recursive: true});

  const destVideoPath = `${videoCachePath}/video.${videoFormat}`;
  if (!fs.existsSync(destVideoPath) || !videoCacheRaw) {
    console.log(`Converting ${videoPath} to ${destVideoPath}`);
    await execAsync(
        `ffmpeg -y -i "${videoPath}" -s ${videoWidth}:${videoHeight} ` +
        `-r ${videoFramerate}` +
        ` -ss ${videoSeek} -t ${videoDuration} -an ` +
        `${destVideoPath}`);
  }

  const destAudioPath = `${videoCachePath}/audio.wav`;
  if (!fs.existsSync(destAudioPath) || !videoCacheRaw) {
    console.log(`Converting ${videoPath} to ${destAudioPath}`);
    await execAsync(
        `ffmpeg -y -i "${videoPath}" ` +
        `-ss ${videoSeek} -t ${videoDuration} -vn ` +
        `${destAudioPath}`);
  }
};

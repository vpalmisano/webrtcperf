const log = require('debug-level')('app:media');
const fs = require('fs');
const Exec = require('child_process').exec;

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

module.exports.prepareFakeMedia = async function({ path, width, height, framerate, seek, duration, cacheRaw, cachePath }) {
    log.info('prepareFakeMedia', { path, width, height, framerate, seek, duration, cacheRaw, cachePath });
    if (!path) {
        throw new Error(`empty video path`);
    }
    if (!fs.existsSync(path)) {
        throw new Error(`video not found: ${path}`);
    }

    await fs.promises.mkdir(cachePath, { recursive: true });
    
    const videoPath = `${cachePath}/video.mjpeg`;
    if (!fs.existsSync(videoPath) || !cacheRaw) {
        console.log(`Converting ${path} to ${videoPath}`);
        await ExecAsync(`ffmpeg -y -i "${path}" -s ${width}:${height} -r ${framerate} -ss ${seek} -t ${duration} -an ${videoPath}`);
    }

    const audioPath = `${cachePath}/audio.wav`;
    if (!fs.existsSync(audioPath) || !cacheRaw) {
        console.log(`Converting ${path} to ${audioPath}`);
        await ExecAsync(`ffmpeg -y -i "${path}" -ss ${seek} -t ${duration} -vn ${audioPath}`);
    }
}

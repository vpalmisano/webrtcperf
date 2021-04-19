const log = require('debug-level')('app:media');
const fs = require('fs');
const Exec = require('child_process').exec;
//
const config = require('../config');

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

module.exports.prepareFakeMedia = async function({ path, width, height, framerate, duration }) {
    log.info('prepareFakeMedia', { path, width, height, framerate, duration });
    if (!path) {
        return;
    }
    if (!fs.existsSync('/tmp/video.y4m')) {
        console.log(`Converting ${path} to y4m...`);
        await ExecAsync(`ffmpeg -y -i "${path}" -s ${width}:${height} -r ${framerate} -t ${duration} -an /tmp/video.y4m`);
    }
    if (!fs.existsSync('/tmp/audio.wav')) {
        console.log(`Converting ${path} to wav...`);
        await ExecAsync(`ffmpeg -y -i "${path}" -t ${duration} -vn /tmp/audio.wav`);
    }
}

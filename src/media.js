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

module.exports.prepareFakeMedia = async function() {
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
}

import { existsSync, promises } from 'fs'

import { logger, md5, runShellCommand } from './utils'

const log = logger('app:media')

/**
 * Converts the video file into raw audio and video files.
 * @param {*} config
 * @param {string} config.videoPath the video to convert
 * @param {string} config.videoWidth the output video width
 * @param {string} config.videoHeight the output video height
 * @param {string} config.videoFramerate the output video framerate
 * @param {string} config.videoSeek the seek position in seconds
 * @param {string} config.videoDuration the output video duration in seconds
 * @param {boolean} config.videoCacheRaw if true and the destinations raw files
 *  exist on file system, the conversion step is skipped
 * @param {string} config.videoCachePath the destination directory path; if not
 *  existing, it will be created
 * @param {string} config.videoFormat the raw video format (y4m or mjpeg)
 */
export async function prepareFakeMedia({
  videoPath,
  videoWidth,
  videoHeight,
  videoFramerate,
  videoSeek,
  videoDuration,
  videoCacheRaw,
  videoCachePath,
  videoFormat,
}: {
  videoPath: string
  videoWidth: number
  videoHeight: number
  videoFramerate: number
  videoSeek: number
  videoDuration: number
  videoCacheRaw: boolean
  videoCachePath: string
  videoFormat: string
}): Promise<void> {
  log.debug('prepareFakeMedia', {
    videoPath,
    videoWidth,
    videoHeight,
    videoFramerate,
    videoSeek,
    videoDuration,
    videoCacheRaw,
    videoCachePath,
    videoFormat,
  })
  if (!videoPath) {
    throw new Error('empty video path')
  }
  if (
    !videoPath.startsWith('http') &&
    !videoPath.startsWith('generate:') &&
    !existsSync(videoPath)
  ) {
    throw new Error(`video not found: ${videoPath}`)
  }

  await promises.mkdir(videoCachePath, { recursive: true })
  const name = md5(videoPath)

  const destVideoPathTmp = `${videoCachePath}/${name}_${videoWidth}x${videoHeight}_${videoFramerate}fps.tmp.${videoFormat}`
  const destVideoPath = `${videoCachePath}/${name}_${videoWidth}x${videoHeight}_${videoFramerate}fps.${videoFormat}`
  if (!existsSync(destVideoPath) || !videoCacheRaw) {
    log.info(`Converting ${videoPath} to ${destVideoPath}`)
    try {
      let source = `-i "${videoPath}"`
      if (videoPath === 'generate:null') {
        source = `-f lavfi -i color=size=${videoWidth}x${videoHeight}:rate=${videoFramerate}:color=black`
      } else if (videoPath === 'generate:test') {
        source = `-f lavfi -i testsrc=size=${videoWidth}x${videoHeight}:rate=${videoFramerate} -pix_fmt yuv420p`
      }
      await runShellCommand(
        `ffmpeg -y ${source} -s ${videoWidth}:${videoHeight} ` +
          `-r ${videoFramerate}` +
          ` -ss ${videoSeek} -t ${videoDuration} -an ` +
          `${destVideoPathTmp} && mv ${destVideoPathTmp} ${destVideoPath}`,
      )
    } catch (err) {
      promises.unlink(destVideoPathTmp).catch(e => log.debug(e.message))
      throw err
    }
  }

  const destAudioPathTmp = `${videoCachePath}/${name}.tmp.wav`
  const destAudioPath = `${videoCachePath}/${name}.wav`
  if (!existsSync(destAudioPath) || !videoCacheRaw) {
    log.info(`Converting ${videoPath} to ${destAudioPath}`)
    try {
      let source = `-i "${videoPath}"`
      if (videoPath === 'generate:null') {
        source = `-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000`
      } else if (videoPath === 'generate:test') {
        source = `-f lavfi -i sine=frequency=220:beep_factor=4:sample_rate=48000`
      }
      await runShellCommand(
        `ffmpeg -y ${source} ` +
          `-ss ${videoSeek} -t ${videoDuration} -vn ` +
          `${destAudioPathTmp} && mv ${destAudioPathTmp} ${destAudioPath}`,
      )
    } catch (err) {
      promises.unlink(destAudioPathTmp).catch(e => log.debug(e.message))
      throw err
    }
  }
}

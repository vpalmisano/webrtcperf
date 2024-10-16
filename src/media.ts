import { existsSync, promises } from 'fs'

import { logger, runShellCommand, sha256 } from './utils'

const log = logger('webrtcperf:media')

const DEFAULT_VIDEO_PATH = 'https://github.com/vpalmisano/webrtcperf/releases/download/v2.0.4/video.mp4'

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
}): Promise<{ video: string; audio: string }> {
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
  if (!videoPath.startsWith('http') && !videoPath.startsWith('generate:') && !existsSync(videoPath)) {
    log.warn(`video not found: ${videoPath}, using default test video`)
    videoPath = DEFAULT_VIDEO_PATH
  }

  await promises.mkdir(videoCachePath, { recursive: true })
  const name = sha256(videoPath)

  const destVideoPath = `${videoCachePath}/${name}_${videoWidth}x${videoHeight}_${videoFramerate}fps.${videoFormat}`
  const destAudioPath = `${videoCachePath}/${name}.wav`

  if (!existsSync(destVideoPath) || !existsSync(destAudioPath) || !videoCacheRaw) {
    log.info(`Converting ${videoPath} to ${destVideoPath}, ${destAudioPath}`)
    const destVideoPathTmp = `${videoCachePath}/${name}_${videoWidth}x${videoHeight}_${videoFramerate}fps.tmp.${videoFormat}`
    const destAudioPathTmp = `${videoCachePath}/${name}.tmp.wav`

    try {
      let source = `-i "${videoPath}"`
      const videoMap = `-map 0:v`
      const audioMap = videoPath.startsWith('generate:') ? '-map 1:a' : '-map 0:a'
      if (videoPath === 'generate:null') {
        source = `-f lavfi -i color=size=${videoWidth}x${videoHeight}:rate=${videoFramerate}:color=black -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000`
      } else if (videoPath === 'generate:test') {
        source = `-f lavfi -i testsrc=size=${videoWidth}x${videoHeight}:rate=${videoFramerate} -pix_fmt yuv420p -f lavfi -i sine=frequency=220:beep_factor=4:sample_rate=48000`
      }
      await runShellCommand(
        `ffmpeg -y -threads 0 ${source}` +
          ` -s ${videoWidth}:${videoHeight}` +
          ` -r ${videoFramerate}` +
          ` -ss ${videoSeek} -t ${videoDuration} -shortest -af apad` +
          ` ${videoMap} ${destVideoPathTmp}` +
          ` ${audioMap} -ar 48000 ${destAudioPathTmp}` +
          ` && mv ${destVideoPathTmp} ${destVideoPath}` +
          ` && mv ${destAudioPathTmp} ${destAudioPath}`,
      )
    } catch (err) {
      log.error(`Error converting video: ${(err as Error).stack}`)
      promises.unlink(destVideoPathTmp).catch(e => log.debug(e.message))
      promises.unlink(destAudioPathTmp).catch(e => log.debug(e.message))
      throw err
    }
  }

  return {
    video: destVideoPath,
    audio: destAudioPath,
  }
}

import { existsSync, promises as fs } from 'fs'

import { logger, runShellCommand, sha256 } from './utils'

const log = logger('webrtcperf:media')

const DEFAULT_VIDEO_PATH = 'https://github.com/vpalmisano/webrtcperf/releases/download/v2.0.4/video.mp4'

export type MediaPath = {
  video: string
  audio: string
  mp4: string
  m4a: string
}

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
  useFakeMedia,
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
  useFakeMedia: boolean
}): Promise<MediaPath> {
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
    useFakeMedia,
  })
  if (!videoPath) {
    throw new Error('empty video path')
  }
  if (!videoPath.startsWith('http') && !videoPath.startsWith('generate:') && !existsSync(videoPath)) {
    log.warn(`video not found: ${videoPath}, using default test video`)
    videoPath = DEFAULT_VIDEO_PATH
  }

  await fs.mkdir(videoCachePath, { recursive: true })
  const name = sha256(videoPath)

  const destVideoPath = `${videoCachePath}/${name}_${videoWidth}x${videoHeight}_${videoFramerate}fps.${videoFormat}`
  const destAudioPath = `${videoCachePath}/${name}.wav`
  const destMp4Path = useFakeMedia
    ? ''
    : `${videoCachePath}/${name}_${videoWidth}x${videoHeight}_${videoFramerate}fps.mp4`
  const destM4aPath = useFakeMedia ? '' : `${videoCachePath}/${name}.m4a`

  if (
    !existsSync(destVideoPath) ||
    !existsSync(destAudioPath) ||
    (destMp4Path && !existsSync(destMp4Path)) ||
    (destM4aPath && !existsSync(destM4aPath)) ||
    !videoCacheRaw
  ) {
    log.info(
      `Converting ${videoPath} to ${destVideoPath}, ${destAudioPath}${destMp4Path ? `, ${destMp4Path}` : ''}${destM4aPath ? `, ${destM4aPath}` : ''}`,
    )
    const destVideoPathTmp = `${videoCachePath}/${name}_${videoWidth}x${videoHeight}_${videoFramerate}fps.tmp.${videoFormat}`
    const destAudioPathTmp = `${videoCachePath}/${name}.tmp.wav`
    const destMp4PathTmp = useFakeMedia
      ? ''
      : `${videoCachePath}/${name}_${videoWidth}x${videoHeight}_${videoFramerate}fps.tmp.mp4`
    const destM4aPathTmp = useFakeMedia ? '' : `${videoCachePath}/${name}.tmp.m4a`

    try {
      let source = `-i "${videoPath}"`
      const videoMap = `-map 0:v`
      const audioMap = videoPath.startsWith('generate:') ? '-map 1:a' : '-map 0:a'
      if (videoPath === 'generate:null') {
        source =
          `-f lavfi -i color=size=${videoWidth}x${videoHeight}:rate=${videoFramerate}:color=black` +
          ` -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000`
      } else if (videoPath === 'generate:test') {
        source =
          `-f lavfi -i testsrc=size=${videoWidth}x${videoHeight}:rate=${videoFramerate} -pix_fmt yuv420p` +
          ` -f lavfi -i sine=frequency=220:beep_factor=4:sample_rate=48000`
      }
      await runShellCommand(
        `ffmpeg -loglevel warning -y -threads 0 ${source}` +
          ` -s ${videoWidth}:${videoHeight}` +
          ` -r ${videoFramerate}` +
          ` -ss ${videoSeek} -t ${videoDuration} -shortest -af apad` +
          ` ${videoMap} ${destVideoPathTmp}` +
          ` ${audioMap} -ar 48000 ${destAudioPathTmp}` +
          (destMp4PathTmp
            ? ` ${videoMap} -c:v libx264 -crf 10 -f mp4 -movflags faststart ${destMp4PathTmp}` +
              ` ${audioMap} -c:a aac -b:a 192k ${destM4aPathTmp}`
            : ''),
      )
      await fs.rename(destVideoPathTmp, destVideoPath)
      await fs.rename(destAudioPathTmp, destAudioPath)
      if (destMp4PathTmp) {
        await fs.rename(destMp4PathTmp, destMp4Path)
      }
      if (destM4aPathTmp) {
        await fs.rename(destM4aPathTmp, destM4aPath)
      }
    } catch (err) {
      log.error(`Error converting video: ${(err as Error).stack}`)
      fs.unlink(destVideoPathTmp).catch(e => log.debug(e.message))
      fs.unlink(destAudioPathTmp).catch(e => log.debug(e.message))
      if (destMp4PathTmp) {
        fs.unlink(destMp4PathTmp).catch(e => log.debug(e.message))
      }
      throw err
    }
  }

  return {
    video: destVideoPath,
    audio: destAudioPath,
    mp4: destMp4Path,
    m4a: destM4aPath,
  }
}

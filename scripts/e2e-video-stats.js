/* global log, MeasuredStats, loadScript, isSenderDisplayTrack, Tesseract */

/**
 * Video end-to-end delay stats.
 * @type MeasuredStats
 */
const videoEndToEndDelayStats = (window.videoEndToEndDelayStats =
  new MeasuredStats({ ttl: 15 }))

window.collectVideoEndToEndDelayStats = () => {
  return videoEndToEndDelayStats.mean()
}

/**
 * Replaces the MediaStream video track with a new generated one with
 * timestamp watermark.
 * @param {MediaStream} mediaStream
 * @returns {MediaStream}
 */
window.applyVideoTimestampWatermark = mediaStream => {
  if (
    !('MediaStreamTrackProcessor' in window) ||
    !('MediaStreamTrackGenerator' in window)
  ) {
    log(`unsupported MediaStreamTrackProcessor and MediaStreamTrackGenerator`)
    return mediaStream
  }
  const videoTrack = mediaStream.getVideoTracks()[0]
  if (!videoTrack) {
    return mediaStream
  }
  const VideoFrame = window.VideoFrame
  const { width, height } = videoTrack.getSettings()
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  const fontSize = Math.ceil(canvas.height / 18)
  ctx.font = `${fontSize}px Noto Mono`
  const textHeight = fontSize + 6
  const isDisplay = isSenderDisplayTrack(videoTrack)
  let participantName = window.getParticipantName()
  if (participantName && isDisplay) {
    participantName += '-d'
  }

  const transformer = new window.TransformStream({
    async transform(videoFrame, controller) {
      const text = String(Date.now())
      const timestamp = videoFrame.timestamp

      const bitmap = await createImageBitmap(videoFrame)
      videoFrame.close()
      ctx.drawImage(bitmap, 0, 0, width, height)
      bitmap.close()

      ctx.fillStyle = 'black'
      ctx.fillRect(0, 0, width, textHeight)
      ctx.fillStyle = 'white'
      ctx.fillText(text, 0, fontSize)

      ctx.fillStyle = 'black'
      ctx.fillRect(0, height - textHeight, width, height)
      ctx.fillStyle = 'white'

      if (!participantName) {
        participantName = window.getParticipantName()
        if (participantName && isDisplay) {
          participantName += '-d'
        }
      }
      ctx.fillText(participantName, 0, height - 6)

      const newBitmap = await createImageBitmap(canvas)
      const newFrame = new VideoFrame(newBitmap, { timestamp })
      newBitmap.close()
      controller.enqueue(newFrame)
    },

    flush(controller) {
      controller.terminate()
    },
  })

  const trackProcessor = new window.MediaStreamTrackProcessor({
    track: videoTrack,
  })
  const trackGenerator = new window.MediaStreamTrackGenerator({ kind: 'video' })

  trackProcessor.readable
    .pipeThrough(transformer)
    .pipeTo(trackGenerator.writable)

  const newMediaStream = new MediaStream([
    trackGenerator,
    ...mediaStream.getAudioTracks(),
  ])

  return newMediaStream
}

const TESSERACT_VERSION = '5.1.0'

async function loadTesseract() {
  if (window._tesseractData) {
    return await window._tesseractData
  }
  const load = async () => {
    await loadScript(
      'tesseract',
      `https://unpkg.com/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`,
    )
    log('Creating Tesseract worker')
    try {
      await window.setRequestInterception(false)
      // Tesseract.setLogging(true)
      const scheduler = Tesseract.createScheduler()
      const worker = await Tesseract.createWorker(
        'eng',
        Tesseract.OEM.LSTM_ONLY,
        {
          //workerPath: `${serverAssets}/tesseract-worker.min.js`,
          //langPath: serverAssets,
          //corePath: `${serverAssets}/tesseract-core.wasm.js`,
          logger: m =>
            m.status.startsWith('recognizing') || log(`[tesseract]`, m),
          errorHandler: e => log(`[tesseract] error: ${e.message}`),
        },
      )
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
        tessedit_char_whitelist: '0123456789',
      })
      scheduler.addWorker(worker)
      log('Creating Tesseract worker done')
      window._tesseractData = { scheduler, worker }
      return { scheduler, worker }
    } catch (err) {
      log(`Creating Tesseract worker error: ${err.message}`)
      throw err
    } finally {
      await window.setRequestInterception(true)
    }
  }
  window._tesseractData = load()
  return await window._tesseractData
}

/**
 * recognizeVideoTimestampWatermark
 * @param {MediaStreamTrack} videoTrack
 * @param {number} measureInterval
 */
window.recognizeVideoTimestampWatermark = async (
  videoTrack,
  measureInterval = 5,
) => {
  const { scheduler } = await loadTesseract()
  const canvas = new OffscreenCanvas(1, 1)
  const ctx = canvas.getContext('2d')
  let lastTimestamp = 0

  const trackProcessor = new window.MediaStreamTrackProcessor({
    track: videoTrack,
  })
  const writableStream = new window.WritableStream(
    {
      async write(/** @type VideoFrame */ videoFrame) {
        const { timestamp, codedWidth, codedHeight } = videoFrame

        if (
          timestamp - lastTimestamp > measureInterval * 1000000 &&
          codedWidth &&
          codedHeight
        ) {
          lastTimestamp = timestamp
          const now = Date.now()
          const fontHeight = Math.ceil(codedHeight / 18) + 6
          canvas.width = codedWidth
          canvas.height = fontHeight
          const bitmap = await createImageBitmap(
            videoFrame,
            0,
            0,
            codedWidth,
            fontHeight,
          )
          ctx.drawImage(bitmap, 0, 0, codedWidth, fontHeight)
          bitmap.close()

          scheduler
            .addJob('recognize', canvas)
            .then(({ data }) => {
              const cleanText = data.text.trim()
              if (cleanText && data.confidence > 70) {
                const recognizedTimestamp = parseInt(cleanText)
                const delay = now - recognizedTimestamp
                if (isFinite(delay) && delay > 0 && delay < 30000) {
                  log(
                    `VideoTimestampWatermark text=${cleanText} delay=${delay}ms confidence=${
                      data.confidence
                    } elapsed=${Date.now() - now}ms`,
                  )
                  videoEndToEndDelayStats.push(now, delay / 1000)
                }
              }
            })
            .catch(err => {
              log(`recognizeVideoTimestampWatermark error: ${err.message}`)
            })
        }
        videoFrame.close()
      },
      close() {},
      abort(err) {
        log('WritableStream error:', err)
      },
    },
    new CountQueuingStrategy({ highWaterMark: 15 }),
  )
  trackProcessor.readable.pipeTo(writableStream)
}

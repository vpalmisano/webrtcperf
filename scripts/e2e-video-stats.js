/* global webrtcperf, log, loadScript, isSenderDisplayTrack, Tesseract, VideoFrame, createWorker */

/**
 * Video end-to-end delay stats.
 * @type MeasuredStats
 */
webrtcperf.videoEndToEndDelayStats = new webrtcperf.MeasuredStats({ ttl: 15 })

webrtcperf.videoStartFrameDelayStats = new webrtcperf.MeasuredStats({ ttl: 60 })

webrtcperf.videoStartFrameTime = 0

/**
 * It sets the start frame time used for calculating the startFrameDelay metric.
 * @param {number} value The start frame time in seconds.
 */
window.setVideoStartFrameTime = value => {
  webrtcperf.videoStartFrameTime = value
}

window.collectVideoEndToEndStats = () => {
  return {
    delay: webrtcperf.videoEndToEndDelayStats.mean(),
    startFrameDelay:
      webrtcperf.videoStartFrameDelayStats.size &&
      webrtcperf.videoStartFrameDelayStats.mean() > webrtcperf.videoStartFrameTime
        ? webrtcperf.videoStartFrameDelayStats.mean() - webrtcperf.videoStartFrameTime
        : undefined,
  }
}

const applyVideoTimestampWatermarkFn = () => {
  const log = (...args) => {
    console.log.apply(null, ['[webrtcperf-applyVideoTimestampWatermarkWorker]', ...args])
  }

  onmessage = ({ data }) => {
    const { readable, writable, width, height, participantName, drawGrid } = data
    log(`participantName=${participantName} ${width}x${height}`)

    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    const fontSize = Math.round(canvas.height / 18)
    ctx.font = `${fontSize}px Noto Mono`
    ctx.textAlign = 'center'
    const textHeight = Math.round(fontSize * 1.2)
    const participantNameIndex = parseInt(participantName.split('-')[1]) || 0

    const transformer = new TransformStream({
      async transform(videoFrame, controller) {
        const text = `${participantNameIndex}-${Date.now()}`
        const timestamp = videoFrame.timestamp

        const bitmap = await createImageBitmap(videoFrame)
        videoFrame.close()
        ctx.drawImage(bitmap, 0, 0, width, height)
        bitmap.close()

        ctx.fillStyle = 'black'
        ctx.fillRect(0, 0, width, textHeight)

        if (drawGrid) {
          ctx.beginPath()
          for (let d = 0; d < width / 2; d += 25) {
            ctx.moveTo(0, textHeight + d)
            ctx.lineTo(width, textHeight + d)
            ctx.moveTo(0, height - d)
            ctx.lineTo(width, height - d)
          }
          for (let d = 0; d < height / 2; d += 25) {
            ctx.moveTo(d, 0)
            ctx.lineTo(d, height)
            ctx.moveTo(width - d, 0)
            ctx.lineTo(width - d, height)
          }
          ctx.strokeStyle = 'black'
          ctx.stroke()
        }

        ctx.fillStyle = 'white'
        ctx.fillText(text, width / 2, fontSize)

        const newBitmap = await createImageBitmap(canvas)
        const newFrame = new VideoFrame(newBitmap, { timestamp })
        newBitmap.close()
        controller.enqueue(newFrame)
      },

      flush(controller) {
        controller.terminate()
      },
    })

    readable
      .pipeThrough(transformer)
      .pipeTo(writable)
      .catch(err => {
        log(`applyVideoTimestampWatermark error: ${err.message}`)
      })
  }
}

let applyVideoTimestampWatermarkWorker = null

const getApplyVideoTimestampWatermarkWorker = () => {
  if (!applyVideoTimestampWatermarkWorker) {
    applyVideoTimestampWatermarkWorker = createWorker(applyVideoTimestampWatermarkFn)
  }
  return applyVideoTimestampWatermarkWorker
}

/**
 * Replaces the MediaStream video track with a new generated one with
 * timestamp watermark.
 * @param {MediaStream} mediaStream
 * @returns {MediaStream}
 */
webrtcperf.applyVideoTimestampWatermark = mediaStream => {
  if (!('MediaStreamTrackProcessor' in window) || !('MediaStreamTrackGenerator' in window)) {
    log(`unsupported MediaStreamTrackProcessor and MediaStreamTrackGenerator`)
    return mediaStream
  }
  const videoTrack = mediaStream.getVideoTracks()[0]
  if (!videoTrack) {
    return mediaStream
  }

  const { width, height, frameRate, aspectRatio } = videoTrack.getSettings()
  const isDisplay = isSenderDisplayTrack(videoTrack)

  let participantName = window.getParticipantName()
  if (participantName && isDisplay) {
    participantName += '-d'
  }

  const trackProcessor = new window.MediaStreamTrackProcessor({
    track: videoTrack,
  })
  const trackGenerator = new window.MediaStreamTrackGenerator({
    kind: 'video',
  })
  const nativeGetSettings = trackGenerator.getSettings.bind(trackGenerator)
  trackGenerator.getSettings = () => {
    return {
      ...nativeGetSettings(),
      width,
      height,
      frameRate,
      aspectRatio,
    }
  }

  const { readable } = trackProcessor
  const { writable } = trackGenerator

  getApplyVideoTimestampWatermarkWorker().postMessage(
    {
      readable,
      writable,
      width,
      height,
      participantName,
    },
    [readable, writable],
  )

  const newMediaStream = new MediaStream([trackGenerator, ...mediaStream.getAudioTracks()])
  return newMediaStream
}

const TESSERACT_VERSION = '5.1.1'

async function loadTesseract() {
  if (window._tesseractData) {
    return await window._tesseractData
  }
  const load = async () => {
    await loadScript('tesseract', `https://unpkg.com/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`)
    log('Creating Tesseract worker')
    try {
      await window.setRequestInterception(false)
      // Tesseract.setLogging(true)
      const scheduler = Tesseract.createScheduler()
      const worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
        //workerPath: `${serverAssets}/tesseract-worker.min.js`,
        //langPath: serverAssets,
        //corePath: `${serverAssets}/tesseract-core.wasm.js`,
        logger: m => m.status.startsWith('recognizing') || log(`[tesseract]`, m),
        errorHandler: e => log(`[tesseract] error: ${e.message}`),
      })
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
        tessedit_char_whitelist: '0123456789-',
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
webrtcperf.recognizeVideoTimestampWatermark = async (videoTrack, measureInterval = 5) => {
  log(`recognizeVideoTimestampWatermark ${videoTrack.id} ${videoTrack.label}`, videoTrack.getSettings())
  const { scheduler } = await loadTesseract()
  let lastTimestamp = 0

  const trackProcessor = new window.MediaStreamTrackProcessor({
    track: videoTrack,
  })
  const writableStream = new window.WritableStream(
    {
      async write(/** @type VideoFrame */ videoFrame) {
        const now = Date.now()
        const { timestamp, codedWidth, codedHeight } = videoFrame

        if (timestamp - lastTimestamp > measureInterval * 1000000 && codedWidth && codedHeight) {
          lastTimestamp = timestamp
          const textHeight = Math.round(Math.round(codedHeight / 18) * 1.2)
          const bitmap = await createImageBitmap(videoFrame, 0, 0, codedWidth, textHeight)
          const canvas = new OffscreenCanvas(codedWidth, textHeight)
          const ctx = canvas.getContext('bitmaprenderer')
          ctx.transferFromImageBitmap(bitmap)
          bitmap.close()

          scheduler
            .addJob('recognize', canvas)
            .then(({ data }) => {
              const cleanText = data.text.trim()
              if (cleanText && data.confidence > 50) {
                const recognizedTimestamp = parseInt(cleanText.split('-')[1])
                const delay = now - recognizedTimestamp
                if (isFinite(delay) && delay > 0 && delay < 30000) {
                  const elapsed = Date.now() - now
                  log(
                    `VideoTimestampWatermark text=${cleanText} delay=${delay}ms confidence=${
                      data.confidence
                    } elapsed=${elapsed}ms`,
                  )
                  webrtcperf.videoEndToEndDelayStats.push(now, delay / 1000)
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

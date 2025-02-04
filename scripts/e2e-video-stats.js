/* global webrtcperf, Tesseract */

/**
 * Video end-to-end delay stats.
 * @type MeasuredStats
 */
webrtcperf.videoEndToEndDelayStats = new webrtcperf.MeasuredStats({ ttl: 15 })
webrtcperf.screenEndToEndDelayStats = new webrtcperf.MeasuredStats({ ttl: 15 })

webrtcperf.videoStartFrameDelayStats = new webrtcperf.MeasuredStats({ ttl: 60 })
webrtcperf.videoStartFrameTime = undefined

webrtcperf.screenStartFrameDelayStats = new webrtcperf.MeasuredStats({ ttl: 60 })
webrtcperf.screenStartFrameTime = undefined

/**
 * It sets the start frame time used for calculating the videoStartFrameDelay metric.
 * @param {number} value The start frame time in seconds.
 */
webrtcperf.setVideoStartFrameTime = value => {
  webrtcperf.videoStartFrameTime = value
}

/**
 * It sets the start frame time used for calculating the screenStartFrameDelay metric.
 * @param {number} value The start frame time in seconds.
 */
webrtcperf.setScreenStartFrameTime = value => {
  webrtcperf.screenStartFrameTime = value
}

webrtcperf.collectVideoEndToEndStats = () => {
  return {
    videoDelay: webrtcperf.videoEndToEndDelayStats.mean(),
    videoStartFrameDelay:
      webrtcperf.videoStartFrameDelayStats.size &&
      webrtcperf.videoStartFrameTime !== undefined &&
      webrtcperf.videoStartFrameDelayStats.mean() > webrtcperf.videoStartFrameTime
        ? webrtcperf.videoStartFrameDelayStats.mean() - webrtcperf.videoStartFrameTime
        : undefined,
    screenDelay: webrtcperf.screenEndToEndDelayStats.mean(),
    screenStartFrameDelay:
      webrtcperf.screenStartFrameDelayStats.size &&
      webrtcperf.screenStartFrameTime !== undefined &&
      webrtcperf.screenStartFrameDelayStats.mean() > webrtcperf.screenStartFrameTime
        ? webrtcperf.screenStartFrameDelayStats.mean() - webrtcperf.screenStartFrameTime
        : undefined,
  }
}

const applyVideoTimestampWatermarkFn = () => {
  const debug = (...args) => {
    console.log.apply(null, ['[webrtcperf-applyVideoTimestampWatermarkWorker]', ...args])
  }

  onmessage = ({ data }) => {
    const { readable, writable, width, height, participantName, drawGrid } = data
    debug(`participantName=${participantName} ${width}x${height}`)

    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    const fontSize = Math.round(canvas.height / 18)
    ctx.font = `${fontSize}px Noto Mono`
    ctx.textAlign = 'center'
    const textHeight = Math.round(canvas.height / 15)
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
          for (let d = 0; d < height; d += 25) {
            ctx.moveTo(0, textHeight + d)
            ctx.lineTo(width, textHeight + d)
          }
          for (let d = 0; d < width; d += 25) {
            ctx.moveTo(d, 0)
            ctx.lineTo(d, height)
          }
          ctx.strokeStyle = 'black'
          ctx.stroke()
        }

        ctx.fillStyle = 'white'
        ctx.fillText(text, width / 2, fontSize)

        const newBitmap = await createImageBitmap(canvas)
        // eslint-disable-next-line no-undef
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
        debug(`applyVideoTimestampWatermark error: ${err.message}`)
      })
  }
}

let applyVideoTimestampWatermarkWorker = null

const getApplyVideoTimestampWatermarkWorker = () => {
  if (!applyVideoTimestampWatermarkWorker) {
    applyVideoTimestampWatermarkWorker = webrtcperf.createWorker(applyVideoTimestampWatermarkFn)
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
    webrtcperf.log(`unsupported MediaStreamTrackProcessor and MediaStreamTrackGenerator`)
    return mediaStream
  }
  const track = mediaStream.getVideoTracks()[0]
  if (!track) {
    return mediaStream
  }

  const trackSettings = track.getSettings()
  const trackConstraints = track.getConstraints()

  const { width, height } = trackSettings
  const participantName = webrtcperf.getParticipantName()

  webrtcperf.log(`applyVideoTimestampWatermark ${track.id}`, { track, trackSettings, trackConstraints })

  const trackProcessor = new window.MediaStreamTrackProcessor({ track })
  const trackGenerator = new window.MediaStreamTrackGenerator({ kind: 'video' })
  trackGenerator.getSettings = () => trackSettings
  trackGenerator.getConstraints = () => trackConstraints
  trackGenerator.applyConstraints = async () => {}
  track.addEventListener('ended', () => {
    trackGenerator.close()
    trackProcessor.close()
  })

  const { readable } = trackProcessor
  const { writable } = trackGenerator

  getApplyVideoTimestampWatermarkWorker().postMessage(
    {
      readable,
      writable,
      width,
      height,
      participantName,
      drawGrid: webrtcperf.params.drawWatermarkGrid,
    },
    [readable, writable],
  )

  mediaStream.removeTrack(track)
  mediaStream.addTrack(trackGenerator)
  return mediaStream
}

const TESSERACT_VERSION = '6.0.0'

async function loadTesseract() {
  if (window._tesseractData) {
    return await window._tesseractData
  }
  const load = async () => {
    await webrtcperf.loadScript(
      'tesseract',
      `https://unpkg.com/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`,
    )
    webrtcperf.log('Creating Tesseract worker')
    try {
      await window.setRequestInterception(false)
      // Tesseract.setLogging(true)
      const scheduler = Tesseract.createScheduler()
      const worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
        //workerPath: `${serverAssets}/tesseract-worker.min.js`,
        //langPath: serverAssets,
        //corePath: `${serverAssets}/tesseract-core.wasm.js`,
        logger: m => m.status.startsWith('recognizing') || webrtcperf.log(`[tesseract]`, m),
        errorHandler: e => webrtcperf.log(`[tesseract] error: ${e.message}`),
      })
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
        tessedit_char_whitelist: '0123456789-',
      })
      scheduler.addWorker(worker)
      webrtcperf.log('Creating Tesseract worker done')
      window._tesseractData = { scheduler, worker }
      return { scheduler, worker }
    } catch (err) {
      webrtcperf.log(`Creating Tesseract worker error: ${err.message}`)
      throw err
    } finally {
      await window.setRequestInterception(true)
    }
  }
  window._tesseractData = load()
  return await window._tesseractData
}

webrtcperf.processingVideoTracks = new Set()

/**
 * recognizeVideoTimestampWatermark
 * @param {MediaStreamTrack} track
 * @param {number} measureInterval
 */
webrtcperf.recognizeVideoTimestampWatermark = async (track, measureInterval = 5) => {
  if (track.ended || track.kind !== 'video' || webrtcperf.processingVideoTracks.has(track)) return
  webrtcperf.processingVideoTracks.add(track)
  track.addEventListener('ended', () => webrtcperf.processingVideoTracks.delete(track))
  webrtcperf.log(`recognizeVideoTimestampWatermark ${track.id} ${track.label}`, track.getSettings())
  const { scheduler } = await loadTesseract()
  let lastTimestamp = 0

  const trackProcessor = new window.MediaStreamTrackProcessor({ track })
  const writableStream = new window.WritableStream(
    {
      async write(/** @type VideoFrame */ videoFrame) {
        const now = Date.now()
        const { timestamp, codedWidth, codedHeight } = videoFrame

        if (timestamp - lastTimestamp > measureInterval * 1000000 && codedWidth && codedHeight) {
          lastTimestamp = timestamp
          const textHeight = Math.max(Math.round(codedHeight / 15), 24)
          const bitmap = await createImageBitmap(videoFrame, 0, 0, codedWidth, textHeight)
          const canvas = new OffscreenCanvas(codedWidth, textHeight)
          const ctx = canvas.getContext('bitmaprenderer')
          ctx.transferFromImageBitmap(bitmap)
          bitmap.close()

          scheduler
            .addJob('recognize', canvas)
            .then(async ({ data }) => {
              const cleanText = data.text.trim()
              if (cleanText && data.confidence > 50) {
                const recognizedTimestamp = parseInt(cleanText.split('-')[1])
                const delay = now - recognizedTimestamp
                if (isFinite(delay) && delay > 0 && delay < 30000) {
                  const elapsed = Date.now() - now
                  webrtcperf.log(
                    `VideoTimestampWatermark text=${cleanText} delay=${delay}ms confidence=${
                      data.confidence
                    } elapsed=${elapsed}ms`,
                  )
                  if (await webrtcperf.isReceiverDisplayTrack(track)) {
                    webrtcperf.screenEndToEndDelayStats.push(now, delay / 1000)
                  } else {
                    webrtcperf.videoEndToEndDelayStats.push(now, delay / 1000)
                  }
                }
              }
            })
            .catch(err => {
              webrtcperf.log(`recognizeVideoTimestampWatermark error: ${err.message}`)
            })
        }
        videoFrame.close()
      },
      close() {
        webrtcperf.processingVideoTracks.delete(track)
      },
      abort(err) {
        webrtcperf.log('WritableStream error:', err)
        webrtcperf.processingVideoTracks.delete(track)
      },
    },
    new CountQueuingStrategy({ highWaterMark: 30 }),
  )
  trackProcessor.readable.pipeTo(writableStream).catch(err => {
    webrtcperf.log(`recognizeVideoTimestampWatermark error: ${err.message}`)
  })
}

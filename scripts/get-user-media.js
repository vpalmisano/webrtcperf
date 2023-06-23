/* global log, loadScript, sleep, Tesseract */

const applyOverride = (constraints, override) => {
  if (override) {
    if (override.video !== undefined) {
      if (override.video instanceof Object) {
        if (!(constraints.video instanceof Object)) {
          constraints.video = {}
        }
        Object.assign(constraints.video, override.video)
      } else {
        constraints.video = override.video
      }
    }
    if (override.audio !== undefined) {
      if (override.audio instanceof Object) {
        if (!(constraints.audio instanceof Object)) {
          constraints.audio = {}
        }
        Object.assign(constraints.audio, override.audio)
      } else {
        constraints.audio = override.audio
      }
    }
  }
}

/**
 * overrideGetUserMedia
 * @param {*} constraints
 */
function overrideGetUserMedia(constraints) {
  if (!window.GET_USER_MEDIA_OVERRIDE) {
    return
  }
  applyOverride(constraints, window.GET_USER_MEDIA_OVERRIDE)
  log(`getUserMedia override result: ${JSON.stringify(constraints, null, 2)}`)
}

/**
 * overrideGetDisplayMedia
 * @param {*} constraints
 */
function overrideGetDisplayMedia(constraints) {
  if (!window.GET_DISPLAY_MEDIA_OVERRIDE) {
    return
  }
  applyOverride(constraints, window.GET_DISPLAY_MEDIA_OVERRIDE)
  log(
    `getDisplayMedia override result: ${JSON.stringify(constraints, null, 2)}`,
  )
}

async function applyGetDisplayMediaCrop(mediaStream) {
  if (!window.GET_DISPLAY_MEDIA_CROP) {
    return
  }
  const area = document.querySelector(window.GET_DISPLAY_MEDIA_CROP)
  const videoTrack = mediaStream.getVideoTracks()[0]
  if (area && videoTrack && videoTrack.cropTo) {
    log(`applyGetDisplayMediaCrop to "${window.GET_DISPLAY_MEDIA_CROP}"`)
    const cropTarget = await window.CropTarget.fromElement(area)
    await videoTrack.cropTo(cropTarget)
  }
}

const AudioTracks = new Set()
const VideoTracks = new Set()

/**
 * getActiveAudioTracks
 * @return {*} The active audio tracks array.
 */
window.getActiveAudioTracks = () => {
  for (const track of AudioTracks.values()) {
    if (track.readyState === 'ended') {
      AudioTracks.delete(track)
    }
  }
  return [...AudioTracks.values()]
}

/**
 * getActiveVideoTracks
 * @return {*} The active video tracks array.
 */
window.getActiveVideoTracks = () => {
  for (const track of VideoTracks.values()) {
    if (track.readyState === 'ended') {
      VideoTracks.delete(track)
    }
  }
  return [...VideoTracks.values()]
}

/**
 * It collects MediaTracks from MediaStream.
 * @param {MediaStream} mediaStream
 */
function collectMediaTracks(mediaStream) {
  const audioTracks = mediaStream.getAudioTracks()
  if (audioTracks.length) {
    const track = audioTracks[0]
    /* log(`MediaStream new audio track ${track.id}`); */
    track.addEventListener('ended', () => AudioTracks.delete(track))
    AudioTracks.add(track)
  }
  const videoTracks = mediaStream.getVideoTracks()
  if (videoTracks.length) {
    const track = videoTracks[0]
    /* const settings = track.getSettings() */
    /* log(`MediaStream new video track ${track.id} ${
      settings.width}x${settings.height} ${settings.frameRate}fps`); */
    track.addEventListener('ended', () => VideoTracks.delete(track))
    VideoTracks.add(track)
  }
  /* mediaStream.getTracks().forEach(track => {
    const applyConstraintsNative = track.applyConstraints.bind(track)
    track.applyConstraints = constraints => {
      log(`${track.kind} track applyConstraints`, constraints)
      return applyConstraintsNative(constraints)
    }
  }) */
}

/**
 * Replaces the MediaStream video track with a new generated one with
 * timestamp watermark.
 * @param {MediaStream} mediaStream
 * @returns {MediaStream}
 */
const applyTimestampWatermark = mediaStream => {
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
  ctx.font = `${fontSize}px Sans`
  const textHeight = fontSize + 6

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

async function loadTesseract() {
  if (window._tesseractData) {
    return await window._tesseractData
  }
  const load = async () => {
    await loadScript(
      'tesseract',
      'https://unpkg.com/tesseract.js@3.0.2/dist/tesseract.min.js',
    )
    log('Creating Tesseract worker')
    try {
      await window.setRequestInterception(false)
      // Tesseract.setLogging(true)
      const scheduler = Tesseract.createScheduler()
      const worker = Tesseract.createWorker({
        //workerPath: `${serverAssets}/tesseract-worker.min.js`,
        //langPath: serverAssets,
        //corePath: `${serverAssets}/tesseract-core.wasm.js`,
        logger: m =>
          m.status.startsWith('recognizing') || log(`[tesseract]`, m),
        errorHandler: e => log(`[tesseract] error: ${e.message}`),
      })
      await worker.load()
      await worker.loadLanguage('eng')
      await worker.initialize('eng')
      await worker.setParameters({
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
 * recognizeTimestampWatermark
 * @param {MediaStreamTrack} videoTrack
 * @param {({ timestamp, delay }: { timestamp: number, delay: number }) => void} cb
 * @param {number} measureInterval
 */
window.recognizeTimestampWatermark = async (
  videoTrack,
  cb,
  measureInterval = 10,
) => {
  const { scheduler } = await loadTesseract()

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  // document.body.appendChild(canvas)

  const video = document.createElement('video')
  video.muted = true

  let lastTimestamp = 0
  const onTimeUpdate = async () => {
    const { currentTime, videoWidth, videoHeight } = video
    if (
      currentTime - lastTimestamp < measureInterval ||
      !videoWidth ||
      !videoHeight
    ) {
      return
    }
    lastTimestamp = currentTime
    const now = Date.now()
    const fontSize = Math.ceil(videoHeight / 18) + 6
    canvas.width = videoWidth
    canvas.height = fontSize
    ctx.drawImage(video, 0, 0, videoWidth, fontSize, 0, 0, videoWidth, fontSize)
    const { data } = await scheduler.addJob('recognize', canvas)
    const cleanText = data.text.trim()
    if (cleanText && data.confidence > 90) {
      const timestamp = parseInt(cleanText)
      const delay = now - timestamp
      if (delay > 0 && delay < 30000) {
        cb({ timestamp, delay: delay / 1000 })
      } /* else {
        log(
          `recognizeTimestampWatermark text=${cleanText} delay=${delay}ms confidence=${data.confidence}`,
        )
      } */
    }
  }
  video.addEventListener('timeupdate', onTimeUpdate)
  video.addEventListener('error', e => {
    video.removeEventListener('timeupdate', onTimeUpdate)
    throw e
  })
  video.srcObject = new MediaStream([videoTrack])
  video.play()
}

// Overrides.
if (navigator.getUserMedia) {
  const nativeGetUserMedia = navigator.getUserMedia.bind(navigator)
  navigator.getUserMedia = async function (constraints, ...args) {
    log(`getUserMedia:`, constraints)
    try {
      overrideGetUserMedia(constraints, ...args)
    } catch (err) {
      log(`overrideGetUserMedia error:`, err)
    }
    return nativeGetUserMedia(constraints, ...args)
  }
}

if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices,
  )
  navigator.mediaDevices.getUserMedia = async function (constraints, ...args) {
    log(`getUserMedia:`, constraints)
    try {
      overrideGetUserMedia(constraints)
    } catch (err) {
      log(`overrideGetUserMedia error:`, err)
    }
    if (window.PARAMS?.getUserMediaWaitTime > 0) {
      await sleep(window.PARAMS?.getUserMediaWaitTime)
    }
    const mediaStream = await nativeGetUserMedia(constraints, ...args)
    try {
      collectMediaTracks(mediaStream)
    } catch (err) {
      log(`collectMediaTracks error:`, err)
    }
    return window.PARAMS?.timestampWatermark
      ? applyTimestampWatermark(mediaStream)
      : mediaStream
  }
}

if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
  const nativeGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(
    navigator.mediaDevices,
  )
  navigator.mediaDevices.getDisplayMedia = async function (
    constraints,
    ...args
  ) {
    log(`getDisplayMedia:`, constraints)
    overrideGetDisplayMedia(constraints)
    if (window.PARAMS?.getDisplayMediaWaitTime > 0) {
      await sleep(window.PARAMS?.getDisplayMediaWaitTime)
    }
    const mediaStream = await nativeGetDisplayMedia(constraints, ...args)
    await applyGetDisplayMediaCrop(mediaStream)
    collectMediaTracks(mediaStream)
    return mediaStream
  }
}

if (navigator.mediaDevices && navigator.mediaDevices.setCaptureHandleConfig) {
  const setCaptureHandleConfig =
    navigator.mediaDevices.setCaptureHandleConfig.bind(navigator.mediaDevices)
  navigator.mediaDevices.setCaptureHandleConfig = config => {
    log('setCaptureHandleConfig', config)
    return setCaptureHandleConfig(config)
  }
}

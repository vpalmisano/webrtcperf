/* global webrtcperf, log, sleep, applyAudioTimestampWatermark, applyVideoTimestampWatermark, enabledForSession */

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
function collectMediaTracks(mediaStream, onEnded = null) {
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
    track.addEventListener('ended', () => {
      VideoTracks.delete(track)
      if (onEnded) {
        onEnded(track)
      }
    })
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
    let mediaStream = await nativeGetUserMedia(constraints, ...args)
    if (window.overrideGetUserMediaStream !== undefined) {
      try {
        mediaStream = await window.overrideGetUserMediaStream(mediaStream)
      } catch (err) {
        log(`overrideGetUserMediaStream error:`, err)
      }
    }
    try {
      collectMediaTracks(mediaStream)
    } catch (err) {
      log(`collectMediaTracks error:`, err)
    }

    if (enabledForSession(window.PARAMS?.timestampWatermarkAudio)) {
      mediaStream = applyAudioTimestampWatermark(mediaStream)
    }

    if (enabledForSession(window.PARAMS?.timestampWatermarkVideo)) {
      mediaStream = applyVideoTimestampWatermark(mediaStream)
    }

    return mediaStream
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
    let stopFakeScreenshare = null
    if (window.PARAMS?.fakeScreenshare) {
      stopFakeScreenshare = await webrtcperf.setupFakeScreenshare(
        window.PARAMS?.fakeScreenshare,
      )
    }
    overrideGetDisplayMedia(constraints)
    if (window.PARAMS?.getDisplayMediaWaitTime > 0) {
      await sleep(window.PARAMS?.getDisplayMediaWaitTime)
    }
    const mediaStream = await nativeGetDisplayMedia(constraints, ...args)
    await applyGetDisplayMediaCrop(mediaStream)
    collectMediaTracks(mediaStream, () => {
      stopFakeScreenshare && stopFakeScreenshare()
    })
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

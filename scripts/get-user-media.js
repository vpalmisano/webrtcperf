/* global webrtcperf, log, sleep */

async function applyGetDisplayMediaCrop(mediaStream) {
  if (!webrtcperf.GET_DISPLAY_MEDIA_CROP) return
  const element = document.querySelector(webrtcperf.GET_DISPLAY_MEDIA_CROP)
  const videoTrack = mediaStream.getVideoTracks()[0]
  if (element && videoTrack) {
    if ('RestrictionTarget' in window && 'fromElement' in window.RestrictionTarget) {
      log(`applyGetDisplayMediaCrop with RestrictionTarget to "${webrtcperf.GET_DISPLAY_MEDIA_CROP}"`)
      const restrictionTarget = await window.RestrictionTarget.fromElement(element)
      await videoTrack.restrictTo(restrictionTarget)
    } else {
      log(`applyGetDisplayMediaCrop to "${webrtcperf.GET_DISPLAY_MEDIA_CROP}"`)
      element.style.zIndex = 99999
      const cropTarget = await window.CropTarget.fromElement(element)
      await videoTrack.cropTo(cropTarget)
    }
  }
}

webrtcperf.audioTracks = new Set()
webrtcperf.videoTracks = new Set()

/**
 * getActiveAudioTracks
 * @return {*} The active audio tracks array.
 */
window.getActiveAudioTracks = () => {
  for (const track of webrtcperf.audioTracks.values()) {
    if (track.readyState === 'ended') {
      webrtcperf.audioTracks.delete(track)
    }
  }
  return [...webrtcperf.audioTracks.values()]
}

/**
 * getActiveVideoTracks
 * @return {*} The active video tracks array.
 */
window.getActiveVideoTracks = () => {
  for (const track of webrtcperf.videoTracks.values()) {
    if (track.readyState === 'ended') {
      webrtcperf.videoTracks.delete(track)
    }
  }
  return [...webrtcperf.videoTracks.values()]
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
    track.addEventListener('ended', () => webrtcperf.audioTracks.delete(track))
    webrtcperf.audioTracks.add(track)
  }
  const videoTracks = mediaStream.getVideoTracks()
  if (videoTracks.length) {
    const track = videoTracks[0]
    /* const settings = track.getSettings() */
    /* log(`MediaStream new video track ${track.id} ${
      settings.width}x${settings.height} ${settings.frameRate}fps`); */
    const nativeApplyConstraints = track.applyConstraints.bind(track)
    track.applyConstraints = constraints => {
      log(`applyConstraints ${track.id} (${track.kind})`, { track, constraints })
      if (window.overrideTrackApplyConstraints) {
        constraints = window.overrideTrackApplyConstraints(track, constraints)
        log(`applyConstraints ${track.id} (${track.kind}) override:`, { track, constraints })
      }
      return nativeApplyConstraints(constraints)
    }
    track.addEventListener('ended', () => {
      webrtcperf.videoTracks.delete(track)
      if (onEnded) {
        onEnded(track)
      }
    })
    webrtcperf.videoTracks.add(track)
  }
  // Log applyConstraints calls.
  mediaStream.getTracks().forEach(track => {
    const applyConstraintsNative = track.applyConstraints.bind(track)
    track.applyConstraints = constraints => {
      log(`applyConstraints ${track.id} (${track.kind})`, { track, constraints })
      if (window.overrideTrackApplyConstraints) {
        constraints = window.overrideTrackApplyConstraints(track, constraints)
      }
      return applyConstraintsNative(constraints)
    }
  })
}

// Overrides.
if (navigator.getUserMedia) {
  const nativeGetUserMedia = navigator.getUserMedia.bind(navigator)
  navigator.getUserMedia = async function (constraints, ...args) {
    log(`getUserMedia:`, constraints)
    if (webrtcperf.overrideGetUserMedia) {
      constraints = webrtcperf.overrideGetUserMedia(constraints)
      log(`getUserMedia override:`, JSON.stringify(constraints))
    }
    return nativeGetUserMedia(constraints, ...args)
  }
}

if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = async function (constraints, ...args) {
    log(`getUserMedia:`, JSON.stringify(constraints))
    if (webrtcperf.overrideGetUserMedia) {
      constraints = webrtcperf.overrideGetUserMedia(constraints)
      log(`getUserMedia override:`, JSON.stringify(constraints))
    }
    if (webrtcperf.params.getUserMediaWaitTime > 0) {
      await sleep(webrtcperf.params.getUserMediaWaitTime)
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

    if (webrtcperf.enabledForSession(webrtcperf.params.timestampWatermarkAudio)) {
      mediaStream = webrtcperf.applyAudioTimestampWatermark(mediaStream)
    }

    if (webrtcperf.enabledForSession(webrtcperf.params.timestampWatermarkVideo)) {
      mediaStream = webrtcperf.applyVideoTimestampWatermark(mediaStream)
    }

    return mediaStream
  }
}

if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
  const nativeGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getDisplayMedia = async function (constraints, ...args) {
    log(`getDisplayMedia:`, JSON.stringify(constraints))
    let stopFakeScreenshare = null
    if (webrtcperf.GET_DISPLAY_MEDIA_TYPE === 'browser') {
      stopFakeScreenshare = await webrtcperf.setupFakeScreenshare(webrtcperf.params.fakeScreenshare)
    }
    if (webrtcperf.overrideGetDisplayMedia) {
      constraints = webrtcperf.overrideGetDisplayMedia(constraints)
      log(`getDisplayMedia override:`, JSON.stringify(constraints))
    }
    if (webrtcperf.params.getDisplayMediaWaitTime > 0) {
      await sleep(webrtcperf.params.getDisplayMediaWaitTime)
    }
    let mediaStream = await nativeGetDisplayMedia(constraints, ...args)
    await applyGetDisplayMediaCrop(mediaStream)
    if (window.overrideGetDisplayMediaStream !== undefined) {
      try {
        mediaStream = await window.overrideGetDisplayMediaStream(mediaStream)
      } catch (err) {
        log(`overrideGetDisplayMediaStream error:`, err)
      }
    }
    collectMediaTracks(mediaStream, () => {
      if (stopFakeScreenshare) stopFakeScreenshare()
    })
    return mediaStream
  }
}

if (navigator.mediaDevices && navigator.mediaDevices.setCaptureHandleConfig) {
  const setCaptureHandleConfig = navigator.mediaDevices.setCaptureHandleConfig.bind(navigator.mediaDevices)
  navigator.mediaDevices.setCaptureHandleConfig = config => {
    log('setCaptureHandleConfig', config)
    return setCaptureHandleConfig(config)
  }
}

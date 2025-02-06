/* global webrtcperf, webrtcperf_startFakeScreenshare */

async function applyGetDisplayMediaCrop(mediaStream) {
  if (!webrtcperf.GET_DISPLAY_MEDIA_CROP) return
  const element = document.querySelector(webrtcperf.GET_DISPLAY_MEDIA_CROP)
  const videoTrack = mediaStream.getVideoTracks()[0]
  if (element && videoTrack) {
    if ('RestrictionTarget' in window && 'fromElement' in window.RestrictionTarget) {
      webrtcperf.log(`applyGetDisplayMediaCrop with RestrictionTarget to "${webrtcperf.GET_DISPLAY_MEDIA_CROP}"`)
      const restrictionTarget = await window.RestrictionTarget.fromElement(element)
      await videoTrack.restrictTo(restrictionTarget)
    } else {
      webrtcperf.log(`applyGetDisplayMediaCrop to "${webrtcperf.GET_DISPLAY_MEDIA_CROP}"`)
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
  webrtcperf.cleanupClosedMediaTracks()
  return [...webrtcperf.audioTracks.values()]
}

/**
 * getActiveVideoTracks
 * @return {*} The active video tracks array.
 */
window.getActiveVideoTracks = () => {
  webrtcperf.cleanupClosedMediaTracks()
  return [...webrtcperf.videoTracks.values()]
}

webrtcperf.cleanupClosedMediaTracks = () => {
  for (const track of webrtcperf.audioTracks.values()) {
    if (track.readyState === 'ended') {
      webrtcperf.audioTracks.delete(track)
    }
  }
  for (const track of webrtcperf.videoTracks.values()) {
    if (track.readyState === 'ended') {
      webrtcperf.videoTracks.delete(track)
    }
  }
}

/**
 * It collects MediaTracks from MediaStream.
 * @param {MediaStream} mediaStream
 */
webrtcperf.collectMediaTracks = (mediaStream, onEnded = null) => {
  const audioTracks = mediaStream.getAudioTracks()
  if (audioTracks.length) {
    const track = audioTracks[0]
    /* webrtcperf.log(`MediaStream new audio track ${track.id}`); */
    track.addEventListener('ended', () => webrtcperf.audioTracks.delete(track))
    webrtcperf.audioTracks.add(track)
  }
  const videoTracks = mediaStream.getVideoTracks()
  if (videoTracks.length) {
    const track = videoTracks[0]
    /* const settings = track.getSettings() */
    /* webrtcperf.log(`MediaStream new video track ${track.id} ${
      settings.width}x${settings.height} ${settings.frameRate}fps`); */
    const nativeApplyConstraints = track.applyConstraints.bind(track)
    track.applyConstraints = constraints => {
      webrtcperf.log(`applyConstraints ${track.id} (${track.kind})`, { track, constraints })
      if (webrtcperf.overrideTrackApplyConstraints) {
        constraints = webrtcperf.overrideTrackApplyConstraints(track, constraints)
        webrtcperf.log(`applyConstraints ${track.id} (${track.kind}) override:`, { track, constraints })
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
  webrtcperf.cleanupClosedMediaTracks()
  // Log applyConstraints calls.
  mediaStream.getTracks().forEach(track => {
    const applyConstraintsNative = track.applyConstraints.bind(track)
    track.applyConstraints = constraints => {
      webrtcperf.log(`applyConstraints ${track.id} (${track.kind})`, { track, constraints })
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
    webrtcperf.log(`getUserMedia:`, constraints)
    if (webrtcperf.overrideGetUserMedia) {
      constraints = webrtcperf.overrideGetUserMedia(constraints)
      webrtcperf.log(`getUserMedia override:`, JSON.stringify(constraints))
    }
    return nativeGetUserMedia(constraints, ...args)
  }
}

webrtcperf.getFakeTrack = async kind => {
  if (!webrtcperf.fakeStream) {
    webrtcperf.log(`[getFakeTrack] Creating fake media stream`)
    webrtcperf.fakeStream = new Promise((resolve, reject) => {
      const video = (webrtcperf.fakeVideo = document.createElement('video'))
      video.src = webrtcperf.VIDEO_URL
      video.loop = true
      video.crossOrigin = 'anonymous'
      video.autoplay = true
      video.play()
      video.addEventListener(
        'canplay',
        () => {
          webrtcperf.fakeVideo._refcount = 0
          resolve(video.captureStream())
        },
        { once: true },
      )
      video.addEventListener(
        'error',
        err => {
          webrtcperf.log(`[getFakeTrack] Create fake media stream error:`, err)
          reject(err)
        },
        { once: true },
      )
    })
  }
  const stream = await webrtcperf.fakeStream
  const track = stream.getTracks().find(track => track.kind === kind)
  if (!track) {
    throw new Error(`[getFakeTrack] track ${kind} not found`)
  }
  webrtcperf.fakeVideo._refcount++
  if (webrtcperf.fakeVideo.paused) {
    await webrtcperf.fakeVideo.play()
  }
  const clonedTrack = track.clone()
  webrtcperf.log(`[getFakeTrack] new ${kind} track ${clonedTrack.id} count: ${webrtcperf.fakeVideo._refcount}`)
  const clonedTrackStop = clonedTrack.stop.bind(clonedTrack)
  clonedTrack.stop = () => {
    clonedTrackStop()
    webrtcperf.fakeVideo._refcount--
    webrtcperf.log(`[getFakeTrack] stop ${kind} track ${clonedTrack.id} count: ${webrtcperf.fakeVideo._refcount}`)
    if (webrtcperf.fakeVideo._refcount === 0) {
      webrtcperf.fakeVideo.pause()
    }
  }
  return clonedTrack
}

if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = async function (constraints, ...args) {
    webrtcperf.log(`getUserMedia:`, JSON.stringify(constraints))
    if (webrtcperf.overrideGetUserMedia) {
      constraints = webrtcperf.overrideGetUserMedia(constraints)
      webrtcperf.log(`getUserMedia override:`, JSON.stringify(constraints))
    }
    if (webrtcperf.params.getUserMediaWaitTime > 0) {
      await webrtcperf.sleep(webrtcperf.params.getUserMediaWaitTime)
    }

    let mediaStream = new MediaStream()
    if (webrtcperf.VIDEO_URL) {
      if (constraints.audio) {
        const audioTrack = await webrtcperf.getFakeTrack('audio')
        mediaStream.addTrack(audioTrack)
      }
      if (constraints.video) {
        const videoTrack = await webrtcperf.getFakeTrack('video')
        mediaStream.addTrack(videoTrack)
      }
    } else {
      mediaStream = await nativeGetUserMedia(constraints, ...args)
    }

    if (window.overrideGetUserMediaStream !== undefined) {
      try {
        mediaStream = await window.overrideGetUserMediaStream(mediaStream)
      } catch (err) {
        webrtcperf.log(`overrideGetUserMediaStream error:`, err)
      }
    }

    if (webrtcperf.enabledForSession(webrtcperf.params.timestampWatermarkAudio)) {
      mediaStream = webrtcperf.applyAudioTimestampWatermark(mediaStream)
    }
    if (webrtcperf.enabledForSession(webrtcperf.params.timestampWatermarkVideo)) {
      mediaStream = webrtcperf.applyVideoTimestampWatermark(mediaStream)
    }

    webrtcperf.collectMediaTracks(mediaStream)
    return mediaStream
  }
}

if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
  const nativeGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getDisplayMedia = async function (constraints, ...args) {
    webrtcperf.log(`getDisplayMedia:`, JSON.stringify(constraints))

    await webrtcperf_startFakeScreenshare()

    if (webrtcperf.overrideGetDisplayMedia) {
      constraints = webrtcperf.overrideGetDisplayMedia(constraints)
      webrtcperf.log(`getDisplayMedia override:`, JSON.stringify(constraints))
    }
    if (webrtcperf.params.getDisplayMediaWaitTime > 0) {
      await webrtcperf.sleep(webrtcperf.params.getDisplayMediaWaitTime)
    }
    let mediaStream = await nativeGetDisplayMedia(constraints, ...args)
    await applyGetDisplayMediaCrop(mediaStream)
    if (window.overrideGetDisplayMediaStream !== undefined) {
      try {
        mediaStream = await window.overrideGetDisplayMediaStream(mediaStream)
      } catch (err) {
        webrtcperf.log(`overrideGetDisplayMediaStream error:`, err)
      }
    }

    if (webrtcperf.enabledForSession(webrtcperf.params.timestampWatermarkAudio)) {
      mediaStream = webrtcperf.applyAudioTimestampWatermark(mediaStream)
    }

    webrtcperf.collectMediaTracks(mediaStream)
    return mediaStream
  }
}

if (navigator.mediaDevices && navigator.mediaDevices.setCaptureHandleConfig) {
  const setCaptureHandleConfig = navigator.mediaDevices.setCaptureHandleConfig.bind(navigator.mediaDevices)
  navigator.mediaDevices.setCaptureHandleConfig = config => {
    webrtcperf.log('setCaptureHandleConfig', config)
    return setCaptureHandleConfig(config)
  }
}

if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
  const NativeEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices)
  navigator.mediaDevices.enumerateDevices = async () => {
    if (webrtcperf.VIDEO_URL) {
      return [
        {
          deviceId: 'webrtcperf-audio',
          kind: 'audioinput',
          label: 'WebRTCPerf Audio',
          groupId: 'webrtcperf',
        },
        {
          deviceId: 'webrtcperf-video',
          kind: 'videoinput',
          label: 'WebRTCPerf Video',
          groupId: 'webrtcperf',
        },
      ]
    }
    const devices = await NativeEnumerateDevices()
    // webrtcperf.log('enumerateDevices', devices)
    return devices
  }
}

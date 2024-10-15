/* global webrtcperf, log, PeerConnections, handleTransceiverForInsertableStreams, handleTransceiverForPlayoutDelayHint, handleTransceiverForJitterBufferTarget, recognizeAudioTimestampWatermark, saveMediaTrack, stopSaveMediaTrack */

const timestampInsertableStreams = !!window.PARAMS?.timestampInsertableStreams

const NativeRTCPeerConnection = window.RTCPeerConnection

webrtcperf.peerConnectionNextId = 0
webrtcperf.peerConnectionsConnected = 0
webrtcperf.peerConnectionsDisconnected = 0
webrtcperf.peerConnectionsFailed = 0
webrtcperf.peerConnectionsClosed = 0

webrtcperf.Timer = class {
  constructor() {
    this.duration = 0
    this.lastTime = 0
    this.timer = null
  }

  start() {
    if (this.timer) return
    this.lastTime = Date.now()
    this.timer = setInterval(() => {
      const now = Date.now()
      this.duration += (now - this.lastTime) / 1000
      this.lastTime = now
    }, 1000)
  }

  stop() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    if (this.lastTime) {
      this.duration += (Date.now() - this.lastTime) / 1000
      this.lastTime = 0
    }
  }
}
webrtcperf.OnOffTimer = class {
  constructor() {
    this.onTimer = new webrtcperf.Timer()
    this.offTimer = new webrtcperf.Timer()
    this.ids = new Set()
  }

  get onDuration() {
    return this.onTimer.duration
  }

  get offDuration() {
    return this.offTimer.duration
  }

  add(id) {
    if (this.ids.has(id)) return
    this.ids.add(id)
    this.offTimer.stop()
    this.onTimer.start()
  }

  remove(id) {
    if (!this.ids.has(id)) return
    this.ids.delete(id)
    if (this.ids.size > 0) return
    this.onTimer.stop()
    this.offTimer.start()
  }
}

webrtcperf.connectionTimer = new webrtcperf.OnOffTimer()

webrtcperf.waitTrackMedia = async (/** @type MediaStreamTrack */ track, startTime = Date.now()) => {
  const { id, kind } = track
  const debug = (...args) => {
    if (webrtcperf.enabledForSession(window.PARAMS?.peerConnectionDebug)) {
      log(`waitTrackMedia ${id} (${kind})`, ...args)
    }
  }
  debug('start')
  return new Promise((resolve, reject) => {
    const { readable } = new window.MediaStreamTrackProcessor({ track, maxBufferSize: 1 })
    const controller = new AbortController()
    const writeable = new WritableStream(
      {
        async write(frame) {
          const { codedWidth, codedHeight, numberOfFrames } = frame
          frame.close()
          if ((kind === 'audio' && numberOfFrames) || (kind === 'video' && codedWidth && codedHeight)) {
            const now = Date.now()
            const elapsedTime = now - startTime
            debug(`done, elapsedTime: ${elapsedTime}ms`, { codedWidth, codedHeight, numberOfFrames })
            controller.abort('done')
            resolve({ now, elapsedTime })
          }
        },
        abort(reason) {
          if (reason === 'done') return
          log(`waitTrackMedia ${id} ${kind} error:`, reason)
          reject(reason)
        },
      },
      new CountQueuingStrategy({ highWaterMark: 1 }),
    )
    readable.pipeTo(writeable, { signal: controller.signal }).catch(reject)
  })
}

window.RTCPeerConnection = function (conf, options) {
  const id = webrtcperf.peerConnectionNextId++

  const debug = (...args) => {
    if (webrtcperf.enabledForSession(window.PARAMS?.peerConnectionDebug)) {
      log(`RTCPeerConnection-${id}`, ...args)
    }
  }

  const encodedInsertableStreams =
    conf?.encodedInsertableStreams || (timestampInsertableStreams && conf?.sdpSemantics === 'unified-plan')

  const pc = new NativeRTCPeerConnection(
    {
      ...(conf || {}),
      encodedInsertableStreams,
    },
    options,
  )

  PeerConnections.set(id, pc)

  const closed = () => {
    if (PeerConnections.has(id)) {
      PeerConnections.delete(id)
      webrtcperf.peerConnectionsClosed++
      webrtcperf.connectionTimer.remove(id)
    }
  }

  pc.addEventListener('connectionstatechange', () => {
    debug(`connectionState: ${pc.connectionState}`)
    switch (pc.connectionState) {
      case 'connected': {
        webrtcperf.peerConnectionsConnected++
        webrtcperf.connectionTimer.add(id)
        break
      }
      case 'disconnected': {
        webrtcperf.peerConnectionsDisconnected++
        webrtcperf.connectionTimer.remove(id)
        break
      }
      case 'failed': {
        webrtcperf.peerConnectionsFailed++
        webrtcperf.connectionTimer.remove(id)
        break
      }
      case 'closed': {
        closed()
        break
      }
    }
  })

  const closeNative = pc.close.bind(pc)
  pc.close = () => {
    debug('close')
    closed()
    return closeNative()
  }

  const createOfferNative = pc.createOffer.bind(pc)
  pc.createOffer = async options => {
    const offer = await createOfferNative(options)
    debug(`createOffer`, { options, offer })
    return offer
  }

  const setLocalDescriptionNative = pc.setLocalDescription.bind(pc)
  pc.setLocalDescription = description => {
    debug(`setLocalDescription`, description)
    if (window.overrideSetLocalDescription) {
      description = window.overrideSetLocalDescription(description)
    }
    return setLocalDescriptionNative(description)
  }

  const setRemoteDescriptionNative = pc.setRemoteDescription.bind(pc)
  pc.setRemoteDescription = description => {
    debug(`setRemoteDescription`, description)
    if (window.overrideSetRemoteDescription) {
      description = window.overrideSetRemoteDescription(description)
    }
    return setRemoteDescriptionNative(description)
  }

  const checkSaveStream = transceiver => {
    if (!transceiver?.sender?.track) return
    if (transceiver.sender.track.kind === 'video' && webrtcperf.enabledForSession(window.PARAMS?.saveSendVideoTrack)) {
      saveMediaTrack(
        transceiver.sender.track,
        'send',
        window.PARAMS?.saveVideoTrackEnableStart,
        window.PARAMS?.saveVideoTrackEnableEnd,
      ).catch(err => log(`saveMediaTrack error: ${err.message}`))
    } else if (
      transceiver.sender.track.kind === 'audio' &&
      webrtcperf.enabledForSession(window.PARAMS?.saveSendAudioTrack)
    ) {
      saveMediaTrack(
        transceiver.sender.track,
        'send',
        window.PARAMS?.saveAudioTrackEnableStart,
        window.PARAMS?.saveAudioTrackEnableEnd,
      ).catch(err => log(`saveMediaTrack error: ${err.message}`))
    }
  }

  const addTransceiverNative = pc.addTransceiver.bind(pc)
  pc.addTransceiver = (...args) => {
    debug(`addTransceiver`, args)

    const transceiver = addTransceiverNative(...args)
    if (transceiver.sender) {
      const setParametersNative = transceiver.sender.setParameters.bind(transceiver.sender)
      transceiver.sender.setParameters = parameters => {
        debug(`transceiver.setParameters`, parameters)
        if (window.overrideSetParameters) {
          parameters = window.overrideSetParameters(parameters)
        }
        return setParametersNative(parameters)
      }

      const setStreamsNative = transceiver.sender.setStreams.bind(transceiver.sender)
      transceiver.sender.setStreams = (...streams) => {
        debug(`transceiver.setStreams`, streams)
        if (window.overrideSetStreams) {
          streams = window.overrideSetStreams(streams)
        }
        setStreamsNative(...streams)

        checkSaveStream(transceiver)
      }

      const replaceTrackNative = transceiver.sender.replaceTrack.bind(transceiver.sender)
      transceiver.sender.replaceTrack = async track => {
        debug(`transceiver.replaceTrack`, track)
        if (window.overrideReplaceTrack) {
          track = window.overrideReplaceTrack(track)
        }
        await replaceTrackNative(track)

        if (encodedInsertableStreams && timestampInsertableStreams) {
          handleTransceiverForInsertableStreams(id, transceiver)
        }

        checkSaveStream(transceiver)
      }
    }

    if (transceiver.receiver) {
      webrtcperf.watchObjectProperty(transceiver.receiver, 'playoutDelayHint', (value, oldValue) => {
        debug(`receiver ${transceiver.receiver.track.kind} playoutDelayHint ${oldValue} -> ${value}`)
      })
      webrtcperf.watchObjectProperty(transceiver.receiver, 'jitterBufferTarget', (value, oldValue) => {
        debug(`receiver ${transceiver.receiver.track.kind} jitterBufferTarget ${oldValue} -> ${value}`)
      })
    }

    if (encodedInsertableStreams && timestampInsertableStreams) {
      handleTransceiverForInsertableStreams(id, transceiver)
    }

    handleTransceiverForPlayoutDelayHint(id, transceiver, 'addTransceiver')
    handleTransceiverForJitterBufferTarget(id, transceiver, 'addTransceiver')
    return transceiver
  }

  const addStreamNative = pc.addStream.bind(pc)
  pc.addStream = (...args) => {
    debug(`addStream`, args)
    addStreamNative(...args)
    for (const transceiver of pc.getTransceivers()) {
      if (['sendonly', 'sendrecv'].includes(transceiver.direction)) {
        if (encodedInsertableStreams && timestampInsertableStreams) {
          handleTransceiverForInsertableStreams(id, transceiver)
        }
        handleTransceiverForPlayoutDelayHint(id, transceiver, 'addStream')
        handleTransceiverForJitterBufferTarget(id, transceiver, 'addStream')

        checkSaveStream(transceiver)
      }
    }
  }

  pc.addEventListener('track', async event => {
    const { receiver, transceiver } = event
    if (receiver?.track) {
      debug(`ontrack`, { kind: receiver.track.kind, event, streams: event.streams })
      if (encodedInsertableStreams && timestampInsertableStreams) {
        handleTransceiverForInsertableStreams(id, transceiver)
      }
      webrtcperf
        .waitTrackMedia(receiver.track)
        .then(({ now }) => {
          if (receiver.track.kind === 'video') {
            webrtcperf.videoStartFrameDelayStats.push(now, (now - window.WEBRTC_PERF_START_TIMESTAMP) / 1000)
            if (webrtcperf.enabledForSession(window.PARAMS?.timestampWatermarkVideo)) {
              webrtcperf.recognizeVideoTimestampWatermark(receiver.track)
            }
            if (webrtcperf.enabledForSession(window.PARAMS?.saveRecvVideoTrack)) {
              return saveMediaTrack(receiver.track, 'recv')
            }
          } else if (receiver.track.kind === 'audio') {
            webrtcperf.audioStartFrameDelayStats.push(now, (now - window.WEBRTC_PERF_START_TIMESTAMP) / 1000)
            if (webrtcperf.enabledForSession(window.PARAMS?.timestampWatermarkAudio)) {
              recognizeAudioTimestampWatermark(receiver.track)
            }
            if (webrtcperf.enabledForSession(window.PARAMS?.saveRecvAudioTrack)) {
              return saveMediaTrack(receiver.track, 'recv')
            }
          }
        })
        .catch(err => log(`waitTrackMedia error: ${err.message}`))
    }
    handleTransceiverForPlayoutDelayHint(id, transceiver, 'track')
    handleTransceiverForJitterBufferTarget(id, transceiver, 'track')
  })

  const setConfigurationNative = pc.setConfiguration.bind(pc)
  pc.setConfiguration = configuration => {
    debug(`setConfiguration`, configuration)
    return setConfigurationNative({
      ...configuration,
      encodedInsertableStreams,
    })
  }

  window.dispatchEvent(
    new CustomEvent('webrtcperf:peerconnectioncreated', {
      bubbles: true,
      detail: { id, pc },
    }),
  )

  return pc
}

for (const key of Object.keys(NativeRTCPeerConnection)) {
  window.RTCPeerConnection[key] = NativeRTCPeerConnection[key]
}
window.RTCPeerConnection.prototype = NativeRTCPeerConnection.prototype

// Override codecs.
const NativeRTCRtpSenderGetCapabilities = window.RTCRtpSender.getCapabilities

window.RTCRtpSender.getCapabilities = kind => {
  const capabilities = NativeRTCRtpSenderGetCapabilities(kind)
  if (!window.GET_CAPABILITIES_DISABLED_VIDEO_CODECS?.length || kind !== 'video') {
    return capabilities
  }
  capabilities.codecs = capabilities.codecs.filter(codec => {
    if (window.GET_CAPABILITIES_DISABLED_VIDEO_CODECS.includes(codec.mimeType.replace('video/', '').toLowerCase())) {
      return false
    }
    return true
  })
  log(`RTCRtpSender getCapabilities custom:`, capabilities)
  return capabilities
}

window.saveTransceiversTracks = async (direction, kind, enableStart = 0, enableEnd = 0) => {
  for (const pc of PeerConnections.values()) {
    const tranceivers = pc
      .getTransceivers()
      .filter(t => t[direction]?.track?.kind === kind && t[direction]?.track?.label !== 'probator')
    for (const tranceiver of tranceivers) {
      await saveMediaTrack(
        tranceiver[direction].track,
        direction === 'sender' ? 'send' : 'recv',
        enableStart,
        enableEnd,
      )
    }
  }
}

window.stopSaveTransceiversTracks = (direction, kind) => {
  for (const pc of PeerConnections.values()) {
    const tranceivers = pc
      .getTransceivers()
      .filter(t => t[direction]?.track?.kind === kind && t[direction]?.track?.label !== 'probator')
    for (const tranceiver of tranceivers) {
      stopSaveMediaTrack(tranceiver[direction].track)
    }
  }
}

window.setTransceiversTracks = (direction, kind, enabled) => {
  for (const pc of PeerConnections.values()) {
    const tranceivers = pc
      .getTransceivers()
      .filter(t => t[direction]?.track?.kind === kind && t[direction]?.track?.label !== 'probator')
    for (const tranceiver of tranceivers) {
      tranceiver[direction].track.enabled = enabled
    }
  }
}

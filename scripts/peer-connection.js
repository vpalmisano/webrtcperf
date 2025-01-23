/* global webrtcperf, log, PeerConnections, handleTransceiverForInsertableStreams, handleTransceiverForPlayoutDelayHint, handleTransceiverForJitterBufferTarget, saveMediaTrack, stopSaveMediaTrack */

const timestampInsertableStreams = !!webrtcperf.params.timestampInsertableStreams

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
    this.startEvents = 0
    this.stopEvents = 0
  }

  start() {
    if (this.timer) return
    this.lastTime = Date.now()
    this.startEvents++
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
    this.stopEvents++
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
    if (webrtcperf.enabledForSession(webrtcperf.params.peerConnectionDebug)) {
      log(`waitTrackMedia ${id} (${kind})`, ...args)
    }
  }
  debug('start')
  return new Promise((resolve, reject) => {
    const { readable } = new window.MediaStreamTrackProcessor({ track })
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
    if (webrtcperf.enabledForSession(webrtcperf.params.peerConnectionDebug)) {
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
  debug(`created`, { conf, options, pc })

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
    let offer = await createOfferNative(options)
    if (webrtcperf.overrideCreateOffer) {
      offer = webrtcperf.overrideCreateOffer(offer)
      debug(`createOffer override`, offer)
    } else {
      debug(`createOffer`, { options, offer })
    }
    return offer
  }

  const setLocalDescriptionNative = pc.setLocalDescription.bind(pc)
  pc.setLocalDescription = description => {
    debug(`setLocalDescription`, description)
    if (webrtcperf.overrideSetLocalDescription) {
      description = webrtcperf.overrideSetLocalDescription(description)
      debug(`setLocalDescription override`, description)
    }
    return setLocalDescriptionNative(description)
  }

  const setRemoteDescriptionNative = pc.setRemoteDescription.bind(pc)
  pc.setRemoteDescription = description => {
    debug(`setRemoteDescription`, description)
    if (webrtcperf.overrideSetRemoteDescription) {
      description = webrtcperf.overrideSetRemoteDescription(description)
      debug(`setRemoteDescription override`, description)
    }
    return setRemoteDescriptionNative(description)
  }

  const checkSaveStream = transceiver => {
    if (!transceiver?.sender?.track) return
    if (
      transceiver.sender.track.kind === 'video' &&
      webrtcperf.enabledForSession(webrtcperf.params.saveSendVideoTrack)
    ) {
      saveMediaTrack(
        transceiver.sender.track,
        'send',
        webrtcperf.params.saveVideoTrackEnableStart,
        webrtcperf.params.saveVideoTrackEnableEnd,
      ).catch(err => log(`saveMediaTrack error: ${err.message}`))
    } else if (
      transceiver.sender.track.kind === 'audio' &&
      webrtcperf.enabledForSession(webrtcperf.params.saveSendAudioTrack)
    ) {
      saveMediaTrack(
        transceiver.sender.track,
        'send',
        webrtcperf.params.saveAudioTrackEnableStart,
        webrtcperf.params.saveAudioTrackEnableEnd,
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

  const addTrackNative = pc.addTrack.bind(pc)
  pc.addTrack = (...args) => {
    debug(`addTrack`, args)
    const sender = addTrackNative(...args)
    for (const transceiver of pc.getTransceivers()) {
      if (['sendonly', 'sendrecv'].includes(transceiver.direction)) {
        if (encodedInsertableStreams && timestampInsertableStreams) {
          handleTransceiverForInsertableStreams(id, transceiver)
        }
        handleTransceiverForPlayoutDelayHint(id, transceiver, 'addTrack')
        handleTransceiverForJitterBufferTarget(id, transceiver, 'addTrack')

        checkSaveStream(transceiver)
      }
    }
    return sender
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
          const t = webrtcperf.elapsedTime() / 1000
          if (receiver.track.kind === 'video') {
            webrtcperf.videoStartFrameDelayStats.push(now, t)
          } else if (receiver.track.kind === 'audio') {
            webrtcperf.audioStartFrameDelayStats.push(now, t)
          }
        })
        .catch(err => log(`waitTrackMedia error: ${err.message}`))

      if (receiver.track.kind === 'video') {
        if (webrtcperf.enabledForSession(webrtcperf.params.timestampWatermarkVideo)) {
          webrtcperf.recognizeVideoTimestampWatermark(receiver.track)
        }
        if (webrtcperf.enabledForSession(webrtcperf.params.saveRecvVideoTrack)) {
          saveMediaTrack(receiver.track, 'recv').catch(err => log(`saveMediaTrack error: ${err.message}`))
        }
      } else if (receiver.track.kind === 'audio') {
        if (webrtcperf.enabledForSession(webrtcperf.params.timestampWatermarkAudio)) {
          webrtcperf.recognizeAudioTimestampWatermark(receiver.track)
        }
        if (webrtcperf.enabledForSession(webrtcperf.params.saveRecvAudioTrack)) {
          saveMediaTrack(receiver.track, 'recv').catch(err => log(`saveMediaTrack error: ${err.message}`))
        }
      }
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

webrtcperf.filterTransceiversTracks = (direction, kind) => {
  if (!['send', 'recv'].includes(direction)) {
    throw new Error(`Invalid direction: ${direction}`)
  }
  const trackKind = kind === 'screen' ? 'video' : kind
  if (!['audio', 'video'].includes(trackKind)) {
    throw new Error(`Invalid kind: ${trackKind}`)
  }
  const directionOption = direction === 'send' ? 'sender' : 'receiver'
  const tranceivers = []
  for (const pc of PeerConnections.values()) {
    pc.getTransceivers().forEach(tranceiver => {
      if (!tranceiver.direction.includes(direction)) return
      const track = tranceiver[directionOption]?.track
      if (track?.kind === trackKind && track?.label !== 'probator') {
        if (
          kind === 'video' &&
          ((direction === 'send' && webrtcperf.isSenderDisplayTrack(track)) ||
            (direction === 'recv' && webrtcperf.isReceiverDisplayTrack(track)))
        )
          return
        tranceivers.push({ tranceiver, track })
      }
    })
  }
  return tranceivers
}

window.saveTransceiversTracks = async (direction, kind, enableStart = 0, enableEnd = 0) => {
  for (const { track } of webrtcperf.filterTransceiversTracks(direction, kind)) {
    await saveMediaTrack(track, direction, enableStart, enableEnd)
  }
}

window.stopSaveTransceiversTracks = (direction, kind) => {
  for (const { track } of webrtcperf.filterTransceiversTracks(direction, kind)) {
    stopSaveMediaTrack(track)
  }
}

window.setTransceiversTracks = (direction, kind, enabled) => {
  for (const { track } of webrtcperf.filterTransceiversTracks(direction, kind)) {
    track.enabled = enabled
  }
}

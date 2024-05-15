/* global log, PeerConnections, handleTransceiverForInsertableStreams, handleTransceiverForPlayoutDelayHint, recognizeTimestampWatermark, saveMediaTrack, enabledForSession */

const timestampInsertableStreams = !!window.PARAMS?.timestampInsertableStreams

const NativeRTCPeerConnection = window.RTCPeerConnection

let peerConnectionNextId = 0

window.RTCPeerConnection = function (conf, options) {
  const id = peerConnectionNextId++

  log(`RTCPeerConnection-${id}`, { conf, options })

  const encodedInsertableStreams =
    conf?.encodedInsertableStreams ||
    (timestampInsertableStreams && conf?.sdpSemantics === 'unified-plan')

  const pc = new NativeRTCPeerConnection(
    {
      ...(conf || {}),
      encodedInsertableStreams,
    },
    options,
  )

  PeerConnections.set(id, pc)

  pc.addEventListener('connectionstatechange', () => {
    log(`RTCPeerConnection-${id} changed to: ${pc.connectionState}`)
    if (pc.connectionState === 'closed') {
      PeerConnections.delete(id)
    }
  })

  /* const createOfferNative = pc.createOffer.bind(pc)
  pc.createOffer = async options => {
    const offer = await createOfferNative(options)
    log(`RTCPeerConnection createOffer`, { options, offer })
    return offer
  }

  const setLocalDescriptionNative = pc.setLocalDescription.bind(pc)
  pc.setLocalDescription = description => {
    log(`RTCPeerConnection setLocalDescription`, description)
    return setLocalDescriptionNative(description)
  }

  const setRemoteDescriptionNative = pc.setRemoteDescription.bind(pc)
  pc.setRemoteDescription = description => {
    log(`RTCPeerConnection setRemoteDescription`, description)
    return setRemoteDescriptionNative(description)
  } */

  const checkSaveStream = transceiver => {
    if (!transceiver?.sender?.track) return
    if (
      transceiver.sender.track.kind === 'video' &&
      enabledForSession(window.PARAMS?.saveSendVideoTrack)
    ) {
      saveMediaTrack(
        transceiver.sender.track,
        'send',
        window.PARAMS?.saveVideoTrackEnableDelay,
      ).catch(err => log(`saveMediaTrack error: ${err.message}`))
    } else if (
      transceiver.sender.track.kind === 'audio' &&
      enabledForSession(window.PARAMS?.saveSendAudioTrack)
    ) {
      saveMediaTrack(
        transceiver.sender.track,
        'send',
        window.PARAMS?.saveAudioTrackEnableDelay,
      ).catch(err => log(`saveMediaTrack error: ${err.message}`))
    }
  }

  const addTransceiverNative = pc.addTransceiver.bind(pc)
  pc.addTransceiver = (...args) => {
    //log(`RTCPeerConnection addTransceiver`, args)

    const transceiver = addTransceiverNative(...args)
    log(`RTCPeerConnection-${id} addTransceiver`, transceiver)
    if (transceiver.sender) {
      const setParametersNative = transceiver.sender.setParameters.bind(
        transceiver.sender,
      )
      transceiver.sender.setParameters = parameters => {
        log(`RTCPeerConnection-${id} transceiver.setParameters`, parameters)
        if (window.overrideSetParameters) {
          parameters = window.overrideSetParameters(parameters)
        }
        return setParametersNative(parameters)
      }

      const setStreamsNative = transceiver.sender.setStreams.bind(
        transceiver.sender,
      )
      transceiver.sender.setStreams = (...streams) => {
        log(`RTCPeerConnection-${id} transceiver.setStreams`, streams)
        setStreamsNative(...streams)

        checkSaveStream(transceiver)
      }

      const replaceTrackNative = transceiver.sender.replaceTrack.bind(
        transceiver.sender,
      )
      transceiver.sender.replaceTrack = async track => {
        log(`RTCPeerConnection-${id} transceiver.replaceTrack`, track)
        await replaceTrackNative(track)

        if (encodedInsertableStreams) {
          handleTransceiverForInsertableStreams(id, transceiver)
        }

        checkSaveStream(transceiver)
      }
    }

    if (encodedInsertableStreams) {
      handleTransceiverForInsertableStreams(id, transceiver)
    }

    handleTransceiverForPlayoutDelayHint(id, transceiver, 'addTransceiver')
    return transceiver
  }

  const addStreamNative = pc.addStream.bind(pc)
  pc.addStream = (...args) => {
    log(`RTCPeerConnection-${id} addStream`)
    addStreamNative(...args)
    for (const transceiver of pc.getTransceivers()) {
      if (['sendonly', 'sendrecv'].includes(transceiver.direction)) {
        if (encodedInsertableStreams) {
          handleTransceiverForInsertableStreams(id, transceiver)
        }
        handleTransceiverForPlayoutDelayHint(id, transceiver, 'addStream')

        checkSaveStream(transceiver)
      }
    }
  }

  pc.addEventListener('track', async event => {
    //log(`RTCPeerConnection-${id} track`)
    const { receiver, transceiver } = event
    if (receiver?.track) {
      log(`RTCPeerConnection-${id} ontrack`, receiver.track.kind, event)
      if (encodedInsertableStreams) {
        handleTransceiverForInsertableStreams(id, transceiver)
      }
      if (receiver.track.kind === 'video') {
        if (enabledForSession(window.PARAMS?.timestampWatermarkVideo)) {
          recognizeTimestampWatermark(receiver.track)
        }

        if (enabledForSession(window.PARAMS?.saveRecvVideoTrack)) {
          await saveMediaTrack(receiver.track, 'recv')
        }
      } else if (receiver.track.kind === 'audio') {
        if (enabledForSession(window.PARAMS?.saveRecvAudioTrack)) {
          await saveMediaTrack(receiver.track, 'recv')
        }
      }
    }
    handleTransceiverForPlayoutDelayHint(id, transceiver, 'track')
  })

  const setConfigurationNative = pc.setConfiguration.bind(pc)
  pc.setConfiguration = configuration => {
    log(`RTCPeerConnection-${id} setConfiguration`, configuration)
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
  if (
    !window.GET_CAPABILITIES_DISABLED_VIDEO_CODECS?.length ||
    kind !== 'video'
  ) {
    return capabilities
  }
  capabilities.codecs = capabilities.codecs.filter(codec => {
    if (
      window.GET_CAPABILITIES_DISABLED_VIDEO_CODECS.includes(
        codec.mimeType.replace('video/', '').toLowerCase(),
      )
    ) {
      return false
    }
    return true
  })
  log(`RTCRtpSender getCapabilities custom:`, capabilities)
  return capabilities
}

async function saveTransceiversTracks(direction, kind, enableDelay = 0) {
  for (const pc of PeerConnections.values()) {
    const tranceivers = pc
      .getTransceivers()
      .filter(
        t =>
          t[direction]?.track?.kind === kind &&
          t[direction]?.track?.label !== 'probator',
      )
    for (const tranceiver of tranceivers) {
      await saveMediaTrack(
        tranceiver[direction].track,
        direction === 'sender' ? 'send' : 'recv',
        enableDelay,
      )
    }
  }
}

window.saveSendAudioTracks = enableDelay =>
  saveTransceiversTracks('sender', 'audio', enableDelay)
window.saveSendVideoTracks = enableDelay =>
  saveTransceiversTracks('sender', 'video', enableDelay)
window.saveRecvAudioTracks = enableDelay =>
  saveTransceiversTracks('receiver', 'audio', enableDelay)
window.saveRecvVideoTracks = enableDelay =>
  saveTransceiversTracks('receiver', 'video', enableDelay)

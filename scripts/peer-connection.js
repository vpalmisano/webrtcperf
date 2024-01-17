/* global log, PeerConnections, handleTransceiverForInsertableStreams, handleTransceiverForPlayoutDelayHint, videoEndToEndDelayStats */

const timestampInsertableStreams = !!window.PARAMS?.timestampInsertableStreams

const NativeRTCPeerConnection = window.RTCPeerConnection

let peerConnectionNextId = 0

window.RTCPeerConnection = function (conf, options) {
  const id = peerConnectionNextId++

  log(`RTCPeerConnection-${id}`, { conf, options })

  const encodedInsertableStreams =
    conf.encodedInsertableStreams ||
    (timestampInsertableStreams && conf?.sdpSemantics === 'unified-plan')

  const pc = new NativeRTCPeerConnection(
    {
      ...conf,
      encodedInsertableStreams,
    },
    options,
  )

  PeerConnections.set(id, pc)

  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'closed') {
      log(`RTCPeerConnection closed (connectionState: ${pc.connectionState})`)
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
        return setStreamsNative(...streams)
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
      }
    }
  }

  pc.addEventListener('track', async event => {
    //log(`RTCPeerConnection-${id} track`)
    const { receiver, transceiver } = event
    if (receiver?.track) {
      //log(`RTCPeerConnection-${id} ontrack`, receiver.track.kind, event)
      if (encodedInsertableStreams) {
        handleTransceiverForInsertableStreams(id, transceiver)
      }
      if (receiver.track.kind === 'video') {
        if (window.PARAMS?.timestampWatermark) {
          window.recognizeTimestampWatermark(
            receiver.track,
            ({ timestamp, delay }) => {
              videoEndToEndDelayStats.push(timestamp, delay)
            },
          )
        }

        if (
          window.PARAMS?.saveMediaStream &&
          window.WEBRTC_STRESS_TEST_INDEX <= window.PARAMS?.saveMediaStream
        ) {
          await window.saveMediaStreamTrack(receiver.track, 'recv')
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

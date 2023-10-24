/* global log, PeerConnections, handleTransceiverForInsertableStreams, handleTransceiverForPlayoutDelayHint, videoEndToEndDelayStats */

const timestampInsertableStreams = !!window.PARAMS?.timestampInsertableStreams
const timestampWatermark = !!window.PARAMS?.timestampWatermark

const NativeRTCPeerConnection = window.RTCPeerConnection

let peerConnectionNextId = 0

window.RTCPeerConnection = function (options) {
  //log(`RTCPeerConnection`, options)

  const pc = new NativeRTCPeerConnection({
    ...options,
    encodedInsertableStreams: timestampInsertableStreams,
  })

  const id = peerConnectionNextId++
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
    // log(`RTCPeerConnection-${id} addTransceiver`, transceiver)
    /* if (transceiver.sender) {
      const setParametersNative = transceiver.sender.setParameters.bind(
        transceiver.sender,
      )
      setParametersNative.setParameters = parameters => {
        log(`RTCPeerConnection-${id} transceiver.setParameters`, parameters)
        return setParametersNative(parameters)
      }
    } */
    if (timestampInsertableStreams) {
      handleTransceiverForInsertableStreams(id, transceiver)
    }

    handleTransceiverForPlayoutDelayHint(id, transceiver, 'addTransceiver')
    return transceiver
  }

  // Used by OpenTok.
  const addStreamNative = pc.addStream.bind(pc)
  pc.addStream = (...args) => {
    addStreamNative(...args)
    //log(`RTCPeerConnection-${id} addStream`)
    for (const transceiver of pc.getTransceivers()) {
      if (['sendonly', 'sendrecv'].includes(transceiver.direction)) {
        if (timestampInsertableStreams) {
          handleTransceiverForInsertableStreams(id, transceiver)
        }
        handleTransceiverForPlayoutDelayHint(id, transceiver, 'addStream')
      }
    }
  }

  pc.addEventListener('track', event => {
    //log(`RTCPeerConnection-${id} track`)
    const { receiver, transceiver } = event
    if (receiver?.track) {
      //log(`RTCPeerConnection-${id} ontrack`, track.kind, event)
      if (timestampInsertableStreams) {
        handleTransceiverForInsertableStreams(id, transceiver)
      }
      if (timestampWatermark) {
        window.recognizeTimestampWatermark(
          receiver?.track,
          ({ timestamp, delay }) => {
            videoEndToEndDelayStats.push(timestamp, delay)
          },
        )
      }
    }
    handleTransceiverForPlayoutDelayHint(id, transceiver, 'track')
  })

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

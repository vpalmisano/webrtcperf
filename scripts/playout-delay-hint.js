/* global log, PeerConnections */

const handleTransceiverForPlayoutDelayHint = (id, transceiver, event) => {
  const playoutDelayHint = window.PARAMS?.playoutDelayHint
  if (playoutDelayHint === undefined) {
    return
  }
  if (transceiver.receiver && transceiver.receiver.track?.label !== 'probator') {
    log(
      `RTCPeerConnection-${id} ${event}: set playoutDelayHint ${transceiver.receiver.track?.kind} ${transceiver.receiver.playoutDelayHint} -> ${playoutDelayHint}`,
    )
    transceiver.receiver.playoutDelayHint = playoutDelayHint
  }
}

window.setPlayoutDelayHint = value => {
  window.PARAMS.playoutDelayHint = value
  ;[...PeerConnections.entries()].forEach(([id, pc]) => {
    pc.getTransceivers().forEach(t => handleTransceiverForPlayoutDelayHint(id, t, 'set'))
  })
}

window.getPlayoutDelayHint = () => {
  ;[...PeerConnections.entries()].forEach(([id, pc]) => {
    pc.getTransceivers().forEach(
      t =>
        t.receiver &&
        log(
          `${id} ${t.receiver.track?.kind} track: ${t.receiver.track?.label} playoutDelayHint: ${t.receiver.playoutDelayHint}`,
        ),
    )
  })
}

const handleTransceiverForJitterBufferTarget = (id, transceiver, event) => {
  const jitterBufferTarget = window.PARAMS?.jitterBufferTarget
  if (jitterBufferTarget === undefined) {
    return
  }
  if (transceiver.receiver && transceiver.receiver.track?.label !== 'probator') {
    log(
      `RTCPeerConnection-${id} ${event}: set jitterBufferTarget ${transceiver.receiver.track?.kind} ${transceiver.receiver.jitterBufferTarget} -> ${jitterBufferTarget}`,
    )
    transceiver.receiver.jitterBufferTarget = jitterBufferTarget
  }
}

window.setJitterBufferTarget = value => {
  window.PARAMS.jitterBufferTarget = value
  ;[...PeerConnections.entries()].forEach(([id, pc]) => {
    pc.getTransceivers().forEach(t => handleTransceiverForJitterBufferTarget(id, t, 'set'))
  })
}

window.getJitterBufferTarget = () => {
  ;[...PeerConnections.entries()].forEach(([id, pc]) => {
    pc.getTransceivers().forEach(
      t =>
        t.receiver &&
        log(
          `${id} ${t.receiver.track?.kind} track: ${t.receiver.track?.label} jitterBufferTarget: ${t.receiver.jitterBufferTarget}`,
        ),
    )
  })
}

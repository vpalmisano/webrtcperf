/* global webrtcperf, PeerConnections */

webrtcperf.handleTransceiverForPlayoutDelayHint = (id, transceiver, event) => {
  const playoutDelayHint = webrtcperf.params.playoutDelayHint
  if (playoutDelayHint === undefined) {
    return
  }
  if (transceiver.receiver && transceiver.receiver.track?.label !== 'probator') {
    webrtcperf.log(
      `RTCPeerConnection-${id} ${event}: set playoutDelayHint ${transceiver.receiver.track?.kind} ${transceiver.receiver.playoutDelayHint} -> ${playoutDelayHint}`,
    )
    transceiver.receiver.playoutDelayHint = playoutDelayHint
  }
}

window.setPlayoutDelayHint = value => {
  webrtcperf.params.playoutDelayHint = value
  ;[...PeerConnections.entries()].forEach(([id, pc]) => {
    pc.getTransceivers().forEach(t => webrtcperf.handleTransceiverForPlayoutDelayHint(id, t, 'set'))
  })
}

window.getPlayoutDelayHint = () => {
  ;[...PeerConnections.entries()].forEach(([id, pc]) => {
    pc.getTransceivers().forEach(
      t =>
        t.receiver &&
        webrtcperf.log(
          `${id} ${t.receiver.track?.kind} track: ${t.receiver.track?.label} playoutDelayHint: ${t.receiver.playoutDelayHint}`,
        ),
    )
  })
}

webrtcperf.handleTransceiverForJitterBufferTarget = (id, transceiver, event) => {
  let jitterBufferTarget = webrtcperf.params.jitterBufferTarget
  if (jitterBufferTarget && isNaN(jitterBufferTarget)) {
    jitterBufferTarget = jitterBufferTarget[transceiver.receiver.track?.kind]
  }
  if (isNaN(jitterBufferTarget)) return
  if (transceiver.receiver && transceiver.receiver.track?.label !== 'probator') {
    webrtcperf.log(
      `RTCPeerConnection-${id} ${event}: set jitterBufferTarget ${transceiver.receiver.track?.kind} ${transceiver.receiver.jitterBufferTarget} -> ${jitterBufferTarget}`,
    )
    transceiver.receiver.jitterBufferTarget = jitterBufferTarget
  }
}

window.setJitterBufferTarget = value => {
  webrtcperf.params.jitterBufferTarget = value
  ;[...PeerConnections.entries()].forEach(([id, pc]) => {
    pc.getTransceivers().forEach(t => webrtcperf.handleTransceiverForJitterBufferTarget(id, t, 'set'))
  })
}

window.getJitterBufferTarget = () => {
  ;[...PeerConnections.entries()].forEach(([id, pc]) => {
    pc.getTransceivers().forEach(
      t =>
        t.receiver &&
        webrtcperf.log(
          `${id} ${t.receiver.track?.kind} track: ${t.receiver.track?.label} jitterBufferTarget: ${t.receiver.jitterBufferTarget}`,
        ),
    )
  })
}

/* global log, PeerConnections */

// Set playoutDelayHint option.
const handleTransceiverForPlayoutDelayHint = (id, transceiver, event) => {
  const playoutDelayHint = window.PARAMS?.playoutDelayHint
  if (playoutDelayHint === undefined) {
    return
  }
  if (
    ['recvonly', 'sendrecv'].includes(transceiver?.direction) &&
    transceiver.receiver &&
    transceiver.receiver.track?.label !== 'probator' &&
    transceiver.receiver.playoutDelayHint !== playoutDelayHint
  ) {
    log(
      `RTCPeerConnection-${id} ${event}: set playoutDelayHint ${transceiver.receiver.track?.kind} ${transceiver.receiver.playoutDelayHint} -> ${playoutDelayHint}`,
    )
    transceiver.receiver.playoutDelayHint = playoutDelayHint
  }
}

window.setPlayoutDelayHint = value => {
  window.PARAMS.playoutDelayHint = value
  ;[...PeerConnections.entries()].forEach(([id, pc]) => {
    pc.getTransceivers().forEach(t =>
      handleTransceiverForPlayoutDelayHint(id, t, 'set'),
    )
  })
}

window.getPlayoutDelayHint = () => {
  ;[...PeerConnections.entries()].forEach(([id, pc]) => {
    pc.getTransceivers().forEach(
      t =>
        ['recvonly', 'sendrecv'].includes(t?.direction) &&
        t.receiver &&
        log(
          `${id} ${t.receiver.track?.kind} track: ${t.receiver.track?.label} playoutDelayHint: ${t.receiver.playoutDelayHint}`,
        ),
    )
  })
}

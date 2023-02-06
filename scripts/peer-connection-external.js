/* global log, PeerConnections */

window.RTCPeerConnection = class {
  constructor(options) {
    log(`RTCPeerConnection`, options)

    window.createPeerConnection(options).then(({ id }) => {
      this.id = id
      PeerConnections.set(id, this)
    })

    /* pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'closed') {
        log(`RTCPeerConnection closed (connectionState: ${pc.connectionState})`)
        PeerConnections.delete(id)
      }
    }) */
  }

  addEventListener(name, cb) {
    log(`RTCPeerConnection-${this.id} addEventListener`, name, cb)
  }

  async createOffer(options) {
    log(`RTCPeerConnection-${this.id} createOffer`, { options })
    return {}
  }

  async setLocalDescription(description) {
    log(`RTCPeerConnection-${this.id} setLocalDescription`, description)
  }

  async setRemoteDescription(description) {
    log(`RTCPeerConnection-${this.id} setRemoteDescription`, description)
  }

  addTransceiver(...args) {
    log(`RTCPeerConnection-${this.id} addTransceiver`, args)
    /* if (transceiver.sender) {
      const setParametersNative = transceiver.sender.setParameters.bind(
        transceiver.sender,
      )
      setParametersNative.setParameters = parameters => {
        log(`RTCPeerConnection-${id} transceiver.setParameters`, parameters)
        return setParametersNative(parameters)
      }
    } */
    return {}
  }

  addStream(...args) {
    log(`RTCPeerConnection-${this.id} addStream`, args)
  }
}

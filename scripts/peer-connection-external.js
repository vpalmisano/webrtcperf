/* global log, PeerConnections */

window.RTCPeerConnection = class {
  #pendingTasks = []
  connectionState = ''
  iceConnectionState = ''
  localDescription = null

  constructor(options) {
    log(`RTCPeerConnection`, options)

    let id = Math.round(Math.random() * 1e8)
    while (PeerConnections.has(id)) {
      id = Math.round(Math.random() * 1e8)
    }
    this.id = id
    PeerConnections.set(id, this)
    this.#pendingTasks.push(
      window.createPeerConnectionExternal(id, JSON.stringify(options)),
    )

    this.addEventListener('connectionstatechange', connectionState => {
      log(`RTCPeerConnection connectionstatechange`, connectionState)
      this.connectionState = connectionState
      if (connectionState === 'closed') {
        PeerConnections.delete(this.id)
      }
    })

    this.addEventListener('iceconnectionstatechange', iceConnectionState => {
      log(`RTCPeerConnection iceconnectionstatechange`, iceConnectionState)
      this.iceConnectionState = iceConnectionState
      if (iceConnectionState === 'closed') {
        PeerConnections.delete(this.id)
      }
    })
  }

  async waitPendingTasks() {
    log(
      `RTCPeerConnection-${this.id} waitPendingTasks ${
        this.#pendingTasks.length
      }`,
    )
    for (const p of this.#pendingTasks.splice(0, this.#pendingTasks.length)) {
      try {
        await p
      } catch (e) {
        log(`Task error: ${e.message}`, e)
      }
    }
  }

  async close() {
    log(`RTCPeerConnection-${this.id} close`)
    await this.waitPendingTasks()
    await window.callPeerConnectionExternalMethod(this.id, 'close')
  }

  addEventListener(name, cb) {
    log(`RTCPeerConnection-${this.id} addEventListener ${name}`)
    window.addEventListener(
      `peer-connection-${this.id}-event-${name}`,
      event => {
        log(
          `RTCPeerConnection-${this.id} peer-connection-event-${name}`,
          event.detail,
        )
        cb(event.detail)
      },
    )
  }

  async addTransceiver(trackOrKind, init) {
    log(`RTCPeerConnection-${this.id} addTransceiver`, { trackOrKind, init })
    await this.waitPendingTasks()
    this.#pendingTasks.push(
      window.callPeerConnectionExternalMethod(
        this.id,
        'addTransceiver',
        JSON.stringify({
          trackOrKind,
          init,
        }),
      ),
    )
  }

  async createOffer(options) {
    log(`RTCPeerConnection-${this.id} createOffer`, JSON.stringify(options))
    await this.waitPendingTasks()
    const ret = await window.callPeerConnectionExternalMethod(
      this.id,
      'createOffer',
      JSON.stringify(options),
    )
    this.localDescription = ret
    return JSON.parse(ret)
  }

  async createAnswer(options) {
    log(`RTCPeerConnection-${this.id} createAnswer`, JSON.stringify(options))
    await this.waitPendingTasks()
    const ret = await window.callPeerConnectionExternalMethod(
      this.id,
      'createAnswer',
      JSON.stringify(options),
    )
    this.localDescription = ret
    return JSON.parse(ret)
  }

  async setLocalDescription(description) {
    log(
      `RTCPeerConnection-${this.id} setLocalDescription`,
      JSON.stringify(description),
    )
    await this.waitPendingTasks()
    await window.callPeerConnectionExternalMethod(
      this.id,
      'setLocalDescription',
      JSON.stringify(description),
    )
  }

  async setRemoteDescription(description) {
    log(
      `RTCPeerConnection-${this.id} setRemoteDescription`,
      JSON.stringify(description),
    )
    await this.waitPendingTasks()
    await window.callPeerConnectionExternalMethod(
      this.id,
      'setRemoteDescription',
      JSON.stringify(description),
    )
  }

  async addStream(mediaStream) {
    log(`RTCPeerConnection-${this.id} addStream`, mediaStream)
    await this.waitPendingTasks()
    this.#pendingTasks.push(
      window.callPeerConnectionExternalMethod(
        this.id,
        'addStream',
        JSON.stringify(mediaStream), // TODO
      ),
    )
  }

  async getStats() {
    log(`RTCPeerConnection-${this.id} getStats`)
    return {}
  }
}

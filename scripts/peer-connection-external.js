/* global log, PeerConnections */

const FakeAudioMediaStreamTrack = () => {
  const ctx = new AudioContext()
  const oscillator = ctx.createOscillator()
  const dst = oscillator.connect(ctx.createMediaStreamDestination())
  oscillator.start()
  return Object.assign(dst.stream.getAudioTracks()[0], { enabled: false })
}

const FakeVideoMediaStreamTrack = ({ width = 640, height = 480 } = {}) => {
  const canvas = Object.assign(document.createElement('canvas'), {
    width,
    height,
  })
  canvas.getContext('2d').fillRect(0, 0, width, height)
  const stream = canvas.captureStream()
  return Object.assign(stream.getVideoTracks()[0], { enabled: false })
}

const fakeAudioTrack = FakeAudioMediaStreamTrack()
const fakeVideoTrack = FakeVideoMediaStreamTrack()

window.RTCPeerConnection = class {
  #pendingTasks = []

  connectionState = 'new'
  iceConnectionState = 'new'
  localDescription = null
  remoteDescription = null
  transceivers = []

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
  }

  async addTask(p) {
    this.#pendingTasks.push(p)
    return p
  }

  async waitPendingTasks() {
    /* log(
      `RTCPeerConnection-${this.id} waitPendingTasks ${
        this.#pendingTasks.length
      }`,
    ) */
    for (const p of this.#pendingTasks.splice(0, this.#pendingTasks.length)) {
      try {
        await p
      } catch (e) {
        log(`Task error: ${e.message}`, e)
      }
    }
  }

  close() {
    log(`RTCPeerConnection-${this.id} close`)
    this.waitPendingTasks().then(
      window.callPeerConnectionExternalMethod(this.id, 'close'),
    )
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

  addTransceiver(trackOrKind, init) {
    log(`RTCPeerConnection-${this.id} addTransceiver`, { trackOrKind, init })
    this.addTask(
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

  getTransceivers() {
    log(`RTCPeerConnection-${this.id} getTransceivers`, this.transceivers)
    return this.transceivers
  }

  async createOffer(options) {
    log(`RTCPeerConnection-${this.id} createOffer`, JSON.stringify(options))
    await this.waitPendingTasks()
    const ret = await this.addTask(
      window.callPeerConnectionExternalMethod(
        this.id,
        'createOffer',
        JSON.stringify(options),
      ),
    )
    this.localDescription = JSON.parse(ret)
    return this.localDescription
  }

  async createAnswer(options) {
    log(`RTCPeerConnection-${this.id} createAnswer`, JSON.stringify(options))
    await this.waitPendingTasks()
    const ret = await this.addTask(
      window.callPeerConnectionExternalMethod(
        this.id,
        'createAnswer',
        JSON.stringify(options),
      ),
    )
    this.localDescription = JSON.parse(ret)
    return this.localDescription
  }

  async setLocalDescription(description) {
    log(
      `RTCPeerConnection-${this.id} setLocalDescription`,
      JSON.stringify(description),
    )
    await this.waitPendingTasks()
    /* const ret = await this.addTask(
      window.callPeerConnectionExternalMethod(
        this.id,
        'setLocalDescription',
        JSON.stringify(description),
      ),
    )
    this.localDescription = JSON.parse(ret)
    return this.localDescription */
  }

  async setRemoteDescription(description) {
    log(
      `RTCPeerConnection-${this.id} setRemoteDescription`,
      JSON.stringify(description),
    )
    await this.waitPendingTasks()
    const ret = await this.addTask(
      window.callPeerConnectionExternalMethod(
        this.id,
        'setRemoteDescription',
        JSON.stringify(description),
      ),
    )
    this.remoteDescription = JSON.parse(ret)

    // Add fake transceivers.
    const sections = []
    for (const line of this.remoteDescription.sdp.split('\r\n')) {
      if (line.startsWith('m=')) {
        const kind = line.replace('m=', '').split(' ')[0]
        sections.push({ kind })
      } else if (line.startsWith('a=mid:')) {
        const mid = line.replace('a=mid:', '')
        sections[sections.length - 1].mid = mid
      }
    }
    sections.forEach(({ mid, kind }) => {
      if (this.transceivers.findIndex(t => t.mid === mid) === -1) {
        this.transceivers.push({
          mid,
          receiver: {
            track: kind === 'audio' ? fakeAudioTrack : fakeVideoTrack,
            getStats: () => {
              return []
            },
          },
        })
      }
    })
  }

  async addStream(mediaStream) {
    log(`RTCPeerConnection-${this.id} addStream`, mediaStream)
    /* this.addTask(
      window.callPeerConnectionExternalMethod(
        this.id,
        'addStream',
        JSON.stringify(mediaStream), // TODO
      ),
    ) */
  }

  async getStats() {
    log(`RTCPeerConnection-${this.id} getStats`)
    return []
  }
}

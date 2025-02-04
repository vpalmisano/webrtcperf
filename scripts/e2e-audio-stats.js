/* global webrtcperf, ggwave_factory */

/**
 * Audio end-to-end delay stats.
 * @type MeasuredStats
 */
webrtcperf.audioEndToEndDelayStats = new webrtcperf.MeasuredStats({ ttl: 15 })

webrtcperf.audioStartFrameDelayStats = new webrtcperf.MeasuredStats({ ttl: 60 })
webrtcperf.audioStartFrameTime = undefined

/**
 * It sets the start frame time used for calculating the startFrameDelay metric.
 * @param {number} value The start frame time in seconds.
 */
webrtcperf.setAudioStartFrameTime = value => {
  webrtcperf.audioStartFrameTime = value
}

webrtcperf.collectAudioEndToEndStats = () => {
  return {
    delay: webrtcperf.audioEndToEndDelayStats.mean(),
    startFrameDelay:
      webrtcperf.videoStartFrameDelayStats.size &&
      webrtcperf.audioStartFrameTime !== undefined &&
      webrtcperf.audioStartFrameDelayStats.mean() > webrtcperf.audioStartFrameTime
        ? webrtcperf.audioStartFrameDelayStats.mean() - webrtcperf.audioStartFrameTime
        : undefined,
  }
}

function convertTypedArray(src, type) {
  const buffer = new ArrayBuffer(src.byteLength)
  new src.constructor(buffer).set(src)
  return new type(buffer)
}

webrtcperf.ggwave = null

if (webrtcperf.enabledForSession(webrtcperf.params.timestampWatermarkAudio)) {
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      webrtcperf.ggwave = await ggwave_factory()
      if (!webrtcperf.params.timestampWatermarkAudioDebug) webrtcperf.ggwave.disableLog()
    } catch (e) {
      webrtcperf.log(`ggwave error: ${e}`)
    }
  })
}

/** @type AudioContext */
webrtcperf.audioContext = null
/** @type MediaStreamAudioDestinationNode */
webrtcperf.audioDestination = null

webrtcperf.initAudioTimestampWatermarkSender = (interval = 5000) => {
  if (webrtcperf.audioContext) return
  webrtcperf.log(`initAudioTimestampWatermarkSender with interval ${interval}ms`)

  const ggwave = webrtcperf.ggwave
  const AudioContext = window.AudioContext || window.webkitAudioContext
  const audioContext = (webrtcperf.audioContext = new AudioContext({
    latencyHint: 'interactive',
    sampleRate: 48000,
  }))
  webrtcperf.audioDestination = audioContext.createMediaStreamDestination()
  const parameters = ggwave.getDefaultParameters()
  parameters.sampleRateInp = audioContext.sampleRate
  parameters.sampleRateOut = audioContext.sampleRate
  parameters.operatingMode = ggwave.GGWAVE_OPERATING_MODE_TX | ggwave.GGWAVE_OPERATING_MODE_USE_DSS
  const instance = ggwave.init(parameters)

  setInterval(() => {
    const now = Date.now()
    const waveform = ggwave.encode(instance, now.toString(), ggwave.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST, 10)
    const buf = convertTypedArray(waveform, Float32Array)
    const buffer = audioContext.createBuffer(1, buf.length, audioContext.sampleRate)
    buffer.copyToChannel(buf, 0)
    const source = audioContext.createBufferSource()
    source.buffer = buffer
    source.connect(webrtcperf.audioDestination)
    source.start()
  }, interval)
}

webrtcperf.applyAudioTimestampWatermark = mediaStream => {
  if (mediaStream.getAudioTracks().length === 0) {
    return mediaStream
  }
  if (!webrtcperf.audioContext || !webrtcperf.audioDestination) {
    webrtcperf.initAudioTimestampWatermarkSender()
  }
  const { audioContext, audioDestination } = webrtcperf
  webrtcperf.log(
    `AudioTimestampWatermark tx overrideGetUserMediaStream`,
    mediaStream.getAudioTracks()[0].id,
    '->',
    audioDestination.stream.getAudioTracks()[0].id,
  )

  // Mix original track with watermark.
  const track = mediaStream.getAudioTracks()[0]
  const trackSource = audioContext.createMediaStreamSource(new MediaStream([track]))
  const gain = audioContext.createGain()
  gain.gain.value = 0.005
  trackSource.connect(gain)
  gain.connect(audioDestination)

  track.addEventListener('ended', () => {
    trackSource.disconnect(gain)
    gain.disconnect(audioDestination)
  })

  const newMediaStream = new MediaStream([
    audioDestination.stream.getAudioTracks()[0].clone(),
    ...mediaStream.getVideoTracks(),
  ])

  return newMediaStream
}

webrtcperf.processingAudioTracks = new Set()

webrtcperf.recognizeAudioTimestampWatermark = track => {
  if (webrtcperf.processingAudioTracks.has(track) || webrtcperf.processingAudioTracks.size > 10 || track.ended) return
  webrtcperf.log(`AudioTimestampWatermark rx ${track.id}`)
  webrtcperf.processingAudioTracks.add(track)
  track.addEventListener('ended', () => {
    webrtcperf.processingAudioTracks.delete(track)
  })

  const ggwave = webrtcperf.ggwave
  const samplesPerFrame = 1024
  const buf = new Float32Array(samplesPerFrame)
  let bufIndex = 0
  let instance = null

  const writableStream = new window.WritableStream(
    {
      async write(/** @type AudioData */ audioFrame) {
        const now = Date.now()
        const { numberOfFrames, sampleRate } = audioFrame
        if (instance === null) {
          const parameters = ggwave.getDefaultParameters()
          parameters.sampleRateInp = sampleRate
          parameters.sampleRateOut = sampleRate
          parameters.samplesPerFrame = samplesPerFrame
          parameters.operatingMode = ggwave.GGWAVE_OPERATING_MODE_RX | ggwave.GGWAVE_OPERATING_MODE_USE_DSS
          instance = ggwave.init(parameters)
          if (instance < 0) {
            webrtcperf.log(`AudioTimestampWatermark rx init failed: ${instance}`)
            return
          }
        }

        try {
          const tmp = new Float32Array(numberOfFrames)
          audioFrame.copyTo(tmp, { planeIndex: 0 })

          const addedFrames = Math.min(numberOfFrames, samplesPerFrame - bufIndex)
          buf.set(tmp.slice(0, addedFrames), bufIndex)
          bufIndex += numberOfFrames

          if (bufIndex < samplesPerFrame) return

          const res = ggwave.decode(instance, convertTypedArray(buf, Int8Array))
          buf.set(tmp.slice(addedFrames), 0)
          bufIndex = numberOfFrames - addedFrames

          if (res && res.length > 0) {
            const data = new TextDecoder('utf-8').decode(res)
            try {
              const ts = parseInt(data)
              const rxFrames = ggwave.rxDurationFrames(instance) + 4
              const rxFramesDuration = (rxFrames * 1000 * samplesPerFrame) / sampleRate
              const delay = now - ts - rxFramesDuration
              webrtcperf.log(
                `AudioTimestampWatermark rx delay: ${delay}ms rxFrames: ${rxFrames} rxFramesDuration: ${rxFramesDuration}ms`,
              )
              if (isFinite(delay) && delay > 0 && delay < 30000) {
                webrtcperf.audioEndToEndDelayStats.push(now, delay / 1000)
              }
            } catch (e) {
              webrtcperf.log(`AudioTimestampWatermark rx failed to parse ${data}: ${e.message}`)
            }
          }
        } catch (err) {
          webrtcperf.log(`AudioTimestampWatermark error: ${err.message}`)
        } finally {
          audioFrame.close()
        }
      },
      close() {
        webrtcperf.processingAudioTracks.delete(track)
        if (instance) ggwave.free(instance)
      },
      abort(err) {
        webrtcperf.log('AudioTimestampWatermark error:', err)
        webrtcperf.processingAudioTracks.delete(track)
      },
    },
    new CountQueuingStrategy({ highWaterMark: 100 }),
  )
  const trackProcessor = new window.MediaStreamTrackProcessor({ track })
  trackProcessor.readable.pipeTo(writableStream).catch(err => {
    webrtcperf.log(`recognizeAudioTimestampWatermark pipeTo error: ${err.message}`)
  })
}

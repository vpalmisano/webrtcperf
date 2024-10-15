/* global webrtcperf, log, ggwave_factory, MeasuredStats */

/**
 * Audio end-to-end delay stats.
 * @type MeasuredStats
 */
webrtcperf.audioEndToEndDelayStats = new MeasuredStats({ ttl: 15 })

webrtcperf.audioStartFrameDelayStats = new webrtcperf.MeasuredStats({ ttl: 60 })

webrtcperf.audioStartFrameTime = 0

/**
 * It sets the start frame time used for calculating the startFrameDelay metric.
 * @param {number} value The start frame time in seconds.
 */
window.setAudioStartFrameTime = value => {
  webrtcperf.audioStartFrameTime = value
}

window.collectAudioEndToEndStats = () => {
  return {
    delay: webrtcperf.audioEndToEndDelayStats.mean(),
    startFrameDelay:
      webrtcperf.videoStartFrameDelayStats.size &&
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

let ggwave = null

if (webrtcperf.enabledForSession(window.PARAMS?.timestampWatermarkAudio)) {
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      ggwave = await ggwave_factory()
      if (!window.PARAMS?.timestampWatermarkAudioDebug) ggwave.disableLog()
    } catch (e) {
      log(`ggwave error: ${e}`)
    }
  })
}

/** @type AudioContext */
let audioContext = null
/** @type MediaStreamAudioDestinationNode */
let audioDestination = null

const SEND_PERIOD = 5000

function initAudioTimestampWatermarkSender() {
  if (audioContext) return
  log(`initAudioTimestampWatermarkSender with interval ${SEND_PERIOD}ms`)

  const AudioContext = window.AudioContext || window.webkitAudioContext
  audioContext = new AudioContext({
    latencyHint: 'interactive',
    sampleRate: 48000,
  })
  audioDestination = audioContext.createMediaStreamDestination()
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
    source.connect(audioDestination)
    source.start()
  }, SEND_PERIOD)
}

window.applyAudioTimestampWatermark = mediaStream => {
  if (mediaStream.getAudioTracks().length === 0) {
    return mediaStream
  }
  if (!audioDestination) {
    initAudioTimestampWatermarkSender()
  }
  log(
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

let processingAudioTracks = 0

window.recognizeAudioTimestampWatermark = track => {
  if (processingAudioTracks > 4) {
    return
  }
  processingAudioTracks += 1

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
            log(`AudioTimestampWatermark rx init failed: ${instance}`)
            return
          }
          processingAudioTracks += 1
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
              log(
                `AudioTimestampWatermark rx delay: ${delay}ms rxFrames: ${rxFrames} rxFramesDuration: ${rxFramesDuration}ms`,
              )
              if (isFinite(delay) && delay > 0 && delay < 30000) {
                webrtcperf.audioEndToEndDelayStats.push(now, delay / 1000)
              }
            } catch (e) {
              log(`AudioTimestampWatermark rx failed to parse ${data}: ${e.message}`)
            }
          }
        } catch (err) {
          log(`AudioTimestampWatermark error: ${err.message}`)
        } finally {
          audioFrame.close()
        }
      },
      close() {
        processingAudioTracks -= 1
        if (instance) ggwave.free(instance)
      },
      abort(err) {
        log('AudioTimestampWatermark error:', err)
      },
    },
    new CountQueuingStrategy({ highWaterMark: 100 }),
  )
  const trackProcessor = new window.MediaStreamTrackProcessor({ track })
  trackProcessor.readable.pipeTo(writableStream).catch(err => {
    log(`recognizeAudioTimestampWatermark pipeTo error: ${err.message}`)
  })
}

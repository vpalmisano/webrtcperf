/* global log, MeasuredStats, wsClient */

const saveStreams = !!window.PARAMS?.saveStreams

/**
 * Video end-to-end delay stats.
 * @type MeasuredStats
 */
const videoEndToEndDelayStats = (window.videoEndToEndDelayStats =
  new MeasuredStats(60))

/**
 * Video end-to-end network delay stats.
 * @type MeasuredStats
 */
const videoEndToEndNetworkDelayStats = new MeasuredStats(60)

window.collectVideoEndToEndDelayStats = () => {
  return {
    videoEndToEndDelay: videoEndToEndDelayStats.mean(),
    videoEndToEndNetworkDelay: videoEndToEndNetworkDelayStats.mean(),
  }
}

// eslint-disable-next-line no-unused-vars
function dumpFrame(encodedFrame, direction, offset = 0, end = 32) {
  const data = new Uint8Array(encodedFrame.data)
  let bytes = ''
  for (let j = offset; j < data.length && j < end; j++) {
    const value = data[j]
    if (value !== undefined) {
      bytes += (value < 16 ? '0' : '') + value.toString(16) + ' '
    }
  }
  console.log(
    direction,
    'bytes=' + bytes.trim(),
    'len=' + encodedFrame.data.byteLength,
    'type=' + (encodedFrame.type || 'audio'),
    'ts=' + encodedFrame.timestamp,
    'ssrc=' + encodedFrame.getMetadata().synchronizationSource,
    'pt=' + (encodedFrame.getMetadata().payloadType || '(unknown)'),
  )
}

function stringToBinary(str) {
  return str
    .split('')
    .reduce((prev, cur, index) => prev + (cur.charCodeAt() << (8 * index)), 0)
}

// IVF writer
async function streamWriter(
  filename,
  width,
  height,
  frameRate,
  sender = false,
) {
  const ws = await wsClient(
    `ws${window.SERVER_USE_HTTPS ? 's' : ''}://localhost:${
      window.SERVER_PORT
    }/?auth=${window.SERVER_SECRET}&action=write-stream&filename=${filename}`,
  )

  const writeHeader = () => {
    const data = new ArrayBuffer(32)
    const view = new DataView(data)
    view.setUint32(0, stringToBinary('DKIF'), true)
    view.setUint16(4, 0, true) // version
    view.setUint16(6, 32, true) // header size
    view.setUint32(8, stringToBinary('VP80'), true) // fourcc
    view.setUint16(12, width, true) // width
    view.setUint16(14, height, true) // header
    view.setUint32(16, frameRate, true) // framerate denominator
    view.setUint32(20, 1, true) // framerate numerator
    view.setUint32(24, 0, true) // frame count
    view.setUint32(28, 0, true) // unused
    ws.send(data)
  }

  let gotKeyframe = false
  /* let startTimestamp = 0
  let startClockTime = 0 */

  return {
    write(encodedFrame, pts) {
      const frameData = encodedFrame.data
      const type = encodedFrame.type
      const metadata = encodedFrame.getMetadata()
      if (!gotKeyframe) {
        if (type === 'key') {
          gotKeyframe = true
          /* startTimestamp = metadata.timestamp
          startClockTime = Number(clockTime) * (90000 / 1000) */
          writeHeader(metadata.width, metadata.height)
        } else {
          return false
        }
      }
      if (sender && (metadata.width !== width || metadata.height !== height)) {
        return false
      }
      /* let pts = Math.round((frameRate * Number(clockTime)) / 1000)
      if (pts === prevPts) {
        pts++
      }
      prevPts = pts */

      /* let pts = Math.round(
        (frameRate *
          (encodedFrame.timestamp - startTimestamp + startClockTime)) /
          90000,
      ) */

      /* log(
        'write',
        filename,
        frameData.byteLength,
        type,
        (encodedFrame.timestamp - startTimestamp) / 90000,
      ) */

      const data = new ArrayBuffer(12 + frameData.byteLength)
      const view = new DataView(data)
      view.setUint32(0, frameData.byteLength, true)
      view.setBigUint64(4, BigInt(pts), true)
      new Uint8Array(data).set(new Uint8Array(frameData), 12)
      ws.send(data)
      return true
    },
    close() {
      ws.close()
    },
  }
}

async function handleInsertableStreams(data, debug = false) {
  const { operation, track, readable, writable } = data
  // console.log(`onmessage ${operation} ${track.kind}`)
  if (track.kind !== 'video') {
    readable.pipeTo(writable)
    return
  }
  let transformStream = null
  const insertableStreamsHeader = stringToBinary('WP00')
  const headerSize = 16
  let writer = null

  if (operation === 'encode') {
    let pts = 0
    const { width, height, frameRate } = track.getSettings()
    if (saveStreams) {
      writer = await streamWriter(
        `${window.WEBRTC_STRESS_TEST_INDEX}_${operation}_${track.id}.ivf`,
        width,
        height,
        frameRate,
        true,
      )
    }

    transformStream = new window.TransformStream({
      transform: (encodedFrame, controller) => {
        if (writer) {
          try {
            if (writer.write(encodedFrame, pts)) pts++
          } catch (err) {
            log('writer error', err)
          }
        }

        const newData = new ArrayBuffer(
          encodedFrame.data.byteLength + headerSize,
        )
        const newView = new DataView(newData)
        new Uint8Array(newData).set(new Uint8Array(encodedFrame.data))
        let pos = encodedFrame.data.byteLength
        newView.setUint32(pos, insertableStreamsHeader, true)
        newView.setBigUint64(pos + 4, BigInt(Date.now()), true)
        newView.setUint32(pos + 12, pts, true)
        encodedFrame.data = newData
        /* if (debug) {
          dumpFrame(
            encodedFrame,
            'e',
            encodedFrame.data.byteLength - headerSize,
            encodedFrame.data.byteLength,
          )
        } */
        controller.enqueue(encodedFrame)
      },
    })
  } else if (operation === 'decode') {
    if (saveStreams) {
      writer = await streamWriter(
        `${window.WEBRTC_STRESS_TEST_INDEX}_${operation}_${track.id}.ivf`,
        window.VIDEO_WIDTH,
        window.VIDEO_HEIGHT,
        window.VIDEO_FRAMERATE,
      )
    }

    transformStream = new window.TransformStream({
      transform: (encodedFrame, controller) => {
        /* if (debug) {
          dumpFrame(
            encodedFrame,
            'd',
            encodedFrame.data.byteLength - headerSize,
            encodedFrame.data.byteLength,
          )
        } */
        const view = new DataView(encodedFrame.data)
        let pos = encodedFrame.data.byteLength - headerSize
        const header = view.getUint32(pos, true)
        if (header === insertableStreamsHeader) {
          const timestamp = Date.now()
          const ts = Number(view.getBigUint64(pos + 4, true))
          const pts = view.getUint32(pos + 12, true)
          if (
            !transformStream._lastTimestamp ||
            timestamp - transformStream._lastTimestamp > 1000
          ) {
            const delay = timestamp - ts
            videoEndToEndNetworkDelayStats.push(timestamp, delay / 1000)
            transformStream._lastTimestamp = timestamp
            if (debug) {
              log(`t: ${timestamp} delay: ${delay}ms`)
            }
          }
          const newData = encodedFrame.data.slice(
            0,
            encodedFrame.data.byteLength - headerSize,
          )
          encodedFrame.data = newData

          try {
            writer?.write(encodedFrame, pts)
          } catch (err) {
            log('writer error', err)
          }
        }
        controller.enqueue(encodedFrame)
      },
    })
  }
  readable.pipeThrough(transformStream).pipeTo(writable)
}

// Register worker for insertable streams measurement.
/*
let timestampInsertableStreamsWorker = null

if (
  timestampInsertableStreams &&
  !!window.PARAMS?.timestampInsertableStreamsUseWorker
) {
  const workerFunction = () => {
    // eslint-disable-next-line no-unused-vars
    function dumpFrame(encodedFrame, direction, offset = 0, end = 32) {
      const data = new Uint8Array(encodedFrame.data)
      let bytes = ''
      for (let j = offset; j < data.length && j < end; j++) {
        const value = data[j]
        if (value !== undefined) {
          bytes += (value < 16 ? '0' : '') + value.toString(16) + ' '
        }
      }
      console.log(
        direction,
        'len=' + encodedFrame.data.byteLength,
        'type=' + (encodedFrame.type || 'audio'),
        'ts=' + encodedFrame.timestamp,
        'ssrc=' + encodedFrame.getMetadata().synchronizationSource,
        'pt=' + (encodedFrame.getMetadata().payloadType || '(unknown)'),
        'bytes=' + bytes.trim(),
      )
    }
    onmessage = ({ data }) => {
      const { operation, kind, readable, writable } = data
      // console.log(`onmessage ${operation} ${kind}`)
      if (kind !== 'video') {
        readable.pipeTo(writable)
        return
      }
      let transformStream = null
      const insertableStreamsHeader = ['w', 's', 't', 'h'].reduce(
        (prev, cur, index) => prev + (cur.charCodeAt() << (8 * index)),
        0,
      )
      if (operation === 'encode') {
        transformStream = new window.TransformStream({
          transform: (encodedFrame, controller) => {
            const newData = new ArrayBuffer(encodedFrame.data.byteLength + 12)
            const newView = new DataView(newData)
            new Uint8Array(newData).set(new Uint8Array(encodedFrame.data))
            newView.setUint32(
              encodedFrame.data.byteLength,
              insertableStreamsHeader,
              false,
            )
            newView.setBigUint64(
              encodedFrame.data.byteLength + 4,
              BigInt(Date.now()),
              false,
            )
            encodedFrame.data = newData
            // dumpFrame(encodedFrame, 'e', encodedFrame.data.byteLength - 8, encodedFrame.data.byteLength)
            controller.enqueue(encodedFrame)
          },
        })
      } else if (operation === 'decode') {
        transformStream = new window.TransformStream({
          transform: (encodedFrame, controller) => {
            // dumpFrame(encodedFrame, 'd', encodedFrame.data.byteLength - 8, encodedFrame.data.byteLength)
            const view = new DataView(encodedFrame.data)
            const header = view.getUint32(
              encodedFrame.data.byteLength - 12,
              false,
            )
            if (header === insertableStreamsHeader) {
              const timestamp = Date.now()
              if (
                !transformStream._lastTimestamp ||
                timestamp - transformStream._lastTimestamp > 1000
              ) {
                const t = view.getBigUint64(
                  encodedFrame.data.byteLength - 8,
                  false,
                )
                const delay = parseInt(BigInt(timestamp) - t)
                postMessage({ timestamp, delay })
                transformStream._lastTimestamp = timestamp
              }
              const newData = encodedFrame.data.slice(
                0,
                encodedFrame.data.byteLength - 12,
              )
              encodedFrame.data = newData
            }
            controller.enqueue(encodedFrame)
          },
        })
      }
      readable.pipeThrough(transformStream).pipeTo(writable)
    }
  }
  try {
    const functionBody = workerFunction
      .toString()
      .replace(/^[^{]*{\s\*\/, '')
      .replace(/\s*}[^}]*$/, '')
    timestampInsertableStreamsWorker = new Worker(
      URL.createObjectURL(
        new Blob([functionBody], { type: 'text/javascript' }),
      ),
      { name: 'WstTimestampInsertableStreamsWorker' },
    )
    timestampInsertableStreamsWorker.onmessage = event => {
      const { timestamp, delay } = event.data
      // log(`t: ${timestamp} delay: ${delay}ms`)
      videoEndToEndNetworkDelayStats.push(timestamp, delay / 1000)
    }
  } catch (err) {
    log(`timestampInsertableStreamsWorker error: ${err.message}`)
  }
} */

/**
 * handleTransceiverForInsertableStreams
 * @param {string} id
 * @param {RTCRtpTransceiver} transceiver
 */
// eslint-disable-next-line no-unused-vars
const handleTransceiverForInsertableStreams = (id, transceiver) => {
  log(
    `RTCPeerConnection-${id} handleTransceiverForInsertableStreams ${transceiver.direction}`,
  )
  if (
    ['sendonly', 'sendrecv'].includes(transceiver.direction) &&
    transceiver.sender &&
    !transceiver.sender._encodedStreams &&
    transceiver.sender.track
  ) {
    log(
      `RTCPeerConnection-${id} handleTransceiver sender transformStream ${transceiver.sender.track.kind}`,
    )
    transceiver.sender._encodedStreams =
      transceiver.sender.createEncodedStreams()
    const { readable, writable } = transceiver.sender._encodedStreams
    const data = {
      operation: 'encode',
      track: transceiver.sender.track,
      readable,
      writable,
    }
    /* if (timestampInsertableStreamsWorker) {
      timestampInsertableStreamsWorker.postMessage(data, [readable, writable])
    } else { */
    handleInsertableStreams(data)
    /* } */
  }
  if (
    ['recvonly', 'sendrecv'].includes(transceiver.direction) &&
    transceiver.receiver &&
    !transceiver.receiver._encodedStreams &&
    transceiver.receiver.track
  ) {
    log(
      `RTCPeerConnection-${id} handleTransceiver receiver transformStream ${transceiver.receiver.track.kind}`,
    )
    transceiver.receiver._encodedStreams =
      transceiver.receiver.createEncodedStreams()
    const { readable, writable } = transceiver.receiver._encodedStreams
    const data = {
      operation: 'decode',
      track: transceiver.receiver.track,
      readable,
      writable,
    }
    /* if (timestampInsertableStreamsWorker) {
      timestampInsertableStreamsWorker.postMessage(data, [readable, writable])
    } else { */
    handleInsertableStreams(data)
    /* } */
  }
}

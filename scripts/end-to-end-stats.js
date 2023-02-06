/* global log, MeasuredStats */

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

const timestampInsertableStreams = !!window.PARAMS?.timestampInsertableStreams
let timestampInsertableStreamsWorker = null

function handleInsertableStreams(data) {
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
        /* dumpFrame(encodedFrame, 'e', encodedFrame.data.byteLength - 8, encodedFrame.data.byteLength) */
        controller.enqueue(encodedFrame)
      },
    })
  } else if (operation === 'decode') {
    transformStream = new window.TransformStream({
      transform: (encodedFrame, controller) => {
        /* dumpFrame(encodedFrame, 'd', encodedFrame.data.byteLength - 8, encodedFrame.data.byteLength) */
        const view = new DataView(encodedFrame.data)
        const header = view.getUint32(encodedFrame.data.byteLength - 12, false)
        if (header === insertableStreamsHeader) {
          const timestamp = Date.now()
          if (
            !transformStream._lastTimestamp ||
            timestamp - transformStream._lastTimestamp > 1000
          ) {
            const t = view.getBigUint64(encodedFrame.data.byteLength - 8, false)
            const delay = parseInt(BigInt(timestamp) - t)
            videoEndToEndNetworkDelayStats.push(timestamp, delay / 1000)
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

// Register worker for insertable streams measurement.
if (
  timestampInsertableStreams &&
  !!window.PARAMS?.timestampInsertableStreamsUseWorker
) {
  const workerFunction = () => {
    /* function dumpFrame(encodedFrame, direction, offset = 0, end = 32) {
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
    } */
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
            /* dumpFrame(encodedFrame, 'e', encodedFrame.data.byteLength - 8, encodedFrame.data.byteLength) */
            controller.enqueue(encodedFrame)
          },
        })
      } else if (operation === 'decode') {
        transformStream = new window.TransformStream({
          transform: (encodedFrame, controller) => {
            /* dumpFrame(encodedFrame, 'd', encodedFrame.data.byteLength - 8, encodedFrame.data.byteLength) */
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
      .replace(/^[^{]*{\s*/, '')
      .replace(/\s*}[^}]*$/, '')
    timestampInsertableStreamsWorker = new Worker(
      URL.createObjectURL(
        new Blob([functionBody], { type: 'text/javascript' }),
      ),
      { name: 'WstTimestampInsertableStreamsWorker' },
    )
    timestampInsertableStreamsWorker.onmessage = event => {
      const { timestamp, delay } = event.data
      //log(`t: ${t} delay: ${delay}ms`)
      videoEndToEndNetworkDelayStats.push(timestamp, delay / 1000)
    }
  } catch (err) {
    log(`timestampInsertableStreamsWorker error: ${err.message}`)
  }
}

// eslint-disable-next-line no-unused-vars
const handleTransceiverForInsertableStreams = (id, transceiver) => {
  // log(`RTCPeerConnection-${id} handleTransceiver ${transceiver.direction}`)
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
      kind: transceiver.sender.track.kind,
      readable,
      writable,
    }
    if (timestampInsertableStreamsWorker) {
      timestampInsertableStreamsWorker.postMessage(data, [readable, writable])
    } else {
      // Fallback to non-worker implementation.
      handleInsertableStreams(data)
    }
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
      kind: transceiver.receiver.track.kind,
      readable,
      writable,
    }
    if (timestampInsertableStreamsWorker) {
      timestampInsertableStreamsWorker.postMessage(data, [readable, writable])
    } else {
      // Fallback to non-worker implementation.
      handleInsertableStreams(data)
    }
  }
}

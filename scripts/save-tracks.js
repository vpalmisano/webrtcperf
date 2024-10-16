/* global webrtcperf, log, getParticipantNameForSave, createWorker */

const saveFileWorkerFn = () => {
  const log = (...args) => {
    console.log.apply(null, ['[webrtcperf-savefileworker]', ...args])
  }

  const wsClient = async url => {
    const client = new WebSocket(url, [])
    await new Promise((resolve, reject) => {
      if (client.readyState === WebSocket.OPEN) {
        resolve()
      } else if (client.readyState === WebSocket.CLOSED) {
        reject(new Error('WebSocket closed'))
      }
      client.addEventListener('open', resolve, { once: true })
      client.addEventListener('error', reject, { once: true })
    })
    return client
  }

  const stringToBinary = str => {
    return str.split('').reduce((prev, cur, index) => prev + (cur.charCodeAt() << (8 * index)), 0)
  }

  const writeIvfHeader = (ws, width, height, frameRateDenominator, frameRateNumerator, fourcc) => {
    const data = new ArrayBuffer(32)
    const view = new DataView(data)
    view.setUint32(0, stringToBinary('DKIF'), true)
    view.setUint16(4, 0, true) // version
    view.setUint16(6, 32, true) // header size
    view.setUint32(8, stringToBinary(fourcc), true)
    view.setUint16(12, width, true)
    view.setUint16(14, height, true)
    view.setUint32(16, frameRateDenominator, true)
    view.setUint32(20, frameRateNumerator, true)
    view.setUint32(24, 0, true) // frame count
    view.setUint32(28, 0, true) // unused
    ws.send(data)
  }

  const websocketControllers = new Map()

  onmessage = async ({ data }) => {
    const { action, id, url, readable, kind, quality, x, y, width, height, frameRate } = data
    const controller = new AbortController()
    log(`action=${action} id=${id} kind=${kind} url=${url}`)
    if (action === 'stop') {
      const controller = websocketControllers.get(id)
      controller?.abort('done')
      return
    }

    const ws = await wsClient(url)
    websocketControllers.set(id, controller)
    if (kind === 'video') {
      const header = new ArrayBuffer(12)
      const view = new DataView(header)
      let headerWritten = false
      let startTimestamp = -1
      let lastPts = -1
      const writableStream = new WritableStream(
        {
          async write(/** @type VideoFrame */ frame) {
            const { timestamp, codedWidth, codedHeight } = frame
            if (startTimestamp < 0) {
              startTimestamp = timestamp
            }
            const pts = Math.floor((frameRate * (timestamp - startTimestamp)) / 1000000)
            if (!codedWidth || !codedHeight || ws.readyState !== WebSocket.OPEN || pts <= lastPts) {
              frame.close()
              return
            }
            const bitmap = await createImageBitmap(
              frame,
              x,
              y,
              Math.min(width, codedWidth),
              Math.min(height, codedHeight),
            )
            frame.close()
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
            const ctx = canvas.getContext('bitmaprenderer')
            ctx.transferFromImageBitmap(bitmap)
            bitmap.close()
            try {
              const blob = await canvas.convertToBlob({
                type: 'image/jpeg',
                quality,
              })
              const data = await blob.arrayBuffer()
              if (!headerWritten) {
                headerWritten = true
                log(`saveTrack ${url} writeIvfHeader ${canvas.width}x${canvas.height}@${frameRate}`)
                writeIvfHeader(ws, canvas.width, canvas.height, frameRate, 1, 'MJPG')
              }
              view.setUint32(0, data.byteLength, true)
              view.setBigUint64(4, BigInt(pts), true)
              const buf = new Uint8Array(header.byteLength + data.byteLength)
              buf.set(new Uint8Array(header), 0)
              buf.set(new Uint8Array(data), header.byteLength)
              ws.send(buf)
              lastPts = pts
            } catch (err) {
              log(`saveMediaTrack ${url} error=${err.message}`)
            }
          },
          close() {
            log(`saveTrack ${url} close`)
            ws.close()
            websocketControllers.delete(id)
            postMessage({ name: 'close', id, kind })
          },
          abort(reason) {
            log(`saveTrack ${url} abort reason:`, reason)
            ws.close()
            websocketControllers.delete(id)
            postMessage({ name: 'close', reason, id, kind })
          },
        },
        new CountQueuingStrategy({ highWaterMark: frameRate * 10 }),
      )
      readable.pipeTo(writableStream, { signal: controller.signal }).catch(err => {
        log(`saveMediaTrack ${url} error=${err.message}`)
      })
    } else {
      const writableStream = new WritableStream(
        {
          async write(/** @type AudioData */ frame) {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                const { numberOfFrames } = frame
                const data = new Float32Array(numberOfFrames)
                frame.copyTo(data, { planeIndex: 0 })
                ws.send(data)
              } catch (err) {
                log(`saveMediaTrack ${url} error=${err.message}`)
              }
            }
            frame.close()
          },
          close() {
            log(`saveTrack ${url} close`)
            ws.close()
            websocketControllers.delete(id)
            postMessage({ name: 'close', id, kind })
          },
          abort(reason) {
            log(`saveTrack ${url} abort reason:`, reason)
            ws.close()
            websocketControllers.delete(id)
            postMessage({ name: 'close', reason, id, kind })
          },
        },
        new CountQueuingStrategy({ highWaterMark: 100 }),
      )
      readable.pipeTo(writableStream, { signal: controller.signal }).catch(err => {
        log(`saveMediaTrack ${url} error=${err.message}`)
      })
    }
  }
}

webrtcperf.saveFileWorker = null
webrtcperf.savingTracks = {
  audio: new Set(),
  video: new Set(),
}

const getSaveFileWorker = () => {
  if (!webrtcperf.saveFileWorker) {
    webrtcperf.saveFileWorker = createWorker(saveFileWorkerFn)
    webrtcperf.saveFileWorker.onmessage = event => {
      const { name, reason, kind, id } = event.data
      log(`saveFileWorker event: ${name} kind: ${kind} id: ${id} reason: ${reason}`)
      webrtcperf.savingTracks[kind].delete(id)
    }
  }
  return webrtcperf.saveFileWorker
}

/**
 * It saves the media track to a file.
 * @param {MediaStreamTrack} track The media track to save.
 * @param {'send'|'recv'} sendrecv If 'send', it is a local track. If 'recv', it is a remote track.
 * @param {Number} enableStart If greater than 0, the track is enabled after this time in milliseconds.
 * @param {Number} enableEnd If greater than 0, the track is disabled after this time in milliseconds.
 * @param {Number} quality The MJPEG video quality.
 * @param {Number} width The video width.
 * @param {Number} height The video height.
 * @param {Number} frameRate The video frame rate.
 */
window.saveMediaTrack = async (
  track,
  sendrecv,
  enableStart = 0,
  enableEnd = 0,
  quality = 0.7,
  x = 0,
  y = 0,
  width = window.VIDEO_WIDTH,
  height = window.VIDEO_HEIGHT,
  frameRate = window.VIDEO_FRAMERATE,
) => {
  const { id, kind } = track
  if (webrtcperf.savingTracks[kind].has(id)) {
    return
  }
  const { readable } = new window.MediaStreamTrackProcessor({ track })
  webrtcperf.savingTracks[kind].add(id)

  if (enableStart > 0) {
    track.enabled = false
    setTimeout(() => {
      track.enabled = true
    }, enableStart)
  }
  if (enableEnd > 0) {
    setTimeout(() => {
      track.enabled = false
    }, enableEnd)
  }

  const filename = `${getParticipantNameForSave(sendrecv, track)}${kind === 'audio' ? '.f32le.raw' : '.ivf.raw'}`
  const url = `ws${window.SERVER_USE_HTTPS ? 's' : ''}://localhost:${
    window.SERVER_PORT
  }/?auth=${window.SERVER_SECRET}&action=write-stream&filename=${filename}`

  log(`saveMediaTrack ${filename}`)
  getSaveFileWorker().postMessage(
    {
      action: 'start',
      id,
      url,
      readable,
      kind,
      quality,
      x,
      y,
      width,
      height,
      frameRate,
    },
    [readable],
  )
}

window.stopSaveMediaTrack = async track => {
  const { id, kind } = track
  if (!webrtcperf.savingTracks[kind].has(id)) {
    return
  }
  log(`stopSaveMediaTrack ${id}`)
  getSaveFileWorker().postMessage({
    action: 'stop',
    id,
    kind,
  })
}

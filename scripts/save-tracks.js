/* global log, getParticipantNameForSave, createWorker */

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
    return str
      .split('')
      .reduce((prev, cur, index) => prev + (cur.charCodeAt() << (8 * index)), 0)
  }

  const writeIvfHeader = (ws, width, height, frameRate, fourcc) => {
    const data = new ArrayBuffer(32)
    const view = new DataView(data)
    view.setUint32(0, stringToBinary('DKIF'), true)
    view.setUint16(4, 0, true) // version
    view.setUint16(6, 32, true) // header size
    view.setUint32(8, stringToBinary(fourcc), true) // fourcc
    view.setUint16(12, width, true) // width
    view.setUint16(14, height, true) // header
    view.setUint32(16, frameRate, true) // framerate denominator
    view.setUint32(20, 1, true) // framerate numerator
    view.setUint32(24, 0, true) // frame count
    view.setUint32(28, 0, true) // unused
    ws.send(data)
  }

  const websockets = new Map()

  onmessage = async ({ data }) => {
    const {
      action,
      id,
      url,
      readable,
      kind,
      quality,
      width,
      height,
      frameRate,
    } = data
    log(`action=${action} id=${id} kind=${kind} url=${url}`)
    if (action === 'stop') {
      const writable = websockets.get(id)
      writable?.close()
      return
    }

    const ws = await wsClient(url)
    websockets.set(id, ws)
    if (kind === 'video') {
      writeIvfHeader(ws, width, height, frameRate, 'MJPG')

      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')
      let startTimestamp = -1
      let lastPts = -1
      const writableStream = new WritableStream(
        {
          async write(frame) {
            const { timestamp, codedWidth, codedHeight } = frame
            if (
              !codedWidth ||
              !codedHeight ||
              ws.readyState !== WebSocket.OPEN
            ) {
              frame.close()
              return
            }
            const bitmap = await createImageBitmap(frame)
            try {
              ctx.drawImage(bitmap, 0, 0, width, height)
              const blob = await canvas.convertToBlob({
                type: 'image/jpeg',
                quality,
              })
              const data = await blob.arrayBuffer()
              if (startTimestamp < 0) {
                startTimestamp = timestamp
              }
              const pts = Math.round(
                (frameRate * (timestamp - startTimestamp)) / 1000000,
              )
              if (pts <= lastPts) {
                log(`warning: pts=${pts} <= lastPts=${lastPts}`)
              }
              lastPts = pts
              /* log(
                `writer ${data.byteLength} bytes timestamp=${
                  videoFrame.timestamp / 1000000
                } pts=${pts}`,
              ) */
              const header = new ArrayBuffer(12)
              const view = new DataView(header)
              view.setUint32(0, data.byteLength, true)
              view.setBigUint64(4, BigInt(pts), true)
              ws.send(header)
              ws.send(data)
            } catch (err) {
              log(`saveMediaTrack ${url} error=${err.message}`)
            }
            frame.close()
            bitmap.close()
          },
          close() {
            log(`saveTrack ${url} close`)
            ws.close()
            websockets.delete(id)
            postMessage({ name: 'close', id, kind })
          },
          abort(error) {
            log(`saveTrack ${url} error`, error)
            ws.close()
            websockets.delete(id)
            postMessage({ name: 'close', error, id, kind })
          },
        },
        new CountQueuingStrategy({ highWaterMark: frameRate * 10 }),
      )
      readable.pipeTo(writableStream)
    } else {
      const writableStream = new WritableStream(
        {
          async write(frame) {
            const { numberOfFrames } = frame
            try {
              const data = new Float32Array(numberOfFrames)
              frame.copyTo(data, { planeIndex: 0 })
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(data)
              }
            } catch (err) {
              log(`saveMediaTrack ${url} error=${err.message}`)
            }
            frame.close()
          },
          close() {
            log(`saveTrack ${url} close`)
            ws.close()
            websockets.delete(id)
            postMessage({ name: 'close', id, kind })
          },
          abort(error) {
            log(`saveTrack ${url} error`, error)
            ws.close()
            websockets.delete(id)
            postMessage({ name: 'close', error, id, kind })
          },
        },
        new CountQueuingStrategy({ highWaterMark: 10 }),
      )
      readable.pipeTo(writableStream)
    }
  }
}

let saveFileWorker = null
const savingTracks = {
  audio: new Set(),
  video: new Set(),
}

const getSaveFileWorker = () => {
  if (!saveFileWorker) {
    saveFileWorker = createWorker(saveFileWorkerFn)
    saveFileWorker.onmessage = event => {
      const { name, error, kind, id } = event.data
      log(`saveFileWorker name=${name} kind=${kind} id=${id} error=${error}`)
      savingTracks[kind].delete(id)
    }
  }
  return saveFileWorker
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
  quality = 0.75,
  width = window.VIDEO_WIDTH,
  height = window.VIDEO_HEIGHT,
  frameRate = window.VIDEO_FRAMERATE,
) => {
  const { id, kind } = track
  if (savingTracks[kind].has(id)) {
    return
  }
  const { readable } = new window.MediaStreamTrackProcessor({ track })
  savingTracks[kind].add(id)

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

  const filename = `${getParticipantNameForSave(sendrecv, track)}${
    kind === 'audio' ? '.f32le.raw' : '.ivf.raw'
  }`
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
      width,
      height,
      frameRate,
    },
    [readable],
  )
}

window.stopSaveMediaTrack = async track => {
  const { id, kind } = track
  if (!savingTracks[kind].has(id)) {
    return
  }
  log(`stopSaveMediaTrack ${id}`)
  getSaveFileWorker().postMessage({
    action: 'stop',
    id,
    kind,
  })
}

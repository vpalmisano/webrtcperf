/* global webrtcperf */

const saveFileWorkerFn = () => {
  const debug = (...args) => {
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
    const { action, id, url, readable, kind, x, y, width, height, frameRate } = data
    const controller = new AbortController()
    debug(`action=${action} id=${id} kind=${kind} url=${url}`)
    if (action === 'stop') {
      const controller = websocketControllers.get(id)
      controller?.abort('done')
      return
    }

    const ws = await wsClient(url)
    websocketControllers.set(id, controller)
    if (kind === 'video') {
      let currentWidth = 0
      let currentHeight = 0
      let headerSent = false
      let startTimestamp = -1
      let lastPts = 0
      let lastTimestamp = 0
      const header = new ArrayBuffer(12)
      const view = new DataView(header)

      const encoder = new window.VideoEncoder({
        output: chunk => {
          if (ws.readyState !== WebSocket.OPEN) return
          try {
            const { byteLength, timestamp } = chunk
            if (!headerSent) {
              writeIvfHeader(ws, currentWidth, currentHeight, frameRate, 1, 'VP80')
              headerSent = true
            }
            if (startTimestamp === -1) {
              startTimestamp = timestamp
            }
            let pts = Math.round((frameRate * (timestamp - startTimestamp)) / 1000000)
            if (pts <= lastPts) {
              debug(`skip pts: ${pts} <= ${lastPts} timestamp: ${timestamp} lastTimestamp: ${lastTimestamp}`)
              return
            }
            const data = new ArrayBuffer(byteLength)
            chunk.copyTo(data)
            view.setUint32(0, byteLength, true)
            view.setBigUint64(4, BigInt(pts), true)
            const buf = new Uint8Array(header.byteLength + byteLength)
            buf.set(new Uint8Array(header), 0)
            buf.set(new Uint8Array(data), header.byteLength)
            ws.send(buf)
            lastPts = pts
            lastTimestamp = timestamp
          } catch (err) {
            debug(`saveMediaTrack ${url} error=${err.message}`)
          }
        },
        error: e => debug(`encoder error: ${e.message}`),
      })

      const configureEncoder = (width, height) => {
        debug(`configureEncoder ${width}x${height}@${frameRate}`)
        if (encoder?.state === 'configured') {
          encoder.flush()
          encoder.reset()
        }
        encoder.configure({
          codec: 'vp8',
          width,
          height,
          framerate: frameRate,
          bitrate: 20_000_000,
          bitrateMode: 'variable',
          latencyMode: 'quality',
        })
        currentWidth = width
        currentHeight = height
      }

      const writableStream = new WritableStream(
        {
          async write(/** @type VideoFrame */ frame) {
            const { codedWidth, codedHeight, timestamp, duration } = frame
            try {
              //log(`encode ${timestamp} ${duration} ${codedWidth}x${codedHeight} ${frame.format}`)
              if (!codedWidth || !codedHeight) return
              if (x || y || (width && width !== codedWidth) || (height && height !== codedHeight)) {
                const w = Math.min(width, codedWidth)
                const h = Math.min(height, codedHeight)
                const rect = { x, y, width: w, height: h }
                const buffer = new Uint8Array(frame.allocationSize({ rect, format: 'RGBA' }))
                await frame.copyTo(buffer, { rect, format: 'RGBA' })
                frame.close()
                frame = new window.VideoFrame(buffer, {
                  timestamp,
                  duration,
                  codedWidth: w,
                  codedHeight: h,
                  format: 'RGBA',
                })
              }
              if (currentWidth !== frame.codedWidth || currentHeight !== frame.codedHeight) {
                configureEncoder(frame.codedWidth, frame.codedHeight)
              }
              encoder.encode(frame, { keyFrame: true })
            } catch (err) {
              debug(`saveMediaTrack ${url} error=${err.message}`)
            } finally {
              frame.close()
            }
          },
          close() {
            debug(`saveTrack ${url} close`)
            if (encoder?.state === 'configured') {
              encoder.flush()
            }
            encoder?.close()
            ws.close()
            websocketControllers.delete(id)
            postMessage({ name: 'close', id, kind })
          },
          abort(reason) {
            debug(`saveTrack ${url} abort reason:`, reason)
            if (encoder?.state === 'configured') {
              encoder.flush()
            }
            encoder?.close()
            ws.close()
            websocketControllers.delete(id)
            postMessage({ name: 'close', reason, id, kind })
          },
        },
        new CountQueuingStrategy({ highWaterMark: frameRate * 10 }),
      )
      readable.pipeTo(writableStream, { signal: controller.signal }).catch(err => {
        debug(`saveMediaTrack ${url} error=${err.message}`)
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
                debug(`saveMediaTrack ${url} error=${err.message}`)
              }
            }
            frame.close()
          },
          close() {
            debug(`saveTrack ${url} close`)
            ws.close()
            websocketControllers.delete(id)
            postMessage({ name: 'close', id, kind })
          },
          abort(reason) {
            debug(`saveTrack ${url} abort reason:`, reason)
            ws.close()
            websocketControllers.delete(id)
            postMessage({ name: 'close', reason, id, kind })
          },
        },
        new CountQueuingStrategy({ highWaterMark: 100 }),
      )
      readable.pipeTo(writableStream, { signal: controller.signal }).catch(err => {
        debug(`saveMediaTrack ${url} error=${err.message}`)
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
    webrtcperf.saveFileWorker = webrtcperf.createWorker(saveFileWorkerFn)
    webrtcperf.saveFileWorker.onmessage = event => {
      const { name, reason, kind, id } = event.data
      webrtcperf.log(`saveFileWorker event: ${name} kind: ${kind} id: ${id} reason: ${reason}`)
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
 * @param {Number} x The video crop x.
 * @param {Number} y The video crop y.
 * @param {Number} width The video crop width.
 * @param {Number} height The video crop height.
 * @param {Number} frameRate The video frame rate.
 */
webrtcperf.saveMediaTrack = async (
  track,
  sendrecv,
  enableStart = 0,
  enableEnd = 0,
  x = 0,
  y = 0,
  width = 0,
  height = 0,
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

  const filename = `${webrtcperf.getParticipantNameForSave(sendrecv, track)}${kind === 'audio' ? '.f32le.raw' : '.ivf.raw'}`
  const url = `ws${window.SERVER_USE_HTTPS ? 's' : ''}://localhost:${
    window.SERVER_PORT
  }/?auth=${window.SERVER_SECRET}&action=write-stream&filename=${filename}`

  webrtcperf.log(`saveMediaTrack ${filename}`)
  getSaveFileWorker().postMessage(
    {
      action: 'start',
      id,
      url,
      readable,
      kind,
      x,
      y,
      width,
      height,
      frameRate,
    },
    [readable],
  )
}

webrtcperf.stopSaveMediaTrack = async track => {
  const { id, kind } = track
  if (!webrtcperf.savingTracks[kind].has(id)) {
    return
  }
  webrtcperf.log(`stopSaveMediaTrack ${id}`)
  getSaveFileWorker().postMessage({
    action: 'stop',
    id,
    kind,
  })
}

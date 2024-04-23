/* global log, streamWriter, getParticipantNameForSave */

const savingVideoTracks = new Set()

/**
 * Save the video track to disk.
 * @param {MediaStreamTrack} track
 */
window.saveVideoTrack = async (
  track,
  sendrecv,
  enableDelay = 0,
  quality = 0.75,
) => {
  if (savingVideoTracks.has(track.id)) {
    return
  }
  savingVideoTracks.add(track.id)
  if (enableDelay > 0) {
    track.enabled = false
    setTimeout(() => {
      track.enabled = true
    }, Math.max(enableDelay - window.webrtcPerfElapsedTime(), 0))
  }

  const width = window.VIDEO_WIDTH
  const height = window.VIDEO_HEIGHT
  const frameRate = window.VIDEO_FRAMERATE
  const fname = `${getParticipantNameForSave(sendrecv, track)}.ivf.raw`
  log(`saveVideoTrack ${fname} ${width}x${height} ${frameRate}fps`)
  const writer = await streamWriter(fname, width, height, frameRate, 'MJPG')

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  let startTimestamp = -1
  const writableStream = new window.WritableStream(
    {
      async write(videoFrame) {
        const { timestamp, codedWidth, codedHeight } = videoFrame
        if (!codedWidth || !codedHeight) {
          return
        }
        const bitmap = await createImageBitmap(videoFrame)
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
          /* log(
              `writer ${data.byteLength} bytes timestamp=${
                videoFrame.timestamp / 1000000
              } pts=${pts}`,
            ) */
          writer.write(data, pts)
        } catch (err) {
          log(`saveVideoTrack error: ${err.message}`)
        }
        videoFrame.close()
        bitmap.close()
      },
      close() {
        log(`saveVideoTrack ${fname} close`)
        writer.close()
        savingVideoTracks.delete(track.id)
      },
      abort(err) {
        log(`saveVideoTrack ${fname} error`, err)
        savingVideoTracks.delete(track.id)
      },
    },
    new CountQueuingStrategy({ highWaterMark: frameRate * 5 }),
  )

  const trackProcessor = new window.MediaStreamTrackProcessor({ track })
  trackProcessor.readable.pipeTo(writableStream)
}

const savingAudioTracks = new Set()

/**
 * Save the audio track to disk.
 * @param {MediaStreamTrack} audioTrack
 */
window.saveAudioTrack = async (track, sendrecv, enableDelay = 0) => {
  if (savingAudioTracks.has(track.id)) {
    return
  }
  savingAudioTracks.add(track.id)
  if (enableDelay > 0) {
    track.enabled = false
    setTimeout(() => {
      track.enabled = true
    }, Math.max(enableDelay - window.webrtcPerfElapsedTime(), 0))
  }

  const fname = `${getParticipantNameForSave(sendrecv, track)}.f32le.raw`
  log(`saveAudioTrack ${fname}`)
  const writer = await streamWriter(fname)

  const writableStream = new window.WritableStream(
    {
      async write(frame) {
        const { numberOfFrames } = frame
        try {
          const data = new Float32Array(numberOfFrames)
          frame.copyTo(data, { planeIndex: 0 })
          writer.write(data)
        } catch (err) {
          log(`saveAudioTrack error: ${err.message}`)
        }
        frame.close()
      },
      close() {
        log(`saveAudioTrack ${fname} close`)
        writer.close()
        savingAudioTracks.delete(track.id)
      },
      abort(err) {
        log(`saveAudioTrack ${fname} error`, err)
        savingAudioTracks.delete(track.id)
      },
    },
    new CountQueuingStrategy({ highWaterMark: 100 }),
  )

  const trackProcessor = new window.MediaStreamTrackProcessor({ track })
  trackProcessor.readable.pipeTo(writableStream)
}

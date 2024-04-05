/* global log, streamWriter */

/**
 * Save the video track to disk.
 * @param {MediaStreamTrack} videoTrack
 */
window.saveVideoTrack = async (videoTrack, sendrecv, quality = 0.75) => {
  const width = window.VIDEO_WIDTH
  const height = window.VIDEO_HEIGHT
  const frameRate = window.VIDEO_FRAMERATE
  const fname = `${window.getParticipantName().split('_')[0]}-${sendrecv}_${
    videoTrack.id
  }.ivf`
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
        writer.close()
      },
      abort(err) {
        log('saveVideoTrack error:', err)
      },
    },
    new CountQueuingStrategy({ highWaterMark: frameRate * 2 }),
  )

  const trackProcessor = new window.MediaStreamTrackProcessor({
    track: videoTrack,
  })
  trackProcessor.readable.pipeTo(writableStream)
}

/**
 * Save the audio track to disk.
 * @param {MediaStreamTrack} audioTrack
 */
window.saveAudioTrack = async (audioTrack, sendrecv) => {
  const fname = `${window.getParticipantName().split('_')[0]}-${sendrecv}_${
    audioTrack.id
  }.f32le.raw`
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
        writer.close()
      },
      abort(err) {
        log('saveAudioTrack error:', err)
      },
    },
    new CountQueuingStrategy({ highWaterMark: 100 }),
  )

  const trackProcessor = new window.MediaStreamTrackProcessor({
    track: audioTrack,
  })
  trackProcessor.readable.pipeTo(writableStream)
}
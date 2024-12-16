/* global webrtcperf */

webrtcperf.videoStats = {
  collectedVideos: new Map(),
  bufferedTime: new webrtcperf.MeasuredStats({ ttl: 15 }),
  width: new webrtcperf.MeasuredStats({ ttl: 15 }),
  height: new webrtcperf.MeasuredStats({ ttl: 15 }),
  playingTime: new webrtcperf.MeasuredStats({ ttl: 15 }),
  bufferingTime: new webrtcperf.MeasuredStats({ ttl: 15 }),
  bufferingEvents: new webrtcperf.MeasuredStats({ ttl: 15 }),

  scheduleNext(timeout = 2000) {
    setTimeout(() => {
      try {
        this.update()
      } catch (e) {
        webrtcperf.log('VideoStats error', e)
      }
    }, timeout)
  },
  watchVideo(video) {
    if (this.collectedVideos.has(video)) return
    webrtcperf.log('VideoStats watchVideo', video)
    const playingTimer = new webrtcperf.Timer()
    const bufferingTimer = new webrtcperf.Timer()
    this.collectedVideos.set(video, { playingTimer, bufferingTimer })
    video.addEventListener(
      'play',
      () => {
        playingTimer.start()
        bufferingTimer.stop()
      },
      { once: true },
    )
    video.addEventListener('playing', () => {
      playingTimer.start()
      bufferingTimer.stop()
    })
    video.addEventListener('waiting', () => {
      playingTimer.stop()
      bufferingTimer.start()
    })
  },
  update() {
    const now = Date.now()
    document.querySelectorAll('video').forEach(el => this.watchVideo(el))
    const entries = Array.from(this.collectedVideos.entries()).filter(([video]) => !!video.src && !video.ended)
    const arrayAverage = cb =>
      entries.length
        ? entries.reduce((acc, entry) => {
            return acc + cb(...entry)
          }, 0) / entries.length
        : undefined

    this.bufferedTime.push(
      now,
      arrayAverage(video => {
        if (video.buffered.length) {
          return Math.max(video.buffered.end(video.buffered.length - 1) - video.currentTime, 0)
        }
        return 0
      }),
    )
    this.width.push(
      now,
      arrayAverage(video => video.videoWidth),
    )
    this.height.push(
      now,
      arrayAverage(video => video.videoHeight),
    )
    this.playingTime.push(
      now,
      arrayAverage((video, stats) => stats.playingTimer.duration),
    )
    this.bufferingTime.push(
      now,
      arrayAverage((video, stats) => stats.bufferingTimer.duration),
    )
    this.bufferingEvents.push(
      now,
      arrayAverage((video, stats) => stats.bufferingTimer.startEvents),
    )
    this.scheduleNext()
  },
  collect() {
    return {
      bufferedTime: this.bufferedTime.mean(),
      width: this.width.mean(),
      height: this.height.mean(),
      playingTime: this.playingTime.mean(),
      bufferingTime: this.bufferingTime.mean(),
      bufferingEvents: this.bufferingEvents.mean(),
    }
  },
}

window.collectVideoStats = () => webrtcperf.videoStats.collect()

document.addEventListener('DOMContentLoaded', () => {
  if (webrtcperf.enabledForSession(window.PARAMS?.enableVideoStats)) {
    webrtcperf.videoStats.scheduleNext()
  }
})

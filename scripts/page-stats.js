/* global webrtcperf */

// Page performance
webrtcperf.httpBitrateStats = new webrtcperf.MeasuredStats({ ttl: 30 })
webrtcperf.httpLatencyStats = new webrtcperf.MeasuredStats({ ttl: 30 })

webrtcperf.httpResourcesStats = {
  recvBytes: 0,
  recvBitrate: 0,
  recvLatency: 0,
}

window.collectHttpResourcesStats = () => {
  webrtcperf.httpResourcesStats.recvBitrate = webrtcperf.httpBitrateStats.mean() || 0
  webrtcperf.httpResourcesStats.recvLatency = webrtcperf.httpLatencyStats.mean() || 0
  return webrtcperf.httpResourcesStats
}

if (typeof window.PerformanceObserver === 'function') {
  // Stop ServiceWorkers.
  /* navigator.serviceWorker.addEventListener('controllerchange', () => {
    webrtcperf.unregisterServiceWorkers()
  })
  webrtcperf.unregisterServiceWorkers() */

  // https://nicj.net/resourcetiming-in-practice/
  const processEntries = entries => {
    const timestamp = Date.now()
    entries
      .filter(entry => {
        // webrtcperf.log(`entry`, entry)
        const { duration, transferSize } = entry
        // Filter cached entries.
        if (!transferSize || duration < 10) {
          return false
        }
        webrtcperf.httpResourcesStats.recvBytes += transferSize
        return true
      })
      .forEach(entry => {
        const { duration, transferSize } = entry
        webrtcperf.httpBitrateStats.push(timestamp, Math.round((8000 * transferSize) / duration))
        webrtcperf.httpLatencyStats.push(timestamp, duration / 1000)
      })
  }
  const observer = new PerformanceObserver(list => processEntries(list.getEntries()))
  observer.observe({ type: 'resource', buffered: true })
}

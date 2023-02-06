/* global MeasuredStats */

// Page performance
const httpBitrateStats = new MeasuredStats(60)
const httpLatencyStats = new MeasuredStats(60)

const httpResourcesStats = {
  recvBytes: 0,
  recvBitrate: 0,
  recvLatency: 0,
}

window.collectHttpResourcesStats = () => {
  httpResourcesStats.recvBitrate = httpBitrateStats.mean()
  httpResourcesStats.recvLatency = httpLatencyStats.mean()
  return httpResourcesStats
}

if (typeof window.PerformanceObserver === 'function') {
  // Stop ServiceWorkers.
  /* navigator.serviceWorker.addEventListener('controllerchange', () => {
    unregisterServiceWorkers()
  })
  unregisterServiceWorkers() */

  // https://nicj.net/resourcetiming-in-practice/
  const processEntries = entries => {
    const timestamp = Date.now()
    entries
      .filter(entry => {
        const { duration, transferSize } = entry
        httpResourcesStats.recvBytes += transferSize
        // Filter cached entries.
        if (!transferSize || duration < 10) {
          return false
        }
        // 304 response.
        /* if (
          encodedBodySize > 0 &&
          transferSize > 0 &&
          transferSize < encodedBodySize
        ) {
          return false
        } */
        return true
      })
      .forEach(entry => {
        const { duration, transferSize } = entry
        httpBitrateStats.push(
          timestamp,
          Math.round((8000 * transferSize) / duration),
        )
        httpLatencyStats.push(timestamp, duration / 1000)
      })
  }
  const observer = new PerformanceObserver(list =>
    processEntries(list.getEntries()),
  )
  observer.observe({ entryTypes: ['resource'] })
  processEntries(observer.takeRecords())
}

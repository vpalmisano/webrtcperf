/* global webrtcperf */

/**
 * CPU pressure stats.
 * @type webrtcperf.MeasuredStats
 */
const cpuPressure = new webrtcperf.MeasuredStats({ ttl: 15 })

webrtcperf.collectCpuPressure = () => {
  return cpuPressure.mean()
}

document.addEventListener('DOMContentLoaded', async () => {
  if ('PressureObserver' in window) {
    const STATES = {
      nominal: 0,
      fair: 1,
      serious: 2,
      critical: 3,
    }
    const observer = new window.PressureObserver(records => {
      const lastRecord = records[records.length - 1]
      // webrtcperf.log(`Current CPU pressure: ${lastRecord.state}`)
      cpuPressure.push(Date.now(), STATES[lastRecord.state])
    })
    observer.observe('cpu', { sampleInterval: 1000 }).catch(error => {
      webrtcperf.log(`Pressure observer error: ${error}`)
    })
  }
})

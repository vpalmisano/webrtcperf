/* global log, MeasuredStats */

/**
 * CPU pressure stats.
 * @type MeasuredStats
 */
const cpuPressure = new MeasuredStats({ ttl: 15 })

window.collectCpuPressure = () => {
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
      // log(`Current CPU pressure: ${lastRecord.state}`)
      cpuPressure.push(Date.now(), STATES[lastRecord.state])
    })
    observer.observe('cpu', { sampleInterval: 1000 }).catch(error => {
      log(`Pressure observer error: ${error}`)
    })
  }
})

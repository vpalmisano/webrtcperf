/**
 * log
 * @param  {...any} args args
 */
function log(...args) {
  console.log.apply(null, ['[webrtcperf]', ...args])
}

/**
 * sleep
 * @param  {number} ms ms
 * @return {Promise}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * getParticipantName
 */
window.getParticipantName = (index = window.WEBRTC_STRESS_TEST_INDEX || 1) => {
  return `Participant-${index.toString().padStart(6, '0')}`
}

/**
 * getElement
 * @param {string} selector
 * @param {number} timeout
 * @param {boolean} throwError
 * @return {Promise<HTMLElement>}
 */
window.getElement = async (selector, timeout = 60000, throwError = false) => {
  let element = document.querySelector(selector)
  if (timeout) {
    const startTime = Date.now()
    while (!element && Date.now() - startTime < timeout) {
      await sleep(Math.min(timeout / 2, 1000))
      element = document.querySelector(selector)
    }
  }
  if (!element && throwError) {
    throw new Error(`Timeout getting "${selector}"`)
  }
  return element
}

/**
 * getElements
 * @param {string} selector
 * @param {number} timeout
 * @param {boolean} throwError
 * @param {string} innerText
 * @return {Promise<HTMLElement[]>}
 */
window.getElements = async (
  selector,
  timeout = 60000,
  throwError = false,
  innerText = '',
) => {
  let elements = document.querySelectorAll(selector)
  if (timeout) {
    const startTime = Date.now()
    while (!elements.length && Date.now() - startTime < timeout) {
      await sleep(Math.min(timeout / 2, 1000))
      elements = document.querySelectorAll(selector)
    }
  }
  if (!elements.length && throwError) {
    throw new Error(`Timeout getting "${selector}"`)
  }
  if (innerText) {
    return [...elements].filter(
      e => e.innerText.trim().toLowerCase() === innerText.trim().toLowerCase(),
    )
  } else {
    return [...elements]
  }
}

/**
 * overrideLocalStorage
 */
window.overrideLocalStorage = () => {
  if (window.LOCAL_STORAGE) {
    try {
      const values = JSON.parse(window.LOCAL_STORAGE)
      Object.entries(values).map(([key, value]) =>
        localStorage.setItem(key, value),
      )
    } catch (err) {
      log(`overrideLocalStorage error: ${err.message}`)
    }
  }
}

window.injectCss = css => {
  const style = document.createElement('style')
  style.setAttribute('type', 'text/css')
  style.innerHTML = css
  document.head.appendChild(style)
}

window.watchObjectProperty = (object, name, cb) => {
  let value = object[name]
  Object.defineProperty(object, name, {
    get: function () {
      return value
    },
    set: function (newValue) {
      cb(newValue, value)
      value = newValue
    },
  })
}

window.loadScript = (name, src) => {
  return new Promise((resolve, reject) => {
    let script = document.getElementById(name)
    if (script) {
      resolve(script)
      return
    }
    script = document.createElement('script')
    script.setAttribute('id', name)
    script.setAttribute('src', src)
    script.setAttribute('referrerpolicy', 'no-referrer')
    script.addEventListener('load', () => script && resolve(script), false)
    script.addEventListener('error', err => reject(err), false)
    document.head.appendChild(script)
  })
}

window.harmonicMean = array => {
  return array.length
    ? 1 /
        (array.reduce((sum, b) => {
          sum += 1 / b
          return sum
        }, 0) /
          array.length)
    : 0
}

window.unregisterServiceWorkers = () => {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (let registration of registrations) {
      registration.unregister()
    }
  })
}

window.MeasuredStats = class {
  constructor(
    { ttl, maxItems, secondsPerSample, storeId } = {
      ttl: 0,
      maxItems: 0,
      secondsPerSample: 1,
      storeId: '',
    },
  ) {
    /** @type number */
    this.ttl = ttl
    /** @type number */
    this.secondsPerSample = secondsPerSample
    /** @type string */
    this.storeId = storeId
    /** @type number */
    this.maxItems = maxItems
    /** @type Array<{ timestamp: number; value: number; count: number }> */
    this.stats = []
    /** @type number */
    this.statsSum = 0
    /** @type number */
    this.statsCount = 0
    // Restore from localStorage.
    this.load()
  }

  store() {
    if (!this.storeId) {
      return
    }
    try {
      localStorage.setItem(
        `webrtcperf-MeasuredStats-${this.storeId}`,
        JSON.stringify({
          stats: this.stats,
          statsSum: this.statsSum,
          statsCount: this.statsCount,
        }),
      )
    } catch (err) {
      log(`MeasuredStats store error: ${err.message}`)
    }
  }

  load() {
    if (!this.storeId) {
      return
    }
    try {
      const data = localStorage.getItem(
        `webrtcperf-MeasuredStats-${this.storeId}`,
      )
      if (data) {
        const { stats, statsSum, statsCount } = JSON.parse(data)
        this.stats = stats
        this.statsSum = statsSum
        this.statsCount = statsCount
      }
    } catch (err) {
      log(`MeasuredStats load error: ${err.message}`)
    }
  }

  clear() {
    this.stats = []
    this.statsSum = 0
    this.statsCount = 0
    this.store()
  }

  purge() {
    let changed = false
    if (this.ttl > 0) {
      const now = Date.now()
      let removeToIndex = -1
      for (const [index, { timestamp }] of this.stats.entries()) {
        if (now - timestamp > this.ttl * 1000) {
          removeToIndex = index
        } else {
          break
        }
      }
      if (removeToIndex >= 0) {
        for (const { value, count } of this.stats.splice(
          0,
          removeToIndex + 1,
        )) {
          this.statsSum -= value
          this.statsCount -= count
        }
        changed = true
      }
    }
    if (this.maxItems && this.stats.length > this.maxItems) {
      for (const { value, count } of this.stats.splice(
        0,
        this.stats.length - this.maxItems,
      )) {
        this.statsSum -= value
        this.statsCount -= count
      }
      changed = true
    }
    if (changed) {
      this.store()
    }
  }

  /**
   * push
   * @param {number} timestamp
   * @param {number} value
   */
  push(timestamp, value) {
    const last = this.stats[this.stats.length - 1]
    if (last && timestamp - last.timestamp < this.secondsPerSample * 1000) {
      last.value += value
      last.count += 1
    } else {
      this.stats.push({ timestamp, value, count: 1 })
    }
    this.statsSum += value
    this.statsCount += 1
    this.purge()
  }

  /**
   * mean
   * @returns {number | undefined} mean value
   */
  mean() {
    this.purge()
    return this.statsCount ? this.statsSum / this.statsCount : undefined
  }
}

// Common page actions
let actionsStarted = false
const actionsQueue = []

window.setupActions = async () => {
  if (!window.PARAMS?.actions || actionsStarted) {
    return
  }
  actionsStarted = true

  const relativeTime = () =>
    Date.now() - window.WEBRTC_STRESS_TEST_START_TIMESTAMP

  /** @ŧype Array<{ name: string, at: number, every: number, times: number, index: number, param: any }> */
  let actions = window.PARAMS.actions
  actions
    .sort((a, b) => (a.at || 0) - (b.at || 0))
    .forEach(action => {
      const { name, at, every, times, index, param } = action
      const fn = window[name]
      if (!fn) {
        log(`setupActions unknown action name: "${name}"`)
        return
      }

      if (index) {
        if (typeof index === 'string') {
          if (index.indexOf('-') !== -1) {
            const [start, end] = index.split('-').map(s => parseInt(s))
            if (isFinite(start) && window.WEBRTC_STRESS_TEST_INDEX < start) {
              return
            }
            if (isFinite(end) && window.WEBRTC_STRESS_TEST_INDEX > end) {
              return
            }
          } else {
            const indexes = index.split(',').map(s => parseInt(s))
            if (!indexes.includes(window.WEBRTC_STRESS_TEST_INDEX)) {
              return
            }
          }
        } else if (window.WEBRTC_STRESS_TEST_INDEX !== index) {
          return
        }
      }

      let remainingTimes = (times || 1) - 1
      const cb = async () => {
        const ts = (relativeTime() / 1000).toFixed(0)
        log(
          `run action [${ts}s] [${
            window.WEBRTC_STRESS_TEST_INDEX
          }] ${name}(${param}) at ${at}s${every ? ` every ${every}s` : ''}${
            times ? ` (${remainingTimes}/${times} times remaining)` : ''
          }`,
        )
        try {
          await fn(param)
          log(
            `run action [${ts}s] [${window.WEBRTC_STRESS_TEST_INDEX}] ${name} done`,
          )
        } catch (err) {
          log(
            `run action [${ts}s] [${window.WEBRTC_STRESS_TEST_INDEX}] ${name} error: ${err.message}`,
          )
        } finally {
          if (every > 0 && (!times || remainingTimes > 0)) {
            actionsQueue.push({ cb, at: every + relativeTime() / 1000 })
            remainingTimes -= 1
          }
          runNext()
        }
      }

      const runNext = () => {
        if (actionsQueue.length) {
          const { cb, at } = actionsQueue.splice(0, 1)[0]
          const scheduledTime = Math.max((at || 0) * 1000 - relativeTime(), 0)
          setTimeout(cb, scheduledTime)
        }
      }

      actionsQueue.push({ cb, at })
      runNext()
    })
}

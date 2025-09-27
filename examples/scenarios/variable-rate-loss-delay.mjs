// Usage:
// webrtcperf --docker scenarios/variable-rate-loss-delay.mjs

import { parseArgs } from 'node:util'
import { twoParticipantsWithRateLossDelay, formatThrottleRule } from '../../build/src/index.js'

const URLS = {
  livekit: 'https://meet.livekit.io/rooms/webrtcperf-test-12345',
  google: process.env.GOOGLE_MEET_URL,
}

const SCRIPTS = {
  livekit: 'livekit.js',
  google: 'google-meet.js',
}

if (process.env.URLS) {
  process.env.URLS.split(',').forEach(entry => {
    const [id, url] = entry.strip().split('=')
    URLS[id] = url
  })
}

if (process.env.SCRIPTS) {
  process.env.SCRIPTS.split(',').forEach(entry => {
    const [id, script] = entry.strip().split('=')
    SCRIPTS[id] = script
  })
}

export default async function (args) {
  const { values } = parseArgs({
    args,
    options: {
      destinations: { type: 'string', default: 'google,livekit' },
      rates: { type: 'string', default: '200,400,1000,2000' },
      losses: { type: 'string', default: '0,5,10,15' },
      delays: { type: 'string', default: '50,100,200' },
      directions: { type: 'string', default: 'up,down' },
      iterations: { type: 'string', default: '1' },
    },
    allowPositionals: true,
  })
  const destinations = values.destinations.split(',').filter(d => d in URLS)
  const rates = values.rates.split(',').map(r => parseInt(r))
  const losses = values.losses.split(',').map(l => parseInt(l))
  const delays = values.delays.split(',').map(d => parseInt(d))
  const directions = values.directions.split(',').filter(d => ['up', 'down', 'bidi'].includes(d))
  const iterations = parseInt(values.iterations)
  const ret = []
  for (const destination of destinations) {
    for (const rate of rates) {
      for (const loss of losses) {
        for (const delay of delays) {
          for (const direction of directions) {
            const configs = await twoParticipantsWithRateLossDelay(
              destination,
              { rate, loss, delay, direction },
              iterations,
            )
            console.log(
              `Adding scenario: ${destination} - ${formatThrottleRule({ rate, loss, delay, direction }, true)} (${iterations} run${iterations > 1 ? 's' : ''})`,
            )
            configs.forEach(config => {
              ret.push({
                ...config,
                url: URLS[destination],
                scriptPath: SCRIPTS[destination],
                sessions: 3,
                debuggingPort: 9200,
                chromiumPath: '/usr/bin/chromium-browser-unstable',
              })
            })
          }
        }
      }
    }
  }
  return ret
}

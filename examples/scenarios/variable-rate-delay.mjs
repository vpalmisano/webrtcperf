// Usage:
// scripts/webrtcperf-docker examples/scenarios/livekit.mjs

function queueSize(rate, delay, mtu = 1400) {
  return Math.max(Math.ceil((((1.5 * rate * 1000) / 8) * (delay / 1000)) / mtu), 25)
}

export default function () {
  console.log('Running variable-rate-delay scenario...', process.env.URL)
  const url = process.env.URL || 'https://meet.livekit.io/rooms/webrtcperf-test-12345'
  const scriptPath = url.startsWith('https://meet.livekit.io')
    ? 'examples/livekit.js'
    : url.startsWith('https://meet.google.com')
      ? 'examples/google-meet.js'
      : undefined
  const ret = []
  for (const direction of ['up', 'down']) {
    for (const rate of [500, 1000, 1500, 2000]) {
      for (const delay of [50, 100, 200]) {
        const d = `/data/${direction}-r${rate}-d${delay}`
        const queue = queueSize(rate, delay)
        ret.push({
          url,
          scriptPath,
          //scriptParams: JSON.stringify({ timestampWatermarkVideo: '0', saveSendVideoTrack: '0', saveRecvVideoTrack: '1' }),
          serverData: d,
          //vmafPath: d,
          statsPath: `${d}/stats.json`,
          detailedStatsPath: `${d}/detailed-stats.json`,
          sessions: 2,
          runDuration: 120,
          throttleConfig: JSON.stringify([
            {
              sessions: direction === 'down' ? '0' : '1',
              protocol: 'udp',
              [direction]: [{ rate, delay, queue }],
            },
          ]),
        })
      }
    }
  }
  return ret
}

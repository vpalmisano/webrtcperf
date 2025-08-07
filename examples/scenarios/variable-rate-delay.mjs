// Usage:
// scripts/webrtcperf-docker examples/scenarios/variable-rate-delay.mjs

function queueSize(rate, delay, mtu = 1400) {
  return Math.max(Math.ceil((((1.5 * rate * 1000) / 8) * (delay / 1000)) / mtu), 25)
}

const SCRIPTS = {
  livekit: 'https://raw.githubusercontent.com/vpalmisano/webrtcperf/refs/heads/devel/examples/livekit.js',
  google: 'https://raw.githubusercontent.com/vpalmisano/webrtcperf/refs/heads/devel/examples/google-meet.js',
}

export default function () {
  const url = process.env.URL || 'https://meet.livekit.io/rooms/webrtcperf-test-12345'
  const type = url.startsWith('https://meet.livekit.io')
    ? 'livekit'
    : url.startsWith('https://meet.google.com')
      ? 'google'
      : 'default'
  const ret = []
  for (const direction of ['up', 'down']) {
    for (const rate of [500, 1000, 2000]) {
      for (const delay of [50, 100, 200]) {
        for (const loss of [5, 10, 20]) {
          const id = `${Date.now()}_${type}_${direction}-r${rate}-d${delay}-l${loss}`
          const d = `/data/${id}`
          const queue = queueSize(rate, delay)
          ret.push({
            url,
            scriptPath: SCRIPTS[type],
            //scriptParams: JSON.stringify({ timestampWatermarkVideo: '0', saveSendVideoTrack: '0', saveRecvVideoTrack: '1' }),
            //vmafPath: d,
            serverData: d,
            prometheusPushgatewayJobName: id,
            statsPath: `${d}/stats.csv`,
            detailedStatsPath: `${d}/detailed-stats.csv`,
            sessions: 2,
            runDuration: 120,
            throttleConfig: JSON.stringify([
              {
                sessions: direction === 'down' ? '0' : '1',
                protocol: 'udp',
                [direction]: [{ rate, delay, loss, queue }],
              },
            ]),
          })
        }
      }
    }
  }
  return ret
}

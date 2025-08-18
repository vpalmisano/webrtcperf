// Usage:
// export URL=https://meet.google.com/<ID>
// scripts/webrtcperf-docker examples/scenarios/google-meet.mjs

export default function () {
  console.log('Running Google Meet scenario')
  return {
    scriptPath: 'https://raw.githubusercontent.com/vpalmisano/webrtcperf/refs/heads/devel/examples/google-meet.js',
    sessions: 3,
    runDuration: 600,
  }
}

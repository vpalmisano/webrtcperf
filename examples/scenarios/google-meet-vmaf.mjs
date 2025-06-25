// Usage:
// export URL=https://meet.google.com/<ID>
// scripts/webrtcperf-docker examples/scenarios/google-meet-vmaf.mjs

export default function () {
  console.log('Running Google Meet scenario with VMAF metrics...')
  return {
    scriptPath: 'https://raw.githubusercontent.com/vpalmisano/webrtcperf/refs/heads/devel/examples/google-meet.js',
    scriptParams: JSON.stringify({
      timestampWatermarkVideo: '0',
      saveSendVideoTrack: '0',
      saveRecvVideoTrack: '1',
    }),
    sessions: 2,
    runDuration: 120,
    throttleConfig: JSON.stringify([
      {
        sessions: '0',
        protocol: 'udp',
        //up: [{ rate: 1000, delay: 50, queue: 50 }],
        down: [{ rate: 1500, delay: 50, queue: 50 }],
      },
    ]),
  }
}

// Usage:
// export URL=https://meet.google.com/<ID>
// scripts/webrtcperf-docker examples/scenarios/google-meet-vmaf.mjs logs

export default function (args) {
  console.log('Running Google Meet scenario with VMAF metrics...', args)
  return {
    scriptPath: 'https://raw.githubusercontent.com/vpalmisano/webrtcperf/refs/heads/devel/examples/google-meet.js',
    scriptParams: {
      timestampWatermarkVideo: '0',
      saveSendVideoTrack: '0',
      saveRecvVideoTrack: '1',
    },
    sessions: 2,
    runDuration: 120,
    throttleConfig: [
      {
        sessions: '0',
        protocol: 'udp',
        up: [{ rate: 1000, delay: 50, queue: 50 }],
        down: [{ rate: 1000, delay: 50, queue: 50 }],
      },
    ],
  }
}

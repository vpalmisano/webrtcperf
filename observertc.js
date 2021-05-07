console.log('Creating ObserverRTC');
window.observer = new ObserverRTC
    .Builder({wsAddress: '', poolingIntervalInMs: 1000 * window.STATS_INTERVAL})
    .withIntegration('General')
    .withLocalTransport({
      onObserverRTCSample: (sampleList) => {
        window.traceRtcStats(sampleList);
      },
    })
    .build();

console.log('Override RTCPeerConnection');
const NativeRTCPeerConnection = window.RTCPeerConnection;

window.RTCPeerConnection = function(...args) {
  const pc = new NativeRTCPeerConnection(...args);
  console.log(`RTCPeerConnection add (state: ${pc.signalingState})`);
  window.observer.addPC(pc);

  const interval = setInterval(async () => {
    /* const stats = await pc.getStats();
        for (const s of stats) {
            console.log('RTCPeerConnection ', JSON.stringify(s, null, 2));
        } */
    if (pc.signalingState === 'closed' || pc.signalingState === 'failed') {
      console.warn(`RTCPeerConnection remove (state: ${pc.signalingState})`);
      window.observer.removePC(pc);
      window.clearInterval(interval);
    }
  }, 2000);

  return pc;
};

for (const key of Object.keys(NativeRTCPeerConnection)) {
  window.RTCPeerConnection[key] = NativeRTCPeerConnection[key];
}
window.RTCPeerConnection.prototype = NativeRTCPeerConnection.prototype;

console.log('Override getUserMedia');

/**
 * overrideGetUserMedia
 * @param {*} constraints
 */
function overrideGetUserMedia(constraints) {
  if (window.GET_USER_MEDIA_OVERRIDE) {
    if (constraints.video && window.GET_USER_MEDIA_OVERRIDE.video) {
      Object.assign(constraints.video, window.GET_USER_MEDIA_OVERRIDE.video);
    }
    if (constraints.audio && window.GET_USER_MEDIA_OVERRIDE.audio) {
      Object.assign(constraints.audio, window.GET_USER_MEDIA_OVERRIDE.audio);
    }
    console.log('getUserMedia override result:',
        JSON.stringify(constraints, null, 2));
  }
}

const nativeGetUserMedia = navigator.getUserMedia;
navigator.getUserMedia = function(constraints) {
  overrideGetUserMedia(constraints, ...args);
  return nativeGetUserMedia.apply(navigator, [constraints, ...args]);
};

if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  const nativeGetUserMedia = navigator.mediaDevices.getUserMedia;
  navigator.mediaDevices.getUserMedia = function(constraints, ...args) {
    overrideGetUserMedia(constraints);
    return nativeGetUserMedia.apply(navigator.mediaDevices,
        [constraints, ...args]);
  };
}

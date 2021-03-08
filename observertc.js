console.log('Creating ObserverRTC');
window.observer = new ObserverRTC
    .Builder({ wsAddress: '', poolingIntervalInMs: 1000 * window.STATS_INTERVAL })
    .withIntegration('General')
    .withLocalTransport({
        onObserverRTCSample: (sampleList) => {
            window.traceRtcStats(sampleList);
        }
    })
    .build();

console.log('Override RTCPeerConnection');
const nativeRTCPeerConnection = window.RTCPeerConnection;

window.RTCPeerConnection = function(config, constraints) {
    const pc = new nativeRTCPeerConnection(config, constraints);
    console.log('RTCPeerConnection add (state: ' + pc.signalingState + ')');
    window.observer.addPC(pc);

    let interval = setInterval(async () => {
        if (pc.signalingState === 'closed' || pc.signalingState === 'failed') {
            console.warn('RTCPeerConnection remove (state: ' + pc.signalingState + ')');
            window.observer.removePC(pc);
            window.clearInterval(interval);
            return;
        }
    }, 2000);

    return pc;
}

for (const key of Object.keys(nativeRTCPeerConnection)) {
    window.RTCPeerConnection[key] = nativeRTCPeerConnection[key];
}
window.RTCPeerConnection.prototype = nativeRTCPeerConnection.prototype;

console.log('Override getUserMedia');

function onGetUserMedia(options) {
    console.log('getUserMedia', JSON.stringify(options, null, 2));
}


const nativeGetUserMedia = navigator.getUserMedia;
navigator.getUserMedia = function() {
    onGetUserMedia(arguments[0]);
    return nativeGetUserMedia.apply(navigator, arguments);
}

if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = function() {
        onGetUserMedia(arguments[0]);
        return nativeGetUserMedia.apply(navigator.mediaDevices, arguments);
    }
}

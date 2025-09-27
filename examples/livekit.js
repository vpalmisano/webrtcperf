/* global webrtcperf */

async function setup() {
  const nameInput = await webrtcperf.getElement('input#username', 200)
  if (nameInput) {
    if (!nameInput.value) {
      nameInput.value = webrtcperf.overrides.getParticipantName()
    }
    await window.keypressText('input#username', ' \n', 100)
  }
  await webrtcperf.clickOn('button.lk-join-button')

  if (!webrtcperf.enabledForSession(webrtcperf.params.enableMic)) {
    await window.muteParticipant(true)
  }
  if (!webrtcperf.enabledForSession(webrtcperf.params.enableCam)) {
    await window.disableCamera(true)
  }
}

window.muteParticipant = muted => {
  return webrtcperf.clickOn(`button[data-lk-source="microphone"][aria-pressed="${muted ? 'true' : 'false'}"]`, 100)
}

window.disableCamera = off => {
  return webrtcperf.clickOn(`button[data-lk-source="camera"][aria-pressed="${off ? 'true' : 'false'}"]`, 100)
}

window.disableScreenShare = off => {
  return webrtcperf.clickOn(`button[data-lk-source="screen_share"][aria-pressed="${off ? 'true' : 'false'}"]`, 100)
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.location.href.startsWith('https://meet.livekit.io/') || self !== top) {
    return
  }
  await webrtcperf.setupActions()
  while (true) {
    await setup()
    await webrtcperf.sleep(2000)
  }
})

/* global webrtcperf */

async function init() {
  const nameInput = await webrtcperf.getElement('input#username', 200)
  if (nameInput && !nameInput.value) {
    nameInput.value = webrtcperf.overrides.getParticipantName()
    await window.keypressText('input#username', ' \n', 100)
  }
  await webrtcperf.clickOn('button.lk-join-button')
}

window.muteParticipant = muted => {
  return webrtcperf.clickOn(`button[data-lk-source="microphone",aria-pressed="${muted ? 'true' : 'false'}"]`, 100)
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.location.href.startsWith('https://meet.livekit.io/')) {
    return
  }
  await webrtcperf.setupActions()
  while (true) {
    await init()
    await webrtcperf.sleep(2000)
  }
})

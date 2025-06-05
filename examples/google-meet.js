/* global webrtcperf */

async function initGoogleMeet() {
  const nameInput = await webrtcperf.getElement('input[aria-label="Your name"]', 200)
  if (!nameInput) return
  if (!nameInput.value) {
    nameInput.value = webrtcperf.overrides.getParticipantName()
  }
  await window.keypressText('input[aria-label="Your name"]', ' \n', 100)
  const joinButton =
    (await webrtcperf.getElements('button', 200, false, 'Join now'))[0] ||
    (await webrtcperf.getElements('button', 200, false, 'Ask to join'))[0]
  if (!joinButton) return
  joinButton.click()
}

window.muteParticipant = muted => {
  return webrtcperf.clickOn(`button[aria-label^="Turn ${muted ? 'off' : 'on'} microphone"]`, 100)
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.location.href.startsWith('https://meet.google.com/')) {
    return
  }
  while (true) {
    await initGoogleMeet()
    await webrtcperf.sleep(2000)
  }
})

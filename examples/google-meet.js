/* global webrtcperf */

async function setup() {
  const nameInput = await webrtcperf.getElement('input[aria-label="Your name"]', 200)
  if (nameInput) {
    if (!nameInput.value) {
      nameInput.value = webrtcperf.overrides.getParticipantName()
    }
    await window.keypressText('input[aria-label="Your name"]', ' \n', 100)
    const joinButton =
      (await webrtcperf.getElements('button', 200, false, 'Join now'))[0] ||
      (await webrtcperf.getElements('button', 200, false, 'Ask to join'))[0]
    if (!joinButton) return
    if (!webrtcperf.enabledForSession(webrtcperf.params.enableMic)) {
      await window.muteParticipant(true)
    }
    if (!webrtcperf.enabledForSession(webrtcperf.params.enableCam)) {
      await window.disableCam(true)
    }
    joinButton.click()
  }

  if (!webrtcperf.enabledForSession(webrtcperf.params.enableMic)) {
    await window.muteParticipant(true)
  }
  if (!webrtcperf.enabledForSession(webrtcperf.params.enableCam)) {
    await window.disableCam(true)
  }
}

window.muteParticipant = muted => {
  return webrtcperf.clickOn(`button[aria-label^="Turn ${muted ? 'off' : 'on'} microphone"]`, 100)
}

window.disableCam = off => {
  return webrtcperf.clickOn(`*[aria-label^="${off ? 'Turn off' : 'Turn on'} camera"]`, 200)
}

window.disableScreenShare = off => {
  return webrtcperf.clickOn(`button[aria-label="${off ? 'You are presenting' : 'Share screen'}]`, 200)
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.location.href.startsWith('https://meet.google.com/') || self !== top) {
    return
  }
  await webrtcperf.setupActions()
  while (true) {
    await setup()
    await webrtcperf.sleep(2000)
  }
})

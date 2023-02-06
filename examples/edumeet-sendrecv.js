/**
 * Toggles audio on/off.
 */
function toggleAudio() {
  const btn = document.querySelector('button[aria-label="Mute audio"]')
  if (btn) {
    console.log(`Toggling audio`)
    btn.click()
  }
  scheduleToggleAudio()
}

/**
 * Schedules the audio on/off toggle.
 */
function scheduleToggleAudio() {
  setTimeout(toggleAudio, 1000 * (10 + 10 * Math.random()))
}

/**
 * Joins the room.
 */
function edumeetJoin() {
  const joinButton = document.querySelector('#joinButton')
  if (!joinButton) {
    setTimeout(edumeetJoin, 1000)
    return
  }
  // change the settings
  const store = JSON.parse(localStorage['persist:root'])
  const settings = JSON.parse(store.settings)
  if (settings.resolution !== 'high') {
    console.log(`Changing settings`)
    settings.resolution = 'high'
    settings.frameRate = 25
    store.settings = JSON.stringify(settings)
    localStorage['persist:root'] = JSON.stringify(store)
    location.reload()
    return
  }
  // join the room
  console.log(`Joining the room`)
  joinButton.click()
  // toggle audio on-off
  scheduleToggleAudio()
}

edumeetJoin()

function join() {
  const choosePermissionButton = document.querySelector(
    'div[aria-label="choose permission"] > button',
  )
  const joinButton = document.querySelector('#joinButton')
  if (!choosePermissionButton || !joinButton) {
    return setTimeout(join, 1000)
  }
  //
  choosePermissionButton.click()
  // join the room
  joinButton.click()
}

join()

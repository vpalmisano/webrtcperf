function toggleAudio() {
    let btn = document.querySelector('button[aria-label="Mute audio"]');
    if (btn) {
        btn.click();
    }
    scheduleToggleAudio();
}

function scheduleToggleAudio() {
    setTimeout(toggleAudio, 1000 * (10 + 10 * Math.random()));
}

function join() {
    const joinButton = document.querySelector('#joinButton');
    if (!joinButton) {
        return setTimeout(join, 1000);
    }
    // join the room
    joinButton.click();
    // toggle audio on-off
    scheduleToggleAudio();
}

join();
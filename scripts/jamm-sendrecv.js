/**
 * Joins the room.
 */
function join() {
  const input = document.querySelector('input[data-qa="knockNameInput"]');
  const button = document.querySelector('button[data-qa="knockBtn"]');
  if (!input || !button) {
    setTimeout(join, 1000);
    return;
  }
  if (!input.value) {
    input.value = `Participant-${WEBRTC_STRESS_TEST_INDEX}`;
    const event = new Event('input', {target: input, bubbles: true});
    event.simulated = true;
    input.dispatchEvent(event);
    setTimeout(join, 1000);
    return;
  }
  if (!button.disabled) {
    button.click();
  } else {
    setTimeout(join, 1000);
    return;
  }
}

join();

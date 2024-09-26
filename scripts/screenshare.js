/* global webrtcperf, log, sleep */

webrtcperf.setupFakeScreenshare = ({
  delay = 15000,
  animationDuration = 1000,
  slides = 4,
  width = window.innerWidth,
  height = window.innerHeight,
} = {}) => {
  if (document.querySelector('#webrtcperf-fake-screenshare')) {
    return
  }

  const animateElement = async (el, direction) => {
    const slideIn = [
      { transform: 'translateX(100%)', opacity: 0 },
      { transform: 'translateX(0%)', opacity: 1 },
    ]
    const slideOut = [
      { transform: 'translateX(0%)', opacity: 1 },
      { transform: 'translateX(-100%)', opacity: 0 },
    ]
    return new Promise(resolve => {
      el.animate(direction === 'in' ? slideIn : slideOut, {
        duration: animationDuration,
        iterations: 1,
        fill: 'forwards',
      }).addEventListener('finish', () => resolve())
    })
  }
  const applyAnimation = async (el1, el2, delay) => {
    await Promise.all([animateElement(el1, 'out'), animateElement(el2, 'in')])
    await sleep(delay)
  }

  log(`FakeScreenshare start: delay=${delay} slides=${slides}`)
  const wrapper = document.createElement('div')
  wrapper.setAttribute('id', 'webrtcperf-fake-screenshare')
  wrapper.setAttribute(
    'style',
    'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 99999; background-color: black;',
  )
  document.body.appendChild(wrapper)
  const slidesElements = []
  for (let i = 0; i < slides; i++) {
    const img = document.createElement('img')
    img.setAttribute(
      'src',
      `https://picsum.photos/seed/${i + 1}/${width}/${height}`,
    )
    img.setAttribute(
      'style',
      `position: absolute; width: ${width}px; height: ${height}px; transform: translateX(100%); opacity: 0;`,
    )
    wrapper.appendChild(img)
    slidesElements.push(img)
  }
  let cur = 0
  let running = true
  let timeout = 0
  const loopIteration = async () => {
    const next = cur === slidesElements.length - 1 ? 0 : cur + 1
    await applyAnimation(slidesElements[cur], slidesElements[next], delay)
    cur = next
    if (running) {
      timeout = setTimeout(() => loopIteration())
    }
  }
  loopIteration()

  return () => {
    log(`FakeScreenshare stop`)
    running = false
    clearTimeout(timeout)
    wrapper.remove()
  }
}

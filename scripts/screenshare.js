/* global webrtcperf */

webrtcperf.setupFakeScreenshare = ({
  embed = '',
  slides = 4,
  delay = 5000,
  animationDuration = 1000,
  width = 1920,
  height = 1080,
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
    await webrtcperf.sleep(delay)
  }

  webrtcperf.log(
    `FakeScreenshare start: embed=${embed} slides=${slides} animationDuration=${animationDuration} delay=${delay} width=${width} height=${height}`,
  )
  const wrapper = document.createElement('div')
  wrapper.setAttribute('id', 'webrtcperf-fake-screenshare')
  wrapper.setAttribute(
    'style',
    `all: unset; position: fixed; top: 0; left: 0; width: ${width}px; height: ${height}px; z-index: -1; background-color: black; isolation: isolate; transform-style: flat;`,
  )
  document.body.appendChild(wrapper)
  webrtcperf.GET_DISPLAY_MEDIA_CROP = '#webrtcperf-fake-screenshare'

  let running = true
  let timeout = 0
  if (embed) {
    const el = document.createElement('iframe')
    el.setAttribute('src', embed)
    el.setAttribute('width', width)
    el.setAttribute('height', height)
    el.setAttribute('style', 'padding: 0; margin: 0; border: none;')
    wrapper.appendChild(el)
  } else {
    const slidesElements = []
    for (let i = 0; i < slides; i++) {
      const img = document.createElement('img')
      img.setAttribute('src', `https://picsum.photos/seed/${i + 1}/${width}/${height}`)
      img.setAttribute(
        'style',
        `all: unset; position: absolute; width: ${width}px; height: ${height}px; transform: translateX(100%); opacity: 0;`,
      )
      wrapper.appendChild(img)
      slidesElements.push(img)
    }
    let cur = 0
    const loopIteration = async () => {
      const next = cur === slidesElements.length - 1 ? 0 : cur + 1
      await applyAnimation(slidesElements[cur], slidesElements[next], delay)
      cur = next
      if (running) {
        timeout = setTimeout(() => loopIteration())
      }
    }
    loopIteration()
  }

  return () => {
    webrtcperf.log(`FakeScreenshare stop`)
    running = false
    clearTimeout(timeout)
    wrapper.remove()
  }
}

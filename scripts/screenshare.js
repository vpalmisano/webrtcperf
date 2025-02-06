/* global webrtcperf */

webrtcperf.startFakeScreenshare = (
  {
    embed = '',
    slides = 4,
    images = [],
    delay = 5000,
    animationDuration = 1000,
    width = 1920,
    height = 1080,
    pointerAnimation = 0,
  } = webrtcperf.params.fakeScreenshare,
) => {
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
    `all: unset; position: fixed; top: 0; left: 0; width: ${width}px; height: ${height}px; z-index: 99999; background-color: black; isolation: isolate; transform-style: flat;`,
  )
  document.body.appendChild(wrapper)
  //webrtcperf.GET_DISPLAY_MEDIA_CROP = '#webrtcperf-fake-screenshare'

  if (pointerAnimation) {
    const el = document.createElement('div')
    el.setAttribute(
      'style',
      'all: unset; position: absolute; width: 10px; height: 10px; background-color: red; border-radius: 50%; opacity: 0;',
    )
    wrapper.appendChild(el)
    el.animate(
      [
        { transform: 'translate(50px, 0px)', opacity: 0, offset: 0.0 },
        { transform: 'translate(25px, 25px)', opacity: 1, offset: 100 / pointerAnimation },
        { transform: 'translate(0px, 50px)', opacity: 0, offset: 200 / pointerAnimation },
      ],
      {
        duration: pointerAnimation,
        iterations: Infinity,
        easing: 'ease-in-out',
      },
    )
  }

  if (embed) {
    const el = document.createElement('iframe')
    el.setAttribute('src', embed)
    el.setAttribute('width', width)
    el.setAttribute('height', height)
    el.setAttribute('style', 'padding: 0; margin: 0; border: none;')
    el.setAttribute('frameborder', '0')
    wrapper.appendChild(el)
  } else {
    const slidesElements = []
    for (let i = 0; i < slides; i++) {
      const img = document.createElement('img')
      if ((images || [])[i]) {
        img.setAttribute('src', images[i])
      } else {
        img.setAttribute('src', `https://picsum.photos/seed/${i + 1}/${width}/${height}`)
      }
      img.setAttribute(
        'style',
        `all: unset; position: absolute; width: ${width}px; height: ${height}px; transform: translateX(100%); opacity: 0;`,
      )
      wrapper.appendChild(img)
      slidesElements.push(img)
    }
    let cur = 0
    const loopIteration = async () => {
      if (!document.querySelector('#webrtcperf-fake-screenshare')) return
      const next = cur === slidesElements.length - 1 ? 0 : cur + 1
      await applyAnimation(slidesElements[cur], slidesElements[next], delay)
      cur = next
      setTimeout(() => loopIteration())
    }
    loopIteration()
  }
}

webrtcperf.stopFakeScreenshare = () => {
  const wrapper = document.querySelector('#webrtcperf-fake-screenshare')
  if (!wrapper) return
  wrapper.remove()
}

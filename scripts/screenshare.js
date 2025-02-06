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
  webrtcperf.log(
    `FakeScreenshare start: embed=${embed} slides=${slides} animationDuration=${animationDuration} delay=${delay} width=${width} height=${height}`,
  )
  const wrapper = document.createElement('div')
  wrapper.setAttribute('id', 'webrtcperf-fake-screenshare')
  wrapper.setAttribute(
    'style',
    `all: unset; position: fixed; top: 0; left: 0; width: ${width}px; height: ${height}px; z-index: ${webrtcperf.USE_FAKE_MEDIA ? '-1' : '1'}; background-color: black; isolation: isolate; transform-style: flat;`,
  )
  document.body.appendChild(wrapper)

  if (webrtcperf.USE_FAKE_MEDIA) {
    webrtcperf.GET_DISPLAY_MEDIA_CROP = '#webrtcperf-fake-screenshare'
  }

  // Pointer animation.
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

  // Draw overlay with timestamp.
  let drawTimestamp = null
  if (webrtcperf.enabledForSession(webrtcperf.params.timestampWatermarkVideo)) {
    const canvas = document.createElement('canvas')
    const fontSize = Math.round(height / 18)
    const textHeight = Math.round(height / 15)
    canvas.width = width
    canvas.height = textHeight
    canvas.setAttribute(
      'style',
      `all: unset; position: absolute; top: 0; left: 0; z-index: 1; width: 100%; height: ${textHeight}px;`,
    )
    wrapper.appendChild(canvas)
    const ctx = canvas.getContext('2d')
    ctx.font = `${fontSize}px Noto Mono`
    ctx.textAlign = 'center'
    const participantNameIndex = parseInt(webrtcperf.getParticipantName().split('-')[1]) || 0
    drawTimestamp = () => {
      ctx.fillStyle = 'black'
      ctx.fillRect(0, 0, width, textHeight)
      ctx.fillStyle = 'white'
      const text = `${participantNameIndex}-${Date.now()}`
      ctx.fillText(text, width / 2, fontSize)
    }
  }

  // Slides animation.
  let advanceSlide = null
  if (embed) {
    const el = document.createElement('iframe')
    el.setAttribute('src', embed)
    el.setAttribute('width', width)
    el.setAttribute('height', height)
    el.setAttribute('style', 'padding: 0; margin: 0; border: none;')
    el.setAttribute('frameborder', '0')
    wrapper.appendChild(el)

    let cur = 0
    advanceSlide = async () => {
      if (cur >= slides) {
        cur = 0
        await window.keypressText('iframe', String.fromCharCode(0x24))
      } else {
        await window.keypressText('iframe', ' ')
        cur++
      }
    }
  } else {
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
    advanceSlide = async () => {
      const next = cur === slidesElements.length - 1 ? 0 : cur + 1
      await Promise.all([animateElement(slidesElements[cur], 'out'), animateElement(slidesElements[next], 'in')])
      cur = next
    }
  }

  const loopIteration = async () => {
    if (!document.querySelector('#webrtcperf-fake-screenshare')) return
    if (drawTimestamp) drawTimestamp()
    if (advanceSlide) await advanceSlide()
    setTimeout(() => loopIteration(), delay)
  }
  loopIteration()
}

webrtcperf.stopFakeScreenshare = () => {
  const wrapper = document.querySelector('#webrtcperf-fake-screenshare')
  if (!wrapper) return
  wrapper.remove()
}

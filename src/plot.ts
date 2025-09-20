import { logger } from './utils'

const log = logger('webrtcperf:plot')

export type PlotData = {
  x: (string | number)[]
  y: number[]
  label: string
}

export type PlotOptions = {
  type?: string
  title?: string
  filePath?: string
  min?: number
  max?: number
}

export async function plot(data: PlotData, options: PlotOptions) {
  const {
    CategoryScale,
    Chart,
    LinearScale,
    LineController,
    BarController,
    LineElement,
    BarElement,
    PointElement,
    Legend,
    Title,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
  } = require('chart.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ErrorBarsPlugin = require('chartjs-chart-error-bars')
  Chart.register(
    CategoryScale,
    LineController,
    LineElement,
    BarController,
    LinearScale,
    BarElement,
    PointElement,
    Legend,
    Title,
    ErrorBarsPlugin,
  )
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Canvas } = require('skia-canvas')

  log.debug('plot')

  const canvas = new Canvas(1280, 720)
  const chart = new Chart(canvas, {
    type: options.type || 'line',
    data: {
      labels: data.x,
      datasets: [
        {
          label: data.label,
          data: data.y,
          fill: false,
          borderColor: 'rgb(0, 0, 0)',
          borderWidth: 1,
          pointRadius: 0,
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: !!options.title,
          text: options.title || '',
        },
      },
      scales: {
        y: {
          min: options.min,
          max: options.max,
        },
      },
    },
  })
  await canvas.toFile(options.filePath || 'plot.png', { format: 'png', matte: 'white' })
  chart.destroy()
}

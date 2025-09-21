import fs from 'fs'

import { logger } from './utils'

const log = logger('webrtcperf:plot')

export type PlotOptions = {
  type?: string
  title?: string
  xLabel?: string
  yLabel?: string
  yMin?: number
  yMax?: number
  labels?: (string | number)[]
  filePath?: string
}

export type PlotData = {
  label: string
  data: { x: number | string; y: number }[]
}

const SERIES_COLORS = [
  'rgba(33, 150, 243, 1)',
  'rgba(244, 67, 54, 1)',
  'rgba(76, 175, 80, 1)',
  'rgba(255, 193, 7, 1)',
  'rgba(156, 39, 176, 1)',
]

export function plotConfig(options: PlotOptions, series: PlotData[]) {
  log.debug('plotConfig')

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type: (options.type || 'line') as any,
    data: {
      labels: options.labels,
      datasets: series.map((s, i) => ({
        fill: false,
        backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length],
        borderColor: SERIES_COLORS[i % SERIES_COLORS.length],
        borderWidth: 1,
        pointRadius: 0,
        ...s,
      })),
    },
    options: {
      plugins: {
        title: options.title
          ? {
              display: true,
              text: options.title,
            }
          : undefined,
      },
      scales: {
        x: {
          title: options.xLabel
            ? {
                display: true,
                text: options.xLabel,
              }
            : undefined,
        },
        y: {
          title: options.yLabel
            ? {
                display: true,
                text: options.yLabel,
              }
            : undefined,
          min: options.yMin,
          max: options.yMax,
        },
      },
    },
  }
}

export async function plot(options: PlotOptions, series: PlotData[]) {
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
  } = await import('chart.js')
  const { BarWithErrorBar, BarWithErrorBarsController } = await import('chartjs-chart-error-bars')
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
    BarWithErrorBar,
    BarWithErrorBarsController,
  )
  const { Canvas } = await import('skia-canvas')

  log.debug('plot')
  const config = plotConfig(options, series)
  const canvas = new Canvas(1280, 720)
  const chart = new Chart(canvas as unknown as HTMLCanvasElement, config)
  await canvas.toFile(options.filePath || 'plot.png', { format: 'png', matte: 'white' })
  chart.destroy()
}

export async function plotHtml(options: PlotOptions, series: PlotData[]) {
  log.debug('plotHtml')
  const config = plotConfig(options, series)

  const data = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.title || 'Plot'}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-chart-error-bars"></script>
  <script src="https://cdn.jsdelivr.net/npm/hammerjs"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom"></script>
</head>
<body>
  <div>
    <canvas id="chart"></canvas>
  </div>
  <script>
    const ctx = document.getElementById('chart');
    const chart = new Chart(ctx, ${JSON.stringify(config)});
  </script>
</body>
</html>`
  await fs.promises.writeFile(options.filePath || 'plot.html', data)
}

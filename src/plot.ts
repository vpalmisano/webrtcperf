import fs from 'fs'

import { logger } from './utils'
import json5 from 'json5'
import { formatThrottleRule, parseStatsFile, parseThrottleRule, StatsRow } from './scenarios'
import path from 'path'

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
  data: { x: number | string; y: number; yMin?: number; yMax?: number }[]
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
    options: {
      plugins: {
        title: options.title
          ? {
              display: true,
              text: options.title,
            }
          : undefined,
        zoom: {
          pan: {
            enabled: true,
            mode: 'x',
            modifierKey: 'ctrl',
          },
          zoom: {
            drag: {
              enabled: true,
            },
            mode: 'x',
          },
        },
      },
      scales: {
        x: {
          type: 'category',
          title: options.xLabel
            ? {
                display: true,
                text: options.xLabel,
              }
            : undefined,
        },
        y: {
          type: 'linear',
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
    const chart = new Chart(ctx, ${json5.stringify(config)});
    chart.options.onClick = e => e.chart.resetZoom();
    addEventListener('resize', () => chart.resize());
  </script>
</body>
</html>`
  await fs.promises.writeFile(options.filePath || 'plot.html', data)
}

function groupByParticipant(rows: StatsRow[]) {
  const m = new Map<string, StatsRow[]>()
  for (const r of rows) {
    if (!r.participantName) continue
    const p = r.participantName as string
    if (!m.has(p)) m.set(p, [])
    m.get(p)!.push(r)
  }
  return m
}

export async function plotDetailedStatsDashboardSinglePage(statsFile: string, outFile = 'plot.html') {
  const rows = await parseStatsFile(statsFile)
  if (rows.length === 0) {
    log.warn('No stats found')
    return
  }

  const byParticipant = groupByParticipant(rows)
  const participants = Array.from(byParticipant.keys()).sort()

  type ChartSpec = { id: string; title: string; yLabel: string; datasets: PlotData[] }
  const charts: ChartSpec[] = []

  const build = (id: string, title: string, yLabel: string, processValue?: (value: number) => number) => {
    const series: PlotData[] = []
    for (const [participant, rows] of byParticipant.entries()) {
      const dataPerTrack = new Map<string, { x: number; y: number }[]>()
      for (const r of rows) {
        const trackId = (r.trackId as string) || ''
        if (!dataPerTrack.has(trackId)) dataPerTrack.set(trackId, [])
        const data = dataPerTrack.get(trackId)!
        const v = r[id] as number
        if (v !== undefined) data.push({ x: r.datetime as number, y: processValue ? processValue(v) : v })
      }
      dataPerTrack.forEach((data, trackId) => {
        if (data.length) series.push({ label: `${participant}${trackId ? ` (${trackId})` : ''}`, data: data })
      })
    }
    charts.push({ id, title, yLabel, datasets: series })
  }

  build('pageCpu', 'Page CPU', '%')
  build('pageMemory', 'Page memory', 'MB')
  build('peerConnectionConnectionTime', 'Peer connection connection time', 's')
  build('peerConnectionDisconnectionTime', 'Peer connection disconnection time', 's')

  const ms = (v: number) => v * 1000

  // Send
  {
    build('audioSentBitrates', 'Sent audio bitrate', 'Kbps', v => v / 1000)
    build('audioSentPacketsLossRate', 'Send audio loss', '%', v => v * 100)
    build('audioSentRoundTripTime', 'Send audio RTT', 'ms', ms)
    build('audioSentJitter', 'Send audio jitter', 'ms', ms)
  }

  {
    build('videoSentBitrates', 'Sent video bitrate', 'Kbps', v => v / 1000)
    build('videoSentPacketsLossRate', 'Send video loss', '%', v => v * 100)
    build('videoSentRoundTripTime', 'Send video RTT', 'ms', ms)
    build('videoSentJitter', 'Send video jitter', 'ms', ms)

    build('videoSentWidth', 'Send video width', 'px')
    build('videoSentHeight', 'Send video height', 'px')
    build('videoSentFps', 'Send video framerate', 'fps')
    build('videoQualityLimitationCpu', 'Send video CPU limitation', '%')
  }

  {
    build('screenSentBitrates', 'Sent screen bitrate', 'Kbps', v => v / 1000)
    build('screenSentPacketsLossRate', 'Send screen loss', '%', v => v * 100)
    build('screenSentRoundTripTime', 'Send screen RTT', 'ms', ms)
    build('screenSentJitter', 'Send screen jitter', 'ms', ms)

    build('screenSentWidth', 'Send screen width', 'px')
    build('screenSentHeight', 'Send screen height', 'px')
    build('screenSentFps', 'Send screen framerate', 'fps')
    build('screenQualityLimitationCpu', 'Send screen CPU limitation', '%')
  }

  // Recv
  {
    build('audioRecvBitrates', 'Recv audio bitrate', 'Kbps', v => v / 1000)
    build('audioRecvPacketsLossRate', 'Recv audio loss', '%', v => v * 100)
    build('audioRecvJitter', 'Recv audio jitter', 'ms', ms)
    build('audioRecvAvgJitterBufferDelay', 'Recv audio jitter buffer', 'ms', ms)
  }

  {
    build('videoRecvBitrates', 'Recv video bitrate', 'Kbps', v => v / 1000)
    build('videoRecvPacketsLossRate', 'Recv video loss', '%', v => v * 100)
    build('videoRecvJitter', 'Recv video jitter', 'ms', ms)
    build('videoRecvAvgJitterBufferDelay', 'Recv video jitter buffer', 'ms', ms)

    build('videoRecvWidth', 'Recv video width', 'px')
    build('videoRecvHeight', 'Recv video height', 'px')
    build('videoRecvFps', 'Recv video framerate', 'fps')
    build('videoTotalFreezesDuration', 'Recv video freezes', 'count')
  }

  {
    build('screenRecvBitrates', 'Recv screen bitrate', 'Kbps', v => v / 1000)
    build('screenRecvPacketsLossRate', 'Recv screen loss', '%', v => v * 100)
    build('screenRecvJitter', 'Recv screen jitter', 'ms', ms)
    build('screenRecvAvgJitterBufferDelay', 'Recv screen jitter buffer', 'ms', ms)

    build('screenRecvWidth', 'Recv screen width', 'px')
    build('screenRecvHeight', 'Recv screen height', 'px')
    build('screenRecvFps', 'Recv screen framerate', 'fps')
    build('screenTotalFreezesDuration', 'Recv screen freezes', 'count')
  }

  // Other
  build('transportSentAvailableOutgoingBitrate', 'Send available bitrate', 'Kbps', v => v / 1000)

  const [_, id, scenario] = path.basename(path.dirname(statsFile)).split('_')
  const description = formatThrottleRule(parseThrottleRule(scenario), true, false)

  const data = `\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${id} (${description})</title>
  <link rel="icon" href="https://raw.githubusercontent.com/vpalmisano/webrtcperf/devel/media/logo.svg">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-chart-error-bars"></script>
  <script src="https://cdn.jsdelivr.net/npm/hammerjs"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom"></script>
  <script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
  <link href="https://cdn.jsdelivr.net/npm/@mdi/font@7.x/css/materialdesignicons.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/vuetify@3.7.2/dist/vuetify.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/vuetify@3.7.2/dist/vuetify.min.js"></script>
</head>
<body>
  <div id="app">
    <v-app>
      <v-main>
        <v-app-bar color="primary" density="compact">
          <v-app-bar-title><b>${id}</b> (${description})</v-app-bar-title>
          <template v-slot:append>
          </template>
        </v-app-bar>
        <v-container fluid>
          <v-row class="align-top mb-3" dense>
            <v-select :items="participants" v-model="selected" label="Participant" variant="outlined" density="compact"></v-select>
          </v-row>
          <v-row dense>
            <v-col v-for="c in charts" :key="c.id" cols="12" :md="isExpanded(c.id) ? 12 : 3">
              <v-card color="primary" variant="outlined">
                <v-card-title class="text-subtitle-1 d-flex align-center flex-nowrap">
                  <span class="text-truncate">{{ c.title }}</span>
                  <v-spacer></v-spacer>
                  <v-icon size="x-small" title="Toggle expanded" @click="toggleExpanded(c)">{{ isExpanded(c.id) ? 'mdi-arrow-collapse-horizontal' : 'mdi-arrow-expand-horizontal' }}</v-icon>
                </v-card-title>
                <v-card-text>
                  <canvas :id="c.id"></canvas>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </v-container>
      </v-main>
    </v-app>
  </div>

  <script>
    const { createApp, onMounted, nextTick, watch, ref } = Vue;
    const vuetify = Vuetify.createVuetify();
    const PARTICIPANTS = ${json5.stringify(['All', ...participants])};
    const CHARTS = ${json5.stringify(charts)};
    const SERIES_COLORS = ${json5.stringify(SERIES_COLORS)};

    function fmtTime(v) {
      const d = new Date(Number(v));
      if (!isFinite(d.getTime())) return v;
      const pad = n => String(n).padStart(2, '0');
      return pad(d.getHours()) + ':' + pad(d.getMinutes())
    }

    function buildDatasets(datasets, selected) {
      const filtered = selected === 'All' ? datasets : datasets.filter(d => d.label.startsWith(selected));
      return filtered.map((s, i) => ({
        label: s.label,
        data: s.data,
        fill: false,
        backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length],
        borderColor: SERIES_COLORS[i % SERIES_COLORS.length],
        borderWidth: 1,
        pointRadius: 0,
      }));
    }

    createApp({
      setup() {
        const participants = ref(PARTICIPANTS);
        const selected = ref('All');
        const charts = ref(CHARTS);
        const chartInstances = new Map();
        const expanded = ref(new Set());

        function onPanZoom({ chart }) {
          const x = chart.scales.x;
          if (!x) return;
          // Sync zoom level across all charts
          for (const { chart: otherChart } of chartInstances.values()) {
            if (otherChart !== chart) {
              const otherX = otherChart.scales.x;
              if (otherX) {
                otherX.options.min = x.min;
                otherX.options.max = x.max;
                otherChart.update('none');
              }
            }
          }
        }

        function createPanel(chartSpec) {
          const canvas = document.getElementById(chartSpec.id);
          if (!canvas) return;
          const ctx = canvas.getContext('2d');
          const chart = new Chart(ctx, {
            type: 'line',
            options: {
              plugins: {
                zoom: {
                    pan: {
                      enabled: true,
                      mode: 'x',
                      modifierKey: 'ctrl',
                      onPan: onPanZoom,
                    },
                    zoom: {
                      drag: { enabled: true },
                      mode: 'x',
                      onZoom: onPanZoom,
                    },
                },
                legend: { display: true },
                tooltip: { callbacks: { title: (items) => items && items.length ? fmtTime(items[0].parsed.x) : '' } },
              },
              scales: {
                x: { type: 'linear', title: { display: false, text: 'Time' }, ticks: { display: true, callback: (value) => fmtTime(value) } },
                y: { type: 'linear', title: { display: true, text: chartSpec.yLabel } },
              },
            },
            data: { datasets: buildDatasets(chartSpec.datasets, selected.value) },
          });
          chartInstances.set(chartSpec.id, { chart, spec: chartSpec });

          canvas.addEventListener('contextmenu', e => {
            e.preventDefault();
            resetZoom();
          });
        }

        function rebuildCharts() {
          for (const { chart } of chartInstances.values()) chart.destroy();
          chartInstances.clear();
          nextTick(() => charts.value.forEach(createPanel));
        }

        function applyFilter() {
          for (const { chart, spec } of chartInstances.values()) {
            chart.data.datasets = buildDatasets(spec.datasets, selected.value);
            chart.update();
          }
        }

        function resetZoom() {
          for (const { chart } of chartInstances.values()) {
            chart.resetZoom('none');
            if (chart.scales.x) {
              chart.scales.x.options.min = undefined;
              chart.scales.x.options.max = undefined;
            }
            chart.update('none');
          }
        }

        function toggleExpanded(c) {
          const id = c.id;
          const s = new Set(expanded.value);
          if (s.has(id)) s.delete(id); else s.add(id);
          expanded.value = s;
          nextTick(() => { const entry = chartInstances.get(id); entry?.chart?.resize(); });
        }

        function isExpanded(id) {
          return expanded.value.has(id);
        }

        onMounted(() => {
          nextTick(() => charts.value.forEach(createPanel));
          window.addEventListener('resize', () => { for (const { chart } of chartInstances.values()) chart.resize(); });
        });

        watch(selected, () => applyFilter());

        return { participants, selected, charts, resetZoom, toggleExpanded, isExpanded };
      }
    }).use(vuetify).mount('#app');
  </script>
</body>
</html>`

  await fs.promises.writeFile(outFile, data)
}

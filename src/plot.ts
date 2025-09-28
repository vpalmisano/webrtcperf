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

export async function plotDetailedStatsDashboard(statsFile: string, outFile = 'plot.html') {
  const rows = await parseStatsFile(statsFile)
  if (rows.length === 0) {
    log.warn('No stats found')
    return
  }

  const byParticipant = groupByParticipant(rows)
  const participants = Array.from(byParticipant.keys()).sort()

  type ChartSpec = { id: string; title?: string; yLabel?: string; datasets?: PlotData[]; width?: number }
  const charts: ChartSpec[] = []

  const build = (
    id: string,
    title?: string,
    yLabel?: string,
    processValue?: (value: number) => number,
    width?: number,
  ) => {
    const series: PlotData[] = []
    if (!id.startsWith('_')) {
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
    }
    charts.push({ id, title, yLabel, datasets: series, width })
  }

  const kbps = (v: number) => v / 1000
  const percent = (v: number) => v * 100
  const ms = (v: number) => v * 1000

  ;[
    { id: '_throttle', title: 'Throttle settings' },
    { id: 'throttleUpRate', title: 'Throttle up rate', yLabel: 'Kbps', processValue: kbps, width: 2 },
    { id: 'throttleUpDelay', title: 'Throttle up delay', yLabel: 'ms', processValue: ms, width: 2 },
    { id: 'throttleUpLoss', title: 'Throttle up loss', yLabel: '%', processValue: percent, width: 2 },
    { id: 'throttleDownRate', title: 'Throttle down rate', yLabel: 'Kbps', processValue: kbps, width: 2 },
    { id: 'throttleDownDelay', title: 'Throttle down delay', yLabel: 'ms', processValue: ms, width: 2 },
    { id: 'throttleDownLoss', title: 'Throttle down loss', yLabel: '%', processValue: percent, width: 2 },
    // Performance / Connectivity
    { id: '_performance', title: 'Performance / Connectivity' },
    { id: 'pageCpu', title: 'Page CPU', yLabel: '%' },
    { id: 'pageMemory', title: 'Page memory', yLabel: 'MB' },
    { id: 'peerConnectionConnectionTime', title: 'Peer connection connection time', yLabel: 's' },
    { id: 'peerConnectionDisconnectionTime', title: 'Peer connection disconnection time', yLabel: 's' },
    // Sent audio
    { id: '_sentAudio', title: 'Sent audio' },
    { id: 'audioSentBitrates', title: 'Sent audio bitrate', yLabel: 'Kbps', processValue: kbps },
    { id: 'audioSentPacketsLossRate', title: 'Send audio loss', yLabel: '%', processValue: percent },
    { id: 'audioSentRoundTripTime', title: 'Send audio RTT', yLabel: 'ms', processValue: ms },
    { id: 'audioSentJitter', title: 'Send audio jitter', yLabel: 'ms', processValue: ms },
    // Sent video
    { id: '_sentVideo', title: 'Sent video' },
    { id: 'videoSentBitrates', title: 'Sent video bitrate', yLabel: 'Kbps', processValue: kbps },
    { id: 'videoSentPacketsLossRate', title: 'Send video loss', yLabel: '%', processValue: percent },
    { id: 'videoSentRoundTripTime', title: 'Send video RTT', yLabel: 'ms', processValue: ms },
    { id: 'videoSentJitter', title: 'Send video jitter', yLabel: 'ms', processValue: ms },
    { id: 'videoSentWidth', title: 'Send video width', yLabel: 'px' },
    { id: 'videoSentHeight', title: 'Send video height', yLabel: 'px' },
    { id: 'videoSentFps', title: 'Send video framerate', yLabel: 'fps' },
    { id: 'videoQualityLimitationCpu', title: 'Send video CPU limitation', yLabel: '%' },
    { id: 'videoQualityLimitationBandwidth', title: 'Send video bandwidth limitation', yLabel: '%' },
    { id: 'videoFirCountReceived', title: 'Send video FIR count', yLabel: 'count' },
    { id: 'videoPliCountReceived', title: 'Send video PLI count', yLabel: 'count' },
    {
      id: 'transportSentAvailableOutgoingBitrate',
      title: 'Send available bitrate',
      yLabel: 'Kbps',
      processValue: kbps,
    },
    // Sent screen
    { id: '_sentScreen', title: 'Sent screen' },
    { id: 'screenSentBitrates', title: 'Sent screen bitrate', yLabel: 'Kbps', processValue: kbps },
    { id: 'screenSentPacketsLossRate', title: 'Send screen loss', yLabel: '%', processValue: percent },
    { id: 'screenSentRoundTripTime', title: 'Send screen RTT', yLabel: 'ms', processValue: ms },
    { id: 'screenSentJitter', title: 'Send screen jitter', yLabel: 'ms', processValue: ms },
    { id: 'screenSentWidth', title: 'Send screen width', yLabel: 'px' },
    { id: 'screenSentHeight', title: 'Send screen height', yLabel: 'px' },
    { id: 'screenSentFps', title: 'Send screen framerate', yLabel: 'fps' },
    { id: 'screenQualityLimitationCpu', title: 'Send screen CPU limitation', yLabel: '%' },
    { id: 'screenQualityLimitationBandwidth', title: 'Send screen bandwidth limitation', yLabel: '%' },
    { id: 'screenFirCountReceived', title: 'Send screen FIR count', yLabel: 'count' },
    { id: 'screenPliCountReceived', title: 'Send screen PLI count', yLabel: 'count' },
    { id: '' },
    // Recv audio
    { id: '_recvAudio', title: 'Recv audio' },
    { id: 'audioRecvBitrates', title: 'Recv audio bitrate', yLabel: 'Kbps', processValue: kbps },
    { id: 'audioRecvPacketsLossRate', title: 'Recv audio loss', yLabel: '%', processValue: percent },
    { id: 'audioRecvJitter', title: 'Recv audio jitter', yLabel: 'ms', processValue: ms },
    { id: 'audioRecvAvgJitterBufferDelay', title: 'Recv audio jitter buffer', yLabel: 'ms', processValue: ms },
    { id: 'audioRecvLevel', title: 'Recv audio level', yLabel: 'db' },
    { id: 'audioRecvConcealmentEvents', title: 'Recv audio concealment events', yLabel: 'count' },
    {
      id: 'audioRecvInsertedSamplesForDeceleration',
      title: 'Recv audio inserted samples',
      yLabel: 'count',
    },
    {
      id: 'audioRecvRemovedSamplesForAcceleration',
      title: 'Recv audio removed samples',
      yLabel: 'count',
    },
    { id: 'audioRecvEndToEndDelay', title: 'Recv audio end to end delay', yLabel: 'ms', processValue: ms },
    // Recv video
    { id: '_recvVideo', title: 'Recv video' },
    { id: 'videoRecvBitrates', title: 'Recv video bitrate', yLabel: 'Kbps', processValue: kbps },
    { id: 'videoRecvPacketsLossRate', title: 'Recv video loss', yLabel: '%', processValue: percent },
    { id: 'videoRecvJitter', title: 'Recv video jitter', yLabel: 'ms', processValue: ms },
    { id: 'videoRecvAvgJitterBufferDelay', title: 'Recv video jitter buffer', yLabel: 'ms', processValue: ms },
    { id: 'videoRecvWidth', title: 'Recv video width', yLabel: 'px' },
    { id: 'videoRecvHeight', title: 'Recv video height', yLabel: 'px' },
    { id: 'videoRecvFps', title: 'Recv video framerate', yLabel: 'fps' },
    { id: 'videoTotalFreezesDuration', title: 'Recv video freezes', yLabel: 'count' },
    { id: 'videoFirCountSent', title: 'Recv video FIR sent', yLabel: 'count' },
    { id: 'videoPliCountSent', title: 'Recv video PLI sent', yLabel: 'count' },
    { id: 'videoRecvEndToEndDelay', title: 'Recv video end to end delay', yLabel: 'ms', processValue: ms },
    { id: '' },
    // Recv screen
    { id: '_recvScreen', title: 'Recv screen' },
    { id: 'screenRecvBitrates', title: 'Recv screen bitrate', yLabel: 'Kbps', processValue: kbps },
    { id: 'screenRecvPacketsLossRate', title: 'Recv screen loss', yLabel: '%', processValue: percent },
    { id: 'screenRecvJitter', title: 'Recv screen jitter', yLabel: 'ms', processValue: ms },
    { id: 'screenRecvAvgJitterBufferDelay', title: 'Recv screen jitter buffer', yLabel: 'ms', processValue: ms },
    { id: 'screenRecvWidth', title: 'Recv screen width', yLabel: 'px' },
    { id: 'screenRecvHeight', title: 'Recv screen height', yLabel: 'px' },
    { id: 'screenRecvFps', title: 'Recv screen framerate', yLabel: 'fps' },
    { id: 'screenTotalFreezesDuration', title: 'Recv screen freezes', yLabel: 'count' },
    { id: 'screenFirCountSent', title: 'Recv screen FIR sent', yLabel: 'count' },
    { id: 'screenPliCountSent', title: 'Recv screen PLI sent', yLabel: 'count' },
    { id: 'screenRecvEndToEndDelay', title: 'Recv screen end to end delay', yLabel: 'ms', processValue: ms },
    { id: '' },
  ].forEach(graph => {
    build(graph.id, graph.title, graph.yLabel, graph.processValue, graph.width)
  })

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
            <v-select color="primary" :items="participants" v-model="selected" label="Participant" variant="outlined" density="compact"></v-select>
          </v-row>
          <v-row dense>
            <v-col v-for="c in charts" :key="c.id" cols="12" :md="isExpanded(c.id) ? 12 : c.width || 3">
              <template v-if="c.id">
                <v-card color="primary" :variant="c.id.startsWith('_') ? 'tonal' : 'text'">
                  <v-card-title class="text-subtitle-1 d-flex align-center flex-nowrap" @click="toggleExpanded(c)" style="cursor: pointer;">
                    <span class="text-truncate">{{ c.title }}</span>
                  </v-card-title>
                  <v-card-text v-if="!c.id.startsWith('_')" style="min-height: 250px;">
                    <canvas :id="c.id"></canvas>
                  </v-card-text>
                </v-card>
              </template>
              <template v-else>
                <div class="empty-slot"></div>
              </template>
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
              maintainAspectRatio: false,
              layout: {
                padding: 0,
                animation: false,
              },
              plugins: {
                legend: { 
                  display: true,
                  position: 'bottom',
                  align: 'start',
                  maxHeight: 50,
                  labels: {
                    boxWidth: 8,
                    boxHeight: 8,
                    font: {
                      size: 8,
                      lineHeight: 1,
                    },
                  },
                },
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
          return id.startsWith('_') || expanded.value.has(id);
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

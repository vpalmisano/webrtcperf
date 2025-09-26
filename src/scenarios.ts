import fs from 'fs'
import path from 'path'
import { FastStats } from './stats'
import { ThrottleConfig, ThrottleRule } from '@vpalmisano/throttler'
import { Config } from './config'
import { Auth, google } from 'googleapis'
import { logger } from './utils'
import { sprintf } from 'sprintf-js'
import { PlotData, plotHtml } from './plot'

const log = logger('webrtcperf:scenarios')

/**
 * It parses a CSV stats file and returns an array of objects representing each row.
 * @param filePath The path to the CSV stats file.
 * @returns An array of objects where each object represents a row in the CSV file with keys as column headers.
 */
export async function parseStatsFile(filePath: string) {
  log.debug(`parseStatsFile: ${filePath}`)
  const fileData = await fs.promises.readFile(filePath, 'utf-8')
  const lines = fileData.split('\n')
  const headers = lines[0].split(',')
  const data = lines.slice(1).map(line =>
    line.split(',').reduce(
      (acc, value, index) => {
        if (value !== '') {
          acc[headers[index]] = isNaN(Number(value)) ? value : Number(value)
        }
        return acc
      },
      {} as Record<string, string | number>,
    ),
  )
  return data
}

export type StatsSummary = {
  timestamp: number
  id: string
  scenario: string
  videoRecvBitratePerPixel: FastStats
  videoRecvFps: FastStats
  videoSentFps: FastStats
}

/**
 * It aggregates the stats summary from multiple test runs in a directory.
 * @param options.dirPath Directory path containing test run subdirectories. Default is 'logs'.
 * @param options.senderParticipantName Participant name of the sender. Default is 'Participant-000001'.
 * @param options.receiverParticipantName Participant name of the receiver. Default is 'Participant-000000'.
 * @param options.nameParser Function to parse test directory names. Default splits by '_' and extracts id and scenario.
 * @returns Array of aggregated stats including timestamp, id, scenario, videoRecvBitratePerPixel, videoRecvFps, and videoSentFps.
 */
export async function aggregateStatsSummary({
  dirPath = 'logs',
  senderParticipantName = 'Participant-000001',
  receiverParticipantName = 'Participant-000000',
  nameParser = (name: string) => {
    const [_, id, scenario] = name.split('_')
    return { id, scenario }
  },
}) {
  log.debug(`aggregateStatsSummary: ${dirPath}`)
  const stats: StatsSummary[] = []
  const results = await fs.promises.readdir(dirPath)
  for (const test of results) {
    const filePath = path.join(dirPath, test, 'detailed-stats-summary.csv')
    if (!fs.existsSync(filePath)) continue
    const timestamp = fs.statSync(path.join(dirPath, test)).ctime.getTime()
    const data = await parseStatsFile(filePath)
    const { id, scenario } = nameParser(test)

    const aggregated = {
      timestamp,
      id,
      scenario,
      videoRecvBitratePerPixel: new FastStats(),
      videoRecvFps: new FastStats(),
      videoSentFps: new FastStats(),
    }
    data.forEach(v => {
      const { participantName, trackId } = v as { participantName: string; trackId: string }
      const metrics = v as Record<string, number>
      if (participantName === receiverParticipantName) {
        if (trackId?.endsWith('-v') && metrics.videoRecvFrames > 0) {
          const videoRecvBitratePerPixel =
            metrics.videoRecvBitrates / (metrics.videoRecvWidth * metrics.videoRecvHeight)
          if (!isNaN(videoRecvBitratePerPixel)) aggregated.videoRecvBitratePerPixel.push(videoRecvBitratePerPixel)
          if (!isNaN(metrics.videoRecvFps)) aggregated.videoRecvFps.push(metrics.videoRecvFps)
        }
      } else if (participantName === senderParticipantName) {
        if (trackId?.endsWith('-v') && metrics.videoSentFrames > 0) {
          if (!isNaN(metrics.videoSentFps)) aggregated.videoSentFps.push(metrics.videoSentFps)
        }
      }
    })
    stats.push(aggregated)
  }
  return stats.sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * It uploads the aggregated stats to a Google Sheet.
 * A valid Google service account credentials file must be specified
 * in the `GOOGLE_CREDENTIALS_PATH` environment variable.
 * @param stats The aggregated stats to upload.
 * @param spreadsheetId The ID of the Google Spreadsheet.
 * @param table The name of the table (sheet) within the spreadsheet. Default is 'data'.
 */
export async function uploadStatsToGoogleSheet(stats: StatsSummary[], spreadsheetId: string, table = 'data') {
  log.debug(`uploadResultsToGoogleSheet spreadsheetId: ${spreadsheetId} table: ${table}`)
  if (!process.env.GOOGLE_CREDENTIALS_PATH) throw new Error('GOOGLE_CREDENTIALS_PATH environment variable is not set')
  if (!fs.existsSync(process.env.GOOGLE_CREDENTIALS_PATH))
    throw new Error(`Google credentials file not found: ${process.env.GOOGLE_CREDENTIALS_PATH}`)
  if (!stats.length) return
  const auth = new Auth.GoogleAuth({
    keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  const sheets = google.sheets({ version: 'v4', auth })
  // Update headers.
  const headers = ['datetime', 'id', 'scenario', 'videoRecvBitratePerPixel', 'videoRecvFps']
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${table}!A1:E1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { majorDimension: 'ROWS', values: [headers] },
  })
  // Append values.
  const values = [] as string[][]
  stats.forEach(s => {
    const { timestamp, id, scenario, videoRecvBitratePerPixel, videoRecvFps } = s
    if (!videoRecvBitratePerPixel.length) return
    const datetime = new Date(timestamp).toLocaleString('en-US', {
      timeZone: 'UTC',
      hourCycle: 'h23',
    })
    values.push([
      datetime,
      id,
      formatThrottleRule(parseThrottleRule(scenario), true),
      videoRecvBitratePerPixel.percentile(95).toFixed(3),
      videoRecvFps.percentile(95).toFixed(3),
    ])
  })
  if (values.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${table}!A:E`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { majorDimension: 'ROWS', values },
    })
  }
}

export type ThrottleDirection = 'up' | 'down' | 'bidi'

export function formatBitrate(bitrate: number | undefined, prefix = ' ', pad = true) {
  if (bitrate === undefined) return ''
  let suffix = 'Kbps'
  if (bitrate >= 1000) {
    bitrate /= 1000
    suffix = 'Mbps'
  }
  return `${prefix}${sprintf(`%${pad ? '5' : ''}.4g`, bitrate)}${suffix}`
}

export function formatLoss(loss: number | undefined, prefix = ' ', pad = true) {
  return loss !== undefined ? `${prefix}${loss.toFixed(0).padStart(pad ? 2 : 0, ' ')}%` : ''
}

export function formatDelay(delay: number | undefined, prefix = ' ', pad = true) {
  return delay !== undefined ? `${prefix}${delay.toFixed(0).padStart(pad ? 3 : 0, ' ')}ms` : ''
}

export function formatThrottleRule(
  throttleRule: ThrottleRule & { direction: ThrottleDirection },
  human = false,
  pad = true,
) {
  const { rate, loss, delay, direction } = throttleRule
  return human
    ? `${direction.padEnd(pad ? 4 : 0, ' ')}${formatBitrate(rate, ' ', pad)}${formatLoss(loss, ' ', pad)}${formatDelay(delay, ' ', pad)}`
    : `${direction}-r${rate}-l${loss}-d${delay}`
}

export function parseThrottleRule(throttleDesc: string) {
  const match = throttleDesc.match(/(up|down|bidi)-r(\d+)-l([\d.]+)-d(\d+)/)
  if (!match) throw new Error(`Invalid throttle description: ${throttleDesc}`)
  const direction = match[1] as ThrottleDirection
  const rate = parseInt(match[2])
  const loss = parseInt(match[3])
  const delay = parseInt(match[4])
  return { direction, rate, loss, delay }
}

export async function plotStatsSummary(stats: StatsSummary[]) {
  const labels = new Set<string>()
  const data = {} as Record<string, Record<string, FastStats>>
  stats.forEach(s => {
    const { id, scenario, videoRecvBitratePerPixel } = s
    if (!videoRecvBitratePerPixel.length) return null
    if (!data[id]) {
      data[id] = {}
    }
    const scenarioFormatted = formatThrottleRule(parseThrottleRule(scenario), true, true)
    if (!data[id][scenarioFormatted]) {
      data[id][scenarioFormatted] = new FastStats()
    }
    labels.add(scenarioFormatted)
    data[id][scenarioFormatted].push(videoRecvBitratePerPixel.percentile(95))
  })
  const series: PlotData[] = []
  Object.entries(data)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([id, data]) => {
      const plotData: PlotData = { label: id, data: [] }
      Object.entries(data)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([scenario, stats]) => {
          plotData.data.push({
            x: scenario,
            y: stats.percentile(50),
            yMin: stats.percentile(5),
            yMax: stats.percentile(95),
          })
        })
      series.push(plotData)
    })
  await plotHtml(
    {
      type: 'barWithErrorBars',
      xLabel: 'Scenario',
      yLabel: 'Video Receive Bitrate per Pixel',
      labels: Array.from(labels).sort((a, b) => a.localeCompare(b)),
    },
    series,
  )
}

/**
 * It generates a test configuration with a scenario including 2 participants.
 * The first participant sends video and the second receives it.
 * Both participants send and receive audio.
 * The network conditions are applied according to the specified direction to the sender (`up`),
 * the receiver (`down`) or both (`bidi`).
 * The test is repeated the specified number of times.
 * The output is an array of partial configuration objects that can be used to run the tests
 * with the main application, after merging it with a configuration that includes
 * the destination url (mandatory) and other optional parameters.
 * @param id The unique identifier for the test scenario.
 * @param options.rate The target bandwidth in kbps.
 * @param options.loss The packet loss percentage.
 * @param options.delay The network delay in milliseconds.
 * @param options.direction The direction of the network throttling: 'up', 'down', or 'bidi'.
 * @param repeat The number of times to repeat the test scenario. Default is 1.
 * @returns An array of partial configuration objects for each test scenario.
 */
export async function twoParticipantsWithRateLossDelay(
  id: string,
  { rate, loss, delay, direction }: { rate: number; loss: number; delay: number; direction: ThrottleDirection },
  repeat: 1,
) {
  const throttle: ThrottleConfig = {}
  const queue = 25
  if (direction === 'down' || direction === 'bidi') {
    throttle.down = [
      { rate: 20000, loss: 0, delay: 0, queue },
      { rate, loss, delay, queue, at: 30 },
    ]
  }
  if (direction === 'up' || direction === 'bidi') {
    throttle.up = [
      { rate: 20000, loss: 0, delay, queue },
      { rate, loss, delay, queue, at: 30 },
    ]
  }
  const throttleDesc = formatThrottleRule({ rate, loss, delay, direction })
  const now = Date.now()
  const ret: Partial<Config>[] = []
  for (let i = 0; i < repeat; i++) {
    const basePath = `logs/${now}-${i + 1}_${id}_${throttleDesc}`
    const sessions = direction === 'bidi' ? '0-1' : direction === 'down' ? '0' : '1'
    ret.push({
      sessions: 2,
      runDuration: 60 * 3,
      debuggingPort: 9000,
      prometheusPushgateway: 'http://localhost:9091',
      prometheusPushgatewayJobName: id,
      statsPath: `${basePath}/stats.csv`,
      detailedStatsPath: `${basePath}/detailed-stats.csv`,
      showPageLog: false,
      showStats: false,
      statsInterval: 5,
      scriptParams: JSON.stringify({
        enableMic: '0-1',
        enableCam: '1',
      }),
      throttleConfig: JSON.stringify([
        {
          sessions,
          protocol: 'udp',
          skipSourcePorts: '53,80,443',
          skipDestinationPorts: '53,80,443',
          ...throttle,
        },
      ]),
    })
  }
  return ret
}

import fs from 'fs'
import path from 'path'
import { FastStats } from './stats'
import { ThrottleConfig, ThrottleRule } from '@vpalmisano/throttler'
import { Config } from './config'

export async function parseStatsFile(filePath: string) {
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

export async function aggregateStatsSummary({
  dirPath = 'logs',
  senderParticipantName = 'Participant-000001',
  receiverParticipantName = 'Participant-000000',
  nameParser = (name: string) => {
    const [_, id, scenario] = name.split('_')
    return { id, scenario }
  },
}) {
  const stats = [] as {
    timestamp: number
    id: string
    scenario: string
    videoRecvBitratePerPixel: FastStats
    videoRecvFps: FastStats
    videoSentFps: FastStats
  }[]
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

export type ThrottleDirection = 'up' | 'down' | 'bidi'

export function formatThrottleRule(throttleRule: ThrottleRule, direction: ThrottleDirection) {
  const { rate, loss, delay } = throttleRule
  return `${direction}-r${rate}-l${loss}-d${delay}`
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

export async function simpleTestWithRateLossDelay(
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
  const throttleDesc = formatThrottleRule({ rate, loss, delay }, direction)
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

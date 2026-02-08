import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { getSessionThrottleIndex, startThrottle } from '@vpalmisano/throttler'
import { z } from 'zod'

import { loadConfig } from './config'
import type { Config } from './config'
import { Session } from './session'
import { Stats } from './stats'
import { MediaPath, prepareFakeMedia } from './media'
import { logger } from './utils'

const log = logger('webrtcperf:mcp')

const mcpServer = new McpServer({
  name: 'webrtcperf',
  version: '1.0.0',
})

let stats: Stats
let statsReady: Promise<void>

async function getStats(): Promise<Stats> {
  if (!stats) {
    const [defaultConfig] = await loadConfig(undefined, {
      showStats: false,
    })
    if (!defaultConfig.startTimestamp) {
      defaultConfig.startTimestamp = Date.now()
    }
    stats = new Stats(defaultConfig)
    statsReady = stats.start()
  }
  await statsReady
  return stats
}

async function startSessionHandler(args: {
  config: Record<string, unknown>
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { config } = args
  log.debug('startSessionHandler', config)
  const stats = await getStats()
  const configs = await loadConfig(undefined, config as Partial<Config>)
  const sessionConfig = configs[0]
  const tabsPerSession = sessionConfig.tabsPerSession ?? 1
  const id = stats.consumeSessionId(tabsPerSession)
  const throttleIndex = getSessionThrottleIndex(id)
  const spawnRate = (sessionConfig as Config & { spawnRate?: number }).spawnRate ?? 1
  const spawnPeriod = 1000 / spawnRate
  const throttleConfig = (sessionConfig as Config & { throttleConfig?: string }).throttleConfig
  if (throttleConfig) {
    await startThrottle(throttleConfig)
  }
  const mediaPaths: MediaPath[] = []
  const videoPath = sessionConfig.videoPath
  if (videoPath) {
    for (const vp of videoPath.split(',')) {
      const ret = await prepareFakeMedia({ ...sessionConfig, videoPath: vp })
      mediaPaths.push(ret)
    }
  }
  const mediaPath = mediaPaths.length ? mediaPaths[id % mediaPaths.length] : undefined
  const session = new Session({
    ...sessionConfig,
    throttleIndex,
    spawnPeriod,
    mediaPath,
    id,
  })
  session.once('stop', () => {
    setTimeout(() => startSessionHandler({ config }).catch(() => {}), spawnPeriod)
  })
  stats.addSession(session)
  try {
    await session.start()
  } catch (err) {
    stats.removeSession(session.id)
    throw err
  }
  if (sessionConfig.runDuration) {
    setTimeout(() => {
      session.removeAllListeners()
      session.stop()
      stats.removeSession(session.id)
    }, sessionConfig.runDuration * 1000)
  }
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ message: 'Session created', id }, null, 2),
      },
    ],
  }
}

async function stopSessionHandler(args: { id: number }): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  const { id } = args
  log.debug('stopSessionHandler', id)
  const s = await getStats()
  const session = s.sessions.get(id)
  if (!session) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ message: 'Session not found', id }, null, 2),
        },
      ],
    }
  }
  session.removeAllListeners()
  s.removeSession(id)
  await session.stop()
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ message: 'Session deleted', id }),
      },
    ],
  }
}

async function getSessionsHandler(): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const s = await getStats()
  const sessions = Array.from(s.sessions.entries()).map(([id, session]) => ({
    id,
    stats: session.stats,
  }))
  log.debug('getSessionsHandler', sessions)
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ sessions, count: sessions.length }),
      },
    ],
  }
}

async function getStatsHandler(): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const stats = await getStats()
  log.debug('getStatsHandler')
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(stats.collectedStats),
      },
    ],
  }
}

mcpServer.registerTool(
  'start_session',
  {
    description:
      'Start a new webrtcperf session in-process. Config is the session config object (url, tabsPerSession, throttleConfig, etc.). Returns the created session id.',
    inputSchema: { config: z.record(z.string(), z.unknown()) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  startSessionHandler as any,
)

mcpServer.registerTool(
  'stop_session',
  {
    description: 'Stop a webrtcperf session by id.',
    inputSchema: { id: z.number().int().nonnegative() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stopSessionHandler as any,
)

mcpServer.registerTool(
  'get_sessions',
  {
    description: 'List current webrtcperf sessions (id and stats for each running session).',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSessionsHandler as any,
)

mcpServer.registerTool(
  'get_stats',
  {
    description: 'Get the current webrtcperf stats.',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getStatsHandler as any,
)

export async function mcpRunner(): Promise<void> {
  log.debug('mcpRunner')
  const transport = new StdioServerTransport()
  await mcpServer.connect(transport)
}

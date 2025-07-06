import { getSessionThrottleIndex, startThrottle, stopThrottle } from '@vpalmisano/throttler'
import { paramCase } from 'change-case'
import fs from 'fs'
import json5 from 'json5'

import { Config, getConfigDocs, loadConfig, loadConfigFromPrompt } from './config'
import { MediaPath, prepareFakeMedia } from './media'
import { Server } from './server'
import { Session } from './session'
import { Stats } from './stats'
import {
  checkChromeExecutable,
  getDockerLogsPath,
  logger,
  registerExitHandler,
  resolvePackagePath,
  sleep,
  startRandomActivateAudio,
  stopRandomActivateAudio,
  stopTimers,
} from './utils'
import { calculateVisqolScore } from './visqol'
import { calculateVmafScore, convertToIvf, prepareVideo } from './vmaf'
import path from 'path'
import { markedTerminal } from 'marked-terminal'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { marked } = require('marked')
marked.use(markedTerminal({ reflowText: true, tab: 2 }))

const log = logger('webrtcperf')

function showHelpOrVersion(): void {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    const docs = getConfigDocs()
    let out = marked.parse(`**Webrtcperf parameters**

\`--version\` It shows the package version.
`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.entries(docs).forEach(([name, value]: [string, any]) => {
      out += marked.parse(
        `
\`--${paramCase(name)}\`
${value.doc}
Default value: \`${value.default}\`
`,
      )
    })
    console.log(out)
    process.exit(0)
  } else if (process.argv.includes('--version') || process.argv.includes('-v')) {
    const version = json5.parse(fs.readFileSync(resolvePackagePath('package.json')).toString()).version
    console.log(version)
    process.exit(0)
  }
}

async function postTest(config: Config): Promise<void> {
  // vmaf score.
  if (config.vmafPath) {
    console.log('Calculating VMAF score...')
    try {
      await calculateVmafScore(config)
    } catch (err: unknown) {
      log.error(`vmaf score error: ${(err as Error).stack}`)
    }
  }

  // visqol score
  if (config.visqolPath) {
    console.log('Calculating Visqol score...')
    try {
      await calculateVisqolScore(config)
    } catch (err: unknown) {
      log.error(`visqol score error: ${(err as Error).stack}`)
    }
  }
}

export async function setupApplication(config: Config): Promise<{ stats: Stats; stop: () => Promise<void> }> {
  if (!config.startTimestamp) {
    config.startTimestamp = Date.now()
  }

  // Stats.
  const stats = new Stats(config)
  await stats.start()

  // Control server.
  let server: Server | undefined
  if (config.serverPort) {
    server = new Server(config, stats)
    await server.start()
  }

  // If sessions are set, prepare fake video/audio and start sessions.
  if (config.sessions > 0) {
    // Prepare fake video and audio.
    const mediaPaths: MediaPath[] = []
    if (config.videoPath) {
      for (const videoPath of config.videoPath.split(',')) {
        const ret = await prepareFakeMedia({ ...config, videoPath })
        mediaPaths.push(ret)
      }
    }

    // Network throttle.
    if (config.throttleConfig) {
      await startThrottle(config.throttleConfig)
    }

    // Download browser if necessary.
    if (!config.chromiumUrl && !config.chromiumPath) {
      await checkChromeExecutable()
    }

    // Start session function.
    const startLocalSession = async (id: number, spawnPeriod: number): Promise<void> => {
      const throttleIndex = getSessionThrottleIndex(id)
      const mediaPath = mediaPaths.length ? mediaPaths[id % mediaPaths.length] : undefined
      const session = new Session({
        ...config,
        mediaPath,
        spawnPeriod,
        id,
        throttleIndex,
      })
      session.once('stop', () => {
        console.warn(`Session ${id} stopped, reloading...`)
        setTimeout(startLocalSession, spawnPeriod, id)
      })
      stats.addSession(session)
      await session.start()
    }

    // Start the local sessions.
    if (config.randomAudioPeriod) {
      startRandomActivateAudio(
        stats.sessions,
        config.randomAudioPeriod,
        config.randomAudioProbability,
        config.randomAudioRange,
      )
    }
    const spawnPeriod = 1000 / config.spawnRate
    log.debug(`Starting ${config.sessions} sessions (spawnPeriod: ${spawnPeriod}ms)`)
    const startTime = Date.now()
    for (let i = 0; i < config.sessions; i += 1) {
      const id = stats.consumeSessionId(config.tabsPerSession)
      await startLocalSession(id, spawnPeriod)
      // If not the last session, sleep
      if (i < config.sessions - 1) {
        await sleep(spawnPeriod)
      }
    }
    const elapsed = Math.round((Date.now() - startTime) / 1000)
    const spawnRate = (config.sessions * config.tabsPerSession) / elapsed
    log.debug(`${config.sessions * config.tabsPerSession} pages started in ${elapsed}s (${spawnRate.toFixed(2)}/s)`)
  }

  return {
    stats,
    stop: async (): Promise<void> => {
      log.debug('Stopping')

      stopRandomActivateAudio()

      await stats.stop()

      if (config.throttleConfig) {
        await stopThrottle()
      }

      stopTimers()

      await postTest(config)

      // Copy docker logs to data directory.
      if (config.pageLogPath) {
        try {
          const logPath = await getDockerLogsPath()
          const dataDir = path.dirname(config.pageLogPath)
          await fs.promises.cp(logPath, path.resolve(dataDir, 'docker.log'))
        } catch (err: unknown) {
          log.debug(`docker logs not found: ${(err as Error).message}`)
        }
      }

      server?.stop()

      log.debug('Stopped')
    },
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  showHelpOrVersion()

  let config: Config

  if (process.argv.slice(2).includes('--prompt')) {
    const params = await loadConfigFromPrompt(
      process.argv
        .slice(2)
        .filter(s => !['--prompt', '--dry-run'].includes(s))
        .join(' '),
    )
    if (process.argv.slice(2).includes('--dry-run')) {
      console.log(json5.stringify(params, null, 2))
      process.exit(0)
    }
    config = await loadConfig(undefined, params)
  } else {
    config = await loadConfig(process.argv[2])
  }

  if (config.vmafPrepareVideo) {
    await prepareVideo(config, true)
    process.exit(0)
  }

  if (config.vmafProcessVideo) {
    await convertToIvf(
      config.vmafProcessVideo,
      config.vmafVideoCrop,
      config.vmafKeepSourceFiles,
      config.vmafSkipDuplicated,
    )
    process.exit(0)
  }

  const { stop: stopApplication } = await setupApplication(config)

  const stop = async (): Promise<void> => {
    console.log('Exiting...')

    await stopApplication()

    process.exit(0)
  }
  registerExitHandler(() => stop())

  // Stop after a configured duration.
  if (config.runDuration || config.vmafPath || config.visqolPath) {
    setTimeout(stop, config.runDuration * 1000)
  }

  // Command line interface.
  if (process.stdin && process.stdin.setRawMode) {
    console.log('Press [q] to quit or [x] to exit immediately')
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', async data => {
      log.debug('[stdin]', data[0])
      if (data[0] === 'q'.charCodeAt(0)) {
        try {
          await stop()
        } catch (err: unknown) {
          log.error(`stop error: ${(err as Error).stack}`)
          process.exit(1)
        }
      } else if (data[0] === 'x'.charCodeAt(0)) {
        process.exit(1)
      }
    })
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err)
    process.exit(-1)
  })
}

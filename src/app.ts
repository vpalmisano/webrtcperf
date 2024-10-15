import { getSessionThrottleIndex, startThrottle, stopThrottle } from '@vpalmisano/throttler'
import { paramCase } from 'change-case'
import fs from 'fs'
import json5 from 'json5'
import wrap from 'word-wrap'

import { Config, getConfigDocs, loadConfig } from './config'
import { prepareFakeMedia } from './media'
import { Server } from './server'
import { Session } from './session'
import { Stats } from './stats'
import {
  checkChromeExecutable,
  logger,
  registerExitHandler,
  resolvePackagePath,
  sleep,
  startRandomActivateAudio,
  stopRandomActivateAudio,
  stopTimers,
} from './utils'
import { calculateVisqolScore } from './visqol'
import { calculateVmafScore } from './vmaf'

const log = logger('webrtcperf')

function showHelpOrVersion(): void {
  if (process.argv.findIndex(a => a.localeCompare('--help') === 0) !== -1) {
    const docs = getConfigDocs()
    let out = `Params:\n  --version\n        It shows the package version.\n`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.entries(docs).forEach(([name, value]: [string, any]) => {
      out += `  --${paramCase(name)}
${wrap(value.doc, { width: 72, indent: '        ' })}
        Default: ${value.default}\n`
    })
    console.log(out)
    process.exit(0)
  } else if (process.argv.findIndex(a => a.localeCompare('--version') === 0) !== -1) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const version = json5.parse(fs.readFileSync(resolvePackagePath('package.json')).toString()).version
    console.log(version)
    process.exit(0)
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
  let server: Server
  if (config.serverPort) {
    server = new Server(config, stats)
    await server.start()
  }

  // Prepare fake video and audio.
  const videoPaths: { video: string; audio: string }[] = []
  if (config.videoPath) {
    for (const videoPath of config.videoPath.split(',')) {
      const ret = await prepareFakeMedia({ ...config, videoPath })
      videoPaths.push(ret)
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
    const videoPath = videoPaths.length ? videoPaths[id % videoPaths.length] : undefined
    const session = new Session({
      ...config,
      videoPath,
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
  if (config.sessions > 0) {
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

      if (server) {
        server.stop()
      }

      await stats.stop()

      if (config.throttleConfig) {
        await stopThrottle()
      }

      stopTimers()
      log.debug('Stopped')
    },
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  showHelpOrVersion()

  const config = loadConfig(process.argv[2])

  // vmaf score.
  if (config.vmafPath) {
    await calculateVmafScore(config)
    process.exit(0)
  }

  // visqol score
  if (config.visqolPath) {
    await calculateVisqolScore(config)
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
  if (config.runDuration > 0) {
    setTimeout(stop, config.runDuration * 1000)
  }

  // Command line interface.
  if (process.stdin && process.stdin.setRawMode) {
    console.log('Press [q] to quit')
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

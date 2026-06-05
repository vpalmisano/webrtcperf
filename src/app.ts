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
  handleExitSignals,
  resolvePackagePath,
  runExitHandlersNow,
  sleep,
  startRandomActivateAudio,
  stopRandomActivateAudio,
  stopTimers,
} from './utils'
import { calculateVisqolScore } from './visqol'
import { calculateVmafScore, convertToIvf, prepareVideo } from './vmaf'
import path from 'path'
import { markedTerminal } from 'marked-terminal'
import { EventEmitter } from 'events'
import { runWithDocker } from './docker'
import { plotDetailedStatsDashboard } from './plot'
import { mcpRunner } from './mcp'

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

export class Application extends EventEmitter {
  readonly config: Config
  readonly stats: Stats
  readonly server?: Server
  private mediaPaths: MediaPath[] = []

  constructor(config: Config) {
    super()
    if (!config.startTimestamp) {
      config.startTimestamp = Date.now()
    }
    this.config = config
    this.stats = new Stats(config)
    if (config.serverPort) {
      this.server = new Server(config, this.stats)
    }
  }

  async start() {
    log.debug(`start (runDuration: ${this.config.runDuration})`)
    await this.stats.start()
    if (this.server) {
      await this.server.start()
    }
    const config = this.config

    // Handle vmaf commands.
    if (config.vmafPrepareVideo) {
      await prepareVideo(config, true)
    }
    if (config.vmafProcessVideo) {
      await convertToIvf(
        config.vmafProcessVideo,
        config.vmafVideoCrop,
        config.vmafKeepSourceFiles,
        config.vmafSkipDuplicated,
      )
    }

    // Handle sessions.
    if (config.sessions > 0) {
      // Prepare fake video and audio.
      if (config.videoPath && !this.mediaPaths.length) {
        for (const videoPath of config.videoPath.split(',')) {
          const ret = await prepareFakeMedia({ ...config, videoPath })
          this.mediaPaths.push(ret)
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

      // Start the local sessions.
      if (config.randomAudioPeriod) {
        startRandomActivateAudio(
          this.stats.sessions,
          config.randomAudioPeriod,
          config.randomAudioProbability,
          config.randomAudioRange,
        )
      }
      const spawnPeriod = 1000 / config.spawnRate
      log.debug(`Starting ${config.sessions} sessions (spawnPeriod: ${spawnPeriod}ms)`)
      const startTime = Date.now()
      for (let i = 0; i < config.sessions; i += 1) {
        const id = this.stats.consumeSessionId(config.tabsPerSession)
        await this.startSession(id, spawnPeriod)
        // If not the last session, sleep.
        if (i < config.sessions - 1) {
          await sleep(spawnPeriod)
        }
      }
      const elapsed = Math.round((Date.now() - startTime) / 1000)
      const spawnRate = (config.sessions * config.tabsPerSession) / elapsed
      log.debug(`${config.sessions * config.tabsPerSession} pages started in ${elapsed}s (${spawnRate.toFixed(2)}/s)`)
    }

    if (config.runDuration || config.vmafPath || config.visqolPath) {
      setTimeout(() => this.stop(), config.runDuration * 1000)
    }
  }

  private async startSession(id: number, spawnPeriod: number) {
    log.debug(`startSession ${id}`)
    const throttleIndex = getSessionThrottleIndex(id)
    const mediaPath = this.mediaPaths.length ? this.mediaPaths[id % this.mediaPaths.length] : undefined
    const session = new Session({
      ...this.config,
      mediaPath,
      spawnPeriod,
      id,
      throttleIndex,
    })
    session.once('stop', (_, error) => {
      if (error) {
        console.warn(`Session ${id} stopped with error: ${error.message}, reloading...`)
        setTimeout(() => this.startSession(id, spawnPeriod), spawnPeriod)
      } else {
        this.stats.removeSession(id)
        if (!this.stats.sessions.size) {
          this.stop()
        }
      }
    })
    this.stats.addSession(session)
    await session.start()
  }

  private async postTest() {
    log.debug('postTest')

    // vmaf score.
    if (this.config.vmafPath) {
      console.log('Calculating VMAF score...')
      try {
        await calculateVmafScore(this.config)
      } catch (err: unknown) {
        log.error(`vmaf score error: ${(err as Error).stack}`)
      }
    }

    // visqol score
    if (this.config.visqolPath) {
      console.log('Calculating Visqol score...')
      try {
        await calculateVisqolScore(this.config)
      } catch (err: unknown) {
        log.error(`visqol score error: ${(err as Error).stack}`)
      }
    }
  }

  async stop(canceled = false) {
    log.debug(`stop (canceled: ${canceled})`)

    stopRandomActivateAudio()

    await this.stats.stop()

    if (this.config.throttleConfig) {
      await stopThrottle()
    }

    stopTimers()

    await this.postTest()

    // Copy docker logs to data directory.
    if (this.config.pageLogPath) {
      try {
        const logPath = await getDockerLogsPath()
        const dataDir = path.dirname(this.config.pageLogPath)
        await fs.promises.cp(logPath, path.resolve(dataDir, 'docker.log'))
      } catch (err: unknown) {
        log.debug(`docker logs not found: ${(err as Error).message}`)
      }
    }

    this.server?.stop()

    this.emit('stop', canceled)
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  showHelpOrVersion()
  handleExitSignals()

  process.argv = process.argv.slice(2)

  // Handle docker run.
  if (process.argv.includes('--docker')) {
    process.argv = process.argv.filter(s => s !== '--docker')
    try {
      await runWithDocker(process.argv)
    } catch (err: unknown) {
      log.error(`runWithDocker error: ${(err as Error).stack}`)
      process.exit(1)
    }
    process.exit(0)
  }

  // Handle plot command.
  if (process.argv.includes('--plot')) {
    process.argv = process.argv.filter(s => s !== '--plot')
    try {
      await plotDetailedStatsDashboard(process.argv[0], process.argv[1])
    } catch (err: unknown) {
      log.error(`plotDetailedStatsDashboard error: ${(err as Error).stack}`)
      process.exit(1)
    }
    process.exit(0)
  }

  // Handle MCP command.
  if (process.argv.includes('--mcp')) {
    process.argv = process.argv.filter(s => s !== '--mcp')
    await mcpRunner()
    return
  }

  let configs: Config[]

  // Handle prompt.
  if (process.argv.includes('--prompt')) {
    const dryRun = process.argv.includes('--dry-run')
    process.argv = process.argv.filter(s => !['--prompt', '--dry-run'].includes(s))
    const params = await loadConfigFromPrompt(process.argv.join(' '))
    if (dryRun) {
      console.log(json5.stringify(params, null, 2))
      process.exit(0)
    }
    configs = await loadConfig(undefined, params)
  } else {
    configs = await loadConfig(process.argv[0])
  }

  if (!configs.length) throw new Error('No configuration found')

  let application: Application
  let i = 0
  const total = configs.length
  const runNext = () => {
    const config = configs.splice(0, 1)[0]

    log.info(`Running ${i + 1}/${total}...`)
    application = new Application(config)
    application.once('stop', canceled => {
      if (!canceled && configs.length) {
        i++
        runNext()
      } else {
        runExitHandlersNow()
          .then(() => process.exit(0))
          .catch(err => {
            log.error(`runExitHandlersNow error: ${(err as Error).stack}`)
            process.exit(1)
          })
      }
    })
    return application.start()
  }

  const stop = async () => {
    log.info('Exiting...')
    await application.stop(true)
  }
  registerExitHandler(() => stop())

  await runNext()

  // Command line interface.
  if (process.stdin && process.stdin.setRawMode) {
    console.log('Press [e] to exit after the current test, [q] to exit immediately or [x] to force exit.')
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', async data => {
      log.debug('[stdin]', data[0])
      if (data[0] === 'e'.charCodeAt(0)) {
        log.info(`Exiting after the current test (${i + 1}/${total})...`)
        configs.splice(0)
      } else if (data[0] === 'q'.charCodeAt(0)) {
        try {
          await stop()
        } catch (err: unknown) {
          log.error(`stop error: ${(err as Error).stack}`)
          process.exit(1)
        }
      } else if (data[0] === 'x'.charCodeAt(0)) {
        log.info('Force exiting...')
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

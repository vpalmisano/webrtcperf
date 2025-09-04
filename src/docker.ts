import path from 'path'
import Docker from 'dockerode'
import { logger, resolvePackagePath } from './utils'
import { loadConfig } from './config'
import fs from 'fs'

const log = logger('webrtcperf:docker')

export async function runWithDocker(argv: string[]) {
  const docker = new Docker()
  const configPath = argv.filter(s => s !== '--docker')[0]
  if (!configPath) throw new Error('No configuration file specified')
  const configName = path.basename(configPath)
  const config = (await loadConfig(configPath))[0]

  const startTimestamp = Date.now()
  const dataDir = path.resolve(path.dirname(configPath), 'logs', `${startTimestamp}`)
  await fs.promises.mkdir(dataDir, { recursive: true })

  const binds: string[] = [
    `${path.resolve(configPath)}:/config/${configName}:ro`,
    '/dev/shm:/dev/shm',
    `${dataDir}:/data`,
    '/tmp/webrtcperf-cache:/root/.webrtcperf',
  ]

  if (config.scriptPath) {
    const scriptName = path.basename(config.scriptPath)
    binds.push(`${path.resolve(config.scriptPath)}:/scripts/${scriptName}:ro`)
  }

  if (process.env.DEBUG_SRC) {
    binds.push(`${resolvePackagePath('app.min.js')}:/app/app.min.js:ro`)
  }

  const portBindings: Docker.PortMap = {}
  const exposedPorts: { [portAndProtocol: string]: object } = {}
  if (config.debuggingPort) {
    for (let i = 0; i < config.sessions; i++) {
      const port = `${config.debuggingPort + i}/tcp`
      portBindings[port] = [{ HostPort: `${config.debuggingPort + i}` }]
      exposedPorts[port] = {}
    }
  }

  const env = [
    `DEBUG_LEVEL=${process.env.DEBUG_LEVEL || 'info'}`,
    'SHOW_PAGE_LOG=false',
    'SHOW_STATS=false',
    'SERVER_PORT=5000',
    'SERVER_USE_HTTPS=true',
    'SERVER_DATA=/data',
    `START_TIMESTAMP=${startTimestamp}`,
    `STATS_PATH=/data/stats.csv`,
    `PAGE_LOG_PATH=/data/page.log`,
    `DETAILED_STATS_PATH=/data/detailed-stats.csv`,
  ]

  if (config.scriptPath) {
    const scriptName = path.basename(config.scriptPath)
    env.push(`SCRIPT_PATH=/scripts/${scriptName}`)
  }

  if (config.debuggingPort) {
    env.push(`DEBUGGING_PORT=${config.debuggingPort}`)
  }

  if (config.prometheusPushgateway.startsWith('http://localhost')) {
    env.push('PROMETHEUS_PUSHGATEWAY=http://pushgateway:9091')
  }

  const containerConfig: Docker.ContainerCreateOptions = {
    Image: 'ghcr.io/vpalmisano/webrtcperf:devel',
    name: 'webrtcperf',
    Cmd: [`/config/${configName}`],
    HostConfig: {
      Binds: binds,
      PortBindings: portBindings,
      CapAdd: ['NET_ADMIN'],
      NetworkMode: config.prometheusPushgateway.startsWith('http://localhost') ? 'prometheus-stack_default' : 'bridge',
    },
    Env: env,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    OpenStdin: true,
    StdinOnce: true,
    ExposedPorts: exposedPorts,
  }

  try {
    if (!process.env.DEBUG_SRC) {
      log.info('Pulling latest development image...')
      await docker.pull('ghcr.io/vpalmisano/webrtcperf:devel')
    }

    try {
      const existingContainer = await docker.getContainer('webrtcperf')
      await existingContainer.remove({ force: true })
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err: unknown) {
      // Container doesn't exist, continue
    }

    const container = await docker.createContainer(containerConfig)
    await container.start()

    const stream = await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
    })

    process.stdin.pipe(stream)
    stream.pipe(process.stdout)

    await new Promise(resolve => {
      container.wait((err: Error, data: { StatusCode: number }) => {
        if (err) log.error('Error waiting for container:', data, err.stack)
        resolve(data)
      })
    })

    await container.remove()
  } catch (error) {
    log.error('Docker operation failed:', error)
    throw error
  }
}

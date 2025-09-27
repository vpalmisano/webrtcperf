import Docker from 'dockerode'
import { logger, resolvePackagePath } from './utils'
import { loadConfig } from './config'
import { runShellCommand } from '@vpalmisano/throttler'
import os from 'os'
import fs from 'fs'

const log = logger('webrtcperf:docker')

export async function runWithDocker(argv: string[]) {
  const docker = new Docker()
  const configPath = argv[0]
  if (!configPath) throw new Error('No configuration file specified')
  const configs = await loadConfig(configPath)
  if (!configs.length) throw new Error('Failed to load configuration file')

  const startTimestamp = Date.now()
  const dataDir = process.cwd()
  const tmpDir = os.tmpdir()

  const jsonConfigPath = `${tmpDir}/webrtcperf-config-${startTimestamp}.json`
  await fs.promises.writeFile(jsonConfigPath, JSON.stringify(configs), 'utf-8')

  const binds: string[] = [
    '/dev/shm:/dev/shm',
    `${dataDir}:/data`,
    `${tmpDir}/webrtcperf-cache:/root/.webrtcperf`,
    `${jsonConfigPath}:/tmp/config.json:ro`,
  ]

  if (process.env.DEBUG_SRC) {
    binds.push(`${resolvePackagePath('app.min.js')}:/app/app.min.js:ro`)
  }

  const portBindings: Docker.PortMap = {}
  const exposedPorts: { [portAndProtocol: string]: object } = {}
  if (configs[0].debuggingPort) {
    for (let i = 0; i < configs[0].sessions; i++) {
      const port = `${configs[0].debuggingPort + i}/tcp`
      portBindings[port] = [{ HostPort: `${configs[0].debuggingPort + i}` }]
      exposedPorts[port] = {}
    }
  }

  if (configs[0].throttleConfig && os.platform() === 'linux') {
    await runShellCommand('sudo modprobe ifb numifbs=1')
  }

  const env = [
    `DEBUG_LEVEL=${process.env.DEBUG_LEVEL || 'info'}`,
    'SHOW_PAGE_LOG=false',
    'SHOW_STATS=false',
    'SERVER_PORT=5000',
    'SERVER_USE_HTTPS=true',
    'SERVER_DATA=/data',
    `START_TIMESTAMP=${startTimestamp}`,
    'VIDEO_CACHE_PATH=/root/.webrtcperf/cache',
  ]

  if (configs[0].prometheusPushgateway.startsWith('http://localhost')) {
    env.push('PROMETHEUS_PUSHGATEWAY=http://pushgateway:9091')
  }

  const containerConfig: Docker.ContainerCreateOptions = {
    Image: 'ghcr.io/vpalmisano/webrtcperf:devel',
    name: 'webrtcperf',
    WorkingDir: '/data',
    Cmd: ['/tmp/config.json'],
    HostConfig: {
      Binds: binds,
      PortBindings: portBindings,
      CapAdd: configs[0].throttleConfig && os.platform() === 'linux' ? ['NET_ADMIN'] : [],
      NetworkMode: configs[0].prometheusPushgateway.startsWith('http://localhost')
        ? 'prometheus-stack_default'
        : 'bridge',
      ExtraHosts: process.env.EXTRA_HOSTS ? process.env.EXTRA_HOSTS.split(',').map(h => h.trim()) : [],
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
      log.info('Pulling latest webrtcperf image...')
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

  await fs.promises.unlink(jsonConfigPath)
}

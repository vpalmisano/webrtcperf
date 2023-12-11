import axios from 'axios'
import { exec, spawn } from 'child_process'
import { createHash } from 'crypto'
import * as dns from 'dns'
import fs, { createWriteStream, WriteStream } from 'fs'
import { Agent } from 'https'
import * as ipaddrJs from 'ipaddr.js'
import NodeCache from 'node-cache'
import * as OSUtils from 'node-os-utils'
import os from 'os'
import path, { dirname } from 'path'
import pidtree from 'pidtree'
import pidusage from 'pidusage'
import { BrowserFetcher, Page } from 'puppeteer-core'

import { Session } from './session'

// eslint-disable-next-line
const ps = require('pidusage/lib/ps')

// eslint-disable-next-line @typescript-eslint/no-var-requires
const debugLevel = require('debug-level')

type Logger = {
  error: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  log: (...args: unknown[]) => void
}

export function logger(name: string): Logger {
  return debugLevel(name)
}

export class LoggerInterface {
  name?: string

  private logInit(args: unknown[]): void {
    if (this.name) {
      args.unshift(`[${this.name}]`)
    }
  }

  debug(...args: unknown[]): void {
    this.logInit(args)
    log.debug(...args)
  }

  info(...args: unknown[]): void {
    this.logInit(args)
    log.info(...args)
  }

  warn(...args: unknown[]): void {
    this.logInit(args)
    log.warn(...args)
  }

  error(...args: unknown[]): void {
    this.logInit(args)
    log.error(...args)
  }

  log(...args: unknown[]): void {
    this.logInit(args)
    log.log(...args)
  }
}

const log = logger('app:utils')

let tsNode = false
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tsNode = !!(process as any)[Symbol.for('ts-node.register.instance')]
} catch (_err) {
  // ignore
}

/**
 * Resolves the absolute path from the package installation directory.
 * @param relativePath The relative path.
 * @returns The absolute path.
 */
export function resolvePackagePath(relativePath: string): string {
  return '__nexe' in process
    ? relativePath
    : process.env.WEBPACK
    ? path.join(path.dirname(__filename), relativePath)
    : tsNode
    ? require.resolve(path.join(__dirname, '..', relativePath))
    : require.resolve(path.join(__dirname, '../..', relativePath))
}

/**
 * Calculates the md5 sum.
 * @param data The string input
 */
export function md5(data: string): string {
  return createHash('md5').update(data).digest('hex')
}

const ProcessStatsCache = new NodeCache({ stdTTL: 5, checkperiod: 10 })
const ProcessChildrenCache = new NodeCache({ stdTTL: 5, checkperiod: 10 })

type ProcessStat = {
  cpu: number
  memory: number
}

/**
 * Returns the process stats.
 * @param pid The process pid
 * @param children If process children should be taken into account.
 * @returns
 */
export async function getProcessStats(
  pid = 0,
  children = false,
): Promise<ProcessStat> {
  const processPid = pid || process.pid
  let stat: ProcessStat | undefined = ProcessStatsCache.get(processPid)
  if (stat) {
    return stat
  }

  const pidStats = await pidusage(processPid)
  if (pidStats) {
    stat = {
      cpu: pidStats.cpu,
      memory: pidStats.memory / 1e6,
    }
  } else {
    stat = { cpu: 0, memory: 0 }
  }
  if (children) {
    try {
      let childrenPids: number[] | undefined =
        ProcessChildrenCache.get(processPid)
      if (!childrenPids?.length) {
        childrenPids = await pidtree(processPid)
        if (childrenPids?.length) {
          ProcessChildrenCache.set(processPid, childrenPids)
        }
      }
      if (childrenPids?.length) {
        const pidStats = await pidusage(childrenPids)
        for (const p of childrenPids) {
          if (!pidStats[p]) {
            continue
          }
          stat.cpu += pidStats[p].cpu
          stat.memory += pidStats[p].memory / 1e6
        }
      }
    } catch (err) {
      log.error(`getProcessStats children error: ${(err as Error).stack}`)
    }
  }
  ProcessStatsCache.set(processPid, stat)
  return stat
}

// System stats.
const SystemStatsCache = new NodeCache({ stdTTL: 30, checkperiod: 60 })

export type SystemStats = {
  usedCpu: number
  usedMemory: number
  usedGpu: number
  usedGpuMemory: number
}

async function updateSystemStats(): Promise<void> {
  const [cpu, memInfo, gpuStats] = await Promise.all([
    OSUtils.cpu.free(10000),
    OSUtils.mem.info(),
    systemGpuStats(),
  ])
  const stat = {
    usedCpu: 100 - cpu,
    usedMemory: 100 - memInfo.freeMemPercentage,
    usedGpu: gpuStats.gpu,
    usedGpuMemory: gpuStats.mem,
  }
  SystemStatsCache.set('default', stat)
}

let systemStatsInterval: NodeJS.Timer | null = null

export function getSystemStats(): SystemStats | undefined {
  if (!systemStatsInterval) {
    startUpdateSystemStats()
  }
  return SystemStatsCache.get<SystemStats>('default')
}

export function startUpdateSystemStats(): void {
  if (systemStatsInterval) {
    return
  }
  systemStatsInterval = setInterval(updateSystemStats, 5000)
}

export function stopUpdateSystemStats(): void {
  if (systemStatsInterval) {
    clearInterval(systemStatsInterval)
    systemStatsInterval = null
  }
}

/**
 * Sleeps for the specified amount of time.
 * @param ms
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(() => resolve(), ms))
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getActiveAudioTracks: () => any[]
  let publisherSetMuted: (muted: boolean) => Promise<void>
}

let randomActivateAudioTimeoutId: NodeJS.Timeout | null = null

/**
 * Randomly activate audio from one tab at time.
 * @param sessions The sessions Map
 * @param randomAudioPeriod If set, the function will be called in loop
 * @param randomAudioProbability The activation probability
 * @param randomAudioRange The number of pages to include into the automation
 */
export async function randomActivateAudio(
  sessions: Map<number, Session>,
  randomAudioPeriod: number,
  randomAudioProbability: number,
  randomAudioRange: number,
): Promise<void> {
  if (!randomAudioPeriod) {
    return
  }
  try {
    let pages: (Page | null)[] = []
    for (const session of sessions.values()) {
      const sessionPages = [...session.pages.values()]
      if (randomAudioRange) {
        if (session.id > randomAudioRange) {
          break
        }
        sessionPages.splice(randomAudioRange - session.id)
      }
      pages = pages.concat(sessionPages)
    }
    // Remove pages with not audio tracks.
    for (const [i, page] of pages.entries()) {
      if (!page) {
        continue
      }
      let active = 0
      try {
        active = await page.evaluate(() => getActiveAudioTracks().length)
      } catch (err) {
        log.error(`randomActivateAudio error: ${(err as Error).stack}`)
      }
      if (!active) {
        pages[i] = null
      }
    }
    const pagesWithAudio: Page[] = pages.filter(p => !!p) as Page[]
    //
    const index = Math.floor(Math.random() * pagesWithAudio.length)
    const enable = Math.round(100 * Math.random()) <= randomAudioProbability
    log.debug('randomActivateAudio %j', {
      pages: pagesWithAudio.length,
      randomAudioProbability,
      index,
      enable,
    })
    for (const [i, page] of pagesWithAudio.entries()) {
      try {
        if (i === index) {
          log.debug(
            `Changing audio in page ${i + 1}/${
              pagesWithAudio.length
            } (enable: ${enable})`,
          )
          await page.evaluate(async enable => {
            if (typeof publisherSetMuted !== 'undefined') {
              await publisherSetMuted(!enable)
            } else {
              getActiveAudioTracks().forEach(track => {
                track.enabled = enable
                // track.dispatchEvent(new Event('custom-enabled'));
              })
            }
          }, enable)
        } else {
          await page.evaluate(async () => {
            if (typeof publisherSetMuted !== 'undefined') {
              await publisherSetMuted(true)
            } else {
              getActiveAudioTracks().forEach(track => {
                track.enabled = false
                // track.dispatchEvent(new Event('custom-enabled'));
              })
            }
          })
        }
      } catch (err) {
        log.error(
          `randomActivateAudio in page ${i + 1}/${
            pagesWithAudio.length
          } error: ${(err as Error).stack}`,
        )
      }
    }
  } catch (err) {
    log.error(`randomActivateAudio error: ${(err as Error).stack}`)
  } finally {
    const nextTime = randomAudioPeriod * (1 + Math.random())
    randomActivateAudioTimeoutId && clearTimeout(randomActivateAudioTimeoutId)
    randomActivateAudioTimeoutId = setTimeout(
      randomActivateAudio,
      nextTime * 1000,
      sessions,
      randomAudioPeriod,
      randomAudioProbability,
      randomAudioRange,
    )
  }
}

/**
 * The {@link downloadUrl} output.
 */
export type DownloadData = {
  /** Download data. */
  data: string
  /** Start byte range. */
  start: number
  /** End byte range. */
  end: number
  /** Total returned size. */
  total: number
}

/**
 * Downloads the specified `url` to a local file or returning the file content
 * as {@link DownloadData} object.
 * @param url The remote url to download.
 * @param auth The basic authentication (`user:password`).
 * @param outputLocationPath The file output. If not specified, the download
 * content will be returned as {@link DownloadData} instance.
 * @param range The HTTP byte range to download (e.g. `10-100`).
 */
export async function downloadUrl(
  url: string,
  auth?: string,
  outputLocationPath?: string,
  range?: string,
): Promise<void | DownloadData> {
  log.debug(`downloadUrl url=${url} ${outputLocationPath}`)
  const authParts = auth && auth.split(':')
  let writer: WriteStream | null = null
  if (outputLocationPath) {
    await fs.promises.mkdir(dirname(outputLocationPath), {
      recursive: true,
    })
    writer = createWriteStream(outputLocationPath)
  }
  const response = await axios({
    method: 'get',
    url,
    auth: authParts
      ? {
          username: authParts[0],
          password: authParts[1],
        }
      : undefined,
    headers: range
      ? {
          Range: `bytes=${range}`,
        }
      : undefined,
    timeout: 60000,
    onDownloadProgress: event => {
      log.debug(`downloadUrl fileUrl=${url} progress=${event}`)
    },
    httpsAgent: new Agent({
      rejectUnauthorized: false,
    }),
    responseType: writer ? 'stream' : 'text',
  })
  if (writer) {
    return new Promise((resolve, reject) => {
      if (!writer) {
        return
      }
      response.data.pipe(writer)
      let error: Error | null = null
      writer.on('error', err => {
        error = err
        writer && writer.close()
        reject(err)
      })
      writer.on('close', () => {
        if (!error) {
          resolve()
        }
      })
    })
  } else {
    /* log.debug(`downloadUrl ${response.data.length} bytes, headers=${
      JSON.stringify(response.headers)}`); */
    let start = 0
    let end = 0
    let total = 0
    if (response.headers['content-range']) {
      log.debug(
        `downloadUrl ${response.data.length} bytes, content-range=${response.headers['content-range']}`,
      )
      const contentRange = response.headers['content-range'].split('/')
      const rangeParts = contentRange[0].split('-')
      total = parseInt(contentRange[1])
      if (rangeParts.length === 2) {
        start = parseInt(rangeParts[0])
        end = parseInt(rangeParts[1])
      } else if (contentRange[0].startsWith('-')) {
        end = parseInt(rangeParts[0])
      } else if (contentRange[0].endsWith('-')) {
        start = parseInt(rangeParts[0])
        end = total
      }
    }
    return {
      data: response.data,
      start,
      end,
      total,
    }
  }
}

const HideAuthRegExp = new RegExp('(http[s]{0,1}://)(.+?:.+?@)', 'g')

/**
 * Hides the authentication part from an HTTP url.
 * @param data
 */
export function hideAuth(data: string): string {
  if (!data) {
    return data
  }
  return data.replace(HideAuthRegExp, '$1')
}

/** Exit handler callback. */
export type ExitHandler = (signal: string) => Promise<void>

const exitHandlers: ExitHandler[] = []

/**
 * Register an {@link ExitHandler} callback that will be executed at the
 * nodejs process exit.
 * @param exitHandler
 */
export function registerExitHandler(exitHandler: ExitHandler): void {
  exitHandlers.push(exitHandler)
}

const runExitHandlers = async (signal: string): Promise<void> => {
  for (const [i, exitHandler] of exitHandlers.entries()) {
    const id = `${i + 1}/${exitHandlers.length}`
    log.debug(`running exitHandler ${id}`)
    try {
      await exitHandler(signal)
      log.debug(`  exitHandler ${id} done`)
    } catch (err) {
      log.error(`exitHandler ${id} error: ${err}`)
    }
  }
}

let runExitHandlersPromise: Promise<void> | null = null

const SIGNALS = [
  'beforeExit',
  'uncaughtException',
  'unhandledRejection',
  'SIGHUP',
  'SIGINT',
  'SIGQUIT',
  'SIGILL',
  'SIGTRAP',
  'SIGABRT',
  'SIGBUS',
  'SIGFPE',
  'SIGUSR1',
  'SIGSEGV',
  'SIGUSR2',
  'SIGTERM',
]
process.setMaxListeners(process.getMaxListeners() + SIGNALS.length)
SIGNALS.forEach(event =>
  process.once(event, async signal => {
    if (signal instanceof Error) {
      log.error(`Exit on error: ${signal.stack || signal.message}`)
    } else {
      log.debug(`Exit on signal: ${signal}`)
    }
    if (!runExitHandlersPromise) {
      runExitHandlersPromise = runExitHandlers(signal)
    }
    await runExitHandlersPromise
    stopUpdateSystemStats()
    process.exit(0)
  }),
)

/**
 * Downloads the configured chrome executable if it doesn't exists into the
 * `$HOME/.webrtcperf/chromium` directory.
 * @returns The revision info.
 */
export async function checkChromiumExecutable(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadConfig } = require('./config')
  const config = loadConfig()
  const cacheDir = path.join(os.homedir(), '.webrtcperf/chromium')
  const browserFetcher = new BrowserFetcher({ path: cacheDir })
  const revisions = await browserFetcher.localRevisions()
  revisions.sort((a: string, b: string) => b.localeCompare(a))
  log.debug(`Available chromium revisions: ${revisions}`)
  if (revisions.indexOf(config.chromiumRevision) === -1) {
    log.info(`Downloading chromium revision ${config.chromiumRevision}...`)
    let progress = 0
    await browserFetcher.download(
      config.chromiumRevision,
      (downloadedBytes: number, totalBytes: number) => {
        const cur = Math.round((100 * downloadedBytes) / totalBytes)
        if (cur - progress > 1) {
          progress = cur
          log.info(`  ${progress}%`)
        }
      },
    )
    log.info(`Downloading chromium revision ${config.chromiumRevision} done.`)
  }
  return browserFetcher.revisionInfo(config.chromiumRevision).executablePath
}

export function clampMinMax(value: number, min: number, max: number): number {
  return Math.max(Math.min(value, max), min)
}

/** Runs the shell command asynchronously. */
export async function runShellCommand(
  cmd: string,
): Promise<{ stdout: string; stderr: string }> {
  //log.debug(`runShellCommand cmd:\n${cmd}`)
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

//
const ipCache = new Map<string, { host: string; timestamp: number }>()

/**
 * Resolves the IP address hostname.
 * @param ip The IP address.
 * @param cacheTime The number of milliseconds to keep the resolved hostname
 * into the memory cache.
 * @returns The IP address hostname.
 */
export async function resolveIP(
  ip: string,
  cacheTime = 60000,
): Promise<string> {
  if (ipaddrJs.parse(ip).range() === 'private') {
    return ip
  }
  const timestamp = Date.now()
  const ret = ipCache.get(ip)
  if (!ret || timestamp - ret.timestamp > cacheTime) {
    const host = await Promise.race([
      sleep(1000),
      dns.promises
        .reverse(ip)
        .then(hosts => {
          if (hosts.length) {
            log.debug(`resolveIP ${ip} -> ${hosts.join(', ')}`)
            ipCache.set(ip, {
              host: hosts[0],
              // Keep the value for 10 min.
              timestamp: timestamp + 10 * cacheTime,
            })
            return hosts[0]
          } else {
            ipCache.set(ip, { host: ip, timestamp })
            return ip
          }
        })
        .catch(err => {
          log.error(`resolveIP error: ${(err as Error).stack}`)
          ipCache.set(ip, { host: ip, timestamp })
        }),
    ])
    return host || ip
  }
  return ret?.host || ip
}

/**
 * Strips the console logs characters from the provided string.
 * @param str The input string.
 * @returns The strippped string.
 */
export function stripColors(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B[[(?);]{0,2}(;?\d)*./g, '')
}

const nvidiaGpuPresent =
  fs.existsSync('/usr/bin/nvidia-smi') && fs.existsSync('/dev/dri')

const macOS = process.platform === 'darwin' && fs.existsSync('/usr/sbin/ioreg')

/**
 * Returns the GPU usage.
 *
 * On Linux, the `nvidia-smi` should be installed if Nvidia card is used.
 * @returns The GPU usage.
 */
export async function systemGpuStats(): Promise<{ gpu: number; mem: number }> {
  try {
    if (nvidiaGpuPresent) {
      const { stdout } = await runShellCommand(
        'nvidia-smi --query-gpu=utilization.gpu,utilization.memory --format=csv',
      )
      const line = stdout.split('\n')[1].trim()
      const [gpu, mem] = line
        .split(',')
        .map(s => parseFloat(s.replace(' %', '')))
      return { gpu, mem }
    } else if (macOS) {
      const { stdout } = await runShellCommand(
        'ioreg -r -d 1 -w 0 -c IOAccelerator | grep PerformanceStatistics\\"',
      )
      const stats = JSON.parse(stdout.trim().split(' = ')[1].replace(/=/g, ':'))
      const gpu = stats['Device Utilization %'] || stats['GPU Activity(%)'] || 0
      return { gpu, mem: 0 }
    }
  } catch (err) {
    log.debug(`systemGpuStats error: ${(err as Error).stack}`)
  }
  return { gpu: 0, mem: 0 }
}

/**
 * Schedules a function call at the specified time interval.
 */
export class Scheduler {
  private readonly name: string
  private readonly interval: number
  private readonly callback: (now: number) => Promise<void>
  private readonly verbose: boolean

  private running = false
  private last = 0
  private errorSum = 0
  private statsTimeoutId?: NodeJS.Timeout

  /**
   * Scheduler.
   * @param name Logging name.
   * @param interval Update interval in seconds.
   * @param callback Callback function.
   * @param verbose Verbose logging.
   */
  constructor(
    name: string,
    interval: number,
    callback: (now: number) => Promise<void>,
    verbose = false,
  ) {
    this.name = name
    this.interval = interval * 1000
    this.callback = callback
    this.verbose = verbose
    log.debug(
      `[${this.name}-scheduler] constructor interval=${this.interval}ms`,
    )
  }

  start(): void {
    log.debug(`[${this.name}-scheduler] start`)
    this.running = true
    this.scheduleNext()
  }

  stop(): void {
    log.debug(`[${this.name}-scheduler] stop`)
    this.running = false
    if (this.statsTimeoutId) {
      clearTimeout(this.statsTimeoutId)
    }
  }

  private scheduleNext(): void {
    if (!this.running) {
      return
    }
    const now = Date.now()
    if (this.last) {
      this.errorSum += clampMinMax(
        now - this.last - this.interval,
        -this.interval,
        this.interval,
      )
      if (this.verbose) {
        log.debug(
          `[${this.name}-scheduler] last=${now - this.last}ms drift=${
            this.errorSum
          }ms`,
        )
      }
    }
    this.last = now
    this.statsTimeoutId = setTimeout(async () => {
      try {
        const now = Date.now()
        await this.callback(now)
        const elapsed = Date.now() - now
        if (elapsed > this.interval) {
          log.warn(
            `[${this.name}-scheduler] callback elapsed=${elapsed}ms > ${this.interval}ms`,
          )
        } else if (this.verbose) {
          log.debug(`[${this.name}-scheduler] callback elapsed=${elapsed}ms`)
        }
      } catch (err) {
        log.error(
          `[${this.name}-scheduler] callback error: ${(err as Error).stack}`,
          err,
        )
      } finally {
        this.scheduleNext()
      }
    }, this.interval - this.errorSum / 2)
  }
}

//
export class PeerConnectionExternal {
  public id: number
  private process
  private static cache = new Map<number, PeerConnectionExternal>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(options?: any) {
    this.process = spawn('sleep', ['600'])
    this.id = this.process.pid || -1
    log.debug(`PeerConnectionExternal contructor: ${this.id}`, options)
    PeerConnectionExternal.cache.set(this.id, this)

    this.process.stdout.on('data', data => {
      log.debug(`PeerConnectionExternal stdout: ${data}`)
    })

    this.process.stderr.on('data', data => {
      log.debug(`PeerConnectionExternal stderr: ${data}`)
    })

    this.process.on('close', code => {
      log.debug(`PeerConnectionExternal process exited with code ${code}`)
      PeerConnectionExternal.cache.delete(this.id)
    })
  }

  static get(id: number): PeerConnectionExternal | undefined {
    return PeerConnectionExternal.cache.get(id)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createOffer(options: any) {
    log.debug(`PeerConnectionExternal createOffer`, { options })
    return {}
  }

  setLocalDescription(description: string) {
    log.debug(`PeerConnectionExternal setLocalDescription`, description)
  }

  setRemoteDescription(description: string) {
    log.debug(`PeerConnectionExternal setRemoteDescription`, description)
  }
}

export type PeerConnectionExternalMethod =
  | 'createOffer'
  | 'setLocalDescription'
  | 'setRemoteDescription'

export function toTitleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export type VideoInfo = {
  width: number
  height: number
  frameRate: number
  start_pts: number
  start_time: number
  duration: number
  keyFrames: { index: number; pkt_pts_time: number }[]
}

export async function ffprobe(fpath: string): Promise<VideoInfo> {
  const { stdout } = await runShellCommand(
    `ffprobe -v quiet -show_format -show_streams -show_frames -show_entries frame=key_frame,pkt_pts_time -print_format json ${fpath}`,
  )
  const data = JSON.parse(stdout) as {
    format: { start_pts: number; duration: string }
    streams: {
      width: number
      height: number
      r_frame_rate: string
      start_pts: number
      start_time: string
      duration: string
    }[]
    frames: { key_frame: number; pkt_pts_time: string }[]
  }
  const [den, num] = data.streams[0].r_frame_rate
    .split('/')
    .map(i => parseInt(i))
  return {
    width: data.streams[0].width,
    height: data.streams[0].height,
    start_pts: data.streams[0].start_pts,
    start_time: parseFloat(data.streams[0].start_time),
    duration: parseFloat(data.streams[0].duration),
    frameRate: den / num,
    keyFrames: data.frames
      .map((f, index) => ({
        index,
        key: f.key_frame === 1,
        pkt_pts_time: parseFloat(f.pkt_pts_time),
      }))
      .filter(f => f.key),
  }
}

// VMAF score methods.
export type IvfFrame = {
  index: number
  position: number
  size: number
}

export type IvfInfo = {
  width: number
  height: number
  frameRate: number
  ptsIndex: number[]
  frames: Map<number, IvfFrame>
}

async function parseIvf(fpath: string): Promise<IvfInfo> {
  const fd = await fs.promises.open(fpath, 'r')

  const headerData = new ArrayBuffer(32)
  const headerView = new DataView(headerData)
  const ret = await fd.read(headerView, 0, 32, 0)
  if (ret.bytesRead !== 32) {
    throw new Error('Invalid IVF file')
  }
  const width = headerView.getUint16(12, true)
  const height = headerView.getUint16(14, true)
  const den = headerView.getUint32(16, true)
  const num = headerView.getUint32(20, true)
  const frameRate = den / num

  const frameHeaderData = new ArrayBuffer(12)
  const frameHeaderView = new DataView(frameHeaderData)
  let index = 0
  let position = 32
  let bytesRead = 0
  const ptsIndex = []
  const frames = new Map<number, IvfFrame>()
  do {
    const ret = await fd.read(frameHeaderView, 0, 12, position)
    bytesRead = ret.bytesRead
    if (bytesRead !== 12) {
      break
    }
    const size = frameHeaderView.getUint32(0, true)
    const pts = Number(frameHeaderView.getBigUint64(4, true))
    /* if (pts <= ptsIndex[ptsIndex.length - 1]) {
      log.warn(`IVF file ${fpath}: pts ${pts} <= prev ${ptsIndex[ptsIndex.length - 1]}`)
    } */
    if (frames.has(pts)) {
      log.warn(`IVF file ${fpath}: pts ${pts} already present, skipping`)
    } else {
      ptsIndex.push(pts)
      frames.set(pts, { index, position, size: size + 12 })
      index++
    }
    position += size + 12
  } while (bytesRead === 12)

  await fd.close()
  ptsIndex.sort((a, b) => a - b)
  return { width, height, frameRate, ptsIndex, frames }
}

export async function fixIvfFrames(
  fpath: string,
  infos: IvfInfo,
  backup = true,
) {
  const { width, height, frameRate, frames, ptsIndex } = infos
  if (!ptsIndex.length) {
    log.warn(`IVF file ${fpath}: no pts found`)
    return
  }
  log.debug(`fixIvfFrames ${fpath}`, { width, height, frameRate })

  const fd = await fs.promises.open(fpath, 'r')
  const fixedPath = fpath.replace('.ivf', '.fixed.ivf')
  const fixedFd = await fs.promises.open(fixedPath, 'w')

  const headerData = new ArrayBuffer(32)
  const headerView = new DataView(headerData)
  await fd.read(headerView, 0, headerData.byteLength, 0)
  headerView.setUint32(24, ptsIndex.length, true)
  await fixedFd.write(new Uint8Array(headerData), 0, headerData.byteLength, 0)

  let position = 32

  for (const pts of ptsIndex) {
    const frame = frames.get(pts)
    if (!frame) {
      log.warn(`IVF file ${fpath}: pts ${pts} not found, skipping`)
      continue
    }

    const frameData = new ArrayBuffer(frame.size)
    const frameView = new DataView(frameData)
    await fd.read(frameView, 0, frame.size, frame.position)
    await fixedFd.write(new Uint8Array(frameData), 0, frame.size, position)
    position += frame.size
  }

  await fd.close()
  await fixedFd.close()

  if (backup) {
    await fs.promises.rename(fpath, fpath + '.bk')
  }
  await fs.promises.rename(fixedPath, fpath)
}

async function alignVideos(referencePath: string, degradedPath: string) {
  if (!referencePath.endsWith('.ivf') || !degradedPath.endsWith('.ivf')) {
    throw new Error('Only IVF files are supported')
  }

  log.debug(
    `alignVideos referencePath: ${referencePath} degradedPath: ${degradedPath}`,
  )
  const referenceInfos = await parseIvf(referencePath)
  //await fixIvfFrames(referencePath, referenceInfos)

  const { width, height, frameRate } = referenceInfos
  const degradedInfos = await parseIvf(degradedPath)
  //await fixIvfFrames(degradedPath, degradedInfos)

  log.log({
    referenceInfos: referenceInfos.ptsIndex.slice(0, 24 * 10),
    degradedInfos: degradedInfos.ptsIndex.slice(0, 24 * 10),
  })

  const startPts = Math.max(
    referenceInfos.ptsIndex[0],
    degradedInfos.ptsIndex[0],
  )
  return { width, height, frameRate, startPts }
}

async function runVmaf(
  referencePath: string,
  degradedPath: string,
  preview = true,
) {
  log.debug('runVmaf', { referencePath, degradedPath })
  const comparisonPath =
    referencePath.replace(/\.[^.]+$/, '_compared-with_') +
    path.basename(degradedPath.replace(/\.[^.]+$/, ''))
  const vmafLogPath = comparisonPath + '.vmaf.json'
  const cpus = os.cpus().length

  const { width, height, frameRate, startPts } = await alignVideos(
    referencePath,
    degradedPath,
  )

  const cmd = preview
    ? `ffmpeg -loglevel warning -y -threads ${cpus} \
-i ${degradedPath} \
-ss ${startPts / frameRate} -i ${referencePath} \
-filter_complex '\
[0:v]scale=w=${width}:h=${height}:flags=bicubic:eval=frame,fps=fps=${frameRate},split[deg1][deg2];\
[1:v]scale=w=${width}:h=${height}:flags=bicubic:eval=frame,fps=fps=${frameRate},split[ref1][ref2];\
[deg1][ref1]libvmaf=log_fmt=json:log_path=${vmafLogPath}:n_subsample=1:n_threads=${cpus}[vmaf];\
[ref2][deg2]hstack=shortest=1[stacked]' \
-shortest \
-map [vmaf] -f null - \
-map [stacked] -c:v libx264 -crf 20 -f mp4 ${comparisonPath + '.mp4'} \
`
    : `ffmpeg -loglevel warning -y -threads ${cpus} \
-i ${degradedPath} \
-ss ${startPts / frameRate} -i ${referencePath} \
-filter_complex '\
[0:v]scale=w=${width}:h=${height}:flags=bicubic:eval=frame[deg];\
[1:v]scale=w=${width}:h=${height}:flags=bicubic:eval=frame[ref];\
[deg][ref]libvmaf=log_fmt=json:log_path=${vmafLogPath}:n_subsample=1:n_threads=${cpus}[vmaf]' \
-shortest \
-map [vmaf] -f null - \
`

  log.debug('runVmaf', cmd)
  const { stdout, stderr } = await runShellCommand(cmd)
  const vmafLog = JSON.parse(await fs.promises.readFile(vmafLogPath, 'utf-8'))
  log.debug('runVmaf', {
    stdout,
    stderr,
    vmafLog: vmafLog['pooled_metrics']['vmaf'],
  })
  log.info('VMAF metrics:', vmafLog['pooled_metrics']['vmaf'])

  const plotlyPath = comparisonPath + '.plotly'
  const title = path.basename(comparisonPath)
  const plotlyData = {
    data: [
      {
        uid: 'id',
        fill: 'none',
        mode: 'lines',
        name: 'VMAF score',
        type: 'scatter',
        x: vmafLog.frames.map(({ frameNum }: { frameNum: number }) => frameNum),
        y: vmafLog.frames.map(
          ({ metrics }: { metrics: { vmaf: number } }) => metrics.vmaf,
        ),
      },
    ],
    layout: {
      title,
      width: 1280,
      height: 720,
      xaxis: {
        type: 'linear',
        range: [0, vmafLog.frames.length],
        dtick: frameRate,
        title: 'Frame',
        showgrid: true,
        autorange: false,
      },
      yaxis: {
        type: 'linear',
        range: [0, 100],
        title: 'Score',
        showgrid: true,
        autorange: false,
      },
      autosize: false,
    },
    frames: [],
  }
  await fs.promises.writeFile(plotlyPath, JSON.stringify(plotlyData))
}

export async function calculateVmafScore(
  referencePath: string,
  degradedPaths: string[],
): Promise<void> {
  log.debug(
    ` calculateVmafScore referencePath=${referencePath} degradedPaths=${degradedPaths}`,
  )

  for (const degradedPath of degradedPaths) {
    await runVmaf(referencePath, degradedPath)
  }

  //log.debug(`calculateVmafScore startPts=${startPts}`)
}

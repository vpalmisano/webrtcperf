import axios from 'axios'
import chalk from 'chalk'
import * as events from 'events'
import { Stats as FastStats } from 'fast-stats'
import * as fs from 'fs'
import * as http from 'http'
import * as https from 'https'
import json5 from 'json5'
import moment from 'moment'
import * as path from 'path'
import * as promClient from 'prom-client'
import { sprintf } from 'sprintf-js'
import * as zlib from 'zlib'

import { PageStatsNames, RtcStatsMetricNames } from './rtcstats'
import { Session } from './session'
import { hideAuth, logger, Scheduler } from './utils'

const log = logger('app:stats')

function calculateFailAmountPercentile(
  stat: FastStats,
  percentile = 75,
): number {
  return Math.round(stat.percentile(percentile))
}

/**
 * StatsWriter
 */
class StatsWriter {
  fname: string
  columns: string[]
  private _header_written = false

  constructor(fname = 'stats.log', columns: string[]) {
    this.fname = fname
    this.columns = columns
  }

  /**
   * push
   * @param dataColumns
   */
  async push(dataColumns: string[]): Promise<void> {
    if (!this._header_written) {
      let data = 'datetime'
      this.columns.forEach(column => {
        data += `,${column}`
      })
      await fs.promises.mkdir(path.dirname(this.fname), { recursive: true })
      await fs.promises.writeFile(this.fname, `${data}\n`)
      this._header_written = true
    }
    //
    let data = `${moment().format('YYYY/MM/DD HH:mm:ss')}`
    this.columns.forEach((_column, i) => {
      data += `,${dataColumns[i]}`
    })
    return fs.promises.appendFile(this.fname, `${data}\n`)
  }
}

/**
 * formatStatsColumns
 * @param column
 */
function formatStatsColumns(column: string): string[] {
  return [
    `${column}_length`,
    `${column}_sum`,
    `${column}_mean`,
    `${column}_stdev`,
    `${column}_5p`,
    `${column}_95p`,
    `${column}_min`,
    `${column}_max`,
  ]
}

/**
 * Format number to the specified precision.
 * @param value value to format
 * @param precision precision
 */
function toPrecision(value: number, precision = 3): string {
  return (Math.round(value * 10 ** precision) / 10 ** precision).toFixed(
    precision,
  )
}

/** The Stats data collected for each metric. */
type StatsData = {
  /** The total samples collected. */
  length: number
  /** The sum of all the samples. */
  sum: number
  /** The average value. */
  mean: number
  /** The standard deviation. */
  stddev: number
  /** The 5th percentile. */
  p5: number
  /** The 95th percentile. */
  p95: number
  /** The minimum value. */
  min: number
  /** The maximum value. */
  max: number
}

type StatsDataKey = keyof StatsData

type CollectedStats = {
  all: FastStats
  [host: string]: FastStats
}

/**
 * Formats the stats for console or for file output.
 * @param s The stats object.
 * @param forWriter If true, format the stats to be written on file.
 */
function formatStats(s: FastStats, forWriter = false): StatsData | string[] {
  if (forWriter) {
    return [
      toPrecision(s.length || 0, 0),
      toPrecision(s.sum || 0),
      toPrecision(s.amean() || 0),
      toPrecision(s.stddev() || 0),
      toPrecision(s.percentile(5) || 0),
      toPrecision(s.percentile(95) || 0),
      toPrecision(s.min || 0),
      toPrecision(s.max || 0),
    ]
  }
  return {
    length: s.length || 0,
    sum: s.sum || 0,
    mean: s.amean() || 0,
    stddev: s.stddev() || 0,
    p5: s.percentile(5) || 0,
    p95: s.percentile(95) || 0,
    min: s.min || 0,
    max: s.max || 0,
  }
}

/**
 * Formats the console stats title.
 * @param name
 */
function sprintfStatsTitle(name: string): string {
  return sprintf(chalk`-- {bold %(name)s} %(fill)s\n`, {
    name,
    fill: '-'.repeat(100 - name.length - 4),
  })
}

/**
 * Formats the console stats header.
 */
function sprintfStatsHeader(): string {
  return (
    sprintfStatsTitle(new Date().toUTCString()) +
    sprintf(
      chalk`{bold %(name)\' 30s} {bold %(length)\' 8s} {bold %(sum)\' 8s} {bold %(mean)\' 8s} {bold %(stddev)\' 8s} {bold %(p5)\' 8s} {bold %(p95)\' 8s} {bold %(min)\' 8s} {bold %(max)\' 8s}\n`,
      {
        name: 'name',
        length: 'count',
        sum: 'sum',
        mean: 'mean',
        stddev: 'stddev',
        p5: '5p',
        p95: '95p',
        min: 'min',
        max: 'max',
      },
    )
  )
}

/**
 * Format the stats for console output.
 */
function sprintfStats(
  name: string,
  stats: CollectedStats,
  format = '.2f',
  unit = '',
  scale = 1,
  hideSum = false,
): string {
  if (!stats || !stats.all.length) {
    return ''
  }
  if (!scale) {
    scale = 1
  }
  const statsData = formatStats(stats.all) as StatsData
  return sprintf(
    chalk`{red {bold %(name)\' 30s}}` +
      chalk` {bold %(length)\' 8d}` +
      (hideSum ? '         ' : chalk` {bold %(sum)\' 8${format}}`) +
      chalk` {bold %(mean)\' 8${format}}` +
      chalk` {bold %(stddev)\' 8${format}}` +
      chalk` {bold %(p5)\' 8${format}}` +
      chalk` {bold %(p95)\' 8${format}}` +
      chalk` {bold %(min)\' 8${format}}` +
      chalk` {bold %(max)\' 8${format}}%(unit)s\n`,
    {
      name,
      length: statsData.length,
      sum: statsData.sum * scale,
      mean: statsData.mean * scale,
      stddev: statsData.stddev * scale,
      p5: statsData.p5 * scale,
      p95: statsData.p95 * scale,
      min: statsData.min * scale,
      max: statsData.max * scale,
      unit: unit ? chalk` {red {bold ${unit}}}` : '',
    },
  )
}

const promPrefix = 'wst_'

const promCreateGauge = (
  register: promClient.Registry,
  name: string,
  suffix = '',
  labelNames: string[] = [],
  collect?: () => void,
): promClient.Gauge<string> => {
  return new promClient.Gauge({
    name: `${promPrefix}${name}${suffix && '_' + suffix}`,
    help: `${name} ${suffix}`,
    labelNames,
    registers: [register],
    collect,
  })
}

/**
 * The alert rule description.
 *
 * Example:
 * ```
 cpu:
    tags:
    - performance
    failPercentile: 90
    p95:
      $gt: 10
      $lt: 100
      $after: 60
 * ```
 * It will check if the `cpu` 95th percentile is lower than 100% and greater than 10%,
 * starting the check after 60s from the test start. The alert results will be
 * grouped into the `performance` category.
 */
export type AlertRule = AlertRuleOption & AlertRuleKey

/**
 * The alert rule options.
 */
export type AlertRuleOption = {
  /** The alert results will be grouped into the specified categories.  */
  tags: string[]
  /** The alert will pass when at least `failPercentile` of the checks (95 by default) are successful. */
  failPercentile?: number
}

/**
 * The supported alert rule checks.
 */
export type AlertRuleKey = {
  /** The total collected samples. */
  length?: AlertRuleValue | AlertRuleValue[]
  /** The sum of the collected samples. */
  sum?: AlertRuleValue | AlertRuleValue[]
  /** The 95th percentile of the collected samples. */
  p95?: AlertRuleValue | AlertRuleValue[]
  /** The 5th percentile of the collected samples. */
  p5?: AlertRuleValue | AlertRuleValue[]
  /** The minimum of the collected samples. */
  min?: AlertRuleValue | AlertRuleValue[]
  /** The maximum of the collected samples. */
  max?: AlertRuleValue | AlertRuleValue[]
}

/**
 * The alert check operators.
 */
export type AlertRuleValue = {
  $eq?: number
  $gt?: number
  $lt?: number
  $gte?: number
  $lte?: number
  $after?: number
  $before?: number
}

const calculateFailAmount = (checkValue: number, ruleValue: number): number => {
  if (ruleValue) {
    return 100 * Math.min(1, Math.abs(checkValue - ruleValue) / ruleValue)
  } else {
    return 100 * Math.min(1, Math.abs(checkValue))
  }
}

/**
 * The Stats collector class.
 */
export class Stats extends events.EventEmitter {
  readonly statsPath: string
  readonly prometheusPushgateway: string
  readonly prometheusPushgatewayJobName: string
  readonly prometheusPushgatewayAuth?: string
  readonly prometheusPushgatewayGzip?: boolean
  readonly showStats: boolean
  readonly showPageLog: boolean
  readonly statsInterval: number
  readonly rtcStatsTimeout: number
  readonly customMetrics: Record<string, { labels?: string[] }> = {}
  readonly startTimestamp: number
  private readonly startTimestampString: string

  sessions = new Map<number, Session>()
  nextSessionId: number
  statsWriter: StatsWriter | null
  private scheduler?: Scheduler

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private alertRules: Record<string, AlertRule> | null = null
  readonly alertRulesFilename: string
  private readonly alertRulesFailPercentile: number
  private readonly pushStatsUrl: string
  private readonly pushStatsId: string
  private readonly serverSecret: string

  private readonly alertRulesReport = new Map<
    string,
    Map<
      string,
      {
        totalFails: number
        totalFailsTime: number
        totalFailsPerc: number
        lastFailed: number
        valueStats: FastStats
        valueAverage: number
        failAmountStats: FastStats
        failAmountPercentile: number
      }
    >
  >()
  private gateway: promClient.Pushgateway | null = null
  private gatewayForDelete: promClient.Pushgateway | null = null

  /* metricConfigGauge: promClient.Gauge<string> | null = null */
  private elapsedTimeMetric: promClient.Gauge<string> | null = null
  private metrics: {
    [name: string]: {
      length: promClient.Gauge<string>
      sum: promClient.Gauge<string>
      mean: promClient.Gauge<string>
      stddev: promClient.Gauge<string>
      p5: promClient.Gauge<string>
      p95: promClient.Gauge<string>
      min: promClient.Gauge<string>
      max: promClient.Gauge<string>
      alertRules: {
        [name: string]: {
          report: promClient.Gauge<string>
          rule: promClient.Gauge<string>
          mean: promClient.Gauge<string>
        }
      }
    }
  } = {}

  private alertTagsMetrics?: promClient.Gauge<string>

  collectedStats: Record<string, CollectedStats>

  collectedStatsConfig = {
    url: '',
    pages: 0,
    startTime: 0,
  }
  externalCollectedStats = new Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { addedTime: number; externalStats: any; config: any }
  >()
  pushStatsInstance: axios.AxiosInstance | null = null

  private running = false

  /**
   * Stats aggregator class.
   */
  constructor({
    statsPath,
    prometheusPushgateway,
    prometheusPushgatewayJobName,
    prometheusPushgatewayAuth,
    prometheusPushgatewayGzip,
    showStats,
    showPageLog,
    statsInterval,
    rtcStatsTimeout,
    customMetrics,
    alertRules,
    alertRulesFilename,
    alertRulesFailPercentile,
    pushStatsUrl,
    pushStatsId,
    serverSecret,
    startSessionId,
    startTimestamp,
  }: {
    statsPath: string
    prometheusPushgateway: string
    prometheusPushgatewayJobName: string
    prometheusPushgatewayAuth: string
    prometheusPushgatewayGzip: boolean
    showStats: boolean
    showPageLog: boolean
    statsInterval: number
    rtcStatsTimeout: number
    customMetrics: string
    alertRules: string
    alertRulesFilename: string
    alertRulesFailPercentile: number
    pushStatsUrl: string
    pushStatsId: string
    serverSecret: string
    startSessionId: number
    startTimestamp: number
  }) {
    super()
    this.statsPath = statsPath
    this.prometheusPushgateway = prometheusPushgateway
    this.prometheusPushgatewayJobName =
      prometheusPushgatewayJobName || 'default'
    this.prometheusPushgatewayAuth = prometheusPushgatewayAuth || undefined
    this.prometheusPushgatewayGzip = prometheusPushgatewayGzip
    this.showStats = showStats !== undefined ? showStats : true
    this.showPageLog = !!showPageLog
    this.statsInterval = statsInterval || 10
    this.rtcStatsTimeout = Math.max(rtcStatsTimeout, this.statsInterval)
    if (customMetrics.trim()) {
      this.customMetrics = json5.parse(customMetrics)
      log.debug(
        `using customMetrics: ${JSON.stringify(
          this.customMetrics,
          undefined,
          2,
        )}`,
      )
    }

    this.collectedStats = this.statsNames.reduce((prev, name: string) => {
      prev[name] = {
        all: new FastStats(),
      } as CollectedStats
      return prev
    }, {} as Record<string, CollectedStats>)

    this.sessions = new Map()
    this.nextSessionId = startSessionId
    this.startTimestamp = startTimestamp
    this.startTimestampString = new Date(this.startTimestamp).toISOString()
    this.statsWriter = null
    if (alertRules.trim()) {
      this.alertRules = json5.parse(alertRules)
      log.debug(
        `using alertRules: ${JSON.stringify(this.alertRules, undefined, 2)}`,
      )
    }
    this.alertRulesFilename = alertRulesFilename
    this.alertRulesFailPercentile = alertRulesFailPercentile
    this.pushStatsUrl = pushStatsUrl
    this.pushStatsId = pushStatsId
    this.serverSecret = serverSecret

    if (this.pushStatsUrl) {
      const httpAgent = new http.Agent({ keepAlive: false })
      const httpsAgent = new https.Agent({
        keepAlive: false,
        rejectUnauthorized: false,
      })
      this.pushStatsInstance = axios.create({
        httpAgent,
        httpsAgent,
        baseURL: this.pushStatsUrl,
        auth: {
          username: 'admin',
          password: this.serverSecret,
        },
        maxBodyLength: 20000000,
        transformRequest: [
          ...(axios.defaults
            .transformRequest as axios.AxiosRequestTransformer[]),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (data: any, headers?: axios.AxiosRequestHeaders): any => {
            if (
              headers &&
              typeof data === 'string' &&
              data.length > 16 * 1024
            ) {
              headers['Content-Encoding'] = 'gzip'
              return zlib.gzipSync(data)
            } else {
              return data
            }
          },
        ],
      })
    }
  }

  private get statsNames(): string[] {
    return Object.keys(PageStatsNames)
      .concat(Object.keys(RtcStatsMetricNames))
      .concat(Object.keys(this.customMetrics))
  }

  /**
   * consumeSessionId
   * @param tabs the number of tabs to allocate in the same session.
   */
  consumeSessionId(tabs = 1): number {
    const id = this.nextSessionId
    this.nextSessionId += tabs
    return id
  }

  /**
   * Adds the session to the list of monitored sessions.
   */
  addSession(session: Session): void {
    log.debug(`addSession ${session.id}`)
    if (this.sessions.has(session.id)) {
      throw new Error(`session id ${session.id} already present`)
    }
    session.once('stop', id => {
      log.debug(`Session ${id} stopped`)
      this.sessions.delete(id)
    })
    this.sessions.set(session.id, session)
  }

  /**
   * Removes the session from list of monitored sessions.
   * @param id the Session id
   */
  removeSession(id: number): void {
    log.debug(`removeSession ${id}`)
    this.sessions.delete(id)
  }

  /**
   * start
   */
  async start(): Promise<void> {
    if (this.running) {
      log.warn('already running')
      return
    }
    log.debug('start')
    this.running = true

    if (this.statsPath) {
      const logPath = path.join(
        this.statsPath,
        `${moment().format('YYYY-MM-DD_HH.mm.ss')}.csv`,
      )
      log.info(`Logging into ${logPath}`)
      const headers: string[] = this.statsNames.reduce(
        (v: string[], name) => v.concat(formatStatsColumns(name)),
        [],
      )
      this.statsWriter = new StatsWriter(logPath, headers)
    }

    if (this.prometheusPushgateway) {
      const register = new promClient.Registry()
      const agent = this.prometheusPushgateway.startsWith('https://')
        ? new https.Agent({
            keepAlive: true,
            keepAliveMsecs: 60000,
            maxSockets: 5,
          })
        : new http.Agent({
            keepAlive: true,
            keepAliveMsecs: 60000,
            maxSockets: 5,
          })
      this.gateway = new promClient.Pushgateway(
        this.prometheusPushgateway,
        {
          timeout: 5000,
          auth: this.prometheusPushgatewayAuth,
          rejectUnauthorized: false,
          agent,
          headers: this.prometheusPushgatewayGzip
            ? {
                'Content-Encoding': 'gzip',
              }
            : undefined,
        },
        register,
      )
      this.gatewayForDelete = new promClient.Pushgateway(
        this.prometheusPushgateway,
        {
          timeout: 5000,
          auth: this.prometheusPushgatewayAuth,
          rejectUnauthorized: false,
          agent,
        },
        register,
      )

      // promClient.collectDefaultMetrics({ prefix: promPrefix, register })

      this.elapsedTimeMetric = promCreateGauge(
        register,
        'elapsedTime',
        '',
        [],
        () =>
          this.elapsedTimeMetric?.set(
            (Date.now() - this.startTimestamp) / 1000,
          ),
      )

      // Export rtc stats.
      this.statsNames.forEach(name => {
        this.metrics[name] = {
          length: promCreateGauge(register, name, 'length', [
            'host',
            'codec',
            'datetime',
          ]),
          sum: promCreateGauge(register, name, 'sum', [
            'host',
            'codec',
            'datetime',
          ]),
          mean: promCreateGauge(register, name, 'mean', [
            'host',
            'codec',
            'datetime',
          ]),
          stddev: promCreateGauge(register, name, 'stddev', [
            'host',
            'codec',
            'datetime',
          ]),
          p5: promCreateGauge(register, name, 'p5', [
            'host',
            'codec',
            'datetime',
          ]),
          p95: promCreateGauge(register, name, 'p95', [
            'host',
            'codec',
            'datetime',
          ]),
          min: promCreateGauge(register, name, 'min', [
            'host',
            'codec',
            'datetime',
          ]),
          max: promCreateGauge(register, name, 'max', [
            'host',
            'codec',
            'datetime',
          ]),
          alertRules: {},
        }

        if (this.alertRules && this.alertRules[name]) {
          const rule = this.alertRules[name]
          for (const ruleKey of Object.keys(rule)) {
            const ruleName = `alert_${name}_${ruleKey}`
            this.metrics[name].alertRules[ruleName] = {
              report: promCreateGauge(register, ruleName, 'report', [
                'rule',
                'datetime',
              ]),
              rule: promCreateGauge(register, ruleName, '', [
                'rule',
                'datetime',
              ]),
              mean: promCreateGauge(register, ruleName, 'mean', [
                'rule',
                'datetime',
              ]),
            }
          }
        }
      })

      if (this.alertRules) {
        this.alertTagsMetrics = promCreateGauge(register, `alert_report`, '', [
          'datetime',
          'tag',
        ])
      }

      await this.deletePushgatewayStats()
    }

    this.scheduler = new Scheduler(
      'stats',
      this.statsInterval,
      this.collectStats.bind(this),
    )
    this.scheduler.start()
  }

  async deletePushgatewayStats(): Promise<void> {
    if (!this.gatewayForDelete) {
      return
    }
    try {
      const { resp, body } = await this.gatewayForDelete.delete({
        jobName: this.prometheusPushgatewayJobName,
      })
      if ((body as string).length) {
        log.warn(
          `Pushgateway delete error ${
            (resp as http.ServerResponse).statusCode
          }: ${body as string}`,
        )
      }
    } catch (err) {
      log.error(`Pushgateway delete error: ${(err as Error).message}`)
    }
  }

  /**
   * collectStats
   */
  async collectStats(now: number): Promise<void> {
    if (!this.running) {
      return
    }
    // log.debug(`statsInterval ${this.sessions.size} sessions`);
    if (!this.sessions.size && !this.externalCollectedStats.size) {
      return
    }
    // Prepare config.
    this.collectedStatsConfig.pages = 0
    this.collectedStatsConfig.startTime = this.startTimestamp
    // Prepare collectedStats object.
    Object.values(this.collectedStats).forEach(stats => {
      Object.values(stats).forEach(s => s.reset())
    })
    for (const session of this.sessions.values()) {
      try {
        this.collectedStatsConfig.url =
          `${hideAuth(session.url)}?${session.urlQuery}` || ''
        this.collectedStatsConfig.pages += session.pages.size || 0
        const sessionStats = await session.updateStats(now)
        for (const [name, obj] of Object.entries(sessionStats)) {
          if (obj === undefined) {
            return
          }
          /* const metricHist = this.metrics[name].hist; */
          if (typeof obj === 'number' && isFinite(obj)) {
            this.collectedStats[name].all.push(obj)
            /* if (metricHist) {
              metricHist.observe(obj);
            } */
          } else {
            for (const [key, value] of Object.entries(obj)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              if (typeof value === 'number' && isFinite(value as any)) {
                this.collectedStats[name].all.push(value as number)
                // Push host variables.
                const label = `host:${key.split(':')[1]}`
                if (!this.collectedStats[name][label]) {
                  this.collectedStats[name][label] = new FastStats()
                }
                this.collectedStats[name][label].push(value as number)
                /* if (metricHist) {
                  metricHist.observe(value);
                } */
              } else if (typeof value === 'string') {
                this.collectedStats[name].all.push(1)
                const label = `codec:${value}`
                if (!this.collectedStats[name][label]) {
                  this.collectedStats[name][label] = new FastStats()
                }
                this.collectedStats[name][label].push(1)
              }
            }
          }
        }
      } catch (err) {
        log.error(`session getStats error: ${(err as Error).message}`)
      }
    }
    // Add external collected stats.
    for (const [id, data] of this.externalCollectedStats.entries()) {
      const { addedTime, externalStats, config } = data
      if (now - addedTime > this.rtcStatsTimeout * 1000) {
        log.debug(`remove externalCollectedStats from ${id}`)
        this.externalCollectedStats.delete(id)
        continue
      }
      log.debug(`add external stats from ${id}`)
      // Add external config settings.
      if (config.url) {
        this.collectedStatsConfig.url = config.url
      }
      if (config.pages) {
        this.collectedStatsConfig.pages += config.pages
      }
      // Add metrics.
      this.statsNames.forEach(name => {
        const stats = externalStats[name]
        if (!stats) {
          return
        }
        for (const [label, values] of Object.entries(stats)) {
          // all hosts label
          this.collectedStats[name].all.push(values as number[])
          // host label
          if (label !== 'all') {
            if (!this.collectedStats[name][label]) {
              this.collectedStats[name][label] = new FastStats()
            }
            this.collectedStats[name][label].push(values as number[])
          }
        }
      })
    }
    this.emit('stats', this.collectedStats)
    // Push to an external instance.
    if (this.pushStatsInstance) {
      const pushStats: Record<string, { [name: string]: number[] }> = {}
      for (const [name, stats] of Object.entries(this.collectedStats)) {
        pushStats[name] = {}
        const hostFound = Object.keys(stats).length > 1
        for (const [label, stat] of Object.entries(stats)) {
          // Push hosts stats or "all" if no other labels are present.
          if (!hostFound || label !== 'all') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pushStats[name][label] = (stat as any).data
          }
        }
      }
      try {
        const res = await this.pushStatsInstance.put('/collected-stats', {
          id: this.pushStatsId,
          stats: pushStats,
          config: this.collectedStatsConfig,
        })
        log.debug(`pushStats message=${res.data.message}`)
      } catch (err) {
        log.error(`pushStats error: ${(err as Error).message}`)
      }
    }
    // Check alerts.
    this.checkAlertRules()
    // Show to console.
    this.consoleShowStats()
    // Write stats to file.
    if (this.statsWriter) {
      const values: string[] = this.statsNames.reduce(
        (v: string[], name) =>
          v.concat(
            formatStats(this.collectedStats[name].all, true) as string[],
          ),
        [],
      )
      await this.statsWriter.push(values)
    }
    // Send to pushgateway.
    await this.sendToPushGateway()
    // Write alert rules
    await this.writeAlertRulesReport()
  }

  /**
   * addCollectedStats
   * @param id
   * @param externalStats
   * @param config
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addExternalCollectedStats(id: string, externalStats: any, config: any): void {
    log.debug(`addExternalCollectedStats from ${id}`)
    const addedTime = Date.now()
    this.externalCollectedStats.set(id, { addedTime, externalStats, config })
  }

  /**
   * It display stats on the console.
   */
  consoleShowStats(): void {
    if (!this.showStats) {
      return
    }
    const stats = this.collectedStats
    let out =
      sprintfStatsHeader() +
      sprintfStats('System CPU', stats.usedCpu, '.2f', '%', undefined, true) +
      sprintfStats('System GPU', stats.usedGpu, '.2f', '%', undefined, true) +
      sprintfStats(
        'System Memory',
        stats.usedMemory,
        '.2f',
        '%',
        undefined,
        true,
      ) +
      sprintfStats('CPU/page', stats.cpu, '.2f', '%') +
      sprintfStats('Memory/page', stats.memory, '.2f', 'MB') +
      sprintfStats('Pages', stats.pages, 'd', '') +
      sprintfStats('Errors', stats.errors, 'd', '') +
      sprintfStats('Warnings', stats.warnings, 'd', '') +
      sprintfStats('Peer Connections', stats.peerConnections, 'd', '') +
      sprintfStats(
        'audioSubscribeDelay',
        stats.audioSubscribeDelay,
        'd',
        'ms',
        undefined,
        true,
      ) +
      sprintfStats(
        'videoSubscribeDelay',
        stats.videoSubscribeDelay,
        'd',
        'ms',
        undefined,
        true,
      ) +
      // inbound audio
      sprintfStatsTitle('Inbound audio') +
      sprintfStats('received', stats.audioBytesReceived, '.2f', 'MB', 1e-6) +
      sprintfStats('rate', stats.audioRecvBitrates, '.2f', 'Kbps', 1e-3) +
      sprintfStats(
        'lost',
        stats.audioRecvPacketsLost,
        '.2f',
        '%',
        undefined,
        true,
      ) +
      sprintfStats(
        'jitter',
        stats.audioRecvJitter,
        '.2f',
        's',
        undefined,
        true,
      ) +
      sprintfStats(
        'avgJitterBufferDelay',
        stats.audioRecvAvgJitterBufferDelay,
        '.2f',
        'ms',
        1e3,
        true,
      ) +
      // inbound video
      sprintfStatsTitle('Inbound video') +
      sprintfStats('received', stats.videoRecvBytes, '.2f', 'MB', 1e-6) +
      sprintfStats('decoded', stats.videoFramesDecoded, 'd', 'frames') +
      sprintfStats('rate', stats.videoRecvBitrates, '.2f', 'Kbps', 1e-3) +
      sprintfStats(
        'lost',
        stats.videoRecvPacketsLost,
        '.2f',
        '%',
        undefined,
        true,
      ) +
      sprintfStats(
        'jitter',
        stats.videoRecvJitter,
        '.2f',
        's',
        undefined,
        true,
      ) +
      sprintfStats(
        'avgJitterBufferDelay',
        stats.videoRecvAvgJitterBufferDelay,
        '.2f',
        'ms',
        1e3,
        true,
      ) +
      sprintfStats('width', stats.videoRecvWidth, 'd', 'px', undefined, true) +
      sprintfStats(
        'height',
        stats.videoRecvHeight,
        'd',
        'px',
        undefined,
        true,
      ) +
      sprintfStats('fps', stats.videoRecvFps, 'd', 'fps', undefined, true) +
      sprintfStats(
        'firCountSent',
        stats.firCountSent,
        'd',
        '',
        undefined,
        true,
      ) +
      sprintfStats(
        'pliCountSent',
        stats.pliCountSent,
        'd',
        '',
        undefined,
        true,
      ) +
      // outbound audio
      sprintfStatsTitle('Outbound audio') +
      sprintfStats('sent', stats.audioBytesSent, '.2f', 'MB', 1e-6) +
      sprintfStats(
        'retransmitted',
        stats.audioRetransmittedBytesSent,
        '.2f',
        'MB',
        1e-6,
      ) +
      sprintfStats('rate', stats.audioSentBitrates, '.2f', 'Kbps', 1e-3) +
      sprintfStats(
        'lost',
        stats.audioSentPacketsLost,
        '.2f',
        '%',
        undefined,
        true,
      ) +
      sprintfStats(
        'roundTripTime',
        stats.audioSentRoundTripTime,
        '.3f',
        's',
        undefined,
        true,
      ) +
      // outbound video
      sprintfStatsTitle('Outbound video') +
      sprintfStats('sent', stats.videoSentBytes, '.2f', 'MB', 1e-6) +
      sprintfStats(
        'retransmitted',
        stats.videoSentRetransmittedBytes,
        '.2f',
        'MB',
        1e-6,
      ) +
      sprintfStats('rate', stats.videoSentBitrates, '.2f', 'Kbps', 1e-3) +
      sprintfStats(
        'lost',
        stats.videoSentPacketsLost,
        '.2f',
        '%',
        undefined,
        true,
      ) +
      sprintfStats(
        'roundTripTime',
        stats.videoSentRoundTripTime,
        '.3f',
        's',
        undefined,
        true,
      ) +
      sprintfStats(
        'qualityLimitResolutionChanges',
        stats.videoQualityLimitationResolutionChanges,
        'd',
        '',
      ) +
      sprintfStats(
        'qualityLimitationCpu',
        stats.videoQualityLimitationCpu,
        'd',
        '%',
      ) +
      sprintfStats(
        'qualityLimitationBandwidth',
        stats.videoQualityLimitationBandwidth,
        'd',
        '%',
      ) +
      sprintfStats(
        'sentActiveSpatialLayers',
        stats.videoSentActiveSpatialLayers,
        'd',
        'layers',
        undefined,
        true,
      ) +
      sprintfStats(
        'sentMaxBitrate',
        stats.videoSentMaxBitrate,
        '.2f',
        'Kbps',
        1e-3,
      ) +
      sprintfStats('width', stats.videoSentWidth, 'd', 'px', undefined, true) +
      sprintfStats(
        'height',
        stats.videoSentHeight,
        'd',
        'px',
        undefined,
        true,
      ) +
      sprintfStats('fps', stats.videoSentFps, 'd', 'fps', undefined, true) +
      sprintfStats(
        'firCountReceived',
        stats.videoFirCountReceived,
        'd',
        '',
        undefined,
        true,
      ) +
      sprintfStats(
        'pliCountReceived',
        stats.videoPliCountReceived,
        'd',
        '',
        undefined,
        true,
      )
    if (this.alertRules) {
      const report = this.formatAlertRulesReport()
      if (report.length) {
        out += sprintfStatsTitle('Alert rules report')
        out += report
      }
    }

    if (!this.showPageLog) {
      console.clear()
    }
    console.log(out)
  }

  /**
   * sendToPushGateway
   */
  async sendToPushGateway(): Promise<void> {
    if (!this.gateway || !this.running) {
      return
    }
    const elapsedSeconds = (Date.now() - this.startTimestamp) / 1000
    const datetime = this.startTimestampString

    Object.entries(this.metrics).forEach(([name, metric]) => {
      if (!this.collectedStats[name]) {
        return
      }
      Object.entries(this.collectedStats[name]).forEach(([label, stats]) => {
        let host = 'all'
        let codec = 'all'
        if (label.startsWith('host:')) {
          host = label.replace('host:', '')
        } else if (label.startsWith('codec:')) {
          codec = label.replace('codec:', '')
        }
        const { length, sum, mean, stddev, p5, p95, min, max } = formatStats(
          stats,
        ) as StatsData
        metric.length.set({ host, codec, datetime }, length)
        metric.sum.set({ host, codec, datetime }, sum)
        metric.mean.set({ host, codec, datetime }, mean)
        metric.stddev.set({ host, codec, datetime }, stddev)
        metric.p5.set({ host, codec, datetime }, p5)
        metric.p95.set({ host, codec, datetime }, p95)
        metric.min.set({ host, codec, datetime }, min)
        metric.max.set({ host, codec, datetime }, max)
      })
      // Set alerts metrics.
      if (this.alertRules && this.alertRules[name]) {
        const rule = this.alertRules[name]
        // eslint-disable-next-line prefer-const
        for (let [ruleKey, ruleValues] of Object.entries(rule)) {
          if (ruleKey === 'tags') {
            continue
          }
          if (!Array.isArray(ruleValues)) {
            ruleValues = [ruleValues as AlertRuleValue]
          } else {
            ruleValues = ruleValues as AlertRuleValue[]
          }
          for (const ruleValue of ruleValues) {
            // Send rule values as metrics.
            if (
              ruleValue.$after !== undefined &&
              elapsedSeconds < ruleValue.$after
            ) {
              continue
            }
            const ruleName = `alert_${name}_${ruleKey}`
            const ruleObj = this.metrics[name].alertRules[ruleName]
            const remove =
              ruleValue.$before !== undefined &&
              elapsedSeconds > ruleValue.$before
            // Send rule report as metric.
            const ruleDesc = this.getAlertRuleDesc(ruleKey, ruleValue)
            const report = this.alertRulesReport.get(name)
            if (report) {
              const ruleReport = report.get(ruleDesc)
              if (ruleReport) {
                const labels = { rule: ruleDesc, datetime }
                if (!remove) {
                  ruleObj.report.set(labels, ruleReport.failAmountPercentile)
                  ruleObj.mean.set(labels, ruleReport.valueAverage)
                } else {
                  ruleObj.report.remove(labels)
                  ruleObj.mean.remove(labels)
                }
              }
            }
            // Send rules values as metrics.
            if (ruleValue.$eq !== undefined) {
              const labels = { rule: `${name} ${ruleKey} =`, datetime }
              if (!remove) {
                ruleObj.rule.set(labels, ruleValue.$eq)
              } else {
                ruleObj.rule.remove(labels)
              }
            }
            if (ruleValue.$lt !== undefined) {
              const labels = { rule: `${name} ${ruleKey} <`, datetime }
              if (!remove) {
                ruleObj.rule.set(labels, ruleValue.$lt)
              } else {
                ruleObj.rule.remove(labels)
              }
            }
            if (ruleValue.$lte !== undefined) {
              const labels = { rule: `${name} ${ruleKey} <=`, datetime }
              if (!remove) {
                ruleObj.rule.set(labels, ruleValue.$lte)
              } else {
                ruleObj.rule.remove(labels)
              }
            }
            if (ruleValue.$gt !== undefined) {
              const labels = { rule: `${name} ${ruleKey} >`, datetime }
              if (!remove) {
                ruleObj.rule.set(labels, ruleValue.$gt)
              } else {
                ruleObj.rule.remove(labels)
              }
            }
            if (ruleValue.$gte !== undefined) {
              const labels = { rule: `${name} ${ruleKey} >=`, datetime }
              if (!remove) {
                ruleObj.rule.set(labels, ruleValue.$gte)
              } else {
                ruleObj.rule.remove(labels)
              }
            }
          }
        }
      }
    })

    const alertRulesReportTags = this.getAlertRulesTags()
    if (alertRulesReportTags && this.alertTagsMetrics) {
      for (const [tag, stat] of alertRulesReportTags.entries()) {
        this.alertTagsMetrics.set(
          { datetime, tag },
          calculateFailAmountPercentile(stat, this.alertRulesFailPercentile),
        )
      }
    }

    try {
      const { resp, body } = await this.gateway.push({
        jobName: this.prometheusPushgatewayJobName,
      })
      if ((body as string).length) {
        log.warn(
          `Pushgateway error ${(resp as http.ServerResponse).statusCode}: ${
            body as string
          }`,
        )
      }
    } catch (err) {
      log.error(`Pushgateway push error: ${(err as Error).message}`)
    }
  }

  /**
   * alertRuleDesc
   */
  getAlertRuleDesc(ruleKey: string, ruleValue: AlertRuleValue): string {
    const ruleDescs = []
    if (ruleValue.$eq !== undefined) {
      ruleDescs.push(`= ${ruleValue.$eq}`)
    }
    if (ruleValue.$gt !== undefined) {
      ruleDescs.push(`> ${ruleValue.$gt}`)
    }
    if (ruleValue.$gte !== undefined) {
      ruleDescs.push(`>= ${ruleValue.$gte}`)
    }
    if (ruleValue.$lt !== undefined) {
      ruleDescs.push(`< ${ruleValue.$lt}`)
    }
    if (ruleValue.$lte !== undefined) {
      ruleDescs.push(`<= ${ruleValue.$lte}`)
    }
    let ruleDesc = `${ruleKey} ${ruleDescs.join(' and ')}`
    if (ruleValue.$after !== undefined) {
      ruleDesc += ` after ${ruleValue.$after}s`
    }
    if (ruleValue.$before !== undefined) {
      ruleDesc += ` before ${ruleValue.$before}s`
    }
    return ruleDesc
  }

  /**
   * checkAlertRules
   */
  checkAlertRules(): void {
    if (!this.alertRules || !this.running) {
      return
    }
    const now = Date.now()
    const elapsedSeconds = (now - this.startTimestamp) / 1000

    for (const [key, rule] of Object.entries(this.alertRules)) {
      if (!this.collectedStats[key]) {
        continue
      }
      let failPercentile = this.alertRulesFailPercentile
      const value = formatStats(this.collectedStats[key].all) as StatsData
      // eslint-disable-next-line prefer-const
      for (let [ruleKey, ruleValues] of Object.entries(rule)) {
        if (['tags', 'failPercentile'].includes(ruleKey)) {
          if (ruleKey === 'failPercentile') {
            failPercentile = ruleValues as number
          }
          continue
        }
        if (!Array.isArray(ruleValues)) {
          ruleValues = [ruleValues as AlertRuleValue]
        } else {
          ruleValues = ruleValues as AlertRuleValue[]
        }
        let ruleElapsedSeconds = elapsedSeconds
        for (const ruleValue of ruleValues) {
          if (
            (ruleValue.$after !== undefined &&
              elapsedSeconds < ruleValue.$after) ||
            (ruleValue.$before !== undefined &&
              elapsedSeconds > ruleValue.$before)
          ) {
            continue
          }
          if (ruleValue.$after !== undefined) {
            ruleElapsedSeconds -= ruleValue.$after
          }
          const checkValue = value[ruleKey as StatsDataKey]
          if (!isFinite(checkValue)) {
            continue
          }
          const ruleDesc = this.getAlertRuleDesc(ruleKey, ruleValue)
          let failed = false
          let failAmount = 0
          if (ruleValue.$eq !== undefined) {
            if (checkValue !== ruleValue.$eq) {
              failed = true
              failAmount = calculateFailAmount(checkValue, ruleValue.$eq)
            }
          } else {
            if (ruleValue.$lt !== undefined) {
              if (checkValue >= ruleValue.$lt) {
                failed = true
                failAmount = calculateFailAmount(checkValue, ruleValue.$lt)
              }
            } else if (ruleValue.$lte !== undefined) {
              if (checkValue > ruleValue.$lte) {
                failed = true
                failAmount = calculateFailAmount(checkValue, ruleValue.$lte)
              }
            }
            if (!failed) {
              if (ruleValue.$gt !== undefined) {
                if (checkValue <= ruleValue.$gt) {
                  failed = true
                  failAmount = calculateFailAmount(checkValue, ruleValue.$gt)
                }
              } else if (ruleValue.$gte !== undefined) {
                if (checkValue < ruleValue.$gte) {
                  failed = true
                  failAmount = calculateFailAmount(checkValue, ruleValue.$gte)
                }
              }
            }
          }
          // Report if failed or not.
          this.updateRulesReport(
            key,
            checkValue,
            ruleDesc,
            failed,
            failAmount,
            now,
            ruleElapsedSeconds,
            failPercentile,
          )
        }
      }
    }
  }

  /**
   * addFailedRule
   */
  updateRulesReport(
    key: string,
    checkValue: number,
    ruleDesc: string,
    failed: boolean,
    failAmount: number,
    now: number,
    elapsedSeconds: number,
    failPercentile: number,
  ): void {
    if (failed) {
      log.debug(
        `updateRulesReport ${key}.${ruleDesc} failed: ${failed} checkValue: ${checkValue} failAmount: ${failAmount} elapsedSeconds: ${elapsedSeconds}`,
      )
    }
    let report = this.alertRulesReport.get(key)
    if (!report) {
      report = new Map()
      this.alertRulesReport.set(key, report)
    }
    let reportValue = report.get(ruleDesc)
    if (!reportValue) {
      reportValue = {
        totalFails: 0,
        totalFailsTime: 0,
        totalFailsPerc: 0,
        lastFailed: 0,
        valueStats: new FastStats(),
        valueAverage: 0,
        failAmountStats: new FastStats(),
        failAmountPercentile: 0,
      }
      report.set(ruleDesc, reportValue)
    }
    if (failed) {
      reportValue.totalFails += 1
      if (reportValue.lastFailed) {
        reportValue.totalFailsTime += (now - reportValue.lastFailed) / 1000
      }
      reportValue.lastFailed = now
    } else {
      reportValue.lastFailed = 0
    }
    reportValue.totalFailsPerc = Math.round(
      (100 * reportValue.totalFailsTime) / elapsedSeconds,
    )
    reportValue.valueStats.push(checkValue)
    reportValue.valueAverage = reportValue.valueStats.amean()
    reportValue.failAmountStats.push(failAmount)
    reportValue.failAmountPercentile = calculateFailAmountPercentile(
      reportValue.failAmountStats,
      failPercentile,
    )
  }

  getAlertRulesTags(): Map<string, FastStats> | undefined {
    if (!this.alertRules) {
      return
    }
    const alertRulesReportTags = new Map<string, FastStats>()
    for (const [key, report] of this.alertRulesReport.entries()) {
      const tags = this.alertRules[key].tags || []
      for (const tag of tags) {
        if (!alertRulesReportTags.has(tag)) {
          alertRulesReportTags.set(tag, new FastStats())
        }
      }
      for (const reportValue of report.values()) {
        const { failAmountPercentile } = reportValue
        for (const tag of tags) {
          const stat = alertRulesReportTags.get(tag)
          if (!stat) {
            continue
          }
          stat.push(failAmountPercentile)
        }
      }
    }
    return alertRulesReportTags
  }

  /**
   * formatAlertRulesReport
   * @param ext
   */
  formatAlertRulesReport(ext: string | null = null): string {
    if (!this.alertRulesReport || !this.alertRules) {
      return ''
    }
    // Update tags values.
    const alertRulesReportTags = this.getAlertRulesTags() as Map<
      string,
      FastStats
    >
    // JSON output.
    if (ext === 'json') {
      const out = {
        tags: {} as Record<string, number>,
        reports: {} as Record<
          string,
          {
            totalFails: number
            totalFailsTime: number
            valueAverage: number
            totalFailsPerc: number
            failAmount: number
            count: number
            // failAmountStats: number[]
          }
        >,
      }
      for (const [key, report] of this.alertRulesReport.entries()) {
        for (const [reportDesc, reportValue] of report.entries()) {
          const {
            totalFails,
            totalFailsTime,
            valueAverage,
            totalFailsPerc,
            failAmountStats,
            failAmountPercentile,
          } = reportValue
          if (totalFails && totalFailsPerc > 0) {
            out.reports[`${key} ${reportDesc}`] = {
              totalFails,
              totalFailsTime: Math.round(totalFailsTime),
              valueAverage,
              totalFailsPerc,
              failAmount: failAmountPercentile,
              count: failAmountStats.length,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              // failAmountStats: (failAmountStats as any).data as number[],
            }
          }
        }
      }
      for (const [tag, stat] of alertRulesReportTags.entries()) {
        out.tags[tag] = calculateFailAmountPercentile(
          stat,
          this.alertRulesFailPercentile,
        )
      }
      return JSON.stringify(out, null, 2)
    }
    // Textual output.
    let out = ''
    // Calculate max column size.
    let colSize = 20
    for (const [key, report] of this.alertRulesReport.entries()) {
      for (const [reportDesc, reportValue] of report.entries()) {
        const { totalFails, totalFailsPerc } = reportValue
        if (totalFails && totalFailsPerc > 0) {
          const check = `${key} ${reportDesc}`
          colSize = Math.max(colSize, check.length)
        }
      }
    }
    if (ext) {
      // eslint-disable-next-line
      out += sprintf(`| %(check)-${colSize}s | %(total)-10s | %(totalFailsTime)-15s | %(totalFailsPerc)-15s | %(failAmount)-15s |\n`, {
          check: 'Condition',
          total: 'Fails',
          totalFailsTime: 'Fail time (s)',
          totalFailsPerc: 'Fail time (%)',
          failAmount: 'Fail amount %',
        },
      )
    } else {
      // eslint-disable-next-line
      out += sprintf(chalk`{bold %(check)-${colSize}s} {bold %(total)-10s} {bold %(totalFailsTime)-15s} {bold %(totalFailsPerc)-15s} {bold %(failAmount)-15s}\n`, {
          check: 'Condition',
          total: 'Fails',
          totalFailsTime: 'Fail time (s)',
          totalFailsPerc: 'Fail time (%)',
          failAmount: 'Fail amount %',
        },
      )
    }
    for (const [key, report] of this.alertRulesReport.entries()) {
      for (const [reportDesc, reportValue] of report.entries()) {
        const {
          totalFails,
          totalFailsTime,
          failAmountPercentile,
          totalFailsPerc,
        } = reportValue
        if (totalFails && totalFailsPerc > 0) {
          if (ext) {
            // eslint-disable-next-line
            out += sprintf(`| %(check)-${colSize}s | %(totalFails)-10s | %(totalFailsTime)-15s | %(totalFailsPerc)-15s | %(failAmountPercentile)-15s |\n`, {
                check: `${key} ${reportDesc}`,
                totalFails,
                totalFailsTime: Math.round(totalFailsTime),
                totalFailsPerc,
                failAmountPercentile,
              },
            )
          } else {
            // eslint-disable-next-line
            out += sprintf(chalk`{red {bold %(check)-${colSize}s}} {bold %(totalFails)-10s} {bold %(totalFailsTime)-15s} {bold %(totalFailsPerc)-15s} {bold %(failAmountPercentile)-15s}\n`, {
                check: `${key} ${reportDesc}`,
                totalFails,
                totalFailsTime: Math.round(totalFailsTime),
                totalFailsPerc,
                failAmountPercentile,
              },
            )
          }
        }
      }
    }
    // Tags report.
    if (ext) {
      out += sprintf(`%(fill)s\n`, { fill: '-'.repeat(colSize + 15 + 7) })
      // eslint-disable-next-line
      out += sprintf(`| %(name)-${colSize}s | %(failPerc)-15s |\n`, {
        name: 'Tag',
        failPerc: 'Fail %',
      })
    } else {
      out += sprintf(`%(fill)s\n`, { fill: '-'.repeat(colSize + 15) })
      // eslint-disable-next-line
      out += sprintf(chalk`{bold %(name)-${colSize}s} {bold %(failPerc)-15s}\n`, {
          name: 'Tag',
          failPerc: 'Fail %',
        },
      )
    }
    for (const [tag, stat] of alertRulesReportTags.entries()) {
      const failPerc = calculateFailAmountPercentile(
        stat,
        this.alertRulesFailPercentile,
      )
      if (ext) {
        // eslint-disable-next-line
        out += sprintf(`| %(tag)-${colSize}s | %(failPerc)-15s |\n`, {
          tag,
          failPerc,
        })
      } else {
        const color =
          failPerc < 5
            ? 'green'
            : failPerc < 25
            ? 'yellowBright'
            : failPerc < 50
            ? 'yellow'
            : 'red'
        // eslint-disable-next-line
        out += sprintf(chalk`{${color} {bold %(tag)-${colSize}s %(failPerc)-15s}}\n`, {
            tag,
            failPerc,
          },
        )
      }
    }
    return out
  }

  /**
   * writeAlertRulesReport
   */
  async writeAlertRulesReport(): Promise<void> {
    if (!this.alertRules || !this.alertRulesFilename || !this.running) {
      return
    }
    log.debug(`writeAlertRulesReport writing in ${this.alertRulesFilename}`)
    try {
      const ext = this.alertRulesFilename.split('.').slice(-1)[0]
      const report = this.formatAlertRulesReport(ext)
      if (!report.length) {
        return
      }
      let out
      if (ext === 'log') {
        const lines = report.split('\n').filter(line => line.length)
        const name = `Alert rules report (${moment().format()})`
        out = sprintf(`-- %(name)s %(fill)s\n`, {
          name,
          fill: '-'.repeat(Math.max(4, lines[0].length - name.length - 4)),
        })
        out += report
        out += sprintf(`%(fill)s\n`, {
          fill: '-'.repeat(lines[lines.length - 1].length),
        })
      } else {
        out = report
      }
      await fs.promises.mkdir(path.dirname(this.alertRulesFilename), {
        recursive: true,
      })
      await fs.promises.writeFile(this.alertRulesFilename, out)
    } catch (err) {
      log.error(`writeAlertRulesReport error: ${(err as Error).message}`)
    }
  }

  /**
   * Stop the stats collector and the added Sessions.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return
    }
    this.running = false
    log.info('stop')
    if (this.scheduler) {
      this.scheduler.stop()
      this.scheduler = undefined
    }

    for (const session of this.sessions.values()) {
      try {
        session.removeAllListeners()
        await session.stop()
      } catch (err) {
        log.error(`session stop error: ${(err as Error).message}`)
      }
    }
    this.sessions.clear()

    this.statsWriter = null

    // delete metrics
    if (this.gateway) {
      await this.deletePushgatewayStats()
      this.gateway = null
      this.gatewayForDelete = null
      this.metrics = {}
    }

    this.collectedStats = {}
    this.externalCollectedStats.clear()
  }
}

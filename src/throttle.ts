import JSON5 from 'json5'
import os from 'os'

import { logger, runShellCommand, toPrecision } from './utils'

const log = logger('webrtcperf:throttle')

let throttleConfig: ThrottleConfig[] | null = null

const ruleTimeouts = new Set<NodeJS.Timeout>()

const throttleCurrentValues = {
  up: new Map<
    number,
    {
      rate?: number
      delay?: number
      delayJitter?: number
      delayJitterCorrelation?: number
      loss?: number
      lossBurst?: number
      queue?: number
    }
  >(),
  down: new Map<
    number,
    {
      rate?: number
      delay?: number
      delayJitterCorrelation?: number
      loss?: number
      lossBurst?: number
      queue?: number
    }
  >(),
}

async function getDefaultInterface(): Promise<string> {
  const { stdout } = await runShellCommand(
    `ip route | awk '/default/ {print $5; exit}' | tr -d ''`,
  )
  return stdout.trim()
}

async function cleanup(): Promise<void> {
  ruleTimeouts.forEach(timeoutId => clearTimeout(timeoutId))
  ruleTimeouts.clear()
  throttleCurrentValues.up.clear()
  throttleCurrentValues.down.clear()
  let device = throttleConfig?.length ? throttleConfig[0].device : ''
  if (!device) {
    device = await getDefaultInterface()
  }
  await runShellCommand(`\
sudo -n tc qdisc del dev ${device} root || true;
sudo -n tc class del dev ${device} || true;
sudo -n tc filter del dev ${device} || true;
sudo -n tc qdisc del dev ${device} ingress || true;

sudo -n tc qdisc del dev ifb0 root || true;
sudo -n tc class del dev ifb0 root || true;
sudo -n tc filter del dev ifb0 root || true;
`)
}

function calculateBufferedPackets(
  rate: number,
  delay: number,
  mtu = 1500,
): number {
  // https://lists.linuxfoundation.org/pipermail/netem/2007-March/001094.html
  return Math.ceil((((1.5 * rate * 1000) / 8) * (delay / 1000)) / mtu)
}

/** The network throttle rules to be applied to uplink or downlink. */
export type ThrottleRule = {
  /** The available bandwidth (Kbps). */
  rate?: number
  /** The one-way delay (ms). */
  delay?: number
  /** The one-way delay jitter (ms). */
  delayJitter?: number
  /** The one-way delay jitter correlation. */
  delayJitterCorrelation?: number
  /** The packet loss percentage. */
  loss?: number
  /** The packet loss burst. */
  lossBurst?: number
  /** The packet queue size. */
  queue?: number
  /** If set, the rule will be applied after the specified number of seconds. */
  at?: number
}

/**
 * The network throttling rules.
 * Specify multiple {@link ThrottleRule} with different `at` values to schedule
 * network bandwidth/delay fluctuations during the test run, e.g.:
 *
 * ```javascript
 * {
    device: "eth0",
    sessions: "0-1",
    protocol: "udp",
    down: [
      { rate: 1000000, delay: 50, loss: "0%", queue: 5 },
      { rate: 200000, delay: 100, loss: "5%", queue: 5, at: 60},
    ],
    up: { rate: 100000, delay: 50, queue: 5 },
  }
 * ```
 */
export type ThrottleConfig = {
  device?: string
  sessions?: string
  protocol?: 'udp' | 'tcp'
  match?: string
  up?: ThrottleRule | ThrottleRule[]
  down?: ThrottleRule | ThrottleRule[]
}

async function applyRules(
  config: ThrottleConfig,
  direction: 'up' | 'down',
  device: string,
  index: number,
  protocol?: 'udp' | 'tcp',
  match?: string,
): Promise<void> {
  let rules = config[direction]
  if (!rules) return
  log.debug(
    `applyRules device=${device} index=${index} protocol=${protocol} match=${match} ${JSON.stringify(
      rules,
    )}`,
  )
  if (!Array.isArray(rules)) {
    rules = [rules]
  }
  rules.sort((a, b) => {
    return (a.at || 0) - (b.at || 0)
  })

  for (const [i, rule] of rules.entries()) {
    const {
      rate,
      delay,
      delayJitter,
      delayJitterCorrelation,
      loss,
      lossBurst,
      queue,
      at,
    } = rule
    const limit = queue ?? calculateBufferedPackets(rate || 0, delay || 0)
    const mark = index + 1
    const handle = index + 2

    if (i === 0) {
      const matches = [`'meta(nf_mark eq ${mark})'`]
      if (protocol === 'udp') {
        matches.push("'cmp(u8 at 9 layer network eq 0x11)'")
      } else if (protocol === 'tcp') {
        matches.push("'cmp(u8 at 9 layer network eq 0x6)'")
      }
      if (match) {
        matches.push(match)
      }
      const cmd = `\
set -e;

sudo -n tc class add dev ${device} parent 1: classid 1:${handle} htb rate 1Gbit ceil 1Gbit;

sudo -n tc qdisc add dev ${device} \
  parent 1:${handle} \
  handle ${handle}: \
  netem; \

sudo -n tc filter add dev ${device} \
  parent 1: \
  protocol ip \
  basic match ${matches.join(' and ')} \
  flowid 1:${handle};
`
      try {
        await runShellCommand(cmd, true)
      } catch (err) {
        log.error(`error running "${cmd}": ${(err as Error).stack}`)
        throw err
      }
    }

    const timeoutId = setTimeout(async () => {
      let delayDesc = ''
      if (delay && delay > 0) {
        delayDesc = ` delay ${delay}ms`
        if (delayJitter && delayJitter > 0) {
          delayDesc += ` ${delayJitter}ms`
          if (delayJitterCorrelation && delayJitterCorrelation > 0) {
            delayDesc += ` ${delayJitterCorrelation}`
          }
        }
      }

      let lossDesc = ''
      if (loss && loss > 0) {
        if (lossBurst && lossBurst > 0) {
          const p = (100 * loss) / (lossBurst * (100 - loss))
          const r = 100 / lossBurst
          lossDesc = ` loss gemodel ${toPrecision(p, 2)} ${toPrecision(r, 2)}`
        } else {
          lossDesc = ` loss ${toPrecision(loss, 2)}%`
        }
      }

      const desc = `\
${rate && rate > 0 ? `rate ${rate}kbit` : ''}\
${delayDesc}\
${lossDesc}\
${limit && limit >= 0 ? ` limit ${limit}` : ''}`

      log.info(`applying rules on ${device} (${mark}): ${desc}`)
      const cmd = `\
sudo -n tc qdisc change dev ${device} \
  parent 1:${handle} \
  handle ${handle}: \
  netem ${desc}`
      try {
        ruleTimeouts.delete(timeoutId)

        await runShellCommand(cmd)

        throttleCurrentValues[direction].set(index, {
          rate: rate ? 1000 * rate : undefined,
          delay: delay || undefined,
          loss: loss || undefined,
          queue: limit || undefined,
        })
      } catch (err) {
        log.error(`error running "${cmd}": ${(err as Error).stack}`)
      }
    }, (at || 0) * 1000)

    ruleTimeouts.add(timeoutId)
  }
}

async function start(): Promise<void> {
  if (!throttleConfig || !throttleConfig.length) return

  let device = throttleConfig[0].device
  if (!device) {
    device = await getDefaultInterface()
  }

  await runShellCommand(
    `\
set -e;

sudo -n modprobe ifb || true;
sudo -n ip link add ifb0 type ifb || true;
sudo -n ip link set dev ifb0 up;

sudo -n tc qdisc add dev ${device} root handle 1: htb default 1;
sudo -n tc class add dev ${device} parent 1: classid 1:1 htb rate 1Gbit ceil 1Gbit;

sudo -n tc qdisc add dev ifb0 root handle 1: htb default 1;
sudo -n tc class add dev ifb0 parent 1: classid 1:1 htb rate 1Gbit ceil 1Gbit;

sudo -n tc qdisc add dev ${device} ingress handle ffff: || true;
sudo -n tc filter add dev ${device} \
  parent ffff: \
  protocol ip \
  u32 \
  match u32 0 0 \
  action connmark \
  action mirred egress \
  redirect dev ifb0 \
  flowid 1:1;
`,
    true,
  )

  let index = 0
  for (const config of throttleConfig) {
    if (config.up) {
      await applyRules(
        config,
        'up',
        device,
        index,
        config.protocol,
        config.match,
      )
    }
    if (config.down) {
      await applyRules(
        config,
        'down',
        'ifb0',
        index,
        config.protocol,
        config.match,
      )
    }
    index++
  }
}

/**
 * Starts a network throttle configuration
 * @param config A JSON5 configuration parsed as {@link ThrottleConfig}.
 */
export async function startThrottle(config: string): Promise<void> {
  if (os.platform() !== 'linux') return
  try {
    throttleConfig = JSON5.parse(config) as ThrottleConfig[]
    log.info('Starting throttle with config:', throttleConfig)
    await cleanup()
    await start()
  } catch (err) {
    log.error(`startThrottle "${config}" error: ${(err as Error).stack}`)
    await stopThrottle()
    throw err
  }
}

/**
 * Stops the network throttle.
 */
export async function stopThrottle(): Promise<void> {
  if (os.platform() !== 'linux') return
  try {
    log.info('Stopping throttle')
    await cleanup()
    throttleConfig = null
  } catch (err) {
    log.error(`Stop throttle error: ${(err as Error).stack}`)
  }
}

export function getSessionThrottleIndex(sessionId: number): number {
  if (!throttleConfig) return -1

  for (const config of throttleConfig) {
    if (!config.sessions) {
      continue
    }
    const index = throttleConfig.indexOf(config)
    try {
      if (config.sessions.includes('-')) {
        const [start, end] = config.sessions.split('-').map(Number)
        if (sessionId >= start && sessionId <= end) {
          return index
        }
      } else if (config.sessions.includes(',')) {
        const sessions = config.sessions.split(',').map(Number)
        if (sessions.includes(sessionId)) {
          return index
        }
      } else if (sessionId === Number(config.sessions)) {
        return index
      }
    } catch (err) {
      log.error(`getSessionThrottleId error: ${(err as Error).stack}`)
    }
  }

  return -1
}

export function getSessionThrottleValues(
  index: number,
  direction: 'up' | 'down',
): {
  rate?: number
  delay?: number
  loss?: number
  queue?: number
} {
  if (index < 0) {
    return {}
  }
  return throttleCurrentValues[direction].get(index) || {}
}

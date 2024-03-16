import JSON5 from 'json5'

import { logger, runShellCommand } from './utils'

const log = logger('app:throttle')

let throttleConfig: ThrottleConfig[] | null = null

const throttleCurrentValues = {
  up: new Map<
    number,
    { rate?: number; delay?: number; loss?: number; queue?: number }
  >(),
  down: new Map<
    number,
    { rate?: number; delay?: number; loss?: number; queue?: number }
  >(),
}

async function getDefaultInterface(): Promise<string> {
  const { stdout } = await runShellCommand(
    `ip route | awk '/default/ {print $5; exit}' | tr -d ''`,
  )
  return stdout.trim()
}

async function cleanup(): Promise<void> {
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
  /** The packet loss percentage. */
  loss?: number
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
  up?: ThrottleRule | ThrottleRule[]
  down?: ThrottleRule | ThrottleRule[]
}

async function applyRules(
  config: ThrottleConfig,
  direction: 'up' | 'down',
  device: string,
  index: number,
  protocol?: 'udp' | 'tcp',
): Promise<void> {
  let rules = config[direction]
  if (!rules) return
  log.debug(
    `applyRules device=${device} index=${index} protocol=${protocol} ${JSON.stringify(
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
    const { rate, delay, loss, queue, at } = rule
    const limit = queue ?? calculateBufferedPackets(rate || 0, delay || 0)
    const mark = index + 1
    const handle = index + 2

    if (i === 0) {
      const matchProtocol =
        protocol === 'udp'
          ? 'match ip protocol 0x11 0xff'
          : protocol === 'tcp'
          ? 'match ip protocol 0x6 0xff'
          : ''
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
  u32 \
  match mark ${mark} 0xffffffff \
  ${matchProtocol} \
  flowid 1:${handle};
`
      try {
        await runShellCommand(cmd)
      } catch (err) {
        log.error(`error running "${cmd}": ${(err as Error).stack}`)
        throw err
      }
    }

    setTimeout(async () => {
      log.info(
        `applying rules on ${device}: rate ${rate}kbit, delay ${delay}ms, loss ${loss}%, limit ${limit}`,
      )
      const cmd = `\
        sudo -n tc qdisc change dev ${device} \
          parent 1:${handle} \
          handle ${handle}: \
          netem \
          ${rate && rate > 0 ? `rate ${rate}kbit` : ''} \
          ${delay && delay >= 0 ? `delay ${delay}ms` : ''} \
          ${loss && loss >= 0 ? `loss ${delay}%` : ''} \
          ${limit && limit >= 0 ? `limit ${limit}` : ''} \
      `
      try {
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
  }
}

async function start(): Promise<void> {
  if (!throttleConfig || !throttleConfig.length) return

  let device = throttleConfig[0].device
  if (!device) {
    device = await getDefaultInterface()
  }

  await runShellCommand(`\
set -e;

sudo -n modprobe ifb;
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
  action mirred egress redirect dev ifb0 \
  flowid 1:1;
`)

  let index = 0
  for (const config of throttleConfig) {
    if (config.up) {
      await applyRules(config, 'up', device, index, config.protocol)
    }
    if (config.down) {
      await applyRules(config, 'down', 'ifb0', index, config.protocol)
    }
    index++
  }
}

/**
 * Starts a network throttle configuration
 * @param config A JSON5 configuration parsed as {@link ThrottleConfig}.
 */
export async function startThrottle(config: string): Promise<void> {
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

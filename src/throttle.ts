import JSON5 from 'json5'

import { logger, runShellCommand } from './utils'

const log = logger('app:throttle')

async function getDefaultInterface(): Promise<string> {
  const { stdout } = await runShellCommand(
    `ip route | awk '/default/ {print $5; exit}' | tr -d ''`,
  )
  return stdout.trim()
}

async function stop(): Promise<void> {
  const device = await getDefaultInterface()
  await runShellCommand(`\
sudo tc qdisc del dev ${device} root; \
sudo tc qdisc del dev ${device} ingress; \
sudo tc qdisc del dev ifb0 root; \
`)
}

function calculateBufferedPackets(rate: number, halfWayRTT: number): number {
  // https://lists.linuxfoundation.org/pipermail/netem/2007-March/001094.html
  return Math.ceil((((1.5 * rate * 1000) / 8) * (halfWayRTT / 1000)) / 1500)
}

/** The network throttle rules to be applied to uplink or downlink. */
export type ThrottleRule = {
  /** The available bandwidth (Kbps). */
  rate?: number
  /** The RTT (ms). */
  rtt?: number
  /** The packet loss percentage with optional correlation (e.g. \`"5% 25%"\`).
   * Refer to [netem documentation](https://wiki.linuxfoundation.org/networking/netem#packet_loss) for additional string options.
   */
  loss?: string
  /** Additional packet queue size. */
  queue?: number
  /** If the rule should be applied only to UDP or TCP flows. */
  protocol?: 'udp' | 'tcp'
  /** If set, the rule will be applied after the specified number of seconds. */
  at?: number
}

/**
 * The network throttling rules.
 * Specify multiple {@link ThrottleRule} with different `at` values to schedule
 * network bandwidth/RTT fluctuations during the test run, e.g.:
 *
 * ```javascript
 * {
    down: [
      { protocol: "udp", rate: 1000000, rtt: 50, loss: "0%", queue: 5 },
      { protocol: "udp", rate: 200000, rtt: 100, loss: "5%", queue: 5, at: 60},
    ],
    up: { rate: 100000, rtt: 50, queue: 5 },
  }
 * ```
 */
export type ThrottleConfig = {
  up?: ThrottleRule | ThrottleRule[]
  down?: ThrottleRule | ThrottleRule[]
}

async function applyRules(
  rules: ThrottleRule | ThrottleRule[],
  device: string,
): Promise<void> {
  if (!Array.isArray(rules)) {
    rules = [rules]
  }
  rules.sort((a, b) => {
    return (a.at || 0) - (b.at || 0)
  })

  for (const [i, rule] of rules.entries()) {
    const { rate, rtt, loss, queue, protocol, at } = rule
    const action = i === 0 ? 'add' : 'change'
    const halfWayRTT = (rtt || 0) / 2
    const lossString = loss ? loss.split(',').join(' ') : '0%'
    const limit = calculateBufferedPackets(rate || 0, halfWayRTT) + (queue || 0)

    if (i === 0) {
      const filterMatch =
        protocol === 'udp'
          ? 'ip protocol 0x11 0xff'
          : protocol === 'tcp'
          ? 'ip protocol 0x6 0xff'
          : 'u32 0 0'
      const cmd = `\
        sudo tc filter add dev ${device} \
          protocol ip \
          parent 1:0 \
          prio 1 \
          u32 \
          match ${filterMatch} \
          flowid 1:1; \
      `
      try {
        await runShellCommand(cmd)
      } catch (err) {
        log.error(`error running "${cmd}": ${(err as Error).message}`)
      }
    }

    setTimeout(async () => {
      log.info(
        `applying rules on ${device}: rate ${rate}kbit, delay ${halfWayRTT}ms, loss ${lossString}, limit ${limit}`,
      )
      const cmd = `\
        sudo tc qdisc ${action} dev ${device} \
          parent 1:1 \
          handle 10: \
          netem \
          delay ${halfWayRTT}ms \
          rate ${rate}kbit \
          loss ${lossString} \
          limit ${limit}; \
      `
      try {
        await runShellCommand(cmd)
      } catch (err) {
        log.error(`error running "${cmd}": ${(err as Error).message}`)
      }
    }, (at || 0) * 1000)
  }
}

async function start(config: ThrottleConfig): Promise<void> {
  // https://rotadev.com/using-tc-to-delay-packets-to-only-a-single-ip-address-server-fault/
  const device = await getDefaultInterface()
  await runShellCommand(`\
sudo modprobe ifb; \
sudo ip link add ifb0 type ifb; \
sudo ip link set dev ifb0 up; \
sudo tc qdisc add dev ${device} root handle 1: prio priomap 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2; \
sudo tc qdisc add dev ifb0      root handle 1: prio priomap 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2; \
sudo tc qdisc add dev ${device} ingress; \
sudo tc filter add dev ${device} \
  parent ffff: \
  protocol ip \
  priority 1 \
  u32 \
  match u32 0 0 \
  flowid 1:1 \
  action mirred egress \
  redirect dev ifb0; \
`)

  if (config.up) {
    await applyRules(config.up, device)
  }

  if (config.down) {
    await applyRules(config.down, 'ifb0')
  }
}

/**
 * Starts a network throttle configuration
 * @param config A JSON5 configuration parsed as {@link ThrottleConfig}.
 */
export async function startThrottle(config: string): Promise<void> {
  try {
    const throttleConfig = JSON5.parse(config) as ThrottleConfig
    log.info('Starting throttle with config:', throttleConfig)
    await start(throttleConfig)
  } catch (err) {
    log.error(`startThrottle "${config}" error: ${(err as Error).message}`)
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
    await stop()
  } catch (err) {
    log.error(`Stop throttle error: ${(err as Error).message}`)
  }
}

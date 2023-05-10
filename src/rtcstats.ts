import assert from 'assert'

/**
 * Page stats metric names.
 */
export enum PageStatsNames {
  /** The browser page CPU usage. */
  cpu = 'cpu',
  /** The browser page memory usage. */
  memory = 'memory',
  /** The tool nodejs CPU usage. */
  nodeCpu = 'nodeCpu',
  /** The tool nodejs memory usage. */
  nodeMemory = 'nodeMemory',
  /** The system total CPU usage. */
  usedCpu = 'usedCpu',
  /** The system total memory usage. */
  usedMemory = 'usedMemory',
  /** The system total GPU usage. */
  usedGpu = 'usedGpu',

  /** The opened pages count. */
  pages = 'pages',
  /** The total opened PeerConnections. */
  peerConnections = 'peerConnections',

  /** The page errors count. */
  errors = 'errors',
  /** The page warnings count. */
  warnings = 'warnings',

  /** The page total HTTP received bytes. */
  httpRecvBytes = 'httpRecvBytes',
  /** The page HTTP receive bitrate. */
  httpRecvBitrate = 'httpRecvBitrate',
  /** The page HTTP receive latency. */
  httpRecvLatency = 'httpRecvLatency',

  /** The video end to end total delay. */
  videoEndToEndDelay = 'videoEndToEndDelay',
  /**
   * The video end to end network delay.
   * It does't include the video encode/decode time and the jitter buffer time.
   */
  videoEndToEndNetworkDelay = 'videoEndToEndNetworkDelay',
}

/**
 * RTC metrics collected by the page helper scripts and related to each
 * track object created by PeerConnections.
 */
export enum RtcStatsMetricNames {
  /** The sent audio codec. */
  audioSentCodec = 'audioSentCodec',
  /** The total sent audio bytes. */
  audioSentBytes = 'audioSentBytes',
  /** The sent audio bitrates. */
  audioSentBitrates = 'audioSentBitrates',
  //'audioSentPackets',
  /** The send audio lost packets. */
  audioSentPacketsLost = 'audioSentPacketsLost',
  //'audioSentPacketsLostCount',
  /** The total audio NACK received by the sender. */
  audioSentNackCountRecv = 'audioSentNackCountRecv',
  /** The sent audio round trip time. */
  audioSentRoundTripTime = 'audioSentRoundTripTime',
  /** The audio RTC transport round trip time. */
  audioSentTransportRoundTripTime = 'audioSentTransportRoundTripTime',

  /** The sent video codec. */
  videoSentCodec = 'videoSentCodec',
  //'videoFirCountReceived',
  /** The PLI requests received by the video sender. */
  videoPliCountReceived = 'videoPliCountReceived',
  /** The sent video encode latency. */
  videoEncodeLatency = 'videoEncodeLatency',
  /** The sent video latency. */
  videoSentLatency = 'videoSentLatency',
  /** The sent video bandwidth quality limitations. */
  videoQualityLimitationBandwidth = 'videoQualityLimitationBandwidth',
  /** The sent video cpu quality limitations. */
  videoQualityLimitationCpu = 'videoQualityLimitationCpu',
  /** The sent video total resolution changes for quality limitations. */
  videoQualityLimitationResolutionChanges = 'videoQualityLimitationResolutionChanges',
  /** The sent video Simulcast active spatial layers. */
  videoSentActiveEncodings = 'videoSentActiveEncodings',
  /** The sent video bitrates. */
  videoSentBitrates = 'videoSentBitrates',
  /** The sent video bytes. */
  videoSentBytes = 'videoSentBytes',
  /** The sent video framerate. */
  videoSentFps = 'videoSentFps',
  /** The sent video width. */
  videoSentWidth = 'videoSentWidth',
  /** The sent video height. */
  videoSentHeight = 'videoSentHeight',
  /** The sent video encoding max bitrate. */
  videoSentMaxBitrate = 'videoSentMaxBitrate',
  //'videoSentPackets',
  /** The sent video lost packets. */
  videoSentPacketsLost = 'videoSentPacketsLost',
  //'videoSentPacketsLostCount',
  /** The NACK count received by video sender. */
  videoSentNackCountRecv = 'videoSentNackCountRecv',
  /** The sent video round trip time. */
  videoSentRoundTripTime = 'videoSentRoundTripTime',
  /** The transport send video round trip time. */
  videoSentTransportRoundTripTime = 'videoSentTransportRoundTripTime',

  /** The sent screen codec. */
  screenSentCodec = 'screenSentCodec',
  //'screenFirCountReceived',
  /** The received PLI from screen sender. */
  screenPliCountReceived = 'screenPliCountReceived',
  /** The sent screen encode latency. */
  screenEncodeLatency = 'screenEncodeLatency',
  /** The sent screen latency. */
  screenSentLatency = 'screenSentLatency',
  /** The sent screen bandwidth quality limitation. */
  screenQualityLimitationBandwidth = 'screenQualityLimitationBandwidth',
  /** The sent screen cpu quality limitation. */
  screenQualityLimitationCpu = 'screenQualityLimitationCpu',
  /** The sent screen resolustion changes caused by quality limitation. */
  screenQualityLimitationResolutionChanges = 'screenQualityLimitationResolutionChanges',
  /** The sent screen active Simulcast spatial layers. */
  screenSentActiveEncodings = 'screenSentActiveEncodings',
  /** The sent screen bitrates. */
  screenSentBitrates = 'screenSentBitrates',
  /** The sent screen bytes. */
  screenSentBytes = 'screenSentBytes',
  /** The sent screen framerate. */
  screenSentFps = 'screenSentFps',
  /** The sent screen width. */
  screenSentWidth = 'screenSentWidth',
  /** The sent screen height. */
  screenSentHeight = 'screenSentHeight',
  /** The sent screen encoding max bitrate. */
  screenSentMaxBitrate = 'screenSentMaxBitrate',
  //'screenSentPackets',
  /** The sent screen lost packets. */
  screenSentPacketsLost = 'screenSentPacketsLost',
  //'screenSentPacketsLostCount',
  /** The NACK count received by screen sender. */
  screenSentNackCountRecv = 'screenSentNackCountRecv',
  /** The sent screen round trip time. */
  screenSentRoundTripTime = 'screenSentRoundTripTime',
  /** The transport sent screen round trip time. */
  screenSentTransportRoundTripTime = 'screenSentTransportRoundTripTime',

  // inbound audio,
  audioRecvCodec = 'audioRecvCodec',
  audioRecvBytes = 'audioRecvBytes',
  audioRecvAvgJitterBufferDelay = 'audioRecvAvgJitterBufferDelay',
  audioRecvBitrates = 'audioRecvBitrates',
  audioRecvJitter = 'audioRecvJitter',
  audioRecvRoundTripTime = 'audioRecvRoundTripTime',
  //'audioRecvPackets',
  audioRecvPacketsLost = 'audioRecvPacketsLost',
  //'audioRecvPacketsLostCount',
  audioRecvNackCountSent = 'audioRecvNackCountSent',
  audioRecvLevel = 'audioRecvLevel',
  // inbound video,
  videoRecvCodec = 'videoRecvCodec',
  //'videoFirCountSent',
  videoPliCountSent = 'videoPliCountSent',
  videoDecodeLatency = 'videoDecodeLatency',
  //'videoFramesDecoded',
  videoRecvFps = 'videoRecvFps',
  videoRecvAvgJitterBufferDelay = 'videoRecvAvgJitterBufferDelay',
  videoRecvBitrates = 'videoRecvBitrates',
  videoRecvBytes = 'videoRecvBytes',
  videoRecvHeight = 'videoRecvHeight',
  videoRecvJitter = 'videoRecvJitter',
  videoRecvRoundTripTime = 'videoRecvRoundTripTime',
  //'videoRecvPackets',
  videoRecvPacketsLost = 'videoRecvPacketsLost',
  //'videoRecvPacketsLostCount',
  videoRecvNackCountSent = 'videoRecvNackCountSent',
  videoRecvWidth = 'videoRecvWidth',
  //'videoTotalDecodeTime',
  videoTotalFreezesDuration = 'videoTotalFreezesDuration',
  // inbound screen,
  screenRecvCodec = 'screenRecvCodec',
  //'screenFirCountSent',
  screenPliCountSent = 'screenPliCountSent',
  screenDecodeLatency = 'screenDecodeLatency',
  //'screenFramesDecoded',
  screenRecvFps = 'screenRecvFps',
  screenRecvAvgJitterBufferDelay = 'screenRecvAvgJitterBufferDelay',
  screenRecvBitrates = 'screenRecvBitrates',
  screenRecvBytes = 'screenRecvBytes',
  screenRecvHeight = 'screenRecvHeight',
  screenRecvJitter = 'screenRecvJitter',
  screenRecvRoundTripTime = 'screenRecvRoundTripTime',
  //'screenRecvPackets',
  screenRecvPacketsLost = 'screenRecvPacketsLost',
  //'screenRecvPacketsLostCount',
  screenRecvNackCountSent = 'screenRecvNackCountSent',
  screenRecvWidth = 'screenRecvWidth',
  //'screenTotalDecodeTime',
  screenTotalFreezesDuration = 'screenTotalFreezesDuration',
}

/**
 * The RTC stats collection indexed by {@link RtcStatsMetricNames}.
 *
 * Each {@link RtcStatsMetricNames} record points to an object indexed by
 * `trackId:hostName:codec`, where:
 * - `trackId`: The RTC getStats track identifier.
 * - `hostName`: The remote endpoint IP address or hostname.
 * - `codec`: The track codec.
 */
export type RtcStats = Record<
  RtcStatsMetricNames,
  Record<string, number | string>
>

const RtcStatsMetrics = Object.keys(RtcStatsMetricNames)

function setStats(
  stats: RtcStats,
  name: RtcStatsMetricNames,
  key: string,
  value: number | string,
): void {
  assert(RtcStatsMetrics.includes(name), `Unknown stat name: ${name}`)
  if (!stats[name]) {
    stats[name] = {}
  }
  stats[name][key] = value
}

/**
 * Updates the {@link RtcStats} object with the collected track values.
 */
export function updateRtcStats(
  stats: RtcStats,
  trackId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any,
  signalingHost: string | null = null,
): void {
  const {
    enabled,
    inboundRtp,
    outboundRtp,
    remoteAddress,
    videoSentActiveEncodings,
    videoSentMaxBitrate,
    isDisplay,
    codec,
    // availableOutgoingBitrate,
  } = value
  const hostName = signalingHost || remoteAddress
  const key = `${trackId}:${hostName}:${codec}`
  //log.log(`updateRtcStats`, {enabled, signalingHost, remoteAddress, isDisplay, key})
  // inbound
  if (inboundRtp) {
    const prefix =
      inboundRtp.kind === 'video' ? (isDisplay ? 'screen' : 'video') : 'audio'
    setStats(stats, (prefix + 'RecvCodec') as RtcStatsMetricNames, key, codec)
    if (enabled) {
      setStats(
        stats,
        (prefix + 'RecvAvgJitterBufferDelay') as RtcStatsMetricNames,
        key,
        inboundRtp.jitterBuffer,
      )
      setStats(
        stats,
        (prefix + 'RecvBitrates') as RtcStatsMetricNames,
        key,
        inboundRtp.bitrate,
      )
      setStats(
        stats,
        (prefix + 'RecvBytes') as RtcStatsMetricNames,
        key,
        inboundRtp.bytesReceived,
      )
      setStats(
        stats,
        (prefix + 'RecvJitter') as RtcStatsMetricNames,
        key,
        inboundRtp.jitter,
      )
      setStats(
        stats,
        (prefix + 'RecvRoundTripTime') as RtcStatsMetricNames,
        key,
        inboundRtp.transportRoundTripTime,
      )
      //setStats(stats, prefix + 'RecvPackets', key, inboundRtp.packetsReceived)
      setStats(
        stats,
        (prefix + 'RecvPacketsLost') as RtcStatsMetricNames,
        key,
        inboundRtp.packetsLossRate,
      )
      //setStats(stats, prefix + 'RecvPacketsLostCount', key, inboundRtp.packetsLost)
      setStats(
        stats,
        (prefix + 'RecvNackCountSent') as RtcStatsMetricNames,
        key,
        inboundRtp.nackCount,
      )
      if (inboundRtp.kind === 'audio') {
        setStats(
          stats,
          (prefix + 'RecvLevel') as RtcStatsMetricNames,
          key,
          inboundRtp.audioLevel,
        )
      }
      if (
        inboundRtp.kind === 'video' &&
        inboundRtp.decoderImplementation !== 'unknown'
      ) {
        //setStats(stats, prefix + 'FramesDecoded', key, inboundRtp.framesDecoded
        setStats(
          stats,
          (prefix + 'RecvFps') as RtcStatsMetricNames,
          key,
          inboundRtp.framesPerSecond,
        )
        setStats(
          stats,
          (prefix + 'RecvHeight') as RtcStatsMetricNames,
          key,
          inboundRtp.frameHeight,
        )
        setStats(
          stats,
          (prefix + 'RecvWidth') as RtcStatsMetricNames,
          key,
          inboundRtp.frameWidth,
        )
        //setStats(stats, prefix + 'TotalDecodeTime', key, inboundRtp.totalDecodeTime)
        //setStats(stats, prefix + 'FirCountSent', key, inboundRtp.firCount)
        setStats(
          stats,
          (prefix + 'PliCountSent') as RtcStatsMetricNames,
          key,
          inboundRtp.pliCount,
        )
        setStats(
          stats,
          (prefix + 'DecodeLatency') as RtcStatsMetricNames,
          key,
          inboundRtp.decodeLatency,
        )
        setStats(
          stats,
          (prefix + 'TotalFreezesDuration') as RtcStatsMetricNames,
          key,
          inboundRtp.totalFreezesDuration,
        )
      }
    }
  }
  // outbound
  if (outboundRtp) {
    // log.log('outboundRtp', isDisplay, JSON.stringify(outboundRtp, null, 2));
    const prefix =
      outboundRtp.kind === 'video' ? (isDisplay ? 'screen' : 'video') : 'audio'
    setStats(stats, (prefix + 'SentCodec') as RtcStatsMetricNames, key, codec)
    if (enabled) {
      setStats(
        stats,
        (prefix + 'SentBitrates') as RtcStatsMetricNames,
        key,
        outboundRtp.bitrate,
      )
      setStats(
        stats,
        (prefix + 'SentBytes') as RtcStatsMetricNames,
        key,
        outboundRtp.bytesSent + outboundRtp.headerBytesSent,
      )
      //setStats(stats, prefix + 'SentPackets', key, outboundRtp.packetsSent)
      setStats(
        stats,
        (prefix + 'SentPacketsLost') as RtcStatsMetricNames,
        key,
        outboundRtp.packetsLossRate,
      )
      setStats(
        stats,
        (prefix + 'SentNackCountRecv') as RtcStatsMetricNames,
        key,
        outboundRtp.nackCount,
      )
      //setStats(stats, prefix + 'SentPacketsLostCount', key, outboundRtp.packetsLost)
      setStats(
        stats,
        (prefix + 'SentRoundTripTime') as RtcStatsMetricNames,
        key,
        outboundRtp.roundTripTime,
      )
      setStats(
        stats,
        (prefix + 'SentTransportRoundTripTime') as RtcStatsMetricNames,
        key,
        outboundRtp.transportRoundTripTime,
      )
      if (outboundRtp.kind === 'video') {
        setStats(
          stats,
          (prefix + 'SentActiveEncodings') as RtcStatsMetricNames,
          key,
          videoSentActiveEncodings,
        )
        setStats(
          stats,
          (prefix + 'SentMaxBitrate') as RtcStatsMetricNames,
          key,
          videoSentMaxBitrate,
        )
        setStats(
          stats,
          (prefix +
            'QualityLimitationResolutionChanges') as RtcStatsMetricNames,
          key,
          outboundRtp.qualityLimitationResolutionChanges,
        )
        setStats(
          stats,
          (prefix + 'QualityLimitationCpu') as RtcStatsMetricNames,
          key,
          outboundRtp.qualityLimitationCpu,
        )
        setStats(
          stats,
          (prefix + 'QualityLimitationBandwidth') as RtcStatsMetricNames,
          key,
          outboundRtp.qualityLimitationBandwidth,
        )
        setStats(
          stats,
          (prefix + 'SentWidth') as RtcStatsMetricNames,
          key,
          outboundRtp.frameWidth,
        )
        setStats(
          stats,
          (prefix + 'SentHeight') as RtcStatsMetricNames,
          key,
          outboundRtp.frameHeight,
        )
        setStats(
          stats,
          (prefix + 'SentFps') as RtcStatsMetricNames,
          key,
          outboundRtp.framesPerSecond,
        )
        //setStats(stats, prefix + 'FirCountReceived', key, outboundRtp.firCountReceived)
        setStats(
          stats,
          (prefix + 'PliCountReceived') as RtcStatsMetricNames,
          key,
          outboundRtp.pliCountReceived,
        )
        setStats(
          stats,
          (prefix + 'EncodeLatency') as RtcStatsMetricNames,
          key,
          outboundRtp.encodeLatency,
        )
        setStats(
          stats,
          (prefix + 'SentLatency') as RtcStatsMetricNames,
          key,
          outboundRtp.sentLatency,
        )
      }
    }
  }
}

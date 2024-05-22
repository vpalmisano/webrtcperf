import assert from 'assert'

import { toTitleCase } from './utils'

/**
 * Page stats metric names.
 */
export enum PageStatsNames {
  /** The browser processes CPU usage (per page). */
  cpu = 'cpu',
  /** The browser processes memory usage (per page). */
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
  /** The page CPU usage calculated as the sum of Layout, RecalcStyle, Script and Task durations. */
  pageCpu = 'pageCpu',
  /** The page memory usage (JSHeapUsedSize). */
  pageMemory = 'pageMemory',

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

  /** The audio end to end total delay. */
  audioEndToEndDelay = 'audioEndToEndDelay',

  /** The video end to end total delay. */
  videoEndToEndDelay = 'videoEndToEndDelay',
  /**
   * The video end to end network delay.
   * It does't include the video encode/decode time and the jitter buffer time.
   */
  videoEndToEndNetworkDelay = 'videoEndToEndNetworkDelay',

  /** The throttle upload rate limitation. */
  throttleUpRate = 'throttleUpRate',
  /** The throttle upload delay. */
  throttleUpDelay = 'throttleUpDelay',
  /** The throttle upload packet loss. */
  throttleUpLoss = 'throttleUpLoss',
  /** The throttle upload packet queue. */
  throttleUpQueue = 'throttleUpQueue',

  /** The throttle download rate limitation. */
  throttleDownRate = 'throttleDownRate',
  /** The throttle download delay. */
  throttleDownDelay = 'throttleDownDelay',
  /** The throttle download packet loss. */
  throttleDownLoss = 'throttleDownLoss',
  /** The throttle download packet queue. */
  throttleDownQueue = 'throttleDownQueue',
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
  /** The sent audio packets. */
  audioSentPackets = 'audioSentPackets',
  /** The sent audio bitrates. */
  audioSentBitrates = 'audioSentBitrates',
  /** The send audio lost packets. */
  audioSentPacketsLost = 'audioSentPacketsLost',
  //'audioSentPacketsLostCount',
  /** The total audio NACK received by the sender. */
  audioSentNackCountRecv = 'audioSentNackCountRecv',
  /** The sent audio round trip time. */
  audioSentRoundTripTime = 'audioSentRoundTripTime',
  /** The audio RTC transport round trip time. */
  audioSentTransportRoundTripTime = 'audioSentTransportRoundTripTime',
  /** The sent audio encoding max bitrate. */
  audioSentMaxBitrate = 'audioSentMaxBitrate',

  /** The sent video codec. */
  videoSentCodec = 'videoSentCodec',
  /** The FIR requests received by the video sender. */
  videoFirCountReceived = 'videoFirCountReceived',
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
  /** The sent video packets. */
  videoSentPackets = 'videoSentPackets',
  /** The sent video frames. */
  videoSentFrames = 'videoSentFrames',
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
  /** The received FIR from screen sender. */
  screenFirCountReceived = 'screenFirCountReceived',
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
  /** The sent screen packets. */
  screenSentPackets = 'screenSentPackets',
  /** The sent screen frames. */
  screenSentFrames = 'screenSentFrames',
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
  audioRecvPackets = 'audioRecvPackets',
  audioRecvPacketsLost = 'audioRecvPacketsLost', // TODO: remove this.
  audioRecvLostPackets = 'audioRecvLostPackets',
  audioRecvPacketsLossRate = 'audioRecvPacketsLossRate',
  audioRecvRetransmittedPackets = 'audioRecvRetransmittedPackets',
  audioRecvNackCountSent = 'audioRecvNackCountSent',
  audioRecvLevel = 'audioRecvLevel',
  audioRecvConcealedSamples = 'audioRecvConcealedSamples',
  audioRecvConcealmentEvents = 'audioRecvConcealmentEvents',
  audioRecvInsertedSamplesForDeceleration = 'audioRecvInsertedSamplesForDeceleration',
  audioRecvRemovedSamplesForAcceleration = 'audioRecvRemovedSamplesForAcceleration',
  // inbound video,
  videoRecvCodec = 'videoRecvCodec',
  videoFirCountSent = 'videoFirCountSent',
  videoPliCountSent = 'videoPliCountSent',
  videoDecodeLatency = 'videoDecodeLatency',
  //'videoFramesDecoded',
  videoRecvFrames = 'videoRecvFrames',
  videoRecvFps = 'videoRecvFps',
  videoRecvAvgJitterBufferDelay = 'videoRecvAvgJitterBufferDelay',
  videoRecvBitrates = 'videoRecvBitrates',
  videoRecvBytes = 'videoRecvBytes',
  videoRecvHeight = 'videoRecvHeight',
  videoRecvJitter = 'videoRecvJitter',
  videoRecvRoundTripTime = 'videoRecvRoundTripTime',
  videoRecvPackets = 'videoRecvPackets',
  videoRecvLostPackets = 'videoRecvLostPackets',
  videoRecvPacketsLost = 'videoRecvPacketsLost', // TODO: remove this.
  videoRecvPacketsLossRate = 'videoRecvPacketsLossRate',
  videoRecvRetransmittedPackets = 'videoRecvRetransmittedPackets',
  videoRecvNackCountSent = 'videoRecvNackCountSent',
  videoRecvWidth = 'videoRecvWidth',
  //'videoTotalDecodeTime',
  videoTotalFreezesDuration = 'videoTotalFreezesDuration',
  // inbound screen,
  screenRecvCodec = 'screenRecvCodec',
  screenFirCountSent = 'screenFirCountSent',
  screenPliCountSent = 'screenPliCountSent',
  screenDecodeLatency = 'screenDecodeLatency',
  //'screenFramesDecoded',
  screenRecvFrames = 'screenRecvFrames',
  screenRecvFps = 'screenRecvFps',
  screenRecvAvgJitterBufferDelay = 'screenRecvAvgJitterBufferDelay',
  screenRecvBitrates = 'screenRecvBitrates',
  screenRecvBytes = 'screenRecvBytes',
  screenRecvHeight = 'screenRecvHeight',
  screenRecvJitter = 'screenRecvJitter',
  screenRecvRoundTripTime = 'screenRecvRoundTripTime',
  screenRecvPackets = 'screenRecvPackets',
  screenRecvLostPackets = 'screenRecvLostPackets',
  screenRecvPacketsLost = 'screenRecvPacketsLost', // TODO: remove this.
  screenRecvPacketsLossRate = 'screenRecvPacketsLossRate',
  screenRecvRetransmittedPackets = 'screenRecvRetransmittedPackets',
  screenRecvNackCountSent = 'screenRecvNackCountSent',
  screenRecvWidth = 'screenRecvWidth',
  //'screenTotalDecodeTime',
  screenTotalFreezesDuration = 'screenTotalFreezesDuration',

  /** The transport availableOutgoingBitrate stat. */
  transportSentAvailableOutgoingBitrate = 'transportSentAvailableOutgoingBitrate',
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
  value?: number | string,
): void {
  assert(RtcStatsMetrics.includes(name), `Unknown stat name: ${name}`)
  if (value === undefined) return
  if (!stats[name]) {
    stats[name] = {}
  }
  stats[name][key] = value
}

export function rtcStatKey({
  pageIndex,
  trackId,
  hostName,
  codec,
  participantName,
}: {
  pageIndex?: number
  trackId?: string
  hostName?: string
  codec?: string
  participantName?: string
}): string {
  return [
    pageIndex ?? '',
    participantName || '',
    hostName || 'unknown',
    codec || '',
    trackId || '',
  ].join(':')
}

export function parseRtStatKey(key: string): {
  pageIndex?: number
  trackId?: string
  hostName: string
  codec?: string
  participantName?: string
} {
  const [pageIndex, participantName, hostName, codec, trackId] = key.split(
    ':',
    5,
  )
  return {
    pageIndex: pageIndex ? parseInt(pageIndex) : undefined,
    trackId: trackId || undefined,
    hostName: hostName || 'unknown',
    codec: codec || undefined,
    participantName: participantName || undefined,
  }
}

/**
 * Updates the {@link RtcStats} object with the collected track values.
 */
export function updateRtcStats(
  stats: RtcStats,
  pageIndex: number,
  trackId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any,
  signalingHost?: string,
  participantName?: string,
): void {
  const {
    enabled,
    inboundRtp,
    outboundRtp,
    remoteAddress,
    videoSentActiveEncodings,
    sentMaxBitrate,
    isDisplay,
    codec,
    availableOutgoingBitrate,
  } = value
  const hostName = signalingHost || remoteAddress
  const key = rtcStatKey({
    pageIndex,
    trackId,
    hostName,
    codec,
    participantName,
  })
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
      setStats(
        stats,
        (prefix + 'RecvPackets') as RtcStatsMetricNames,
        key,
        inboundRtp.packetsReceived,
      )
      setStats(
        stats,
        (prefix + 'RecvRetransmittedPackets') as RtcStatsMetricNames,
        key,
        inboundRtp.retransmittedPacketsReceived,
      )
      // TODO: remove this.
      setStats(
        stats,
        (prefix + 'RecvPacketsLost') as RtcStatsMetricNames,
        key,
        inboundRtp.packetsLossRate,
      )
      setStats(
        stats,
        (prefix + 'RecvPacketsLossRate') as RtcStatsMetricNames,
        key,
        inboundRtp.packetsLossRate,
      )
      setStats(
        stats,
        (prefix + 'RecvLostPackets') as RtcStatsMetricNames,
        key,
        inboundRtp.packetsLost,
      )
      setStats(
        stats,
        (prefix + 'RecvNackCountSent') as RtcStatsMetricNames,
        key,
        inboundRtp.nackCount,
      )
      if (inboundRtp.kind === 'audio') {
        ;[
          'audioLevel',
          'concealedSamples',
          'concealmentEvents',
          'insertedSamplesForDeceleration',
          'removedSamplesForAcceleration',
        ].forEach(name => {
          setStats(
            stats,
            (prefix +
              'Recv' +
              toTitleCase(name.replace('audio', ''))) as RtcStatsMetricNames,
            key,
            inboundRtp[name],
          )
        })
      }
      if (inboundRtp.kind === 'video' && inboundRtp.keyFramesDecoded > 0) {
        //setStats(stats, prefix + 'FramesDecoded', key, inboundRtp.framesDecoded
        setStats(
          stats,
          (prefix + 'RecvFrames') as RtcStatsMetricNames,
          key,
          inboundRtp.framesReceived,
        )
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
        setStats(
          stats,
          (prefix + 'FirCountSent') as RtcStatsMetricNames,
          key,
          inboundRtp.firCount,
        )
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
      setStats(
        stats,
        (prefix + 'SentPackets') as RtcStatsMetricNames,
        key,
        outboundRtp.packetsSent,
      )
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
      setStats(
        stats,
        'transportSentAvailableOutgoingBitrate' as RtcStatsMetricNames,
        key,
        availableOutgoingBitrate,
      )
      setStats(
        stats,
        (prefix + 'SentMaxBitrate') as RtcStatsMetricNames,
        key,
        sentMaxBitrate,
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
          (prefix + 'SentFrames') as RtcStatsMetricNames,
          key,
          outboundRtp.framesSent,
        )
        setStats(
          stats,
          (prefix + 'SentFps') as RtcStatsMetricNames,
          key,
          outboundRtp.framesPerSecond,
        )
        setStats(
          stats,
          (prefix + 'FirCountReceived') as RtcStatsMetricNames,
          key,
          outboundRtp.firCountReceived,
        )
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

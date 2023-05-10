/* global log */

const PeerConnections = new Map()
const TrackStats = new Map()
const TrackStatsKeys = []

const filterUndefined = o =>
  Object.fromEntries(
    // eslint-disable-next-line no-unused-vars
    Object.entries(o).filter(([_, v]) => typeof v === 'string' || isFinite(v)),
  )

const sumOptional = (a, b, prop) => {
  a[prop] = (a[prop] || 0) + (b[prop] || 0)
}

const maxOptional = (a, b, prop) => {
  a[prop] = Math.max(a[prop] || 0, b[prop] || 0)
}

const calculateBitrate = (cur, old, timeDiff, fallback = 0) =>
  cur > 0 && old > 0 && cur >= old
    ? Math.round((8000 * (cur - old)) / timeDiff)
    : fallback

const positiveDiff = (cur, old) => Math.max(0, (cur || 0) - (old || 0))

const calculateLossRate = (lost, total) =>
  total > 0 ? (100 * lost) / total : undefined

const calculateJitterBuffer = (jitterBufferDelay, count) =>
  count > 0 ? jitterBufferDelay / count : undefined

/**
 * updateTrackStats
 * @param {string} trackId
 * @param {MediaStreamTrack} track
 * @param {number} t
 * @param {any} values
 */
const updateTrackStats = (trackId, track, t, values) => {
  const isNew = !TrackStats.has(trackId)
  TrackStats.set(trackId, { t, values })
  // Update ordered array.
  const index = TrackStatsKeys.indexOf(trackId)
  if (index !== -1) {
    TrackStatsKeys.splice(index, 1)
  }
  TrackStatsKeys.push(trackId)
  if (isNew) {
    track.addEventListener(
      'ended',
      () => {
        TrackStats.delete(trackId)
        const index = TrackStatsKeys.indexOf(trackId)
        if (index !== -1) {
          TrackStatsKeys.splice(index, 1)
        }
      },
      { once: true },
    )
  }
}

/**
 * tracePeerConnection
 * @param {number} id
 * @param {RTCPeerConnection} pc
 * @param {number} now
 * @param {raw} verbose
 * @param {boolean} verbose
 */
async function getPeerConnectionStats(
  id,
  pc,
  now,
  raw = false,
  verbose = false,
) {
  // log('getPeerConnectionStats', id, pc);
  const ret = {}
  const transceivers = pc
    .getTransceivers()
    .filter(t => t && t.mid !== 'probator')
  if (verbose) {
    log('getPeerConnectionStats', { id, pc, transceivers })
  }
  for (const t of transceivers) {
    // outbound
    if (t.sender && t.sender.track) {
      const track = t.sender.track
      const encodings = t.sender
        .getParameters()
        .encodings.filter(encoding => encoding.active)
      if (track) {
        const trackId = `${id}-${track.kind[0]}s-${track.id}`
        const stats = await pc.getStats(track)
        const values = {
          enabled:
            track.enabled && (track.kind === 'audio' || encodings.length > 0),
          outboundRtp: {},
        }
        if (track.kind === 'video') {
          values.isDisplay = isDisplayTrack(track)
          values.videoSentActiveEncodings = encodings.length
          values.videoSentMaxBitrate = encodings.reduce((prev, encoding) => {
            prev += encoding.maxBitrate || 0
            return prev
          }, 0)
        }
        for (const s of stats.values()) {
          if (raw) {
            if (!values.raw) {
              values.raw = [encodings]
            }
            values.raw.push(s)
          }
          if (s.type === 'codec') {
            values.codec = s.mimeType.split('/')[1].toLowerCase()
          } else if (s.type === 'candidate-pair' && s.nominated) {
            values.availableOutgoingBitrate = s.availableOutgoingBitrate
            Object.assign(values.outboundRtp, {
              transportRoundTripTime: s.currentRoundTripTime,
            })
          } else if (
            s.type === 'outbound-rtp' &&
            s.kind === track.kind &&
            s.bytesSent + s.headerBytesSent > 0
          ) {
            if (s.remoteId) {
              // Get the RTCRemoteInboundRtpStreamStats.
              const remoteInboundRtpStreamStats = stats.get(s.remoteId)
              s.packetsLost = remoteInboundRtpStreamStats.packetsLost
              s.totalRoundTripTime =
                remoteInboundRtpStreamStats.totalRoundTripTime
              s.roundTripTimeMeasurements =
                remoteInboundRtpStreamStats.roundTripTimeMeasurements
            }
            const {
              kind,
              bytesSent,
              headerBytesSent,
              packetsSent,
              frameWidth,
              frameHeight,
              framesPerSecond,
              qualityLimitationResolutionChanges,
              qualityLimitationDurations,
              // firCount,
              pliCount,
              packetsLost,
              nackCount,
              totalRoundTripTime,
              roundTripTimeMeasurements,
              totalEncodeTime,
              totalPacketSendDelay,
            } = s
            const outboundRtp = {
              kind,
              bytesSent,
              headerBytesSent,
              packetsSent,
              packetsLost,
              nackCount,
              frameWidth,
              frameHeight,
              framesPerSecond,
              // firCountReceived: firCount,
              pliCountReceived: pliCount,
              totalRoundTripTime,
              roundTripTimeMeasurements,
              totalEncodeTime,
              totalPacketSendDelay,
              qualityLimitationResolutionChanges,
              qualityLimitationDurationsCpu: qualityLimitationDurations
                ? qualityLimitationDurations.cpu
                : undefined,
              qualityLimitationDurationsBandwidth: qualityLimitationDurations
                ? qualityLimitationDurations.bandwidth
                : undefined,
              qualityLimitationDurationsTotal: qualityLimitationDurations
                ? qualityLimitationDurations.other +
                  qualityLimitationDurations.cpu +
                  qualityLimitationDurations.bandwidth +
                  qualityLimitationDurations.none
                : undefined,
            }
            values.outboundRtp.kind = outboundRtp.kind
            ;[
              'bytesSent',
              'headerBytesSent',
              'packetsSent',
              'packetsLost',
              'nackCount',
              'qualityLimitationResolutionChanges',
              'qualityLimitationDurationsCpu',
              'qualityLimitationDurationsBandwidth',
              'qualityLimitationDurationsTotal',
            ].forEach(prop =>
              sumOptional(values.outboundRtp, outboundRtp, prop),
            )
            ;[
              'frameWidth',
              'frameHeight',
              'framesPerSecond',
              // 'firCountReceived',
              'pliCountReceived',
              'totalRoundTripTime',
              'roundTripTimeMeasurements',
              'totalEncodeTime',
              'totalPacketSendDelay',
            ].forEach(prop =>
              maxOptional(values.outboundRtp, outboundRtp, prop),
            )
          } else if (s.type === 'remote-candidate') {
            values.remoteAddress = s.address
          }
        }
        if (
          values.outboundRtp.kind &&
          values.outboundRtp.bytesSent + values.outboundRtp.headerBytesSent > 0
        ) {
          const prevStats = TrackStats.get(trackId)
          if (prevStats) {
            // bitrate
            values.outboundRtp.bitrate = calculateBitrate(
              values.outboundRtp.bytesSent + values.outboundRtp.headerBytesSent,
              prevStats.values.outboundRtp.bytesSent +
                prevStats.values.outboundRtp.headerBytesSent,
              now - prevStats.t,
              prevStats.values.outboundRtp.bitrate,
            )
            // loss rate
            const lost = positiveDiff(
              values.outboundRtp.packetsLost,
              prevStats.values.outboundRtp.packetsLost,
            )
            const sent = positiveDiff(
              values.outboundRtp.packetsSent,
              prevStats.values.outboundRtp.packetsSent,
            )
            values.outboundRtp.packetsLossRate = calculateLossRate(
              lost,
              lost + sent,
            )
            // quality limitations
            const totalQualityLimitationDurationsDiff = positiveDiff(
              values.outboundRtp.qualityLimitationDurationsTotal,
              prevStats.values.outboundRtp.qualityLimitationDurationsTotal,
            )
            if (totalQualityLimitationDurationsDiff) {
              const qualityLimitationDurationsCpuDiff = positiveDiff(
                values.outboundRtp.qualityLimitationDurationsCpu,
                prevStats.values.outboundRtp.qualityLimitationDurationsCpu,
              )
              const qualityLimitationDurationsBandwidthDiff = positiveDiff(
                values.outboundRtp.qualityLimitationDurationsBandwidth,
                prevStats.values.outboundRtp
                  .qualityLimitationDurationsBandwidth,
              )
              values.outboundRtp.qualityLimitationCpu =
                (100 * qualityLimitationDurationsCpuDiff) /
                totalQualityLimitationDurationsDiff
              values.outboundRtp.qualityLimitationBandwidth =
                (100 * qualityLimitationDurationsBandwidthDiff) /
                totalQualityLimitationDurationsDiff
            }
            // round trip time
            values.outboundRtp.roundTripTime =
              (values.outboundRtp.totalRoundTripTime -
                prevStats.values.outboundRtp.totalRoundTripTime) /
              (values.outboundRtp.roundTripTimeMeasurements -
                prevStats.values.outboundRtp.roundTripTimeMeasurements)
            // encode and sent latency
            if (values.outboundRtp.kind === 'video') {
              const packetsSentDiff =
                values.outboundRtp.packetsSent -
                prevStats.values.outboundRtp.packetsSent
              values.outboundRtp.encodeLatency =
                (values.outboundRtp.totalEncodeTime -
                  prevStats.values.outboundRtp.totalEncodeTime) /
                packetsSentDiff
              values.outboundRtp.sentLatency =
                (values.outboundRtp.totalPacketSendDelay -
                  prevStats.values.outboundRtp.totalPacketSendDelay) /
                packetsSentDiff
            }
          }
          values.outboundRtp = filterUndefined(values.outboundRtp)
          if (verbose) {
            log(
              `Track ${track.id} (${track.kind}): ${JSON.stringify(
                values.outboundRtp,
                null,
                2,
              )}`,
            )
          }
          ret[trackId] = values
          updateTrackStats(trackId, track, now, values)
        }
      }
    }
    // inbound
    if (t.receiver && t.receiver.track) {
      const track = t.receiver.track
      if (track) {
        const trackId = `${id}-${track.kind[0]}r-${track.id}`
        const stats = await pc.getStats(track)
        const values = {
          enabled: track.enabled,
          inboundRtp: {},
        }
        if (track.kind === 'video') {
          values.isDisplay = isDisplayTrack(track)
        }
        for (const s of stats.values()) {
          if (raw) {
            if (!values.raw) {
              values.raw = [
                { contributingSources: t.receiver.getContributingSources() },
              ]
            }
            values.raw.push(s)
          }
          if (s.type === 'codec') {
            values.codec = s.mimeType.split('/')[1].toLowerCase()
          } else if (
            s.type === 'inbound-rtp' &&
            s.kind === track.kind &&
            s.bytesReceived + s.headerBytesReceived > 0
          ) {
            const {
              kind,
              packetsLost,
              packetsReceived,
              jitter,
              bytesReceived,
              headerBytesReceived,
              decoderImplementation,
              framesDecoded,
              totalDecodeTime,
              frameWidth,
              frameHeight,
              framesPerSecond,
              firCount,
              pliCount,
              nackCount,
              freezeCount,
              totalFreezesDuration,
              jitterBufferEmittedCount,
              jitterBufferDelay,
              totalRoundTripTime,
              roundTripTimeMeasurements,
              totalAudioEnergy,
              totalSamplesDuration,
            } = s
            Object.assign(values.inboundRtp, {
              kind,
              packetsLost,
              packetsReceived,
              jitter,
              bytesReceived,
              headerBytesReceived,
              decoderImplementation,
              framesDecoded,
              totalDecodeTime,
              frameWidth,
              frameHeight,
              framesPerSecond,
              firCount,
              pliCount,
              nackCount,
              freezeCount,
              totalFreezesDuration,
              jitterBufferEmittedCount,
              jitterBufferDelay,
              totalRoundTripTime,
              roundTripTimeMeasurements,
              totalAudioEnergy,
              totalSamplesDuration,
            })
          } else if (s.type === 'remote-candidate') {
            values.remoteAddress = s.address
          } else if (s.type === 'candidate-pair' && s.nominated) {
            Object.assign(values.inboundRtp, {
              transportTotalRoundTripTime: s.totalRoundTripTime,
              transportResponsesReceived: s.responsesReceived,
            })
          }
        }
        if (
          values.inboundRtp.kind &&
          values.inboundRtp.bytesReceived +
            values.inboundRtp.headerBytesReceived >
            0
        ) {
          const prevStats = TrackStats.get(trackId)
          if (prevStats) {
            // Update bitrate.
            values.inboundRtp.bitrate = calculateBitrate(
              values.inboundRtp.bytesReceived +
                values.inboundRtp.headerBytesReceived,
              prevStats.values.inboundRtp.bytesReceived +
                prevStats.values.inboundRtp.headerBytesReceived,
              now - prevStats.t,
            )
            // Update packet loss rate.
            const lost = positiveDiff(
              values.inboundRtp.packetsLost,
              prevStats.values.inboundRtp.packetsLost,
            )
            const received = positiveDiff(
              values.inboundRtp.packetsReceived,
              prevStats.values.inboundRtp.packetsReceived,
            )
            values.inboundRtp.packetsLossRate = calculateLossRate(
              lost,
              lost + received,
            )
            // Update jitter buffer.
            values.inboundRtp.jitterBuffer = calculateJitterBuffer(
              values.inboundRtp.jitterBufferDelay -
                prevStats.values.inboundRtp.jitterBufferDelay,
              values.inboundRtp.jitterBufferEmittedCount -
                prevStats.values.inboundRtp.jitterBufferEmittedCount,
            )
            // Update round trip time.
            values.inboundRtp.transportRoundTripTime =
              (values.inboundRtp.transportTotalRoundTripTime -
                prevStats.values.inboundRtp.transportTotalRoundTripTime) /
              (values.inboundRtp.transportResponsesReceived -
                prevStats.values.inboundRtp.transportResponsesReceived)
            // Update latency.
            if (values.inboundRtp.kind === 'video') {
              values.inboundRtp.decodeLatency =
                (values.inboundRtp.totalDecodeTime -
                  prevStats.values.inboundRtp.totalDecodeTime) /
                (values.inboundRtp.framesDecoded -
                  prevStats.values.inboundRtp.framesDecoded)
            }
            // Update audio level.
            if (values.inboundRtp.kind === 'audio') {
              const energy = positiveDiff(
                values.inboundRtp.totalAudioEnergy,
                prevStats.values.inboundRtp.totalAudioEnergy,
              )
              const samples = positiveDiff(
                values.inboundRtp.totalSamplesDuration,
                prevStats.values.inboundRtp.totalSamplesDuration,
              )
              values.inboundRtp.audioLevel =
                samples > 0 ? Math.sqrt(energy / samples) : undefined
            }
          }
          values.inboundRtp = filterUndefined(values.inboundRtp)
          if (verbose) {
            log(
              `Track ${track.id} (${track.kind}): ${JSON.stringify(
                values.inboundRtp,
                null,
                2,
              )}`,
            )
          }
          ret[trackId] = values
          updateTrackStats(trackId, track, now, values)
        }
      }
    }
  }
  return ret
}

const TRACK_STATS_TIMEOUT = 60 * 1000

setInterval(() => {
  const now = Date.now()
  for (const [index, trackId] of TrackStatsKeys.entries()) {
    const item = TrackStats.get(trackId)
    if (!item) {
      TrackStatsKeys.splice(index, 1)
      continue
    }
    const timeDiff = now - item.t
    if (timeDiff > TRACK_STATS_TIMEOUT) {
      // log(`remove ${trackId} (updated ${timeDiff / 1000}s ago)`)
      TrackStats.delete(trackId)
      TrackStatsKeys.splice(index, 1)
    } else {
      break
    }
  }
}, TRACK_STATS_TIMEOUT)

/**
 * isDisplayTrack
 * @param {MediaStreamTrack} videoTrack
 * @return {Boolean}
 */
const isDisplayTrack = videoTrack => {
  if (['detail', 'text'].indexOf(videoTrack.contentHint) !== -1) {
    return true
  }

  const trackSettings = videoTrack.getSettings()
  const trackConstraints = videoTrack.getConstraints()

  const supportedConstraints = navigator.mediaDevices.getSupportedConstraints
    ? navigator.mediaDevices.getSupportedConstraints()
    : undefined

  if (supportedConstraints?.mediaSource) {
    // supports mediaSource constraint (firefox)
    return (
      trackConstraints.mediaSource === 'window' ||
      trackConstraints.mediaSource === 'screen'
    )
  } else if (trackSettings.displaySurface || trackSettings.logicalSurface) {
    return true
  } else {
    return !trackSettings.deviceId
  }
}

/**
 * collectPeerConnectionStats
 * @param {boolean} verbose
 * @return {Object}
 */
window.collectPeerConnectionStats = async (raw = false, verbose = false) => {
  const stats = []
  const now = Date.now()
  let activePeerConnections = 0
  for (const [id, pc] of PeerConnections.entries()) {
    if (pc.connectionState !== 'connected') {
      if (pc.connectionState === 'closed') {
        PeerConnections.delete(id)
      }
      continue
    }
    activePeerConnections += 1
    try {
      const ret = await getPeerConnectionStats(id, pc, now, raw, verbose)
      if (Object.keys(ret).length) {
        stats.push(ret)
      }
    } catch (err) {
      console.error(`getPeerConnectionStats error: ${err.message}`, err)
    }
  }

  // TODO move to custom metrics.
  const signalingHost = window.signalingHost

  return {
    stats,
    activePeerConnections,
    signalingHost,
  }
}

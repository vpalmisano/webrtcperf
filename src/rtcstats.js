const log = require('debug-level')('app:rtcstats');
const config = require('../config');

module.exports.rtcStats = function(stats, now, index, sample) {
  const { peerConnectionId, receiverStats, senderStats } = sample;    
  // log.debug('rtcStats', util.inspect(sample, { depth: null }));

  // receiver
  if (receiverStats) {
    let { inboundRTPStats, tracks } = receiverStats;
    for (const stat of inboundRTPStats) {
      // log.debug('rtcStats', util.inspect(stat, { depth: null }));
      /*
        {                                                                                                                                                                                                      
        bytesReceived: 923,                                                                                                                                                                                  
        codecId: 'RTCCodec_0_Inbound_100',                                                                                                                                                                   
        fecPacketsDiscarded: 0,                                                                                                                                                                              
        fecPacketsReceived: 0,                                                                                                                                                                               
        headerBytesReceived: 1204,                                                                                                                                                                           
        id: 'RTCInboundRTPAudioStream_362585473',
        isRemote: false,
        jitter: 0,
        lastPacketReceivedTimestamp: 3167413.454,
        mediaType: 'audio',
        packetsLost: 0,
        packetsReceived: 43,
        ssrc: 362585473,
        trackId: 'RTCMediaStreamTrack_receiver_3',
        transportId: 'RTCTransport_0_1'
      },
      {
        bytesReceived: 626796,
        codecId: 'RTCCodec_0_Inbound_101',
        decoderImplementation: 'libvpx',
        firCount: 0,
        framesDecoded: 146,
        headerBytesReceived: 19584,
        id: 'RTCInboundRTPVideoStream_605881643',
        isRemote: false,
        jitter: 1.706,
        keyFramesDecoded: 1,
        lastPacketReceivedTimestamp: 3438093.449,
        mediaType: 'video',
        nackCount: 0,
        packetsLost: 0,
        packetsReceived: 612,
        pliCount: 1,
        qpSum: 2374,
        ssrc: 605881643,
        totalDecodeTime: 0.15,
        totalInterFrameDelay: 6.368999999999999,
        totalSquaredInterFrameDelay: 0.2946809999999993,
        trackId: 'RTCMediaStreamTrack_receiver_3',
        transportId: 'RTCTransport_0_1'
      }
      {
        bytesReceived: 15488,
        decoderImplementation: 'unknown',
        firCount: 0,
        framesDecoded: 0,
        headerBytesReceived: 832,
        id: 'RTCInboundRTPVideoStream_1234',
        isRemote: false,
        jitter: 0.132,
        keyFramesDecoded: 0,
        lastPacketReceivedTimestamp: 3438092.641,
        mediaType: 'video',
        nackCount: 0,
        packetsLost: 0,
        packetsReceived: 26,
        pliCount: 29,
        ssrc: 1234,
        totalDecodeTime: 0,
        totalInterFrameDelay: 0,
        totalSquaredInterFrameDelay: 0,
        trackId: 'RTCMediaStreamTrack_receiver_4',
        transportId: 'RTCTransport_0_1'
      }
      */
      const key = `${index}_${peerConnectionId}_${stat.id}`;

      if (stat.mediaType === 'audio') {
        stats.audioPacketsLost[key] = 100 * stat.packetsLost / stat.packetsReceived;
        // calculate rate
        if (stats.timestamps[key]) {
            stats.audioRecvBitrates[key] = 8000 * 
            (stat.bytesReceived - stats.audioBytesReceived[key]) 
            / (now - stats.timestamps[key]);
        }
        // update values
        stats.audioBytesReceived[key] = stat.bytesReceived;
      } else if (stat.mediaType === 'video' && stat.decoderImplementation !== 'unknown') {
        stats.videoPacketsLost[key] = 100 * stat.packetsLost / stat.packetsReceived;
        // calculate rate
        if (stats.timestamps[key]) {
            stats.videoRecvBitrates[key] = 8000 * 
            (stat.bytesReceived - stats.videoBytesReceived[key]) 
            / (now - stats.timestamps[key]);
        }
        // update values
        stats.videoBytesReceived[key] = stat.bytesReceived;
      }
      stats.timestamps[key] = now;
    }

    for (const stat of tracks) {
      //log.debug('rtcStats', util.inspect(stat, { depth: null }));
      /*
        {
          concealedSamples: 0,
          concealmentEvents: 0,
          detached: false,
          ended: false,
          id: 'RTCMediaStreamTrack_receiver_5',
          insertedSamplesForDeceleration: 120,
          jitterBufferDelay: 2659.2,
          jitterBufferEmittedCount: 29760,
          mediaType: 'audio',
          remoteSource: true,
          removedSamplesForAcceleration: 0,
          silentConcealedSamples: 0,
          totalSamplesReceived: 228000
        }
      */
  
      const key = `${index}_${peerConnectionId}_${stat.id}`;
      if (stat.jitterBufferEmittedCount) {
        // https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats-jitterbufferdelay
        let avgjitterBufferDelay = stat.jitterBufferDelay / stat.jitterBufferEmittedCount;
        if (stat.mediaType === 'audio') {
          stats.audioAvgJitterBufferDelay[key] = avgjitterBufferDelay;
        } else if (stat.mediaType === 'video') {
          stats.videoAvgJitterBufferDelay[key] = avgjitterBufferDelay;
        }
        stats.timestamps[key] = now;
      }
  
    }
  }

  // sender
  if (senderStats) {
    let { outboundRTPStats } = senderStats;
    for (const stat of outboundRTPStats) {
      /*
        {                                                                                                                                                                                                      
          bytesSent: 245987,                                                                                                                                                                                   
          codecId: 'RTCCodec_0_Outbound_96',                                                                                                                                                                   
          encoderImplementation: 'libvpx',                                                                                                                                                                     
          firCount: 0,                                                                                                                                                                                         
          framesEncoded: 80,                                                                                                                                                                                   
          headerBytesSent: 23032,                                                                                                                                                                              
          id: 'RTCOutboundRTPVideoStream_505023861',                                                                                                                                                           
          isRemote: false,                                                                                                                                                                                     
          keyFramesEncoded: 1,                                                                                                                                                                                 
          mediaSourceId: 'RTCVideoSource_1',                                                                                                                                                                   
          mediaType: 'video',                                                                                                                                                                                  
          nackCount: 0,                                                                                                                                                                                        
          packetsSent: 322,                                                                                                                                                                                    
          pliCount: 0,                                                                                                                                                                                         
          qpSum: 5389,                                                                                                                                                                                         
          qualityLimitationReason: 'none',                                                                                                                                                                     
          qualityLimitationResolutionChanges: 1,                                                                                                                                                               
          remoteId: 'RTCRemoteInboundRtpVideoStream_505023861',                                                                                                                                                
          retransmittedBytesSent: 0,                                                                                                                                                                           
          retransmittedPacketsSent: 0,                                                                                                                                                                         
          ssrc: 505023861,                                                                                                                                                                                     
          totalEncodeTime: 0.424,                                                                                                                                                                              
          totalEncodedBytesTarget: 0,                                                                                                                                                                          
          totalPacketSendDelay: 9.825,                                                                                                                                                                         
          trackId: 'RTCMediaStreamTrack_sender_1',                                                                                                                                                             
          transportId: 'RTCTransport_0_1'                                                                                                                                                                      
        },    
        {                                                                                                                                                                                                      
          bytesSent: 76599,                                                                                                                                                                                    
          codecId: 'RTCCodec_1_Outbound_111',                                                                                                                                                                  
          headerBytesSent: 28700,                                                                                                                                                                              
          id: 'RTCOutboundRTPAudioStream_534975921',                                                                                                                                                           
          isRemote: false,
          mediaSourceId: 'RTCAudioSource_2',
          mediaType: 'audio',
          packetsSent: 1025,
          remoteId: 'RTCRemoteInboundRtpAudioStream_534975921',
          retransmittedBytesSent: 0,
          retransmittedPacketsSent: 0,
          ssrc: 534975921,
          trackId: 'RTCMediaStreamTrack_sender_2',
          transportId: 'RTCTransport_0_1'
        }
      */
      const key = `${index}_${peerConnectionId}_${stat.id}`;
      
      if (stat.mediaType === 'audio') {
        // calculate rate
        if (stats.timestamps[key]) {
            stats.audioSendBitrates[key] = 8000 * 
            (
                (stat.bytesSent - stat.retransmittedBytesSent) 
                - (stats.audioBytesSent[key] - stats.audioRetransmittedBytesSent[key])
            )
            / (now - stats.timestamps[key]);
        }
        // update values
        stats.timestamps[key] = now;
        stats.audioBytesSent[key] = stat.bytesSent;
        stats.audioRetransmittedBytesSent[key] = stat.retransmittedBytesSent;
      } else if (stat.mediaType === 'video') {
        // calculate rate
        if (stats.timestamps[key]) {
            stats.videoSendBitrates[key] = 8000 * 
            (
                (stat.bytesSent - stat.retransmittedBytesSent) 
                - (stats.videoBytesSent[key] - stats.videoRetransmittedBytesSent[key])
            )
            / (now - stats.timestamps[key]);
        }
        // update values
        stats.timestamps[key] = now;
        stats.videoBytesSent[key] = stat.bytesSent;
        stats.videoRetransmittedBytesSent[key] = stat.retransmittedBytesSent;
        // https://w3c.github.io/webrtc-stats/#dom-rtcoutboundrtpstreamstats-qualitylimitationresolutionchanges
        stats.qualityLimitationResolutionChanges[key] = stat.qualityLimitationResolutionChanges;
      }
    }
  }

}

module.exports.purgeRtcStats = function(stats) {
  // purge stats with expired timeout
  const now = Date.now();
  
  if (!stats || Object.keys(stats.timestamps).length) {
    return;
  }

  for (const [key, timestamp] of Object.entries(stats.timestamps)) {
    if (now - timestamp > 1000 * config.RTC_STATS_TIMEOUT) {
      log.debug(`expired stat ${key}`);
      //
      delete(stats.timestamps[key]);
      delete(stats.audioPacketsLost[key]);
      delete(stats.audioBytesReceived[key]);
      delete(stats.audioRecvBitrates[key]);
      delete(stats.audioAvgJitterBufferDelay[key]);
      delete(stats.videoPacketsLost[key]);
      delete(stats.videoBytesReceived[key]);
      delete(stats.videoRecvBitrates[key]);
      delete(stats.videoAvgJitterBufferDelay[key]);
      //
      delete(stats.audioBytesSent[key]);
      delete(stats.audioSendBitrates[key]);
      delete(stats.audioRetransmittedBytesSent[key]);
      delete(stats.videoBytesSent[key]);
      delete(stats.videoSendBitrates[key]);
      delete(stats.videoRetransmittedBytesSent[key]);
      delete(stats.qualityLimitationResolutionChanges[key]);
    }
  }
}

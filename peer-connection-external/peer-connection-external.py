#!/usr/bin/env python

import gi
import sys
import signal
import os
import logging
import json

gi.require_version('Gst', '1.0')
gi.require_version('GstBase', '1.0')
gi.require_version('GObject', '2.0')
gi.require_version('GstWebRTC', '1.0')
gi.require_version('GstSdp', '1.0')
gi.require_version('Gio', '2.0')
from gi.repository import GObject, Gst, GLib, Gio
from gi.repository import GstWebRTC
from gi.repository import GstSdp

logging.basicConfig(level=logging.DEBUG)

class PeerConnectionExternal:
    logger = logging.getLogger('PeerConnectionExternal')
    _connection_states = {
        GstWebRTC.WebRTCPeerConnectionState.NEW: 'new',
        GstWebRTC.WebRTCPeerConnectionState.CONNECTING: 'connecting',
        GstWebRTC.WebRTCPeerConnectionState.CONNECTED: 'connected',
        GstWebRTC.WebRTCPeerConnectionState.DISCONNECTED: 'disconnected',
        GstWebRTC.WebRTCPeerConnectionState.FAILED: 'failed',
        GstWebRTC.WebRTCPeerConnectionState.CLOSED: 'closed',
    }

    def __init__(self):
        self.logger.debug('init')
        self.pipeline = Gst.parse_bin_from_description('''
        webrtcbin name=webrtcbin bundle-policy=max-bundle latency=200

        audiotestsrc is-live=true wave=silence num-buffers=100 ! opusenc ! rtpopuspay ! webrtcbin.
        ''', False)
        self.webrtcbin = self.pipeline.get_by_name('webrtcbin')
        self.webrtcbin.connect('pad-added', self.on_pad_added)
        self.webrtcbin.connect('notify::connection-state', self.on_connection_state_changed)
        self.pipeline.set_state(Gst.State.PLAYING)

    def on_connection_state_changed(self, webrtcbin, value):
        state = webrtcbin.get_property('connection-state')
        state = self._connection_states[state]
        self.logger.debug('on_connection_state_changed: %s', state)
        print('rev|connectionstatechange|%s' %state, file=sys.stdout, flush=True)

    def on_pad_added(self, webrtcbin, pad):
        self.logger.info('on_pad_added: %s', pad)
        if pad.direction != Gst.PadDirection.SRC:
            return
        decodebin = Gst.ElementFactory.make('decodebin', 'decodebin')
        decodebin.connect('pad-added', self.on_incoming_decodebin_stream)
        self.pipeline.add(decodebin)
        self.webrtcbin.link(decodebin)
        decodebin.sync_state_with_parent()

    def on_incoming_decodebin_stream(self, decodebin, pad):
        if not pad.has_current_caps():
            self.logger.warn('pad has no caps, ignoring')
            return
        caps = pad.get_current_caps()
        self.logger.info('on_incoming_decodebin_stream: %s', caps.to_string())

    #
    def add_transceiver(self, value, cb):
        value = json.loads(value)
        self.logger.debug('add_transceiver %s', value)
        kind = value['trackOrKind']
        if kind == 'audio':
            caps = Gst.caps_from_string('application/x-rtp,media=audio,encoding-name=OPUS,clock-rate=48000,payload=96,ssrc=1')
        elif kind == 'video':
            caps = Gst.caps_from_string('application/x-rtp,media=video,encoding-name=VP9,clock-rate=90000,payload=101,ssrc=2')
        self.webrtcbin.emit('add-transceiver', GstWebRTC.WebRTCRTPTransceiverDirection.RECVONLY, caps)
        cb()

    def set_remote_description(self, offer, cb):
        offer = json.loads(offer)
        self.logger.debug('set_remote_description %s', offer)
        res, sdpmsg = GstSdp.SDPMessage.new()
        GstSdp.sdp_message_parse_buffer(bytes(offer['sdp'].encode()), sdpmsg)
        offer = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.OFFER, sdpmsg)

        def on_remote_description_set(promise):
            promise.wait()
            reply = promise.get_reply()
            self.logger.debug('on_remote_description_set: %s', reply)
            cb()
        self.webrtcbin.emit('set-remote-description', offer, Gst.Promise.new_with_change_func(on_remote_description_set))

    def set_local_description(self, answer, cb):
        answer = json.loads(answer)
        self.logger.debug('set_local_description: %s', answer)
        res, sdpmsg = GstSdp.SDPMessage.new()
        GstSdp.sdp_message_parse_buffer(bytes(answer['sdp'].encode()), sdpmsg)
        answer = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.ANSWER, sdpmsg)

        def on_local_description_set(promise):
            promise.wait()
            reply = promise.get_reply()
            self.logger.debug('on_local_description_set: %s', reply)
            cb()
        self.webrtcbin.emit('set-local-description', answer, Gst.Promise.new_with_change_func(on_local_description_set))

    def create_offer(self, cb):
        self.logger.debug('create_offer')
        def on_offer_created(promise):
            promise.wait()
            reply = promise.get_reply()
            offer = reply.get_value('offer')
            sdp = offer.sdp.as_text()
            self.logger.debug('on_offer_created: %s', sdp)
            cb(json.dumps({ 'sdp': sdp, 'type': 'offer' }))
        self.webrtcbin.emit('create-offer', None, Gst.Promise.new_with_change_func(on_offer_created))

    def create_answer(self, cb):
        self.logger.debug('create_answer')
        def on_answer_created(promise):
            promise.wait()
            reply = promise.get_reply()
            answer = reply.get_value('answer')
            sdp = answer.sdp.as_text()
            self.logger.debug('on_answer_created: %s', sdp)
            cb(json.dumps({ 'sdp': sdp, 'type': 'answer' }))
        #    self.webrtcbin.emit('set-local-description', answer, Gst.Promise.new_with_change_func(on_local_description_set))
        #def on_local_description_set(promise):
        #    promise.wait()
        #    reply = promise.get_reply()
        #    localDescription = self.webrtcbin.get_property('local-description')
        #    sdp = localDescription.sdp.as_text()
        #    self.logger.debug('on_local_description_set: %s', sdp)
        #    cb(json.dumps({ 'sdp': sdp, 'type': 'answer' }))
        self.webrtcbin.emit('create-answer', None, Gst.Promise.new_with_change_func(on_answer_created))

    def stop(self):
        self.logger.debug('stop')
        if self.pipeline:
            self.pipeline.set_state(Gst.State.NULL)
            self.pipeline = None
            self.webrtcbin = None

if __name__=='__main__':
    Gst.init(sys.argv)
    logger = logging.getLogger('app')

    pc = PeerConnectionExternal()

    def callback(stream, task, buf):
        data = stream.read_bytes_finish(task).get_data().decode()
        buf += data

        while len(buf) > 0 and buf.find('\n') != -1:
            pos = buf.find('\n')
            cmd = buf[0:pos]
            buf = buf[pos+1:]

            [id, command, value] = cmd.strip().split('|')
            logger.debug('command: [%s] %s "%s"', id, command, value)

            def reply(ret=''):
                logger.debug('reply [%s] %s: "%s"', id, command, ret)
                print('r%s|%s|%s' % (id, command, ret), file=sys.stdout, flush=True)

            def error(ret=''):
                logger.debug('error [%s] %s: "%s"', id, command, ret)
                print('e%s|%s|%s' % (id, command, ret), file=sys.stdout, flush=True)

            try:
                if command == 'close':
                    on_exit()
                    return
                elif command == 'addTransceiver':
                    pc.add_transceiver(value, reply)
                elif command == 'setRemoteDescription':
                    pc.set_remote_description(value, reply)
                elif command == 'setLocalDescription':
                    pc.set_local_description(value, reply)
                elif command == 'createAnswer':
                    pc.create_answer(reply)
                elif command == 'createOffer':
                    pc.create_offer(reply)
            except Exception as e:
                error(str(e))

        read_next(stream, buf)

    def read_next(stream, buf):
        stream.read_bytes_async(1024, GLib.PRIORITY_DEFAULT, None, callback, buf)

    stream = Gio.UnixInputStream.new(sys.stdin.fileno(), False)
    buf = ''
    read_next(stream, buf)

    def on_exit(signum=-1, frame=None):
        logger.info('Exiting (%d)', signum)
        try:
            pc.stop()
        except Exception as e:
            logger.error('Error stopping: %s', e)
            sys.exit(-1)
        else:
            sys.exit(0)
    signal.signal(signal.SIGINT, on_exit)

    try:
        GLib.MainLoop().run()
    except:
        on_exit()

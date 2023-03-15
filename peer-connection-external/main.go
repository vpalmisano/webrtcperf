package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/pion/interceptor"
	"github.com/pion/webrtc/v3"
)

func readStdin(channel chan string) {
	r := bufio.NewReader(os.Stdin)
	for {
		var in string
		for {
			var err error
			in, err = r.ReadString('\n')
			if err != nil {
				os.Exit(0)
			}
			in = strings.TrimSpace(in)
			if len(in) > 0 {
				break
			}
		}
		channel <- in
	}
}

func onResult(id string, command string, value string) {
	println(fmt.Sprintf("[peer-connection-external] [%s] %s", id, command))
	//println(fmt.Sprintf("[peer-connection-external] [%s] %s result: '%s'", id, command, value))
	fmt.Printf("r%s|%s|%s\n", id, command, value)
}

func onError(id string, command string, err error) {
	println(fmt.Sprintf("[peer-connection-external] [%s] %s error: %s", id, command, err))
	fmt.Printf("e%s|%s|%s\n", id, command, err.Error())
}

func main() {
	m := &webrtc.MediaEngine{}
	if err := m.RegisterDefaultCodecs(); err != nil {
		panic(err)
	}
	i := &interceptor.Registry{}
	if err := webrtc.RegisterDefaultInterceptors(m, i); err != nil {
		panic(err)
	}
	settingEngine := webrtc.SettingEngine{}
	// settingEngine.SetLite(true)
	api := webrtc.NewAPI(webrtc.WithMediaEngine(m), webrtc.WithInterceptorRegistry(i), webrtc.WithSettingEngine(settingEngine))

	config := webrtc.Configuration{}
	err := json.Unmarshal([]byte(os.Args[1]), &config)
	if err != nil {
		panic(err)
	}
	peerConnection, err := api.NewPeerConnection(config)
	if err != nil {
		panic(err)
	}

	peerConnection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		onResult("ev", "connectionstatechange", state.String())
	})

	peerConnection.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		onResult("ev", "iceconnectionstatechange", state.String())
	})

	peerConnection.OnICEGatheringStateChange(func(state webrtc.ICEGathererState) {
		onResult("ev", "icegatheringstatechange", state.String())
	})

	peerConnection.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		// Send a PLI on an interval so that the publisher is pushing a keyframe every rtcpPLIInterval
		/* go func() {
			ticker := time.NewTicker(time.Second * 5)
			for range ticker.C {
				rtcpSendErr := peerConnection.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(track.SSRC())}})
				if rtcpSendErr != nil {
					fmt.Println(rtcpSendErr)
				}
			}
		}() */

		codecName := strings.Split(track.Codec().RTPCodecCapability.MimeType, "/")[1]
		println(fmt.Sprintf("[peer-connection-external] OnTrack type %d: %s", track.PayloadType(), codecName))

		buf := make([]byte, 1400)
		for {
			i, _, readErr := track.Read(buf)
			if readErr != nil {
				panic(err)
			}
			println("[peer-connection-external] OnTrack data", i)
		}
	})

	//
	channel := make(chan string)
	go readStdin(channel)

	for msg := range channel {
		commands := strings.SplitN(msg, "|", 3)
		id := commands[0]
		command := commands[1]
		value := commands[2]

		//println(fmt.Sprintf("[peer-connection-external] command [%s] %s: \"%s\"", id, command, value))

		switch {
		case command == "close":
			onResult(id, command, "")
			return

		case command == "addTransceiver":
			var args map[string]interface{}
			err = json.Unmarshal([]byte(value), &args)
			if err != nil {
				onError(id, command, err)
				continue
			}
			trackOrKind := args["trackOrKind"].(string)
			_, err := peerConnection.AddTransceiverFromKind(webrtc.NewRTPCodecType(trackOrKind))
			if err != nil {
				onError(id, command, err)
				continue
			}
			onResult(id, command, "")

		case command == "createOffer":
			offer, err := peerConnection.CreateOffer(nil)
			if err != nil {
				onError(id, command, err)
				continue
			}
			err = peerConnection.SetLocalDescription(offer)
			if err != nil {
				onError(id, command, err)
				continue
			}
			b, err := json.Marshal(offer)
			if err != nil {
				onError(id, command, err)
				continue
			}
			onResult(id, command, string(b))

		case command == "createAnswer":
			answer, err := peerConnection.CreateAnswer(nil)
			if err != nil {
				onError(id, command, err)
				continue
			}
			gatherComplete := webrtc.GatheringCompletePromise(peerConnection)
			err = peerConnection.SetLocalDescription(answer)
			if err != nil {
				onError(id, command, err)
				continue
			}
			<-gatherComplete
			b, err := json.Marshal(*peerConnection.LocalDescription())
			if err != nil {
				onError(id, command, err)
				continue
			}
			onResult(id, command, string(b))

		/* case command == "setLocalDescription":
		offer := webrtc.SessionDescription{}
		err = json.Unmarshal([]byte(value), &offer)
		if err != nil {
			onError(id, command, err)
			continue
		}
		if err = peerConnection.SetLocalDescription(offer); err != nil {
			onError(id, command, err)
			continue
		}
		b, err := json.Marshal(*peerConnection.LocalDescription())
		if err != nil {
			onError(id, command, err)
			continue
		}
		onResult(id, command, string(b)) */

		case command == "setRemoteDescription":
			answer := webrtc.SessionDescription{}
			err = json.Unmarshal([]byte(value), &answer)
			if err != nil {
				onError(id, command, err)
				continue
			}
			err = peerConnection.SetRemoteDescription(answer)
			if err != nil {
				onError(id, command, err)
				continue
			}
			b, err := json.Marshal(*peerConnection.RemoteDescription())
			if err != nil {
				onError(id, command, err)
				continue
			}
			onResult(id, command, string(b))
		}
	}
}

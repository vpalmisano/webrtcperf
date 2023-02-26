package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/pion/webrtc/v3"
)

func readStdin(channel chan string) {
	r := bufio.NewReader(os.Stdin)
	for {
		var in string
		for {
			var err error
			in, err = r.ReadString('\n')
			if err != io.EOF {
				if err != nil {
					panic(err)
				}
			}
			in = strings.TrimSpace(in)
			if len(in) > 0 {
				break
			}
		}
		channel <- in
	}
}

func onError(id string, msg string, err error) {
	println(fmt.Sprintf("[peer-connection-external] [%s] %s error: %s", id, msg, err))
	fmt.Printf("e|error|%s", err.Error())
}

func main() {
	config := webrtc.Configuration{}
	err := json.Unmarshal([]byte(os.Args[1]), &config)
	if err != nil {
		panic(err)
	}

	peerConnection, err := webrtc.NewPeerConnection(config)
	if err != nil {
		panic(err)
	}

	peerConnection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		fmt.Println("e|connectionstatechange|" + state.String())
	})

	peerConnection.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		fmt.Println("e|iceconnectionstatechange|" + state.String())
	})

	peerConnection.OnICEGatheringStateChange(func(state webrtc.ICEGathererState) {
		fmt.Println("e|icegatheringstatechange|" + state.String())
	})

	peerConnection.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		buf := make([]byte, 1400)
		for {
			i, _, readErr := track.Read(buf)
			if readErr != nil {
				panic(err)
			}
			println("[peer-connection-external] OnTrack data", i)
		}
	})

	/* gatherComplete := webrtc.GatheringCompletePromise(peerConnection)
	go func() {
		<-gatherComplete

		b, err := json.Marshal(*peerConnection.LocalDescription())
		if err != nil {
			panic(err)
		}
		fmt.Println("e||" + string(b))
	} */

	//
	channel := make(chan string)
	go readStdin(channel)

	for {
		msg := <-channel
		commands := strings.SplitN(msg, "|", 3)
		id := commands[0]
		command := commands[1]
		value := commands[2]

		//println(fmt.Sprintf("[peer-connection-external] command [%s] %s: \"%s\"", id, command, value))

		switch {
		case command == "close":
			fmt.Println(id + "|" + command)
			return

		case command == "addTransceiver":
			var args map[string]interface{}
			err = json.Unmarshal([]byte(value), &args)
			if err != nil {
				onError(id, command, err)
				continue
			}
			trackOrKind := args["trackOrKind"].(string)
			if trackOrKind == "audio" {
				audioTrack, err := webrtc.NewTrackLocalStaticSample(webrtc.RTPCodecCapability{MimeType: "audio/opus"}, "audio", "a1")
				if err != nil {
					onError(id, command, err)
					continue
				}
				_, err = peerConnection.AddTrack(audioTrack)
				if err != nil {
					onError(id, command, err)
					continue
				}
				fmt.Println(id + "|" + command)
			} else if trackOrKind == "video" {
				videoTrack, err := webrtc.NewTrackLocalStaticSample(webrtc.RTPCodecCapability{MimeType: "video/vp8"}, "video", "v1")
				if err != nil {
					onError(id, command, err)
					continue
				}
				_, err = peerConnection.AddTrack(videoTrack)
				if err != nil {
					onError(id, command, err)
					continue
				}
				fmt.Println(id + "|" + command)
			} else {
				onError(id, command, errors.New("InvalidTrackOrKind"))
			}

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
			fmt.Println(id + "|" + command + "|" + string(b))

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
			fmt.Println(id + "|" + command + "|" + string(b))

		case command == "setLocalDescription":
			offer := webrtc.SessionDescription{}
			err = json.Unmarshal([]byte(value), &offer)
			if err != nil {
				onError(id, command, err)
				continue
			}
			/* if err = peerConnection.SetLocalDescription(offer); err != nil {
				onError(id, command, err)
				continue
			} */
			fmt.Println(id + "|" + command)

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
			fmt.Println(id + "|" + command)
		}
	}
}

func test() {
	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{
				URLs: []string{"stun:stun.l.google.com:19302"},
			},
		},
	}
	peerConnection, err := webrtc.NewPeerConnection(config)
	if err != nil {
		panic(err)
	}

	peerConnection.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		buf := make([]byte, 1400)
		for {
			i, _, readErr := track.Read(buf)
			if readErr != nil {
				panic(err)
			}
			fmt.Printf("Read %d", i)
		}
	})

	// Set the handler for ICE connection state
	peerConnection.OnICEConnectionStateChange(func(connectionState webrtc.ICEConnectionState) {
		fmt.Printf("[connectionstatechange]%s\n", connectionState.String())
	})

	// Create a audio track
	audioTrack, err := webrtc.NewTrackLocalStaticSample(webrtc.RTPCodecCapability{MimeType: "audio/opus"}, "audio", "a1")
	if err != nil {
		panic(err)
	}
	_, err = peerConnection.AddTrack(audioTrack)
	if err != nil {
		panic(err)
	}

	// Create a video track
	firstVideoTrack, err := webrtc.NewTrackLocalStaticSample(webrtc.RTPCodecCapability{MimeType: "video/vp8"}, "video", "v1")
	if err != nil {
		panic(err)
	}
	_, err = peerConnection.AddTrack(firstVideoTrack)
	if err != nil {
		panic(err)
	}

	// Create an offer
	offer, err := peerConnection.CreateOffer(nil)
	if err != nil {
		panic(err)
	}

	// Sets the LocalDescription, and starts our UDP listeners
	// Note: this will start the gathering of ICE candidates
	if err = peerConnection.SetLocalDescription(offer); err != nil {
		panic(err)
	}

	fmt.Println(offer)

	/*
		// Wait for the offer to be pasted
		offer := webrtc.SessionDescription{}
		err = json.Unmarshal([]byte(signal.MustReadStdin()), &offer)
		if err != nil {
			panic(err)
		}

		// Set the remote SessionDescription
		err = peerConnection.SetRemoteDescription(offer)
		if err != nil {
			panic(err)
		}

		// Create an answer
		answer, err := peerConnection.CreateAnswer(nil)
		if err != nil {
			panic(err)
		}

		// Create channel that is blocked until ICE Gathering is complete
		gatherComplete := webrtc.GatheringCompletePromise(peerConnection)

		// Sets the LocalDescription, and starts our UDP listeners
		err = peerConnection.SetLocalDescription(answer)
		if err != nil {
			panic(err)
		}

		// Block until ICE Gathering is complete, disabling trickle ICE
		// we do this because we only can exchange one signaling message
		// in a production application you should exchange ICE Candidates via OnICECandidate
		<-gatherComplete

		// Output the answer in base64 so we can paste it in browser
		fmt.Println(signal.Encode(*peerConnection.LocalDescription())) */

	// Block forever
	select {}
}

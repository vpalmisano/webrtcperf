//var peerPairs = [[{name: 1, set: false }, {name: 2, set: false }]];
//var name = {name: 1, set: false };
//var peer = {name: 2, set: false };

/*
function setName() {
  var nameInput = document.querySelector('#id');
  peerPairs.forEach(element => {
    if (!element[1].set){
      name = element[1].name
    }else if (!element[2].set){
      name = element[2].name
    }
  });
  nameInput.value = peerPairs[1].name
  const registerButton = document.querySelector('#register');
}*/

function setPeer() {
  const peerInput = document.querySelector('#peer')
  const peerDisplay = document.querySelector('#display_peer')
  peerInput.value = peerDisplay.innerHTML
  //console.log("peerdisplayinnerhtml " + peerDisplay.innerHTML + " peerinputvalue " +peerInput.value)
}

/**
 * Gets, sets and then joins the peer.
 */
function kurentoJoin() {
  //setName()
  const joinButton = document.querySelector('#call')

  if (!joinButton) {
    setTimeout(kurentoJoin, 1000)
    return
  }
  setPeer()

  // join the room
  console.log(`Joining the room`)
  joinButton.click()
}
setTimeout(kurentoJoin, 2000)

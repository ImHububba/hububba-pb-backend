const peersEl = document.getElementById("peers");
const localVideo = document.getElementById("localVideo");

const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");
const muteBtn = document.getElementById("muteBtn");
const camBtn = document.getElementById("camBtn");
const screenBtn = document.getElementById("screenBtn");
const roomInput = document.getElementById("room");

const socket = io({ autoConnect: false }); // connect after we have media
const pcByPeer = new Map();                 // sid -> RTCPeerConnection
const streamsByPeer = new Map();            // sid -> MediaStream

let localStream = null;
let room = null;
let mySid = null;
let micEnabled = true;
let camEnabled = true;

// Add your TURN here later for reliability
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
    // { urls: "turn:YOUR_TURN_HOST:3478", username: "X", credential: "Y" }
  ]
};

function enableControls(joined) {
  joinBtn.disabled = joined;
  leaveBtn.disabled = !joined;
  muteBtn.disabled = !joined;
  camBtn.disabled = !joined;
  screenBtn.disabled = !joined;
  roomInput.disabled = joined;
}

function addRemoteVideo(peerSid, stream) {
  let v = document.getElementById(`v_${peerSid}`);
  if (!v) {
    v = document.createElement("video");
    v.id = `v_${peerSid}`;
    v.autoplay = true;
    v.playsInline = true;
    peersEl.appendChild(v);
  }
  v.srcObject = stream;
}

function removeRemoteVideo(peerSid) {
  const v = document.getElementById(`v_${peerSid}`);
  if (v && v.parentNode) v.parentNode.removeChild(v);
}

function createPeerConnection(peerSid) {
  const pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("signal", {
        to: peerSid,
        from: mySid,
        type: "candidate",
        payload: e.candidate
      });
    }
  };

  pc.ontrack = (e) => {
    const [stream] = e.streams;
    streamsByPeer.set(peerSid, stream);
    addRemoteVideo(peerSid, stream);
  };

  // add local tracks
  if (localStream) {
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  }

  pcByPeer.set(peerSid, pc);
  return pc;
}

async function callPeer(peerSid) {
  const pc = createPeerConnection(peerSid);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("signal", {
    to: peerSid,
    from: mySid,
    type: "offer",
    payload: offer
  });
}

async function handleOffer(fromSid, offer) {
  const pc = createPeerConnection(fromSid);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("signal", {
    to: fromSid,
    from: mySid,
    type: "answer",
    payload: answer
  });
}

async function handleAnswer(fromSid, answer) {
  const pc = pcByPeer.get(fromSid);
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
}

async function handleCandidate(fromSid, candidate) {
  const pc = pcByPeer.get(fromSid);
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) {
    console.error("addIceCandidate error", e);
  }
}

// UI handlers
joinBtn.addEventListener("click", async () => {
  if (!roomInput.value.trim()) {
    alert("Enter a room name.");
    return;
  }
  room = roomInput.value.trim();

  // get mic/cam
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  localVideo.srcObject = localStream;

  socket.connect();
  socket.emit("join", { room });
  enableControls(true);
});

leaveBtn.addEventListener("click", () => {
  if (!room) return;
  socket.emit("leave", { room });

  for (const [peerSid, pc] of pcByPeer) {
    pc.close();
    removeRemoteVideo(peerSid);
  }
  pcByPeer.clear();
  streamsByPeer.clear();

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    localVideo.srcObject = null;
  }
  enableControls(false);
  room = null;
  mySid = null;
});

muteBtn.addEventListener("click", () => {
  if (!localStream) return;
  micEnabled = !micEnabled;
  localStream.getAudioTracks().forEach((t) => (t.enabled = micEnabled));
  muteBtn.textContent = micEnabled ? "Mute" : "Unmute";
});

camBtn.addEventListener("click", () => {
  if (!localStream) return;
  camEnabled = !camEnabled;
  localStream.getVideoTracks().forEach((t) => (t.enabled = camEnabled));
  camBtn.textContent = camEnabled ? "Hide Cam" : "Show Cam";
});

screenBtn.addEventListener("click", async () => {
  if (!localStream) return;
  try {
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const newTrack = screen.getVideoTracks()[0];

    // swap outgoing video in all peer connections
    for (const [, pc] of pcByPeer) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender) await sender.replaceTrack(newTrack);
    }

    // show locally
    const old = localStream.getVideoTracks()[0];
    if (old) {
      localStream.removeTrack(old);
      old.stop();
    }
    localStream.addTrack(newTrack);
    localVideo.srcObject = localStream;

    newTrack.addEventListener("ended", async () => {
      // revert to camera
      const cam = await navigator.mediaDevices.getUserMedia({ video: true });
      const camTrack = cam.getVideoTracks()[0];
      for (const [, pc] of pcByPeer) {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
        if (sender) await sender.replaceTrack(camTrack);
      }
      const current = localStream.getVideoTracks()[0];
      if (current) {
        localStream.removeTrack(current);
        current.stop();
      }
      localStream.addTrack(camTrack);
      localVideo.srcObject = localStream;
    });
  } catch (e) {
    console.error("screen share error", e);
  }
});

// Socket events
socket.on("connect", () => {
  mySid = socket.id;
  console.log("connected as", mySid);
});

socket.on("peers", async ({ peers, you }) => {
  mySid = you;
  for (const sid of peers) {
    await callPeer(sid);
  }
});

socket.on("peer-left", ({ sid }) => {
  const pc = pcByPeer.get(sid);
  if (pc) pc.close();
  pcByPeer.delete(sid);
  streamsByPeer.delete(sid);
  removeRemoteVideo(sid);
});

socket.on("signal", async ({ from, type, payload }) => {
  if (from === mySid) return;
  switch (type) {
    case "offer": await handleOffer(from, payload); break;
    case "answer": await handleAnswer(from, payload); break;
    case "candidate": await handleCandidate(from, payload); break;
  }
});

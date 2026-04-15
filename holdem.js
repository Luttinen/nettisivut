const playersContainer = document.getElementById("players");
const communityCardsEl = document.getElementById("community-cards");
const potEl = document.getElementById("pot");
const potPhaseLabelEl = document.getElementById("pot-phase-label");
const statusEl = document.getElementById("status");
const roomCodeEl = document.getElementById("room-code");
const appShellEl = document.getElementById("app-shell");
const headerMetaEl = document.getElementById("header-meta");
const headerHandLineEl = document.getElementById("header-hand-line");
const headerLivePillEl = document.getElementById("header-live-pill");
const headerBlindsEl = document.getElementById("header-blinds");
const headerSeatsEl = document.getElementById("header-seats");
const headerPhaseEl = document.getElementById("header-phase");
const headerTurnTimerEl = document.getElementById("header-turn-timer");
const connectionBadgeEl = document.getElementById("connection-badge");
const chatOnlineCountEl = document.getElementById("chat-online-count");
const heroHandEl = document.getElementById("hero-hand");
const newHandBtn = document.getElementById("new-hand-btn");
const addBotBtn = document.getElementById("add-bot-btn");
const removeBotBtn = document.getElementById("remove-bot-btn");
const forceEndBtn = document.getElementById("force-end-btn");
const resetChipsBtn = document.getElementById("reset-chips-btn");
const kickPlayerSelect = document.getElementById("kick-player-select");
const kickPlayerBtn = document.getElementById("kick-player-btn");
const checkCallBtn = document.getElementById("check-call-btn");
const raiseBtn = document.getElementById("raise-btn");
const foldBtn = document.getElementById("fold-btn");
const bettingPanel = document.getElementById("betting-panel");
const betSlider = document.getElementById("bet-slider");
const betTargetLabel = document.getElementById("bet-target-label");
const betSliderTitle = document.getElementById("bet-slider-title");
const betPresets = document.getElementById("bet-presets");
const autoActionSelect = document.getElementById("auto-action-select");
const betAmountInput = document.getElementById("bet-amount-input");
const bettingHint = document.getElementById("betting-hint");
const nameInput = document.getElementById("name-input");
const passwordInput = document.getElementById("password-input");
const roomInput = document.getElementById("room-input");
const registerBtn = document.getElementById("register-btn");
const loginBtn = document.getElementById("login-btn");
const createRoomBtn = document.getElementById("create-room-btn");
const joinRoomBtn = document.getElementById("join-room-btn");
const lobbyEl = document.getElementById("lobby");
const webcamPreviewEl = document.getElementById("webcam-preview");
const webcamCanvasEl = document.getElementById("webcam-canvas");
const avatarPreviewEl = document.getElementById("avatar-preview");
const startCameraBtn = document.getElementById("start-camera-btn");
const captureAvatarBtn = document.getElementById("capture-avatar-btn");
const saveAvatarBtn = document.getElementById("save-avatar-btn");
const hostStreamPanel = document.getElementById("host-stream-panel");
const hostStreamHostUi = document.getElementById("host-stream-host-ui");
const hostStreamViewerUi = document.getElementById("host-stream-viewer-ui");
const hostTableStreamStartBtn = document.getElementById("host-table-stream-start");
const hostTableStreamStopBtn = document.getElementById("host-table-stream-stop");
const hostTableSelfPreview = document.getElementById("host-table-self-preview");
const remoteStreamsGrid = document.getElementById("remote-streams-grid");
const hostTablePlaceholder = document.getElementById("host-table-placeholder");

const suitMap = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};
const socket = io();

const PHASE_LABELS = {
  waiting: "Lobby",
  preflop: "Pre-flop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

let myId = null;
let isHost = false;
let inRoom = false;
let isAuthed = false;
let webcamStream = null;
let avatarDataUrl = "";
let latestState = null;
let roomHostId = null;
let tableStreamSubscribedKey = "";
let tableMediaStream = null;
const outPeerByViewerId = new Map();
const pendingViewerSubs = new Set();
const incomingPcByBroadcasterId = new Map();
const remoteTilesByPeerId = new Map();
let lastAutoFingerprint = "";
let turnDisplayInterval = null;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function formatChips(n) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function defaultAvatar(name = "?") {
  const initial = encodeURIComponent(String(name || "?").trim().charAt(0).toUpperCase() || "?");
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">
      <rect width="100%" height="100%" fill="#143d24"/>
      <text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" fill="#ffd700" font-family="Inter,Arial" font-size="36" font-weight="700">${initial}</text>
    </svg>`,
  )}`;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setConnectionBadge(online) {
  connectionBadgeEl.textContent = online ? "Connected" : "Offline";
  connectionBadgeEl.classList.toggle("is-online", online);
}

function updateRoomChrome() {
  appShellEl.dataset.inRoom = inRoom ? "true" : "false";
  headerMetaEl.hidden = !inRoom;
  if (!inRoom) {
    headerHandLineEl.textContent = "Texas Hold'em";
    headerLivePillEl.hidden = true;
    chatOnlineCountEl.textContent = "—";
  }
  updateHostStreamPanel();
}

function updateHostStreamPanel() {
  if (!hostStreamPanel) return;
  hostStreamPanel.hidden = !inRoom;
  if (hostStreamHostUi) hostStreamHostUi.hidden = false;
  if (hostStreamViewerUi) hostStreamViewerUi.classList.remove("host-stream-viewer-ui--as-host");
}

function updateRemoteStreamsPlaceholder() {
  if (!hostTablePlaceholder || !remoteStreamsGrid) return;
  const hasVideo = [...remoteStreamsGrid.querySelectorAll("video")].some((v) => v.srcObject && !v.hidden);
  hostTablePlaceholder.hidden = Boolean(hasVideo);
}

function updateRemoteStreamLabels(state) {
  if (!state?.players) return;
  remoteTilesByPeerId.forEach((tile, peerId) => {
    const name = state.players.find((p) => p.id === peerId)?.name || "Player";
    tile.label.textContent = name;
  });
}

function pruneStaleStreamPeers(state) {
  if (!state?.players) return;
  const humanIds = new Set(state.players.filter((p) => !p.isBot).map((p) => p.id));
  for (const id of [...incomingPcByBroadcasterId.keys()]) {
    if (!humanIds.has(id) || id === myId) teardownIncomingPeer(id);
  }
}

function ensureRemoteVideoTile(broadcasterId) {
  if (!remoteStreamsGrid) return null;
  let tile = remoteTilesByPeerId.get(broadcasterId);
  if (tile) return tile.video;
  const wrap = document.createElement("div");
  wrap.className = "remote-stream-tile";
  wrap.dataset.peerId = broadcasterId;
  const label = document.createElement("span");
  label.className = "remote-stream-tile__name";
  const video = document.createElement("video");
  video.className = "host-stream-video";
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.hidden = true;
  wrap.appendChild(label);
  wrap.appendChild(video);
  remoteStreamsGrid.appendChild(wrap);
  tile = { wrap, video, label };
  remoteTilesByPeerId.set(broadcasterId, tile);
  return video;
}

function removeRemoteVideoTile(broadcasterId) {
  const tile = remoteTilesByPeerId.get(broadcasterId);
  if (!tile) return;
  try {
    tile.video.srcObject = null;
  } catch (_) {}
  tile.wrap.remove();
  remoteTilesByPeerId.delete(broadcasterId);
  updateRemoteStreamsPlaceholder();
}

function teardownIncomingPeer(broadcasterId) {
  const entry = incomingPcByBroadcasterId.get(broadcasterId);
  if (entry?.pc) {
    try {
      entry.pc.close();
    } catch (_) {}
  }
  incomingPcByBroadcasterId.delete(broadcasterId);
  removeRemoteVideoTile(broadcasterId);
}

function teardownAllIncomingPeers() {
  for (const id of [...incomingPcByBroadcasterId.keys()]) {
    const entry = incomingPcByBroadcasterId.get(id);
    if (entry?.pc) {
      try {
        entry.pc.close();
      } catch (_) {}
    }
    incomingPcByBroadcasterId.delete(id);
  }
  remoteTilesByPeerId.forEach(({ wrap }) => wrap.remove());
  remoteTilesByPeerId.clear();
  updateRemoteStreamsPlaceholder();
}

function teardownViewerHostStream() {
  teardownAllIncomingPeers();
}

function teardownHostTableBroadcast() {
  pendingViewerSubs.clear();
  outPeerByViewerId.forEach(({ pc }) => {
    try {
      pc.close();
    } catch (_) {}
  });
  outPeerByViewerId.clear();
  if (tableMediaStream) {
    tableMediaStream.getTracks().forEach((t) => t.stop());
    tableMediaStream = null;
  }
  if (hostTableSelfPreview) {
    hostTableSelfPreview.srcObject = null;
    hostTableSelfPreview.hidden = true;
  }
  if (hostTableStreamStartBtn) hostTableStreamStartBtn.hidden = false;
  if (hostTableStreamStopBtn) hostTableStreamStopBtn.hidden = true;
}

function syncTableStreamSubscription(state) {
  if (!inRoom || !state?.players) return;
  const humans = state.players.filter((p) => !p.isBot);
  if (humans.length < 2) {
    tableStreamSubscribedKey = "";
    return;
  }
  const key = humans.map((p) => p.id).sort().join(",");
  if (key === tableStreamSubscribedKey) return;
  tableStreamSubscribedKey = key;
  socket.emit("table_stream_subscribe");
}

function syncOutgoingStreamPeers(state) {
  if (!tableMediaStream || !state?.players) return;
  const humanIds = new Set(state.players.filter((p) => !p.isBot && p.id !== myId).map((p) => p.id));
  for (const id of [...outPeerByViewerId.keys()]) {
    if (!humanIds.has(id)) {
      try {
        outPeerByViewerId.get(id)?.pc.close();
      } catch (_) {}
      outPeerByViewerId.delete(id);
    }
  }
  humanIds.forEach((id) => {
    void ensureOutgoingPeer(id);
  });
}

async function ensureOutgoingPeer(viewerId) {
  if (!tableMediaStream || viewerId === myId) return;
  const existing = outPeerByViewerId.get(viewerId);
  if (existing?.pc) {
    if (existing.pc.connectionState === "connected") return;
    if (
      existing.pc.connectionState === "connecting"
      || existing.pc.signalingState === "have-local-offer"
    ) return;
    try {
      existing.pc.close();
    } catch (_) {}
    outPeerByViewerId.delete(viewerId);
  }

  const pc = new RTCPeerConnection(RTC_CONFIG);
  const icePending = [];
  tableMediaStream.getTracks().forEach((track) => pc.addTrack(track, tableMediaStream));

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      socket.emit("webrtc_relay", {
        to: viewerId,
        payload: { type: "ice", candidate: ev.candidate.toJSON() },
      });
    }
  };

  outPeerByViewerId.set(viewerId, { pc, icePending });

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("webrtc_relay", {
      to: viewerId,
      payload: { type: "offer", sdp: offer.sdp },
    });
  } catch (err) {
    setStatus(`Videolähetys ei onnistunut katsojalle (${err.message || err}).`);
    try {
      pc.close();
    } catch (_) {}
    outPeerByViewerId.delete(viewerId);
  }
}

async function broadcasterHandleWebRtcRelay(from, payload) {
  if (!tableMediaStream) return;
  const entry = outPeerByViewerId.get(from);
  if (!entry) return;
  const { pc, icePending } = entry;
  try {
    if (payload.type === "answer" && payload.sdp) {
      await pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
      const queued = icePending.splice(0);
      for (const c of queued) {
        try {
          await pc.addIceCandidate(c);
        } catch (_) {}
      }
    } else if (payload.type === "ice" && payload.candidate) {
      const cand = new RTCIceCandidate(payload.candidate);
      if (pc.remoteDescription?.type) {
        try {
          await pc.addIceCandidate(cand);
        } catch (_) {}
      } else {
        icePending.push(cand);
      }
    }
  } catch (err) {
    setStatus(`WebRTC (lähetys): ${err.message || err}`);
  }
}

async function receiverHandleWebRtcRelay(from, payload) {
  if (from === myId || !payload) return;
  if (!latestState?.players?.some((p) => p.id === from && !p.isBot)) return;

  try {
    if (payload.type === "offer" && payload.sdp) {
      teardownIncomingPeer(from);
      const videoEl = ensureRemoteVideoTile(from);
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const icePending = [];
      pc.ontrack = (ev) => {
        const [stream] = ev.streams;
        if (stream && videoEl) {
          videoEl.srcObject = stream;
          videoEl.hidden = false;
          updateRemoteStreamsPlaceholder();
        }
      };
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          socket.emit("webrtc_relay", {
            to: from,
            payload: { type: "ice", candidate: ev.candidate.toJSON() },
          });
        }
      };
      incomingPcByBroadcasterId.set(from, { pc, icePending });
      await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc_relay", { to: from, payload: { type: "answer", sdp: answer.sdp } });
      const queued = icePending.splice(0);
      for (const c of queued) {
        try {
          await pc.addIceCandidate(c);
        } catch (_) {}
      }
      if (latestState) updateRemoteStreamLabels(latestState);
    } else if (payload.type === "ice" && payload.candidate) {
      const entry = incomingPcByBroadcasterId.get(from);
      if (!entry?.pc) return;
      const cand = new RTCIceCandidate(payload.candidate);
      if (entry.pc.remoteDescription?.type) {
        try {
          await entry.pc.addIceCandidate(cand);
        } catch (_) {}
      } else {
        entry.icePending.push(cand);
      }
    }
  } catch (err) {
    setStatus(`WebRTC (vastaanotto): ${err.message || err}`);
  }
}

function resetHostStreamSessionFlags() {
  roomHostId = null;
  tableStreamSubscribedKey = "";
}

function potLabelForPhase(phase) {
  if (phase === "waiting") return "Pot";
  const name = (PHASE_LABELS[phase] || phase).toUpperCase();
  return `${name} · POT`;
}

function updateHeader(state) {
  if (!inRoom) return;
  const sb = state.smallBlind ?? 10;
  const bb = state.bigBlind ?? 20;
  const maxP = state.maxPlayers ?? 6;
  const n = (state.players || []).length;
  const handNo = state.handNumber || 0;
  const code = state.code || "";

  headerHandLineEl.textContent = handNo > 0 ? `Hand #${handNo} · Room ${code}` : `Room ${code}`;
  headerBlindsEl.textContent = `Blinds ${formatChips(sb)} / ${formatChips(bb)}`;
  headerSeatsEl.textContent = `${n} / ${maxP} players`;
  headerPhaseEl.textContent = PHASE_LABELS[state.phase] || state.phase || "—";
  headerLivePillEl.hidden = state.phase === "waiting";

  const humans = (state.players || []).filter((p) => !p.isBot).length;
  chatOnlineCountEl.textContent = `${humans} player${humans === 1 ? "" : "s"} online`;

  potPhaseLabelEl.textContent = potLabelForPhase(state.phase);
  updateTurnTimerDisplay(state);
}

function updateTurnTimerDisplay(state) {
  if (turnDisplayInterval) {
    clearInterval(turnDisplayInterval);
    turnDisplayInterval = null;
  }
  if (!headerTurnTimerEl) return;
  if (!inRoom || !state?.turnExpiresAt || state.phase === "waiting" || state.phase === "showdown") {
    headerTurnTimerEl.hidden = true;
    headerTurnTimerEl.textContent = "";
    return;
  }
  const lim = state.turnTimeLimitSec ?? 40;
  const tick = () => {
    const st = latestState;
    if (!st?.turnExpiresAt || st.phase === "waiting" || st.phase === "showdown") {
      headerTurnTimerEl.hidden = true;
      headerTurnTimerEl.textContent = "";
      if (turnDisplayInterval) {
        clearInterval(turnDisplayInterval);
        turnDisplayInterval = null;
      }
      return;
    }
    const sec = Math.max(0, Math.ceil((st.turnExpiresAt - Date.now()) / 1000));
    headerTurnTimerEl.hidden = false;
    const mine = st.players?.find((p) => p.id === myId);
    const toCall = mine ? Math.max(0, st.currentBet - mine.bet) : 0;
    const autoAct = toCall > 0 ? "fold" : "check";
    headerTurnTimerEl.textContent = st.currentTurn === myId
      ? `· ${sec}s / ${lim}s (→ ${autoAct})`
      : `· ${sec}s / ${lim}s`;
  };
  tick();
  turnDisplayInterval = setInterval(tick, 1000);
}

function getSuitColor(suit) {
  const symbol = suitMap[suit] || suit;
  return symbol === "♥" || symbol === "♦" ? "red" : "";
}

function renderCard(card, hidden = false, delay = 0) {
  const el = document.createElement("div");
  const suit = suitMap[card.suit] || card.suit;
  el.className = `card ${hidden ? "back" : getSuitColor(card.suit)}`;
  el.style.animationDelay = `${delay}ms`;
  el.textContent = hidden ? "X" : `${card.rank}${suit}`;
  return el;
}

function appendRoleBadges(container, state, seatIndex) {
  if (state.phase === "waiting") return;
  const { buttonIndex, sbIndex, bbIndex } = state;
  const wrap = document.createElement("div");
  wrap.className = "player-role-badges";
  if (typeof buttonIndex === "number" && buttonIndex === seatIndex) {
    const d = document.createElement("span");
    d.className = "role-badge role-badge--d";
    d.textContent = "D";
    d.title = "Dealer";
    wrap.appendChild(d);
  }
  if (typeof sbIndex === "number" && sbIndex === seatIndex) {
    const s = document.createElement("span");
    s.className = "role-badge role-badge--s";
    s.textContent = "S";
    s.title = "Small blind";
    wrap.appendChild(s);
  }
  if (typeof bbIndex === "number" && bbIndex === seatIndex) {
    const b = document.createElement("span");
    b.className = "role-badge role-badge--b";
    b.textContent = "B";
    b.title = "Big blind";
    wrap.appendChild(b);
  }
  if (wrap.childElementCount) container.appendChild(wrap);
}

function presetTargetBet(state, preset) {
  const h = state.bettingHints;
  if (!h) return null;
  const mine = state.players.find((p) => p.id === myId);
  if (!mine) return null;
  const { pot, toCall, minRaiseBet, maxBet } = h;
  const base = mine.bet + toCall;
  switch (preset) {
    case "min":
      return minRaiseBet;
    case "third":
      return clamp(Math.round(base + pot / 3), minRaiseBet, maxBet);
    case "half":
      return clamp(Math.round(base + pot / 2), minRaiseBet, maxBet);
    case "pot":
      return clamp(Math.round(base + pot), minRaiseBet, maxBet);
    case "max":
      return maxBet;
    default:
      return null;
  }
}

function automationFingerprint(state) {
  return `${state.handNumber}|${state.phase}|${state.currentTurn}|${state.pot}|${state.currentBet}`;
}

function maybeApplyAutomation(state) {
  if (!inRoom || state.currentTurn !== myId) return;
  const mode = autoActionSelect?.value || "off";
  if (mode === "off") return;
  const fp = automationFingerprint(state);
  if (fp === lastAutoFingerprint) return;
  const mine = state.players.find((p) => p.id === myId);
  if (!mine) return;
  const toCall = Math.max(0, state.currentBet - mine.bet);
  if (mode === "check_fold") {
    lastAutoFingerprint = fp;
    if (toCall === 0) socket.emit("action", { type: "checkcall" });
    else socket.emit("action", { type: "fold" });
    return;
  }
  if (mode === "call_any") {
    lastAutoFingerprint = fp;
    socket.emit("action", { type: "checkcall" });
    return;
  }
  if (mode === "check_only" && toCall === 0) {
    lastAutoFingerprint = fp;
    socket.emit("action", { type: "checkcall" });
  }
}

function setActionEnabled(state, canAct) {
  const raiseAmt = state.raiseAmount ?? 20;
  const mine = state.players.find((p) => p.id === myId);
  const isMyTurn = state.currentTurn === myId && state.phase !== "waiting" && state.phase !== "showdown";
  const toCall = mine ? Math.max(0, state.currentBet - mine.bet) : 0;
  const h = state.bettingHints;
  const canRaise = Boolean(h?.canRaise ?? (mine && mine.stack >= toCall + raiseAmt));
  if (isMyTurn) {
    checkCallBtn.textContent = toCall > 0 ? `Call $${formatChips(toCall)}` : "Check";
  } else {
    checkCallBtn.textContent = "Check / Call";
  }
  checkCallBtn.disabled = !(canAct && isMyTurn);
  foldBtn.disabled = !(canAct && isMyTurn);
  raiseBtn.disabled = !(canAct && isMyTurn && canRaise);

  let raiseDisplayAmount = null;
  if (bettingPanel && betSlider && betTargetLabel && betSliderTitle) {
    const show = Boolean(canAct && isMyTurn && h && state.phase !== "waiting" && state.phase !== "showdown");
    bettingPanel.hidden = !show;
    if (show) {
      const minV = Math.min(h.minRaiseBet, h.maxBet);
      const maxV = Math.max(h.minRaiseBet, h.maxBet);
      betSlider.min = String(minV);
      betSlider.max = String(maxV);
      let cur = Math.round(Number(betSlider.value));
      if (!Number.isFinite(cur) || cur < minV || cur > maxV) cur = minV;
      betSlider.value = String(cur);
      betTargetLabel.textContent = `$${formatChips(cur)}`;
      raiseDisplayAmount = cur;
      betSliderTitle.textContent = state.currentBet === 0 ? "Bet to" : "Raise to";
      betSlider.disabled = !canRaise;
      betPresets?.querySelectorAll("button").forEach((btn) => {
        btn.disabled = !canRaise;
      });
      if (betAmountInput) {
        betAmountInput.min = String(minV);
        betAmountInput.max = String(maxV);
        betAmountInput.disabled = !canRaise;
        betAmountInput.value = String(cur);
      }
      if (bettingHint) {
        if (!canRaise) {
          bettingHint.hidden = false;
          bettingHint.textContent = toCall > 0
            ? "A legal raise is not possible with your stack — use Call or Fold."
            : "You cannot open for the minimum bet — you can still Check if no one has bet.";
        } else {
          bettingHint.hidden = true;
        }
      }
    } else if (bettingHint) {
      bettingHint.hidden = true;
    }
  }

  if (canAct && isMyTurn && canRaise && raiseDisplayAmount != null) {
    raiseBtn.textContent = `${state.currentBet === 0 ? "Bet" : "Raise"} $${formatChips(raiseDisplayAmount)}`;
  } else {
    raiseBtn.textContent = state.currentBet === 0 ? "Bet" : "Raise";
  }
  newHandBtn.disabled = !(isHost && state.phase === "waiting");
  addBotBtn.disabled = !(isHost && state.phase === "waiting");
  removeBotBtn.disabled = !(isHost && state.phase === "waiting" && state.players.some((p) => p.isBot));
  forceEndBtn.disabled = !(isHost && state.phase !== "waiting" && state.phase !== "showdown");
  resetChipsBtn.disabled = !isHost;
  kickPlayerSelect.disabled = !isHost;
  kickPlayerBtn.disabled = !isHost || !kickPlayerSelect.value;
}

function updateKickDropdown(state) {
  const previous = kickPlayerSelect.value;
  kickPlayerSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Select player to kick";
  kickPlayerSelect.appendChild(defaultOption);

  const options = state.players
    .filter((p) => !p.isBot && p.id !== myId)
    .map((p) => ({ id: p.id, label: p.name }));

  options.forEach((opt) => {
    const el = document.createElement("option");
    el.value = opt.id;
    el.textContent = opt.label;
    kickPlayerSelect.appendChild(el);
  });

  if (options.some((o) => o.id === previous)) {
    kickPlayerSelect.value = previous;
  } else {
    kickPlayerSelect.value = "";
  }
}

function renderHeroHand(state) {
  heroHandEl.innerHTML = "";
  const mine = state.players.find((p) => p.id === myId);
  const cards = mine?.cards || [];
  const show = inRoom && mine && cards.length === 2 && state.phase !== "waiting";
  if (!show) {
    heroHandEl.hidden = true;
    return;
  }
  heroHandEl.hidden = false;
  cards.forEach((card, idx) => {
    heroHandEl.appendChild(renderCard(card, false, idx * 80));
  });
}

function renderState(state) {
  latestState = state;
  roomCodeEl.textContent = state.code || "-";
  potEl.textContent = formatChips(state.pot || 0);
  updateHeader(state);

  communityCardsEl.innerHTML = "";
  (state.board || []).forEach((card, i) => {
    communityCardsEl.appendChild(renderCard(card, false, i * 70));
  });

  playersContainer.innerHTML = "";
  (state.players || []).forEach((player, seatIndex) => {
    const seat = document.createElement("article");
    seat.className = "player-seat";
    if (player.id === state.currentTurn) seat.classList.add("active");
    if (player.folded) seat.classList.add("player-seat--folded");
    if (player.allIn && !player.folded) seat.classList.add("player-seat--allin");

    const head = document.createElement("div");
    head.className = "player-head";
    const leftWrap = document.createElement("div");
    leftWrap.className = "player-name-wrap";

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "player-avatar-wrap";
    const avatar = document.createElement("img");
    avatar.className = "player-avatar";
    avatar.src = player.avatar || defaultAvatar(player.name);
    avatar.alt = `${player.name} avatar`;
    avatarWrap.appendChild(avatar);
    appendRoleBadges(avatarWrap, state, seatIndex);

    const nameEl = document.createElement("h2");
    const who = player.isBot ? " · bot" : (player.id === myId ? " · you" : "");
    nameEl.textContent = `${player.name}${who}`;

    leftWrap.appendChild(avatarWrap);
    leftWrap.appendChild(nameEl);

    const stackEl = document.createElement("span");
    stackEl.className = "player-stack";
    stackEl.textContent = `$${formatChips(player.stack)}`;
    head.appendChild(leftWrap);
    head.appendChild(stackEl);
    seat.appendChild(head);

    const cardsRow = document.createElement("div");
    cardsRow.className = "cards-row";
    const cards = player.cards || [];
    const hideCards = cards.length === 0 && state.phase !== "waiting";
    const isMe = player.id === myId;
    const holeInHero = isMe && cards.length === 2 && !hideCards;

    if (hideCards) {
      cardsRow.appendChild(renderCard({ rank: "?", suit: "S" }, true));
      cardsRow.appendChild(renderCard({ rank: "?", suit: "S" }, true, 65));
    } else if (holeInHero) {
      cardsRow.classList.add("player-meta");
      cardsRow.textContent = "Your hole cards below";
    } else {
      cards.forEach((card, idx) => cardsRow.appendChild(renderCard(card, false, idx * 65)));
    }
    seat.appendChild(cardsRow);

    if (player.bet > 0) {
      const betPill = document.createElement("div");
      betPill.className = "player-bet-pill";
      betPill.textContent = `+ $${formatChips(player.bet)}`;
      seat.appendChild(betPill);
    }

    const tags = document.createElement("div");
    tags.className = "player-tags";
    if (player.folded) {
      const t = document.createElement("span");
      t.className = "player-tag player-tag--folded";
      t.textContent = "Folded";
      tags.appendChild(t);
    }
    if (player.allIn && !player.folded) {
      const t = document.createElement("span");
      t.className = "player-tag player-tag--allin";
      t.textContent = "All-in";
      tags.appendChild(t);
    }
    if (player.out) {
      const t = document.createElement("span");
      t.className = "player-tag player-tag--out";
      t.textContent = "Out";
      tags.appendChild(t);
    }
    if (tags.childElementCount) seat.appendChild(tags);

    const info = document.createElement("div");
    info.className = "player-meta";
    info.textContent = `W ${player.wins || 0} · H ${player.hands || 0}`;
    seat.appendChild(info);

    playersContainer.appendChild(seat);
  });

  renderHeroHand(state);
  pruneStaleStreamPeers(state);
  syncTableStreamSubscription(state);
  if (tableMediaStream) syncOutgoingStreamPeers(state);
  updateRemoteStreamLabels(state);
  updateKickDropdown(state);
  setActionEnabled(state, inRoom);
  maybeApplyAutomation(state);
  updateHostStreamPanel();
}

function getName() {
  const raw = (nameInput.value || "").trim();
  return raw || "Player";
}

function getPassword() {
  return String(passwordInput.value || "");
}

function validateAuthInputs() {
  const name = getName().trim();
  const password = getPassword();
  if (name.length < 2) {
    setStatus("Username must be at least 2 characters.");
    return false;
  }
  if (password.length < 6) {
    setStatus("Password must be at least 6 characters.");
    return false;
  }
  return true;
}

function requireAuth() {
  if (isAuthed) return true;
  setStatus("Please login or register first.");
  return false;
}

function stopWebcam() {
  if (!webcamStream) return;
  webcamStream.getTracks().forEach((t) => t.stop());
  webcamStream = null;
  webcamPreviewEl.srcObject = null;
  captureAvatarBtn.disabled = true;
}

startCameraBtn.addEventListener("click", async () => {
  try {
    stopWebcam();
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    webcamPreviewEl.srcObject = webcamStream;
    captureAvatarBtn.disabled = false;
    setStatus("Camera started. Click Capture Avatar.");
  } catch (err) {
    setStatus("Could not access webcam. Allow camera permission.");
  }
});

captureAvatarBtn.addEventListener("click", () => {
  if (!webcamStream) {
    setStatus("Start camera first.");
    return;
  }
  const ctx = webcamCanvasEl.getContext("2d");
  ctx.drawImage(webcamPreviewEl, 0, 0, webcamCanvasEl.width, webcamCanvasEl.height);
  avatarDataUrl = webcamCanvasEl.toDataURL("image/jpeg", 0.82);
  avatarPreviewEl.src = avatarDataUrl;
  saveAvatarBtn.disabled = !isAuthed;
  setStatus("Avatar captured. Click Save Avatar.");
});

saveAvatarBtn.addEventListener("click", () => {
  if (!isAuthed) {
    setStatus("Login first, then save avatar.");
    return;
  }
  if (!avatarDataUrl) {
    setStatus("Capture avatar first.");
    return;
  }
  socket.emit("set_avatar", { avatar: avatarDataUrl });
});

registerBtn.addEventListener("click", () => {
  if (!validateAuthInputs()) return;
  socket.emit("register", { name: getName(), password: getPassword() });
});

loginBtn.addEventListener("click", () => {
  if (!validateAuthInputs()) return;
  socket.emit("login", { name: getName(), password: getPassword() });
});

createRoomBtn.addEventListener("click", () => {
  if (!requireAuth()) return;
  socket.emit("create_room");
});

joinRoomBtn.addEventListener("click", () => {
  if (!requireAuth()) return;
  socket.emit("join_room", { code: roomInput.value.trim().toUpperCase() });
});

newHandBtn.addEventListener("click", () => socket.emit("start_hand"));
addBotBtn.addEventListener("click", () => socket.emit("add_bot"));
removeBotBtn.addEventListener("click", () => socket.emit("admin_remove_bot"));
forceEndBtn.addEventListener("click", () => socket.emit("admin_force_end_hand"));
resetChipsBtn.addEventListener("click", () => {
  if (!confirm("Reset all players and bots to 1000 chips?")) return;
  socket.emit("admin_reset_chips");
});
kickPlayerSelect.addEventListener("change", () => {
  kickPlayerBtn.disabled = !isHost || !kickPlayerSelect.value;
});
kickPlayerBtn.addEventListener("click", () => {
  if (!kickPlayerSelect.value) return;
  socket.emit("admin_kick_player", { targetId: kickPlayerSelect.value });
});
checkCallBtn.addEventListener("click", () => socket.emit("action", { type: "checkcall" }));
raiseBtn.addEventListener("click", () => {
  const st = latestState;
  if (!st) return;
  if (st.bettingHints && betSlider) {
    if (!st.bettingHints.canRaise) return;
    const minV = Math.round(Number(betSlider.min));
    const maxV = Math.round(Number(betSlider.max));
    const fromInput = betAmountInput ? Math.round(Number(betAmountInput.value)) : NaN;
    const fromSlider = Math.round(Number(betSlider.value));
    const raw = Number.isFinite(fromInput) ? fromInput : fromSlider;
    const v = clamp(raw, minV, maxV);
    socket.emit("action", { type: "raise", targetBet: v });
    return;
  }
  const mine = st.players.find((p) => p.id === myId);
  const toCall = mine ? Math.max(0, st.currentBet - mine.bet) : 0;
  const raiseAmt = st.raiseAmount ?? 20;
  if (!mine || mine.stack < toCall + raiseAmt) return;
  socket.emit("action", { type: "raise" });
});
foldBtn.addEventListener("click", () => socket.emit("action", { type: "fold" }));

function syncBetDisplayFromSlider() {
  if (!betSlider || !betTargetLabel) return;
  const minV = Math.round(Number(betSlider.min));
  const maxV = Math.round(Number(betSlider.max));
  const v = clamp(Math.round(Number(betSlider.value)), minV, maxV);
  betSlider.value = String(v);
  betTargetLabel.textContent = `$${formatChips(v)}`;
  if (betAmountInput) betAmountInput.value = String(v);
  if (latestState && latestState.currentTurn === myId) {
    const isBet = latestState.currentBet === 0;
    raiseBtn.textContent = `${isBet ? "Bet" : "Raise"} $${formatChips(v)}`;
  }
}

if (betSlider && betTargetLabel) {
  betSlider.addEventListener("input", syncBetDisplayFromSlider);
}

if (betAmountInput && betSlider) {
  betAmountInput.addEventListener("change", () => {
    const minV = Math.round(Number(betSlider.min));
    const maxV = Math.round(Number(betSlider.max));
    const v = clamp(Math.round(Number(betAmountInput.value)), minV, maxV);
    betSlider.value = String(v);
    syncBetDisplayFromSlider();
  });
  betAmountInput.addEventListener("input", () => {
    const minV = Math.round(Number(betSlider.min));
    const maxV = Math.round(Number(betSlider.max));
    const raw = Math.round(Number(betAmountInput.value));
    if (!Number.isFinite(raw)) return;
    const v = clamp(raw, minV, maxV);
    betSlider.value = String(v);
    betTargetLabel.textContent = `$${formatChips(v)}`;
    if (latestState && latestState.currentTurn === myId) {
      const isBet = latestState.currentBet === 0;
      raiseBtn.textContent = `${isBet ? "Bet" : "Raise"} $${formatChips(v)}`;
    }
  });
}

if (betPresets) {
  betPresets.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preset]");
    if (!btn || !betSlider || betSlider.disabled || !latestState) return;
    const t = presetTargetBet(latestState, btn.getAttribute("data-preset"));
    if (t == null) return;
    betSlider.value = String(t);
    syncBetDisplayFromSlider();
  });
}

if (autoActionSelect) {
  const stored = localStorage.getItem("holdem_auto_action");
  if (stored && autoActionSelect.querySelector(`option[value="${stored}"]`)) {
    autoActionSelect.value = stored;
  }
  autoActionSelect.addEventListener("change", () => {
    localStorage.setItem("holdem_auto_action", autoActionSelect.value);
    lastAutoFingerprint = "";
  });
}

if (hostTableStreamStartBtn) {
  hostTableStreamStartBtn.addEventListener("click", async () => {
    if (!inRoom) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: true,
      });
      tableMediaStream = stream;
      if (hostTableSelfPreview) {
        hostTableSelfPreview.srcObject = stream;
        hostTableSelfPreview.hidden = false;
      }
      hostTableStreamStartBtn.hidden = true;
      if (hostTableStreamStopBtn) hostTableStreamStopBtn.hidden = false;
      pendingViewerSubs.forEach((id) => {
        void ensureOutgoingPeer(id);
      });
      pendingViewerSubs.clear();
      if (latestState) syncOutgoingStreamPeers(latestState);
      setStatus("Kamera ja mikki päällä — muut pelaajat näkevät sinut Table Chat -paneelissa.");
    } catch (err) {
      setStatus(`Kameraa / mikkia ei voitu avata: ${err.message || err}`);
    }
  });
}

if (hostTableStreamStopBtn) {
  hostTableStreamStopBtn.addEventListener("click", () => {
    teardownHostTableBroadcast();
    socket.emit("table_stream_stop");
    setStatus("Oma videolähetys lopetettu.");
  });
}

socket.on("stream_subscriber", ({ viewerId }) => {
  if (!viewerId || viewerId === myId) return;
  if (tableMediaStream) void ensureOutgoingPeer(viewerId);
  else pendingViewerSubs.add(viewerId);
});

socket.on("webrtc_relay", ({ from, payload }) => {
  if (from === myId || !payload?.type) return;
  if (payload.type === "offer") {
    void receiverHandleWebRtcRelay(from, payload);
    return;
  }
  if (outPeerByViewerId.has(from)) {
    void broadcasterHandleWebRtcRelay(from, payload);
    return;
  }
  if (incomingPcByBroadcasterId.has(from)) {
    void receiverHandleWebRtcRelay(from, payload);
  }
});

socket.on("peer_stream_stopped", ({ broadcasterId }) => {
  if (!broadcasterId || broadcasterId === myId) return;
  teardownIncomingPeer(broadcasterId);
});

socket.on("connect", () => setConnectionBadge(true));
socket.on("disconnect", () => setConnectionBadge(false));

socket.on("auth_ok", ({ name, chips, wins, hands, avatar }) => {
  isAuthed = true;
  nameInput.value = name;
  nameInput.disabled = true;
  passwordInput.disabled = true;
  registerBtn.disabled = true;
  loginBtn.disabled = true;
  avatarDataUrl = avatar || "";
  avatarPreviewEl.src = avatarDataUrl || defaultAvatar(name);
  saveAvatarBtn.disabled = !avatarDataUrl;
  setStatus(`Logged in as ${name}. Chips $${chips} | W:${wins} H:${hands}`);
});

socket.on("room_joined", ({ code, playerId, host, hostId }) => {
  myId = playerId;
  isHost = Boolean(host);
  inRoom = true;
  roomHostId = hostId ?? null;
  tableStreamSubscribedKey = "";
  roomCodeEl.textContent = code;
  lobbyEl.style.display = "none";
  updateRoomChrome();
  setStatus(`Joined room ${code}. ${isHost ? "You are host." : ""}`);
});

socket.on("state", (state) => {
  renderState(state);
  if (state.message) setStatus(state.message);
});

socket.on("error_message", (msg) => {
  setStatus(msg);
});

socket.on("kicked_from_room", () => {
  if (turnDisplayInterval) {
    clearInterval(turnDisplayInterval);
    turnDisplayInterval = null;
  }
  inRoom = false;
  isHost = false;
  myId = null;
  latestState = null;
  resetHostStreamSessionFlags();
  teardownViewerHostStream();
  teardownHostTableBroadcast();
  roomCodeEl.textContent = "-";
  playersContainer.innerHTML = "";
  communityCardsEl.innerHTML = "";
  potEl.textContent = "0";
  potPhaseLabelEl.textContent = "Pot";
  lobbyEl.style.display = "";
  checkCallBtn.textContent = "Check / Call";
  raiseBtn.textContent = "Raise $20";
  heroHandEl.innerHTML = "";
  heroHandEl.hidden = true;
  updateRoomChrome();
  setStatus("You were removed from the room.");
});

socket.on("avatar_saved", ({ avatar }) => {
  avatarDataUrl = avatar || avatarDataUrl;
  avatarPreviewEl.src = avatarDataUrl || defaultAvatar(getName());
  setStatus("Avatar saved to profile.");
});

window.addEventListener("beforeunload", () => {
  if (turnDisplayInterval) {
    clearInterval(turnDisplayInterval);
    turnDisplayInterval = null;
  }
  stopWebcam();
  teardownHostTableBroadcast();
  teardownViewerHostStream();
});

avatarPreviewEl.src = defaultAvatar("?");
setConnectionBadge(socket.connected);
updateRoomChrome();

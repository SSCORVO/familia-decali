const code = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
if (!code) location.href = '/home.html';
document.getElementById('roomCode').textContent = code;

const members = new Map();
const peers = new Map();
const audioEls = new Map();
const screenTiles = new Map();
const volumes = new Map();
let selfId = null, localStream = null, screenStream = null;
let muted = false, deafened = false, pttMode = false, pttHeld = false;
let perms = {};
let socket = null;
const recentBubbles = new Map();

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderMembers() {
  const list = document.getElementById('memberList');
  list.innerHTML = '';
  document.getElementById('memberCount').textContent = members.size;
  members.forEach(m => {
    const li = document.createElement('li');
    li.className = 'member-item';
    li.style.cursor = 'pointer';
    li.onclick = (e) => openCtx(e, m);
    li.innerHTML = `
      <div class="avatar ${m.speaking ? 'speaking' : ''}" style="background:${m.color}">${initial(m.name)}</div>
      <div style="font-size:0.85rem">${escapeHtml(m.name)}${m.id===selfId?' (você)':''}
        ${m.sharing?'🖥️':''}${m.muted?'🔇':''}</div>`;
    list.appendChild(li);
  });
  renderTable();
  renderVolumes();
}

function renderTable() {
  const area = document.getElementById('tableArea');
  area.querySelectorAll('.seat').forEach(el => el.remove());
  const ids = Array.from(members.keys());
  const n = ids.length;
  if (!n) return;
  const radius = n <= 4 ? 38 : n <= 8 ? 40 : 42;
  ids.forEach((id, i) => {
    const m = members.get(id);
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const seat = document.createElement('div');
    seat.className = `seat ${m.speaking ? 'speaking' : ''}`;
    seat.style.left = (50 + radius * Math.cos(angle)) + '%';
    seat.style.top = (50 + radius * Math.sin(angle)) + '%';
    seat.style.cursor = 'pointer';
    seat.onclick = (e) => openCtx(e, m);
    const bubble = recentBubbles.get(id);
    seat.innerHTML = `
      ${bubble ? `<div class="bubble">${escapeHtml(bubble)}</div>` : ''}
      ${characterHTML(m.character, 48)}
      <div class="seat-name">${escapeHtml(m.name)}</div>
      <div class="seat-icons" style="font-size:0.7rem">${m.muted?'🔇':''}${m.sharing?'🖥️':''}${m.speaking?'💬':''}</div>
    `;
    area.appendChild(seat);
  });
}

function renderVolumes() {
  const box = document.getElementById('volumeList');
  box.innerHTML = '';
  members.forEach(m => {
    if (m.id === selfId) return;
    const vol = volumes.get(m.id) ?? 1;
    const row = document.createElement('div');
    row.className = 'volume-row';
    row.innerHTML = `<span style="width:70px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(m.name)}</span>
      <input type="range" min="0" max="1" step="0.05" value="${vol}" data-id="${m.id}" />`;
    row.querySelector('input').oninput = (e) => {
      const v = parseFloat(e.target.value);
      volumes.set(m.id, v);
      const a = audioEls.get(m.id);
      if (a) a.volume = deafened ? 0 : v;
    };
    box.appendChild(row);
  });
}

function addChat(msg) {
  const box = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="author" style="color:${msg.color}">${escapeHtml(msg.name)}</span>
    <span class="time">${formatTime(msg.time)}</span><div>${escapeHtml(msg.text)}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  // balão na mesa
  const mid = [...members.values()].find(m => m.userId === msg.userId || m.name === msg.name);
  if (mid) {
    recentBubbles.set(mid.id, msg.text.slice(0, 40));
    renderTable();
    setTimeout(() => {
      if (recentBubbles.get(mid.id) === msg.text.slice(0, 40)) {
        recentBubbles.delete(mid.id);
        renderTable();
      }
    }, 5000);
  }
}

function openCtx(e, m) {
  e.stopPropagation();
  const ctx = document.getElementById('ctx');
  ctx.classList.remove('hidden');
  ctx.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
  ctx.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
  let html = `<button onclick="mention('${escapeHtml(m.name)}')">@ Mencionar</button>`;
  if (m.id !== selfId && perms.moderate) {
    html += `<button onclick="modMute('${m.id}')">Silenciar mic</button>`;
    html += `<button onclick="modStopScreen('${m.id}')">Parar tela</button>`;
  }
  if (m.id !== selfId && perms.kick) {
    html += `<button onclick="modKick('${m.id}')">Expulsar da sala</button>`;
  }
  ctx.innerHTML = html;
}
document.addEventListener('click', () => document.getElementById('ctx').classList.add('hidden'));
window.mention = (name) => {
  const input = document.getElementById('chatInput');
  input.value += '@' + name + ' ';
  input.focus();
  document.getElementById('ctx').classList.add('hidden');
};
window.modMute = (id) => { socket.emit('mod-mute', { targetId: id }); document.getElementById('ctx').classList.add('hidden'); };
window.modKick = (id) => { socket.emit('mod-kick', { targetId: id }); document.getElementById('ctx').classList.add('hidden'); };
window.modStopScreen = (id) => { socket.emit('mod-stop-screen', { targetId: id }); document.getElementById('ctx').classList.add('hidden'); };

async function startMic() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }, video: false
    });
    if (pttMode) localStream.getAudioTracks().forEach(t => { t.enabled = false; });
    setupSpeaking(localStream);
    return true;
  } catch {
    showToast('Permita o microfone');
    return false;
  }
}

function setupSpeaking(stream) {
  try {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let last = false;
    const tick = () => {
      if (!localStream) return;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const speaking = !muted && (!pttMode || pttHeld) && sum / data.length > 18;
      if (speaking !== last) {
        last = speaking;
        socket.emit('speaking', speaking);
        if (selfId && members.has(selfId)) {
          members.get(selfId).speaking = speaking;
          renderMembers();
        }
      }
      requestAnimationFrame(tick);
    };
    tick();
  } catch (_) {}
}

function connectTo(remoteId, asInitiator) {
  if (peers.has(remoteId) || remoteId === selfId) return;
  const peer = new MediaPeer(asInitiator, localStream);
  peers.set(remoteId, peer);
  peer.onSignal = (data) => socket.emit('signal', { to: remoteId, data });
  peer.onTrack = (track, remoteStream) => onRemoteTrack(remoteId, track, remoteStream);
  peer.onClose = () => cleanupPeer(remoteId);
  if (screenStream && asInitiator) {
    screenStream.getTracks().forEach(t => peer.addTrack(t, screenStream));
  }
}

function onRemoteTrack(remoteId, track, remoteStream) {
  if (track.kind === 'audio') {
    let audio = audioEls.get(remoteId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      document.getElementById('audioContainer').appendChild(audio);
      audioEls.set(remoteId, audio);
    }
    audio.srcObject = remoteStream;
    audio.volume = deafened ? 0 : (volumes.get(remoteId) ?? 1);
    audio.play().catch(() => {});
  } else if (track.kind === 'video') {
    ensureScreenTile(remoteId, remoteStream);
  }
}

function ensureScreenTile(id, stream) {
  const grid = document.getElementById('screenGrid');
  grid.classList.remove('hidden');
  let tile = screenTiles.get(id);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'screen-tile';
    tile.id = 'screen-' + id;
    tile.innerHTML = `<video autoplay playsinline></video><div class="lbl"></div>`;
    grid.appendChild(tile);
    screenTiles.set(id, tile);
  }
  const m = members.get(id);
  tile.querySelector('.lbl').textContent = m ? m.name : 'Tela';
  const v = tile.querySelector('video');
  v.srcObject = stream;
  v.play().catch(() => {});
}

function removeScreenTile(id) {
  const tile = screenTiles.get(id);
  if (tile) { tile.remove(); screenTiles.delete(id); }
  if (screenTiles.size === 0) document.getElementById('screenGrid').classList.add('hidden');
}

function cleanupPeer(id) {
  const p = peers.get(id);
  if (p) { p.close(); peers.delete(id); }
  const a = audioEls.get(id);
  if (a) { a.srcObject = null; a.remove(); audioEls.delete(id); }
  removeScreenTile(id);
}

function qualityConstraints(q) {
  if (q === 'economy') return { frameRate: { ideal: 5, max: 8 }, width: { ideal: 854 } };
  if (q === 'high') return { frameRate: { ideal: 20, max: 30 }, width: { ideal: 1280 } };
  return { frameRate: { ideal: 12, max: 15 }, width: { ideal: 1280 } };
}

(async function init() {
  const user = await requireAuth();
  if (!user) return;

  socket = io({ auth: { token: getToken() }, reconnection: true, reconnectionAttempts: 15 });

  socket.on('connect_error', () => {
    showToast('Reconectando...');
  });
  socket.on('connect', () => {
    if (selfId) socket.emit('join-room', { code });
  });

  socket.emit('join-room', { code });

  socket.on('error-msg', (msg) => showToast(msg));
  socket.on('force-mute', () => {
    muted = true;
    if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = false; });
    document.getElementById('btnMute').classList.add('active');
    showToast('Você foi silenciado por um moderador');
  });
  socket.on('force-kick', ({ reason }) => {
    alert(reason || 'Removido da sala');
    leave();
  });
  socket.on('force-stop-screen', () => {
    if (screenStream) stopScreen();
    showToast('Transmissão encerrada por um moderador');
  });

  socket.on('joined', async (data) => {
    selfId = data.selfId;
    perms = data.perms || {};
    data.members.forEach(m => members.set(m.id, m));
    renderMembers();
    (data.messages || []).forEach(addChat);
    await startMic();
    members.forEach((_, mid) => {
      if (mid !== selfId) connectTo(mid, selfId < mid);
    });
    showToast('Sala ' + code);
  });

  socket.on('user-joined', (m) => {
    members.set(m.id, m);
    renderMembers();
    connectTo(m.id, selfId < m.id);
    showToast(m.name + ' entrou');
  });

  socket.on('user-left', ({ id }) => {
    const m = members.get(id);
    members.delete(id);
    cleanupPeer(id);
    renderMembers();
    if (m) showToast(m.name + ' saiu');
  });

  socket.on('user-update', ({ id, muted: mu, speaking }) => {
    const u = members.get(id);
    if (!u) return;
    if (typeof mu === 'boolean') u.muted = mu;
    if (typeof speaking === 'boolean') u.speaking = speaking;
    renderMembers();
  });

  socket.on('chat', addChat);

  socket.on('screen-start', ({ id, name }) => {
    if (members.has(id)) members.get(id).sharing = true;
    renderMembers();
    showToast(name + ' compartilhou a tela');
  });

  socket.on('screen-stop', ({ id }) => {
    if (members.has(id)) members.get(id).sharing = false;
    renderMembers();
    removeScreenTile(id);
  });

  socket.on('signal', async ({ from, data }) => {
    let peer = peers.get(from);
    if (!peer) {
      peer = new MediaPeer(false, localStream);
      peers.set(from, peer);
      peer.onSignal = (d) => socket.emit('signal', { to: from, data: d });
      peer.onTrack = (track, remoteStream) => onRemoteTrack(from, track, remoteStream);
      peer.onClose = () => cleanupPeer(from);
    }
    await peer.handleSignal(data);
  });

  // controls
  document.getElementById('btnMute').onclick = () => {
    muted = !muted;
    applyMicState();
    socket.emit('mute', muted);
    if (selfId && members.has(selfId)) {
      members.get(selfId).muted = muted;
      renderMembers();
    }
    document.getElementById('btnMute').classList.toggle('active', muted);
  };

  document.getElementById('btnDeafen').onclick = () => {
    deafened = !deafened;
    audioEls.forEach((a, id) => {
      a.volume = deafened ? 0 : (volumes.get(id) ?? 1);
    });
    document.getElementById('btnDeafen').classList.toggle('active', deafened);
  };

  document.getElementById('btnPTT').onclick = () => {
    pttMode = !pttMode;
    document.getElementById('btnPTT').classList.toggle('active-green', pttMode);
    showToast(pttMode ? 'Push-to-talk: segure Espaço' : 'PTT desligado');
    applyMicState();
  };

  function applyMicState() {
    if (!localStream) return;
    const on = !muted && (!pttMode || pttHeld);
    localStream.getAudioTracks().forEach(t => { t.enabled = on; });
  }

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !pttMode) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    if (!pttHeld) {
      pttHeld = true;
      applyMicState();
      document.getElementById('pttHint').classList.add('show');
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' || !pttMode) return;
    pttHeld = false;
    applyMicState();
    document.getElementById('pttHint').classList.remove('show');
  });

  document.getElementById('btnScreen').onclick = async () => {
    if (screenStream) return stopScreen();
    try {
      const q = document.getElementById('quality').value;
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: qualityConstraints(q),
        audio: false
      });
      screenStream.getVideoTracks()[0].onended = () => stopScreen();
      socket.emit('screen-start', { quality: q });
      if (selfId && members.has(selfId)) {
        members.get(selfId).sharing = true;
        renderMembers();
      }
      ensureScreenTile(selfId, screenStream);
      peers.forEach(peer => screenStream.getTracks().forEach(t => peer.addTrack(t, screenStream)));
      document.getElementById('btnScreen').classList.add('active-green');
      document.getElementById('btnScreen').querySelector('.ctrl-label').textContent = 'Parar';
    } catch {
      showToast('Cancelado');
    }
  };

  function stopScreen() {
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
    }
    socket.emit('screen-stop');
    if (selfId && members.has(selfId)) {
      members.get(selfId).sharing = false;
      renderMembers();
    }
    removeScreenTile(selfId);
    document.getElementById('btnScreen').classList.remove('active-green');
    document.getElementById('btnScreen').querySelector('.ctrl-label').textContent = 'Tela';
  }

  function leave() {
    if (screenStream) stopScreen();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    peers.forEach(p => p.close());
    socket.disconnect();
    location.href = '/home.html';
  }

  document.getElementById('btnLeave').onclick = leave;
  document.getElementById('btnLeave2').onclick = leave;
  document.getElementById('btnCopy').onclick = () => {
    navigator.clipboard.writeText(code).then(() => showToast('Código copiado'));
  };
  document.getElementById('chatForm').onsubmit = (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat', { text });
    input.value = '';
  };
})();

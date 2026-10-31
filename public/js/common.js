const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

function showToast(msg, ms = 3000) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function initial(name) {
  return (name || '?').charAt(0).toUpperCase();
}

const ACC_ICON = { none: '', hat: '🎩', glasses: '👓', headphones: '🎧', crown: '👑' };

function characterHTML(ch, size = 48) {
  if (!ch) return `<div class="seat-avatar" style="background:#5865f2;width:${size}px;height:${size}px">${initial('?')}</div>`;
  const s = size;
  return `<div style="width:${s}px;height:${s * 1.2}px;margin:0 auto;position:relative">
    <div style="width:${s * 0.7}px;height:${s * 0.85}px;background:${ch.clothes};border-radius:10px;margin:${s * 0.35}px auto 0;position:relative">
      <div style="width:${s * 0.55}px;height:${s * 0.22}px;background:${ch.hair};border-radius:12px 12px 0 0;position:absolute;top:-${s * 0.12}px;left:50%;transform:translateX(-50%)"></div>
      <div style="width:${s * 0.5}px;height:${s * 0.5}px;background:${ch.skin};border-radius:50%;position:absolute;top:-${s * 0.28}px;left:50%;transform:translateX(-50%);border:2px solid rgba(0,0,0,0.1)"></div>
      <div style="position:absolute;top:-${s * 0.42}px;left:50%;transform:translateX(-50%);font-size:${s * 0.28}px">${ACC_ICON[ch.accessory] || ''}</div>
    </div>
  </div>`;
}

class MediaPeer {
  constructor(isInitiator, localStream) {
    this.pc = new RTCPeerConnection(ICE_SERVERS);
    this.isInitiator = isInitiator;
    this.onSignal = null;
    this.onTrack = null;
    this.onClose = null;
    this._makingOffer = false;
    this._polite = !isInitiator;
    if (localStream) localStream.getTracks().forEach(t => this.pc.addTrack(t, localStream));
    this.pc.onicecandidate = (e) => {
      if (e.candidate && this.onSignal) this.onSignal({ type: 'candidate', candidate: e.candidate });
    };
    this.pc.ontrack = (e) => { if (this.onTrack) this.onTrack(e.track, e.streams[0]); };
    this.pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(this.pc.connectionState) && this.onClose) this.onClose();
    };
    if (isInitiator) this._makeOffer();
  }
  async _makeOffer() {
    try {
      this._makingOffer = true;
      await this.pc.setLocalDescription(await this.pc.createOffer());
      if (this.onSignal) this.onSignal({ type: 'offer', sdp: this.pc.localDescription });
    } catch (e) { console.error(e); }
    finally { this._makingOffer = false; }
  }
  async handleSignal(data) {
    try {
      if (data.type === 'offer') {
        if (!this._polite && (this._makingOffer || this.pc.signalingState !== 'stable')) return;
        await this.pc.setRemoteDescription(data.sdp);
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        if (this.onSignal) this.onSignal({ type: 'answer', sdp: this.pc.localDescription });
      } else if (data.type === 'answer') {
        await this.pc.setRemoteDescription(data.sdp);
      } else if (data.type === 'candidate' && data.candidate) {
        try { await this.pc.addIceCandidate(data.candidate); } catch (_) {}
      }
    } catch (e) { console.error(e); }
  }
  async addTrack(track, stream) {
    this.pc.addTrack(track, stream);
    try {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      if (this.onSignal) this.onSignal({ type: 'offer', sdp: this.pc.localDescription });
    } catch (e) { console.error(e); }
  }
  close() { this.pc.close(); }
}

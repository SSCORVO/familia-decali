const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 5e6 });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MAX_ROOM = 12;
const liveRooms = new Map(); // roomKey -> state

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const session = db.getSession(token);
  if (!session) return res.status(401).json({ error: 'Não autenticado.' });
  req.user = session.user;
  req.token = token;
  next();
}

// ----- Auth -----
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.findUserByUsername(username);
  if (!user || user.blocked || !db.verifyPassword(user, password)) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }
  const token = db.createSession(user.id);
  res.json({ token, user: db.publicUser(user) });
});

app.post('/api/logout', auth, (req, res) => {
  db.destroySession(req.token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: req.user, perms: db.perms(req.user.role) });
});

app.post('/api/account/password', auth, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Senha fraca.' });
    db.updatePassword(req.user.id, currentPassword, newPassword);
    const token = db.createSession(req.user.id);
    res.json({ ok: true, token, message: 'Senha alterada. Outras sessões encerradas.' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/account/profile', auth, (req, res) => {
  try {
    res.json({ user: db.updateProfile(req.user.id, { displayName: req.body.displayName }) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/account/character', auth, (req, res) => {
  try {
    res.json({ user: db.updateCharacter(req.user.id, req.body || {}) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/account/character/random', auth, (req, res) => {
  const ch = db.randomCharacter(req.user.displayName);
  res.json({ user: db.updateCharacter(req.user.id, ch) });
});

// ----- Invites -----
app.get('/api/invites/check/:code', (req, res) => {
  const inv = db.findInviteByCode(req.params.code);
  if (!inv) return res.status(404).json({ error: 'Convite não encontrado.' });
  res.json({
    code: inv.code, targetName: inv.targetName, role: inv.role,
    valid: db.isInviteValid(inv), expiresAt: inv.expiresAt,
    remainingUses: Math.max(0, inv.maxUses - inv.usesCount)
  });
});

app.post('/api/invites/redeem', (req, res) => {
  try {
    const { code, username, password, displayName } = req.body || {};
    if (!code || !username || !password) return res.status(400).json({ error: 'Dados incompletos.' });
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'Usuário inválido.' });
    const { user } = db.redeemInvite(code, { username, password, displayName });
    const token = db.createSession(user.id);
    res.json({ token, user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/invites', auth, (req, res) => {
  if (!db.perms(req.user.role).manageInvites) return res.status(403).json({ error: 'Sem permissão.' });
  res.json({ invites: db.getInvites() });
});

app.post('/api/invites', auth, (req, res) => {
  if (!db.perms(req.user.role).manageInvites) return res.status(403).json({ error: 'Sem permissão.' });
  const { targetName, role, maxUses, expiresInHours } = req.body || {};
  const invite = db.createInvite({
    createdBy: req.user.id, targetName,
    role: role || 'member', maxUses: maxUses || 1, expiresInHours: expiresInHours || 72
  });
  res.json({ invite });
});

app.post('/api/invites/:id/revoke', auth, (req, res) => {
  if (!db.perms(req.user.role).manageInvites) return res.status(403).json({ error: 'Sem permissão.' });
  try {
    res.json({ invite: db.revokeInvite(req.params.id, req.user.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ----- Groups / channels -----
app.get('/api/groups', auth, (req, res) => {
  res.json({ groups: db.listGroups(req.user.id) });
});

app.post('/api/groups', auth, (req, res) => {
  try {
    const result = db.createGroup(req.user, req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/groups/:id/join', auth, (req, res) => {
  try {
    res.json({ group: db.joinGroup(req.user.id, req.params.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/groups/:id/channels', auth, (req, res) => {
  try {
    res.json({ channel: db.createChannel(req.user, req.params.id, req.body.name) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/channels/:id/messages', auth, (req, res) => {
  res.json({ messages: db.getMessages(req.params.id, 80) });
});

app.post('/api/channels/:id/messages', auth, (req, res) => {
  if (!db.perms(req.user.role).chat) return res.status(403).json({ error: 'Sem permissão de chat.' });
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Mensagem vazia.' });
  const mentions = [];
  const re = /@(\w+)/g;
  let m;
  while ((m = re.exec(text))) mentions.push(m[1].toLowerCase());
  const msg = db.addMessage({
    channelId: req.params.id,
    userId: req.user.id,
    name: req.user.displayName,
    text,
    mentions
  });
  io.to('channel:' + req.params.id).emit('channel-message', msg);
  res.json({ message: msg });
});

app.delete('/api/messages/:id', auth, (req, res) => {
  try {
    const msg = db.deleteMessage(req.params.id, req.user);
    io.to('channel:' + msg.channelId).emit('message-deleted', { id: msg.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ----- Admin -----
app.get('/api/users', auth, (req, res) => {
  if (!db.perms(req.user.role).manageRoles && !db.perms(req.user.role).ban) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  res.json({ users: db.listUsers() });
});

app.post('/api/users/:id/role', auth, (req, res) => {
  try {
    res.json({ user: db.setRole(req.user, req.params.id, req.body.role) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/users/:id/ban', auth, (req, res) => {
  try {
    db.banUser(req.user, req.params.id, req.body.reason);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/audit', auth, (req, res) => {
  if (!db.perms(req.user.role).manageInvites) return res.status(403).json({ error: 'Sem permissão.' });
  res.json({ log: db.getAuditLog(80) });
});

app.post('/api/rooms/create', auth, (req, res) => {
  let code;
  do {
    code = '';
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (liveRooms.has(code));
  liveRooms.set(code, {
    users: new Map(),
    messages: [],
    screenSharers: new Set(),
    createdBy: req.user.id,
    createdAt: Date.now(),
    emptySince: null
  });
  res.json({ code });
});

// offline page fallback
app.get('/offline.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'offline.html'));
});

// ----- Socket -----
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const session = db.getSession(token);
  if (!session) return next(new Error('auth'));
  socket.user = session.user;
  next();
});

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentChannel = null;

  socket.on('subscribe-channel', ({ channelId }) => {
    if (currentChannel) socket.leave('channel:' + currentChannel);
    currentChannel = channelId;
    if (channelId) socket.join('channel:' + channelId);
  });

  socket.on('typing', ({ channelId, typing }) => {
    if (!channelId) return;
    socket.to('channel:' + channelId).emit('typing', {
      userId: socket.user.id,
      name: socket.user.displayName,
      typing: !!typing
    });
  });

  socket.on('join-room', ({ code }) => {
    code = (code || '').toUpperCase().trim();
    if (!liveRooms.has(code)) {
      liveRooms.set(code, {
        users: new Map(),
        messages: [],
        screenSharers: new Set(),
        createdBy: socket.user.id,
        createdAt: Date.now(),
        emptySince: null
      });
    }
    const room = liveRooms.get(code);
    room.emptySince = null;
    if (room.users.size >= MAX_ROOM) {
      socket.emit('error-msg', 'Sala cheia (máx. 12).');
      return;
    }
    currentRoom = code;
    const color = ['#5865F2','#57F287','#FEE75C','#EB459E','#ED4245','#F26522','#3BA55D','#FAA61A','#9B59B6','#1ABC9C','#E91E63','#00BCD4'][room.users.size % 12];
    const info = {
      id: socket.id,
      userId: socket.user.id,
      name: socket.user.displayName,
      role: socket.user.role,
      color,
      character: socket.user.character,
      muted: false,
      speaking: false,
      sharing: false,
      inCall: true
    };
    room.users.set(socket.id, info);
    socket.join(code);
    const members = [];
    room.users.forEach(u => members.push({ ...u }));
    socket.emit('joined', {
      code, selfId: socket.id, members,
      messages: room.messages.slice(-40),
      screenSharers: Array.from(room.screenSharers),
      user: socket.user,
      perms: db.perms(socket.user.role)
    });
    socket.to(code).emit('user-joined', info);
  });

  socket.on('chat', ({ text }) => {
    if (!currentRoom || !text) return;
    if (!db.perms(socket.user.role).chat) return;
    const room = liveRooms.get(currentRoom);
    if (!room) return;
    const u = room.users.get(socket.id);
    const msg = {
      id: uuidv4(),
      userId: socket.user.id,
      name: socket.user.displayName,
      color: u ? u.color : '#5865F2',
      text: String(text).slice(0, 500),
      time: Date.now()
    };
    room.messages.push(msg);
    if (room.messages.length > 80) room.messages.shift();
    io.to(currentRoom).emit('chat', msg);
  });

  socket.on('mute', (muted) => {
    if (!currentRoom) return;
    const room = liveRooms.get(currentRoom);
    if (!room || !room.users.has(socket.id)) return;
    room.users.get(socket.id).muted = !!muted;
    io.to(currentRoom).emit('user-update', { id: socket.id, muted: !!muted });
  });

  socket.on('speaking', (speaking) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('user-update', { id: socket.id, speaking: !!speaking });
  });

  socket.on('screen-start', ({ quality }) => {
    if (!currentRoom) return;
    if (!db.perms(socket.user.role).shareScreen) {
      socket.emit('error-msg', 'Sem permissão para compartilhar tela.');
      return;
    }
    const room = liveRooms.get(currentRoom);
    if (!room) return;
    // até 3 telas simultâneas
    if (room.screenSharers.size >= 3 && !room.screenSharers.has(socket.id)) {
      socket.emit('error-msg', 'Máximo de 3 telas ao mesmo tempo.');
      return;
    }
    room.screenSharers.add(socket.id);
    if (room.users.has(socket.id)) room.users.get(socket.id).sharing = true;
    io.to(currentRoom).emit('screen-start', {
      id: socket.id,
      name: socket.user.displayName,
      quality: quality || 'balanced'
    });
  });

  socket.on('screen-stop', () => {
    if (!currentRoom) return;
    const room = liveRooms.get(currentRoom);
    if (!room) return;
    room.screenSharers.delete(socket.id);
    if (room.users.has(socket.id)) room.users.get(socket.id).sharing = false;
    io.to(currentRoom).emit('screen-stop', { id: socket.id });
  });

  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // moderação na sala
  socket.on('mod-mute', ({ targetId }) => {
    if (!currentRoom || !db.perms(socket.user.role).moderate) return;
    io.to(targetId).emit('force-mute');
    io.to(currentRoom).emit('user-update', { id: targetId, muted: true });
    db.audit(socket.user.id, 'mod_mute', { targetId, room: currentRoom });
  });

  socket.on('mod-kick', ({ targetId }) => {
    if (!currentRoom || !db.perms(socket.user.role).kick) return;
    io.to(targetId).emit('force-kick', { reason: 'Removido da sala por um moderador.' });
    db.audit(socket.user.id, 'mod_kick', { targetId, room: currentRoom });
  });

  socket.on('mod-stop-screen', ({ targetId }) => {
    if (!currentRoom || !db.perms(socket.user.role).moderate) return;
    io.to(targetId).emit('force-stop-screen');
    db.audit(socket.user.id, 'mod_stop_screen', { targetId, room: currentRoom });
  });

  socket.on('disconnect', () => {
    if (currentChannel) socket.leave('channel:' + currentChannel);
    if (!currentRoom) return;
    const room = liveRooms.get(currentRoom);
    if (!room) return;
    room.users.delete(socket.id);
    room.screenSharers.delete(socket.id);
    io.to(currentRoom).emit('screen-stop', { id: socket.id });
    io.to(currentRoom).emit('user-left', { id: socket.id });
    if (room.users.size === 0) {
      room.emptySince = Date.now();
      // encerra após 60s sem ninguém
      setTimeout(() => {
        const r = liveRooms.get(currentRoom);
        if (r && r.users.size === 0 && r.emptySince && Date.now() - r.emptySince >= 55000) {
          liveRooms.delete(currentRoom);
        }
      }, 60000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Familia deCali FULL → http://localhost:' + PORT));

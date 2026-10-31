const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

const ROLES = ['owner', 'admin', 'moderator', 'member', 'guest'];
const ROLE_RANK = { owner: 100, admin: 80, moderator: 60, member: 40, guest: 20 };

const DEFAULT_PERMS = {
  owner: { manageInvites: true, manageRoles: true, manageGroups: true, moderate: true, kick: true, ban: true, createGroup: true, shareScreen: true, voice: true, chat: true },
  admin: { manageInvites: true, manageRoles: true, manageGroups: true, moderate: true, kick: true, ban: true, createGroup: true, shareScreen: true, voice: true, chat: true },
  moderator: { manageInvites: false, manageRoles: false, manageGroups: false, moderate: true, kick: true, ban: false, createGroup: true, shareScreen: true, voice: true, chat: true },
  member: { manageInvites: false, manageRoles: false, manageGroups: false, moderate: false, kick: false, ban: false, createGroup: true, shareScreen: true, voice: true, chat: true },
  guest: { manageInvites: false, manageRoles: false, manageGroups: false, moderate: false, kick: false, ban: false, createGroup: false, shareScreen: false, voice: true, chat: true }
};

const SKINS = ['#f5d0c5', '#e0ac69', '#c68642', '#8d5524', '#5c3317'];
const HAIRS = ['#1a1a1a', '#4a3728', '#c4a35a', '#e8e8e8', '#c0392b', '#2c3e50'];
const CLOTHES = ['#5865f2', '#23a559', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c', '#34495e'];
const ACCESSORIES = ['none', 'hat', 'glasses', 'headphones', 'crown'];

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function defaultStore() {
  return { users: [], invites: [], sessions: [], groups: [], channels: [], messages: [], bans: [], auditLog: [] };
}

function load() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) { console.error(e); }
  return defaultStore();
}

function save(store) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf8'); }
  catch (e) { console.error(e); }
}

let store = load();
['users','invites','sessions','groups','channels','messages','bans','auditLog'].forEach(k => {
  if (!store[k]) store[k] = [];
});

function randomCharacter(name) {
  return {
    displayName: name || 'Membro',
    skin: SKINS[Math.floor(Math.random() * SKINS.length)],
    hair: HAIRS[Math.floor(Math.random() * HAIRS.length)],
    clothes: CLOTHES[Math.floor(Math.random() * CLOTHES.length)],
    accessory: ACCESSORIES[Math.floor(Math.random() * ACCESSORIES.length)]
  };
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    character: u.character || randomCharacter(u.displayName),
    createdAt: u.createdAt,
    blocked: !!u.blocked
  };
}

function audit(actorId, action, detail) {
  store.auditLog.unshift({ id: uuidv4(), actorId, action, detail: detail || {}, at: Date.now() });
  if (store.auditLog.length > 200) store.auditLog.length = 200;
  save(store);
}

function generateCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < len; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function ensureOwner() {
  if (store.users.some(u => u.role === 'owner')) return;
  const password = process.env.OWNER_PASSWORD || 'decali2024';
  store.users.push({
    id: uuidv4(),
    username: 'dono',
    passwordHash: bcrypt.hashSync(password, 10),
    displayName: 'Dono',
    role: 'owner',
    createdAt: Date.now(),
    character: randomCharacter('Dono'),
    blocked: false
  });
  save(store);
  console.log('Dono criado: usuario=dono senha=decali2024');
}
ensureOwner();

const db = {
  ROLES, ROLE_RANK, DEFAULT_PERMS, SKINS, HAIRS, CLOTHES, ACCESSORIES, randomCharacter, publicUser, audit,

  perms(role) { return DEFAULT_PERMS[role] || DEFAULT_PERMS.guest; },
  rank(role) { return ROLE_RANK[role] || 0; },

  findUserByUsername(username) {
    return store.users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
  },
  findUserById(id) { return store.users.find(u => u.id === id); },

  createUser({ username, password, displayName, role }) {
    if (this.findUserByUsername(username)) throw new Error('Nome de usuário já existe.');
    if (!ROLES.includes(role)) role = 'member';
    const user = {
      id: uuidv4(),
      username: String(username).trim().toLowerCase().slice(0, 24),
      passwordHash: bcrypt.hashSync(password, 10),
      displayName: String(displayName || username).trim().slice(0, 32),
      role,
      createdAt: Date.now(),
      character: randomCharacter(displayName || username),
      blocked: false
    };
    store.users.push(user);
    save(store);
    return publicUser(user);
  },

  verifyPassword(user, password) { return bcrypt.compareSync(password, user.passwordHash); },

  updatePassword(userId, currentPassword, newPassword) {
    const user = this.findUserById(userId);
    if (!user) throw new Error('Usuário não encontrado.');
    if (!bcrypt.compareSync(currentPassword, user.passwordHash)) throw new Error('Senha atual incorreta.');
    user.passwordHash = bcrypt.hashSync(newPassword, 10);
    store.sessions = store.sessions.filter(s => s.userId !== userId);
    save(store);
  },

  updateProfile(userId, { displayName }) {
    const user = this.findUserById(userId);
    if (!user) throw new Error('Usuário não encontrado.');
    if (displayName) {
      user.displayName = String(displayName).trim().slice(0, 32);
      if (user.character) user.character.displayName = user.displayName;
    }
    save(store);
    return publicUser(user);
  },

  updateCharacter(userId, character) {
    const user = this.findUserById(userId);
    if (!user) throw new Error('Usuário não encontrado.');
    user.character = {
      displayName: user.displayName,
      skin: character.skin || SKINS[0],
      hair: character.hair || HAIRS[0],
      clothes: character.clothes || CLOTHES[0],
      accessory: character.accessory || 'none'
    };
    save(store);
    return publicUser(user);
  },

  setRole(actor, targetId, newRole) {
    if (!this.perms(actor.role).manageRoles) throw new Error('Sem permissão.');
    const target = this.findUserById(targetId);
    if (!target) throw new Error('Usuário não encontrado.');
    if (target.role === 'owner') throw new Error('Não é possível alterar o dono.');
    if (this.rank(actor.role) <= this.rank(target.role) && actor.role !== 'owner') throw new Error('Hierarquia insuficiente.');
    if (newRole === 'owner' || !ROLES.includes(newRole)) throw new Error('Cargo inválido.');
    target.role = newRole;
    save(store);
    audit(actor.id, 'set_role', { targetId, newRole });
    return publicUser(target);
  },

  banUser(actor, targetId, reason) {
    if (!this.perms(actor.role).ban) throw new Error('Sem permissão.');
    const target = this.findUserById(targetId);
    if (!target) throw new Error('Usuário não encontrado.');
    if (target.role === 'owner') throw new Error('Não pode banir o dono.');
    if (this.rank(actor.role) <= this.rank(target.role) && actor.role !== 'owner') throw new Error('Hierarquia insuficiente.');
    target.blocked = true;
    store.bans.push({ id: uuidv4(), userId: targetId, by: actor.id, reason: reason || '', at: Date.now(), lifted: false });
    store.sessions = store.sessions.filter(s => s.userId !== targetId);
    save(store);
    audit(actor.id, 'ban', { targetId, reason });
  },

  listUsers() { return store.users.map(publicUser); },

  createSession(userId) {
    const token = uuidv4() + '-' + uuidv4();
    store.sessions.push({ token, userId, createdAt: Date.now() });
    save(store);
    return token;
  },

  getSession(token) {
    if (!token) return null;
    const s = store.sessions.find(x => x.token === token);
    if (!s) return null;
    const user = this.findUserById(s.userId);
    if (!user || user.blocked) return null;
    return { token: s.token, user: publicUser(user) };
  },

  destroySession(token) {
    store.sessions = store.sessions.filter(s => s.token !== token);
    save(store);
  },

  createInvite({ createdBy, targetName, role, maxUses, expiresInHours }) {
    if (!ROLES.includes(role) || role === 'owner') role = 'member';
    const invite = {
      id: uuidv4(), code: generateCode(8), createdBy,
      targetName: (targetName || '').trim().slice(0, 40), role,
      maxUses: Math.max(1, Math.min(50, parseInt(maxUses, 10) || 1)),
      usesCount: 0, uses: [],
      expiresAt: expiresInHours ? Date.now() + Number(expiresInHours) * 3600000 : null,
      revoked: false, createdAt: Date.now()
    };
    store.invites.push(invite);
    save(store);
    return invite;
  },

  getInvites() {
    return store.invites.slice().sort((a, b) => b.createdAt - a.createdAt).map(inv => ({
      ...inv, valid: this.isInviteValid(inv)
    }));
  },

  findInviteByCode(code) {
    return store.invites.find(i => i.code === String(code).toUpperCase().trim());
  },

  isInviteValid(inv) {
    if (!inv || inv.revoked) return false;
    if (inv.expiresAt && Date.now() > inv.expiresAt) return false;
    if (inv.usesCount >= inv.maxUses) return false;
    return true;
  },

  revokeInvite(inviteId, byUserId) {
    const inv = store.invites.find(i => i.id === inviteId);
    if (!inv) throw new Error('Convite não encontrado.');
    inv.revoked = true;
    inv.revokedBy = byUserId;
    inv.revokedAt = Date.now();
    save(store);
    audit(byUserId, 'revoke_invite', { inviteId });
    return inv;
  },

  redeemInvite(code, { username, password, displayName }) {
    const inv = this.findInviteByCode(code);
    if (!inv) throw new Error('Convite inválido.');
    if (!this.isInviteValid(inv)) throw new Error('Convite expirado, esgotado ou revogado.');
    const user = this.createUser({
      username, password,
      displayName: displayName || inv.targetName || username,
      role: inv.role
    });
    inv.usesCount += 1;
    inv.uses.push({ userId: user.id, username: user.username, displayName: user.displayName, at: Date.now() });
    save(store);
    return { user, invite: inv };
  },

  createGroup(user, { name, capacity, isPrivate }) {
    if (!this.perms(user.role).createGroup) throw new Error('Sem permissão para criar grupo.');
    const cap = Math.max(2, Math.min(12, parseInt(capacity, 10) || 12));
    const group = {
      id: uuidv4(),
      name: String(name || 'Grupo').trim().slice(0, 40),
      capacity: cap,
      isPrivate: !!isPrivate,
      ownerId: user.id,
      members: [user.id],
      createdAt: Date.now()
    };
    store.groups.push(group);
    const general = { id: uuidv4(), groupId: group.id, name: 'geral', isPrivate: false, createdAt: Date.now() };
    store.channels.push(general);
    save(store);
    audit(user.id, 'create_group', { groupId: group.id, name: group.name });
    return { group, channel: general };
  },

  listGroups(userId) {
    return store.groups
      .filter(g => !g.isPrivate || g.members.includes(userId) || this.findUserById(userId)?.role === 'owner')
      .map(g => ({
        ...g,
        channels: store.channels.filter(c => c.groupId === g.id).map(c => ({ id: c.id, name: c.name, isPrivate: c.isPrivate }))
      }));
  },

  getGroup(id) { return store.groups.find(g => g.id === id); },

  joinGroup(userId, groupId) {
    const g = this.getGroup(groupId);
    if (!g) throw new Error('Grupo não encontrado.');
    if (g.members.includes(userId)) return g;
    if (g.members.length >= g.capacity) throw new Error('Grupo cheio.');
    g.members.push(userId);
    save(store);
    return g;
  },

  createChannel(user, groupId, name) {
    const g = this.getGroup(groupId);
    if (!g) throw new Error('Grupo não encontrado.');
    if (g.ownerId !== user.id && !this.perms(user.role).manageGroups) throw new Error('Sem permissão.');
    const ch = {
      id: uuidv4(),
      groupId,
      name: String(name || 'canal').trim().toLowerCase().slice(0, 24).replace(/\s+/g, '-'),
      isPrivate: false,
      createdAt: Date.now()
    };
    store.channels.push(ch);
    save(store);
    return ch;
  },

  getChannel(id) { return store.channels.find(c => c.id === id); },

  addMessage({ channelId, userId, name, text, mentions }) {
    const msg = {
      id: uuidv4(), channelId, userId, name,
      text: String(text).slice(0, 1000),
      mentions: mentions || [],
      createdAt: Date.now(),
      deleted: false
    };
    store.messages.push(msg);
    const chMsgs = store.messages.filter(m => m.channelId === channelId && !m.deleted);
    if (chMsgs.length > 300) {
      let removed = 0;
      const excess = chMsgs.length - 300;
      store.messages = store.messages.filter(m => {
        if (m.channelId === channelId && !m.deleted && removed < excess) { removed++; return false; }
        return true;
      });
    }
    save(store);
    return msg;
  },

  getMessages(channelId, limit = 50) {
    return store.messages.filter(m => m.channelId === channelId && !m.deleted).slice(-limit);
  },

  deleteMessage(msgId, user) {
    const msg = store.messages.find(m => m.id === msgId);
    if (!msg) throw new Error('Mensagem não encontrada.');
    if (msg.userId !== user.id && !this.perms(user.role).moderate) throw new Error('Sem permissão.');
    msg.deleted = true;
    save(store);
    return msg;
  },

  getAuditLog(limit = 50) { return store.auditLog.slice(0, limit); }
};

module.exports = db;

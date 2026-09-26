// Tax Dodge: The Incidence Duel
// Two-player classroom game on tax incidence and elasticity
// Created by Dr. Sarabjeet Bedi
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const TEACHER_CODE = (process.env.TEACHER_CODE || 'bedi2302').toLowerCase();

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/teacher', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher.html')));
app.get('/healthz', (req, res) => res.send('ok'));
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 20000, pingTimeout: 30000 });

// ---------------- Economics ----------------
const P0 = 10, Q0 = 100; // pre-tax equilibrium: $10, 100 units

const PROFILES = {
  buyer: [
    { key: 'A', name: 'Must-Have Buyer', e: 0.25, start: 600, desc: 'Few substitutes. You keep buying almost no matter the price.' },
    { key: 'B', name: 'Habit Buyer', e: 0.75, start: 555, desc: 'Some substitutes, but switching is a hassle.' },
    { key: 'C', name: 'Comparison Shopper', e: 1.5, start: 510, desc: 'Good substitutes. You shop around and cut back when price rises.' },
    { key: 'D', name: 'Walk-Away Buyer', e: 3.0, start: 470, desc: 'Many close substitutes. You drop this good fast if price rises.' }
  ],
  seller: [
    { key: 'A', name: 'Fixed Plant', e: 0.25, start: 600, desc: 'Output is locked in. Your inputs have no other use.' },
    { key: 'B', name: 'Steady Producer', e: 0.75, start: 555, desc: 'Some flexibility, but changing output is slow.' },
    { key: 'C', name: 'Flexible Producer', e: 1.5, start: 510, desc: 'You can shift inputs to other products fairly easily.' },
    { key: 'D', name: 'Pivot-Anytime Producer', e: 3.0, start: 470, desc: 'Inputs move to other markets almost instantly.' }
  ]
};

const ROUNDS = [
  { name: 'Coffee Shop Lattes', tax: 1 },
  { name: 'Gasoline', tax: 4 },
  { name: 'Concert Tickets', tax: 2 },
  { name: 'Energy Drinks', tax: 6 },
  { name: 'Rideshare Trips', tax: 3 }
];

const r2 = x => Math.round(x * 100) / 100;

function computeRound(bi, si, t) {
  const Ed = PROFILES.buyer[bi].e, Es = PROFILES.seller[si].e;
  const buyerShare = Es / (Es + Ed);
  const dPb = t * buyerShare;          // rise in price buyers pay
  const dPs = t - dPb;                 // fall in price sellers keep
  const Q1 = Q0 - (Ed * Q0 / P0) * dPb; // new quantity (linear curves)
  const revenue = t * Q1;
  const dwl = 0.5 * t * (Q0 - Q1);
  const buyerTax = dPb * Q1, sellerTax = dPs * Q1;
  const buyerDWL = 0.5 * dPb * (Q0 - Q1), sellerDWL = 0.5 * dPs * (Q0 - Q1);
  const buyerLoss = buyerTax + buyerDWL, sellerLoss = sellerTax + sellerDWL;
  const buyerStart = PROFILES.buyer[bi].start, sellerStart = PROFILES.seller[si].start;
  return {
    Ed, Es, t, P0, Q0,
    buyerShare: r2(buyerShare * 100), sellerShare: r2((1 - buyerShare) * 100),
    Pb: r2(P0 + dPb), Ps: r2(P0 - dPs), Q1: r2(Q1),
    revenue: r2(revenue), dwl: r2(dwl),
    buyerTax: r2(buyerTax), sellerTax: r2(sellerTax),
    buyerDWL: r2(buyerDWL), sellerDWL: r2(sellerDWL),
    buyerLoss: r2(buyerLoss), sellerLoss: r2(sellerLoss),
    buyerStart, sellerStart,
    buyerPoints: Math.round(buyerStart - buyerLoss),
    sellerPoints: Math.round(sellerStart - sellerLoss)
  };
}

// ---------------- Rooms ----------------
const rooms = {};
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join(''); } while (rooms[c]);
  return c;
}
const other = role => (role === 'buyer' ? 'seller' : 'buyer');
const cleanName = n => String(n || '').replace(/[<>]/g, '').trim().slice(0, 20) || 'Player';

function makeRoom() {
  const code = newCode();
  rooms[code] = {
    code, created: Date.now(), lastActive: Date.now(),
    members: {},           // playerId -> { name, role, socketId, connected }
    roles: { buyer: null, seller: null }, // playerId or 'BOT'
    phase: 'lobby', round: 0,
    choices: { buyer: null, seller: null },
    ready: { buyer: false, seller: false },
    history: [], scores: { buyer: 0, seller: 0 }
  };
  return rooms[code];
}

function roleName(room, role) {
  const id = room.roles[role];
  if (!id) return null;
  if (id === 'BOT') return 'Computer';
  return room.members[id] ? room.members[id].name : null;
}

function publicState(room, forId) {
  const me = room.members[forId];
  const myRole = me ? me.role : null;
  const choices = {};
  ['buyer', 'seller'].forEach(r => {
    if (room.phase === 'choose') choices[r] = r === myRole ? room.choices[r] : null;
    else choices[r] = room.choices[r];
  });
  return {
    code: room.code, phase: room.phase, round: room.round, totalRounds: ROUNDS.length,
    scenario: room.round >= 1 && room.round <= ROUNDS.length ? ROUNDS[room.round - 1] : null,
    rounds: ROUNDS,
    me: me ? { name: me.name, role: myRole } : null,
    names: { buyer: roleName(room, 'buyer'), seller: roleName(room, 'seller') },
    connected: {
      buyer: room.roles.buyer === 'BOT' ? true : !!(room.roles.buyer && room.members[room.roles.buyer] && room.members[room.roles.buyer].connected),
      seller: room.roles.seller === 'BOT' ? true : !!(room.roles.seller && room.members[room.roles.seller] && room.members[room.roles.seller].connected)
    },
    memberCount: Object.keys(room.members).length,
    hasBot: room.roles.buyer === 'BOT' || room.roles.seller === 'BOT',
    locked: { buyer: room.choices.buyer !== null, seller: room.choices.seller !== null },
    choices,
    ready: room.ready,
    history: room.history,
    scores: room.scores,
    profiles: PROFILES
  };
}

function broadcast(room) {
  room.lastActive = Date.now();
  Object.entries(room.members).forEach(([pid, m]) => {
    if (m.connected && m.socketId) io.to(m.socketId).emit('state', publicState(room, pid));
  });
  scheduleTeacherUpdate();
}

// ---------------- Bot ----------------
function botChoice(room, botRole) {
  const human = other(botRole);
  const last = room.history.length ? room.history[room.history.length - 1] : null;
  if (!last || Math.random() < 0.25) return 1 + Math.floor(Math.random() * 2); // B or C
  const oppIdx = human === 'buyer' ? last.buyerChoice : last.sellerChoice;
  const t = ROUNDS[room.round - 1].tax;
  let best = 0, bestVal = -Infinity;
  for (let i = 0; i < 4; i++) {
    const res = botRole === 'buyer' ? computeRound(i, oppIdx, t) : computeRound(oppIdx, i, t);
    const val = botRole === 'buyer' ? res.buyerPoints : res.sellerPoints;
    if (val > bestVal) { bestVal = val; best = i; }
  }
  return best;
}

function startRound(room) {
  room.phase = 'choose';
  room.choices = { buyer: null, seller: null };
  room.ready = { buyer: false, seller: false };
  ['buyer', 'seller'].forEach(r => { if (room.roles[r] === 'BOT') room.choices[r] = botChoice(room, r); });
}

function maybeResolve(room) {
  if (room.phase !== 'choose') return;
  if (room.choices.buyer === null || room.choices.seller === null) return;
  const sc = ROUNDS[room.round - 1];
  const res = computeRound(room.choices.buyer, room.choices.seller, sc.tax);
  room.history.push({ round: room.round, scenario: sc.name, buyerChoice: room.choices.buyer, sellerChoice: room.choices.seller, result: res });
  room.scores.buyer += res.buyerPoints;
  room.scores.seller += res.sellerPoints;
  room.phase = 'reveal';
  room.ready = { buyer: room.roles.buyer === 'BOT', seller: room.roles.seller === 'BOT' };
}

function maybeAdvance(room) {
  if (room.phase !== 'reveal' || !room.ready.buyer || !room.ready.seller) return;
  if (room.round >= ROUNDS.length) { room.phase = 'done'; return; }
  room.round += 1;
  startRound(room);
}

// ---------------- Teacher summary ----------------
function teacherSummary() {
  const list = Object.values(rooms).map(room => ({
    code: room.code, phase: room.phase, round: room.round,
    buyer: roleName(room, 'buyer'), seller: roleName(room, 'seller'),
    hasBot: room.roles.buyer === 'BOT' || room.roles.seller === 'BOT',
    connected: {
      buyer: room.roles.buyer === 'BOT' || !!(room.roles.buyer && room.members[room.roles.buyer] && room.members[room.roles.buyer].connected),
      seller: room.roles.seller === 'BOT' || !!(room.roles.seller && room.members[room.roles.seller] && room.members[room.roles.seller].connected)
    },
    scores: room.scores,
    history: room.history.map(h => ({ round: h.round, b: h.buyerChoice, s: h.sellerChoice, bp: h.result.buyerPoints, sp: h.result.sellerPoints, bs: h.result.buyerShare, dwl: h.result.dwl })),
    created: room.created
  })).sort((a, b) => a.created - b.created);
  return { rooms: list, rounds: ROUNDS, profiles: PROFILES };
}
let teacherTimer = null;
function scheduleTeacherUpdate() {
  if (teacherTimer) return;
  teacherTimer = setTimeout(() => { teacherTimer = null; io.to('teachers').emit('summary', teacherSummary()); }, 400);
}

// ---------------- Sockets ----------------
function attach(socket, room, pid) {
  socket.data.room = room.code; socket.data.pid = pid;
  socket.join(room.code);
}

io.on('connection', socket => {
  const err = msg => socket.emit('err', msg);
  const ctx = () => {
    const room = rooms[socket.data.room];
    if (!room) return {};
    return { room, pid: socket.data.pid, me: room.members[socket.data.pid] };
  };

  socket.on('create', ({ name, playerId }) => {
    if (!playerId) return err('Missing player id. Refresh the page.');
    const room = makeRoom();
    room.members[playerId] = { name: cleanName(name), role: null, socketId: socket.id, connected: true };
    attach(socket, room, playerId);
    broadcast(room);
  });

  socket.on('join', ({ code, name, playerId }) => {
    code = String(code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) return err('No game found with code ' + code + '. Check the code and try again.');
    if (!room.members[playerId]) {
      const humans = Object.keys(room.members).length;
      if (humans >= 2 || (humans >= 1 && (room.roles.buyer === 'BOT' || room.roles.seller === 'BOT'))) return err('Game ' + code + ' is already full.');
      room.members[playerId] = { name: cleanName(name), role: null, socketId: socket.id, connected: true };
    } else {
      Object.assign(room.members[playerId], { socketId: socket.id, connected: true });
    }
    attach(socket, room, playerId);
    broadcast(room);
  });

  socket.on('rejoin', ({ code, playerId }) => {
    const room = rooms[String(code || '').toUpperCase()];
    if (!room || !room.members[playerId]) return socket.emit('rejoinFailed');
    Object.assign(room.members[playerId], { socketId: socket.id, connected: true });
    attach(socket, room, playerId);
    broadcast(room);
  });

  socket.on('claimRole', ({ role }) => {
    const { room, pid, me } = ctx();
    if (!room || !me || room.phase !== 'lobby') return;
    if (role !== 'buyer' && role !== 'seller') return;
    if (room.roles[role] && room.roles[role] !== pid) return err('That role is already taken.');
    if (me.role) room.roles[me.role] = null;
    me.role = role; room.roles[role] = pid;
    broadcast(room);
  });

  socket.on('addBot', () => {
    const { room, me } = ctx();
    if (!room || !me || room.phase !== 'lobby') return;
    if (Object.keys(room.members).length > 1) return err('A classmate already joined this game.');
    if (!me.role) return err('Pick your role first.');
    room.roles[other(me.role)] = 'BOT';
    broadcast(room);
  });

  socket.on('removeBot', () => {
    const { room } = ctx();
    if (!room || room.phase !== 'lobby') return;
    ['buyer', 'seller'].forEach(r => { if (room.roles[r] === 'BOT') room.roles[r] = null; });
    broadcast(room);
  });

  socket.on('start', () => {
    const { room, me } = ctx();
    if (!room || !me || room.phase !== 'lobby') return;
    if (!room.roles.buyer || !room.roles.seller) return err('Both roles must be filled before starting.');
    room.round = 1;
    startRound(room);
    broadcast(room);
  });

  socket.on('choose', ({ idx }) => {
    const { room, me } = ctx();
    if (!room || !me || !me.role || room.phase !== 'choose') return;
    if (room.choices[me.role] !== null) return; // already locked
    idx = Number(idx);
    if (!(idx >= 0 && idx <= 3)) return;
    room.choices[me.role] = idx;
    maybeResolve(room);
    broadcast(room);
  });

  socket.on('ready', () => {
    const { room, me } = ctx();
    if (!room || !me || !me.role || room.phase !== 'reveal') return;
    room.ready[me.role] = true;
    maybeAdvance(room);
    broadcast(room);
  });

  socket.on('leave', () => {
    const { room, pid, me } = ctx();
    if (!room || !me) return;
    if (room.phase === 'lobby') {
      if (me.role) room.roles[me.role] = null;
      delete room.members[pid];
      if (!Object.keys(room.members).length) delete rooms[room.code];
      else broadcast(room);
    } else {
      me.connected = false; broadcast(room);
    }
    socket.leave(room.code); socket.data.room = null;
    scheduleTeacherUpdate();
  });

  socket.on('disconnect', () => {
    const { room, me } = ctx();
    if (room && me && me.socketId === socket.id) { me.connected = false; broadcast(room); }
  });

  // Teacher
  socket.on('teacherJoin', ({ code }) => {
    if (String(code || '').toLowerCase().trim() !== TEACHER_CODE) return socket.emit('teacherDenied');
    socket.join('teachers'); socket.data.teacher = true;
    socket.emit('teacherOk'); socket.emit('summary', teacherSummary());
  });
  socket.on('teacherClear', ({ mode }) => {
    if (!socket.data.teacher) return;
    Object.values(rooms).forEach(room => {
      if (mode === 'all' || room.phase === 'done') {
        io.to(room.code).emit('roomClosed');
        delete rooms[room.code];
      }
    });
    scheduleTeacherUpdate();
  });
});

// Remove rooms idle > 4 hours
setInterval(() => {
  const cutoff = Date.now() - 4 * 3600 * 1000;
  Object.values(rooms).forEach(r => { if (r.lastActive < cutoff) delete rooms[r.code]; });
  scheduleTeacherUpdate();
}, 10 * 60 * 1000);

if (require.main === module) {
  server.listen(PORT, () => console.log('Tax Dodge running on port ' + PORT));
}
module.exports = { computeRound, PROFILES, ROUNDS, server, io, rooms };

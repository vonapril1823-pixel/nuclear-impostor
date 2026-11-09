#!/usr/bin/env node
/*
 * Nuclear Impostor: LAN / hotspot game server.
 *
 *   node server.js [port]        (default port 3000, or set PORT)
 *
 * What it does
 *   1. Serves the game (index.html + vendor/ + icons/) so friends just open
 *      http://<this-device-ip>:3000 in their browser, no internet needed.
 *   2. Relays multiplayer messages over WebSocket (/ws). The host's browser is
 *      the authority; this server only forwards messages between the host and
 *      the players in a room. No game logic lives here.
 *
 * Zero dependencies. Needs Node 16+ (works in Termux on Android too).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || Number(process.argv[2]) || 3000;
const ROOT = __dirname;
const VERSION = require('./package.json').version;
const MAX_FRAME = 64 * 1024; // largest message we accept
const MAX_PEERS = 9; // host + 9 = 10 players (the Impostor is always a bot)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
// Only these paths are ever served (never server.js, package.json, ...).
const PUBLIC = /^(index\.html|manifest\.webmanifest|sw\.js|faces\.js|favicon\.ico|(vendor|icons)\/[\w.-]+)$/;

function lanAddresses() {
  const out = [];
  let ifs = {};
  try {
    ifs = os.networkInterfaces();
  } catch (_) {
    // Some Android/Termux builds throw here; fall back to `ip`.
    try {
      const txt = require('child_process').execSync('ip -4 -o addr show', { encoding: 'utf8', timeout: 2000 });
      for (const l of txt.split('\n')) {
        const m = l.match(/^\d+:\s+(\S+)\s+inet\s+([\d.]+)/);
        if (m && m[1] !== 'lo') out.push({ ip: m[2], port: PORT, iface: m[1] });
      }
    } catch (_2) {}
    return out;
  }
  for (const [name, list] of Object.entries(ifs)) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push({ ip: i.address, port: PORT, iface: name });
    }
  }
  return out;
}

/* ------------------------------ HTTP ------------------------------ */
const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (_) {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (pathname === '/api/info') {
    const body = JSON.stringify({ kind: 'nuclear-impostor', version: VERSION, port: PORT, ips: lanAddresses(), rooms: rooms.size });
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }).end(body);
    return;
  }
  const rel = pathname.replace(/^\/+/, '') || 'index.html';
  if (!PUBLIC.test(rel)) {
    res.writeHead(404, { 'Content-Type': MIME['.txt'] }).end('Not found');
    return;
  }
  const file = path.join(ROOT, rel);
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': MIME['.txt'] }).end('Not found');
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': rel === 'index.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

/* ------------------- minimal RFC 6455 WebSocket ------------------- */
function frame(op, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | op;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | op;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

class Conn {
  constructor(sock) {
    this.sock = sock;
    this.room = null;
    this.id = null;
    this.isHost = false;
    this.alive = true;
    this.closed = false;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragOp = 0;
    this.count = 0; // crude flood guard
    sock.setNoDelay(true);
    sock.on('data', (d) => this.onData(d));
    sock.on('close', () => this.onClose());
    sock.on('error', () => this.onClose());
    this.flood = setInterval(() => (this.count = 0), 1000);
    this.ping = setInterval(() => {
      if (!this.alive) return this.destroy();
      this.alive = false;
      this.raw(frame(0x9, Buffer.alloc(0)));
    }, 15000);
  }
  raw(buf) {
    if (!this.closed && this.sock.writable) this.sock.write(buf);
  }
  send(obj) {
    this.raw(frame(0x1, Buffer.from(JSON.stringify(obj), 'utf8')));
  }
  destroy() {
    try {
      this.sock.destroy();
    } catch (_) {}
    this.onClose();
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (this.buf.length > MAX_FRAME * 2) return this.destroy();
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 0x80);
      const op = b[0] & 0x0f;
      const masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(MAX_FRAME)) return this.destroy();
        len = Number(big);
        off = 10;
      }
      if (len > MAX_FRAME || !masked) return this.destroy(); // clients must mask
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op === 0x8) {
        this.raw(frame(0x8, Buffer.alloc(0)));
        return this.destroy();
      }
      if (op === 0x9) {
        this.raw(frame(0xa, data));
        continue;
      }
      if (op === 0xa) {
        this.alive = true;
        continue;
      }
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        if (op !== 0x0) {
          this.fragOp = op;
          this.frags = [data];
        } else this.frags.push(data);
        if (fin) {
          const msg = Buffer.concat(this.frags);
          this.frags = [];
          if (this.fragOp === 0x1 && ++this.count <= 400) {
            let obj = null;
            try {
              obj = JSON.parse(msg.toString('utf8'));
            } catch (_) {}
            if (obj && typeof obj === 'object') handle(this, obj);
          }
        }
      }
    }
  }
  onClose() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.flood);
    clearInterval(this.ping);
    leave(this);
  }
}

server.on('upgrade', (req, sock) => {
  const url = (req.url || '').split('?')[0];
  const key = req.headers['sec-websocket-key'];
  if (url !== '/ws' || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key) {
    sock.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  new Conn(sock);
});

/* ---------------------------- rooms / relay ---------------------------- */
const rooms = new Map(); // code -> { code, host: Conn, hostName, peers: Map<id, Conn>, locked }
let nextId = 1;

const clean = (s, n) => String(s == null ? '' : s).replace(/[<>&"'`]/g, '').trim().slice(0, n);
function newCode() {
  for (let k = 0; k < 200; k++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function handle(c, m) {
  switch (m.op) {
    case 'host': {
      if (c.room) return;
      const code = newCode();
      if (!code) return c.send({ ev: 'err', msg: 'Server is full.' });
      const room = { code, host: c, hostName: clean(m.name, 12) || 'Host', peers: new Map(), locked: false };
      rooms.set(code, room);
      c.room = room;
      c.isHost = true;
      c.send({ ev: 'hosted', code });
      log(`room ${code} opened by ${room.hostName}`);
      break;
    }
    case 'rooms': {
      const list = [];
      for (const r of rooms.values()) if (!r.locked && r.peers.size < MAX_PEERS) list.push({ code: r.code, host: r.hostName, n: r.peers.size + 1 });
      c.send({ ev: 'rooms', list });
      break;
    }
    case 'join': {
      if (c.room) return;
      const room = rooms.get(String(m.code || '').toUpperCase());
      if (!room) return c.send({ ev: 'err', msg: 'No lobby with that code.' });
      if (room.locked) return c.send({ ev: 'err', msg: 'That game has already started.' });
      if (room.peers.size >= MAX_PEERS) return c.send({ ev: 'err', msg: 'That lobby is full.' });
      c.id = nextId++;
      c.room = room;
      room.peers.set(c.id, c);
      c.send({ ev: 'joined', code: room.code, id: c.id });
      room.host.send({ ev: 'peer', id: c.id });
      break;
    }
    case 'lock': {
      if (c.isHost && c.room) {
        c.room.locked = true;
        log(`room ${c.room.code} started with ${c.room.peers.size + 1} player(s)`);
      }
      break;
    }
    case 'to': {
      // host -> one player
      if (!c.isHost || !c.room || typeof m.d !== 'string' || m.d.length > 16384) return;
      const p = c.room.peers.get(m.id);
      if (p) p.send({ ev: 'msg', d: m.d });
      break;
    }
    case 'up': {
      // player -> host
      if (c.isHost || !c.room || typeof m.d !== 'string' || m.d.length > 16384) return;
      c.room.host.send({ ev: 'msg', id: c.id, d: m.d });
      break;
    }
  }
}

function leave(c) {
  const room = c.room;
  if (!room) return;
  c.room = null;
  if (c.isHost) {
    rooms.delete(room.code);
    for (const p of room.peers.values()) {
      p.room = null;
      p.send({ ev: 'closed' });
      try {
        p.sock.end();
      } catch (_) {}
    }
    log(`room ${room.code} closed`);
  } else {
    room.peers.delete(c.id);
    if (!room.host.closed) room.host.send({ ev: 'leave', id: c.id });
  }
}

function log(s) {
  if (!process.env.QUIET) console.log(new Date().toLocaleTimeString() + '  ' + s);
}

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n  ☢  Nuclear Impostor server v' + VERSION);
    console.log('  Everyone must be on the same Wi-Fi or hotspot. Open one of these on every phone:\n');
    const ips = lanAddresses();
    if (!ips.length) console.log('    (no network found; connect to a Wi-Fi/hotspot first)  http://localhost:' + PORT);
    for (const a of ips) console.log('    http://' + a.ip + ':' + a.port + '   (' + a.iface + ')');
    console.log('\n  Then one player taps Host and the others tap Join. Ctrl+C to stop.\n');
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is busy. Try: PORT=3001 node server.js` : e);
    process.exit(1);
  });
}
module.exports = { server, rooms };

// Smoke test for the LAN relay. Needs Node 22+ (global WebSocket).
'use strict';
process.env.QUIET = '1';
const assert = require('assert');
const http = require('http');
const { server, rooms } = require('../server.js');

if (typeof WebSocket === 'undefined') {
  console.log('SKIP: this Node has no global WebSocket (use Node 22+).');
  process.exit(0);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function client(port) {
  return new Promise((res, rej) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    const got = [];
    ws.onmessage = (e) => got.push(JSON.parse(e.data));
    ws.onopen = () => res({ ws, got, send: (o) => ws.send(JSON.stringify(o)) });
    ws.onerror = rej;
  });
}
const next = async (c, ev, ms = 1500) => {
  const t0 = Date.now();
  for (;;) {
    const i = c.got.findIndex((m) => m.ev === ev);
    if (i >= 0) return c.got.splice(i, 1)[0];
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + ev);
    await wait(10);
  }
};
const get = (port, p) =>
  new Promise((res, rej) =>
    http.get({ host: '127.0.0.1', port, path: p }, (r) => {
      let b = '';
      r.on('data', (d) => (b += d));
      r.on('end', () => res({ status: r.statusCode, body: b }));
    }).on('error', rej)
  );

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // HTTP: game is served, internals are not
  assert.strictEqual((await get(port, '/')).status, 200);
  assert.strictEqual((await get(port, '/server.js')).status, 404);
  assert.strictEqual((await get(port, '/../server.js')).status, 404);
  const info = JSON.parse((await get(port, '/api/info')).body);
  assert.strictEqual(info.kind, 'nuclear-impostor');

  // host + two players
  const h = await client(port);
  h.send({ op: 'host', name: 'Ann<b>' });
  const { code } = await next(h, 'hosted');
  assert.match(code, /^[A-Z2-9]{4}$/);

  const a = await client(port);
  a.send({ op: 'rooms' });
  const list = (await next(a, 'rooms')).list;
  assert.deepStrictEqual(list, [{ code, host: 'Annb', n: 1 }]);
  a.send({ op: 'join', code: code.toLowerCase() });
  const ja = await next(a, 'joined');
  const pa = await next(h, 'peer');
  assert.strictEqual(pa.id, ja.id);

  const b = await client(port);
  b.send({ op: 'join', code });
  const jb = await next(b, 'joined');
  await next(h, 'peer');

  // player -> host, host -> one player
  a.send({ op: 'up', d: '{"t":"hi","name":"A"}' });
  const m1 = await next(h, 'msg');
  assert.deepStrictEqual([m1.id, m1.d], [ja.id, '{"t":"hi","name":"A"}']);
  h.send({ op: 'to', id: jb.id, d: '{"t":"snap"}' });
  assert.strictEqual((await next(b, 'msg')).d, '{"t":"snap"}');
  await wait(60);
  assert.strictEqual(a.got.filter((m) => m.ev === 'msg').length, 0, 'players must not see each other\'s traffic');

  // a player cannot impersonate the host
  a.send({ op: 'to', id: jb.id, d: 'evil' });
  await wait(80);
  assert.strictEqual(b.got.filter((m) => m.ev === 'msg').length, 0);

  // large payload (> 126 bytes, uses extended frame length)
  const big = 'x'.repeat(3000);
  a.send({ op: 'up', d: big });
  assert.strictEqual((await next(h, 'msg')).d.length, 3000);

  // lock: no more joins, not listed
  h.send({ op: 'lock' });
  await wait(50);
  const c = await client(port);
  c.send({ op: 'join', code });
  assert.match((await next(c, 'err')).msg, /already started/);
  c.send({ op: 'rooms' });
  assert.deepStrictEqual((await next(c, 'rooms')).list, []);

  // leave / host closing
  b.ws.close();
  assert.strictEqual((await next(h, 'leave')).id, jb.id);
  h.ws.close();
  await next(a, 'closed');
  await wait(50);
  assert.strictEqual(rooms.size, 0);

  // a full lobby: host + 9 players = 10 people, the 11th is turned away
  const fh = await client(port);
  fh.send({ op: 'host', name: 'Full' });
  const fcode = (await next(fh, 'hosted')).code;
  const crowd = [];
  for (let i = 0; i < 9; i++) {
    const p = await client(port);
    p.send({ op: 'join', code: fcode });
    await next(p, 'joined');
    crowd.push(p);
  }
  const extra = await client(port);
  extra.send({ op: 'join', code: fcode });
  assert.match((await next(extra, 'err')).msg, /full/);
  extra.send({ op: 'rooms' });
  assert.deepStrictEqual((await next(extra, 'rooms')).list, [], 'a full lobby is not listed');
  const peers = fh.got.filter((m) => m.ev === 'peer');
  assert.strictEqual(peers.length, 9, 'host is told about all 9 players');
  crowd.forEach((p) => p.ws.close());
  fh.ws.close();

  console.log('relay smoke test passed');
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});

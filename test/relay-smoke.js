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
  assert.deepStrictEqual(list, [{ code, host: 'Annb', lobby: "Annb's lobby", n: 1, max: 10, bots: 0, locked: false, w: 0 }]);
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
  const lk = (await next(c, 'rooms')).list;
  assert.strictEqual(lk.length, 1);
  assert.strictEqual(lk[0].locked, true, 'started game is flagged locked');
  // spectators may still join a started game, and are not players
  c.send({ op: 'join', code, spec: true });
  const jc = await next(c, 'joined');
  const pc = await next(h, 'peer');
  assert.strictEqual(pc.id, jc.id);
  c.send({ op: 'up', d: '{"t":"hi","spec":1}' });
  assert.strictEqual((await next(h, 'msg')).id, jc.id, 'spectator can talk to the host');
  h.send({ op: 'to', id: jc.id, d: '{"t":"snap"}' });
  assert.strictEqual((await next(c, 'msg')).d, '{"t":"snap"}', 'host can feed the spectator');

  // leave / host closing
  b.send({ op: 'bye' });
  assert.strictEqual((await next(h, 'leave')).id, jb.id);
  h.send({ op: 'bye' });
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
  assert.strictEqual((await next(extra, 'rooms')).list[0].locked, true, 'a full lobby is flagged locked');
  // spectators do not use player slots
  extra.send({ op: 'join', code: fcode, spec: true });
  await next(extra, 'joined');
  const peers = fh.got.filter((m) => m.ev === 'peer');
  assert.strictEqual(peers.length, 10, 'host is told about all 9 players plus the spectator');
  crowd.forEach((p) => p.send({ op: 'bye' }));
  fh.send({ op: 'bye' });

  // private rooms are not listed; max players is enforced; meta updates the list
  const ph = await client(port);
  ph.send({ op: 'host', name: 'Priv', lobby: 'Secret', pub: false, max: 4 });
  const pcode = (await next(ph, 'hosted')).code;
  const lk2 = await client(port);
  lk2.send({ op: 'rooms' });
  assert.ok(!(await next(lk2, 'rooms')).list.some((r) => r.code === pcode), 'private room hidden');
  const pj = [];
  for (let i = 0; i < 3; i++) {
    const q = await client(port);
    q.send({ op: 'join', code: pcode });
    await next(q, 'joined');
    pj.push(q);
  }
  const q4 = await client(port);
  q4.send({ op: 'join', code: pcode });
  assert.match((await next(q4, 'err')).msg, /full/, 'max 4 players enforced');
  ph.send({ op: 'meta', pub: true, bots: 2, lobby: 'Open now' });
  await wait(50);
  lk2.send({ op: 'rooms' });
  const shown = (await next(lk2, 'rooms')).list.find((r) => r.code === pcode);
  assert.ok(shown && shown.bots === 2 && shown.lobby === 'Open now' && shown.max === 4 && shown.locked === true);
  pj.forEach((q) => q.send({ op: 'bye' }));
  ph.send({ op: 'bye' });

  // ---- dropped connections: seats are kept, devices can resume ----
  {
    const h2 = await client(port);
    h2.send({ op: 'host', name: 'Resume' });
    const hc = await next(h2, 'hosted');
    assert.ok(hc.token, 'host gets a resume token');
    const p1 = await client(port);
    p1.send({ op: 'join', code: hc.code });
    const j1 = await next(p1, 'joined');
    assert.ok(j1.token, 'player gets a resume token');
    await next(h2, 'peer');
    h2.send({ op: 'lock' });

    // player's socket dies: host hears "drop", seat stays reserved
    p1.ws.close();
    assert.strictEqual((await next(h2, 'drop')).id, j1.id);
    const p1b = await client(port);
    p1b.send({ op: 'resume', code: hc.code, id: j1.id, token: 'wrong' });
    await next(p1b, 'gone');
    const p1c = await client(port);
    p1c.send({ op: 'resume', code: hc.code, id: j1.id, token: j1.token });
    assert.strictEqual((await next(p1c, 'resumed')).id, j1.id);
    assert.strictEqual((await next(h2, 'back')).id, j1.id);
    h2.send({ op: 'to', id: j1.id, d: 'hello' });
    assert.strictEqual((await next(p1c, 'msg')).d, 'hello', 'messages reach the resumed device');
    p1c.send({ op: 'up', d: 'yo' });
    assert.strictEqual((await next(h2, 'msg')).d, 'yo');

    // heartbeat is flowing
    await next(p1c, 'hb', 6000);

    // host drops: players are told, room survives, host takes it back
    h2.ws.close();
    await next(p1c, 'hostdrop');
    assert.ok(rooms.has(hc.code), 'room survives a dropped host');
    const h3 = await client(port);
    h3.send({ op: 'resume', code: hc.code, token: hc.token, host: true });
    const rs = await next(h3, 'resumed');
    assert.strictEqual(rs.peers.length, 1);
    await next(p1c, 'hostback');
    p1c.send({ op: 'up', d: 'again' });
    assert.strictEqual((await next(h3, 'msg')).d, 'again');

    // clean exit has no grace period
    p1c.send({ op: 'bye' });
    assert.strictEqual((await next(h3, 'leave')).id, j1.id);

    // unlock and kick
    h3.send({ op: 'unlock' });
    const p2 = await client(port);
    p2.send({ op: 'join', code: hc.code });
    const j2 = await next(p2, 'joined');
    await next(h3, 'peer');
    h3.send({ op: 'kick', id: j2.id });
    await next(p2, 'gone');
    assert.strictEqual((await next(h3, 'leave')).id, j2.id);

    // host says bye: room closes immediately
    const p3 = await client(port);
    p3.send({ op: 'join', code: hc.code });
    await next(p3, 'joined');
    h3.send({ op: 'bye' });
    await next(p3, 'closed');
    assert.ok(!rooms.has(hc.code));
  }

  console.log('relay smoke test passed');
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});

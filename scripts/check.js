#!/usr/bin/env node
/* Fast sanity checks, no browser needed: npm run check */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let failed = 0;
const ok = (msg) => console.log('  ok   ' + msg);
const bad = (msg) => { failed++; console.log('  FAIL ' + msg); };
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));

// 1. inline scripts in index.html parse
const html = read('index.html');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
check(scripts.length > 0, 'index.html has inline script(s)');
scripts.forEach((m, i) => {
  try { new Function(m[1]); ok('inline script #' + (i + 1) + ' parses'); }
  catch (e) { bad('inline script #' + (i + 1) + ': ' + e.message); }
});

// 2. server parses
try { execFileSync(process.execPath, ['--check', path.join(root, 'server.js')]); ok('server.js parses'); }
catch (e) { bad('server.js: ' + e.message); }

// 3. files the page and the service worker rely on exist
for (const f of ['manifest.webmanifest', 'sw.js', 'faces.js', 'favicon.ico', 'vendor/three.min.js', 'icons/apple-touch-icon.png']) {
  check(fs.existsSync(path.join(root, f)), f + ' exists');
}

// 3b. faces.js is in sync with the images in faces/
try {
  const fj = read('faces.js');
  const arr = JSON.parse(fj.slice(fj.indexOf('=') + 1, fj.lastIndexOf(';')));
  const n = fs.readdirSync(path.join(root, 'faces')).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).length;
  check(arr.length === n && n > 0, 'faces.js holds all ' + n + ' images from faces/ (run npm run build:faces if not)');
  check(arr.every((f) => f.id && f.name && /^data:image\//.test(f.src)), 'every face has an id, a label and image data');
} catch (e) { bad('faces.js: ' + e.message); }

// 4. manifest is valid and its icons exist at the declared size
try {
  const mf = JSON.parse(read('manifest.webmanifest'));
  check(!!(mf.name && mf.start_url && mf.icons && mf.icons.length), 'manifest has name, start_url and icons');
  for (const ic of mf.icons || []) {
    const p = path.join(root, ic.src);
    if (!fs.existsSync(p)) { bad('manifest icon missing: ' + ic.src); continue; }
    const b = fs.readFileSync(p);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    check(ic.sizes === w + 'x' + h, ic.src + ' is ' + w + 'x' + h);
  }
} catch (e) { bad('manifest.webmanifest: ' + e.message); }

// 5. everything the service worker precaches exists
const sw = read('sw.js');
const list = (sw.match(/ASSETS\s*=\s*\[([\s\S]*?)\]/) || [, ''])[1].match(/'[^']+'/g) || [];
check(list.length > 0, 'sw.js lists assets to cache');
for (const q of list) {
  const rel = q.slice(1, -1);
  if (rel === './') continue;
  check(fs.existsSync(path.join(root, rel)), 'sw.js asset exists: ' + rel);
}

// 6. package.json scripts point at real files
const pkg = JSON.parse(read('package.json'));
for (const [k, v] of Object.entries(pkg.scripts || {})) {
  const m = /node\s+(\S+\.js)/.exec(v);
  if (m) check(fs.existsSync(path.join(root, m[1])), 'npm run ' + k + ' -> ' + m[1] + ' exists');
}

console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nAll checks passed');
process.exit(failed ? 1 : 0);

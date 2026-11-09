#!/usr/bin/env node
/* Copies the static game files into ./www (used by GitHub Pages and the Android app build). */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
const FILES = ['index.html', 'manifest.webmanifest', 'sw.js', 'faces.js', 'favicon.ico', 'vendor', 'icons'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of FILES) {
  const from = path.join(root, f);
  if (!fs.existsSync(from)) {
    console.error('Missing required file: ' + f);
    process.exit(1);
  }
  fs.cpSync(from, path.join(out, f), { recursive: true });
}
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('Built www/ with: ' + FILES.join(', '));

// Builds one self-contained HTML file (Three.js + faces inlined): dist/NuclearImpostor.html
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const r = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
let h = r('index.html');
h = h.replace(/<link rel="manifest"[^>]*>/, '').replace(/<link rel="apple-touch-icon"[^>]*>/, '');
h = h.replace('<script src="vendor/three.min.js"></script>', () => '<script>' + safe(r('vendor/three.min.js')) + '</script>');
h = h.replace('<script src="vendor/qr.min.js"></script>', () => '<script>' + safe(r('vendor/qr.min.js')) + '</script>');
h = h.replace('<script src="faces.js"></script>', () => '<script>' + safe(r('faces.js')) + '</script>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/NuclearImpostor.html'), h);
console.log('dist/NuclearImpostor.html', (h.length / 1024).toFixed(0) + ' KB');

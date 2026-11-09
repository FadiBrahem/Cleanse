const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src', 'content');
const outPath = path.join(__dirname, 'content.js');

const files = ['state.js', 'cache.js', 'api.js', 'ui.js', 'observers.js', 'unfollow.js', 'main.js'];

let out = `// Cleanse (X Region Blocker) v1.8
// Built from modular src/ — edit src/content/*.js, then run: node build.js

(function () {
  'use strict';
  if (window.__xrbContentLoaded) return;   // guard against double injection in the same world
  window.__xrbContentLoaded = true;

`;

for (const file of files) {
    const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
    out += `  // ── ${file} ──\n`;
    out += content.split('\n').map(l => l ? '  ' + l : '').join('\n') + '\n\n';
}

out += '})();\n';
fs.writeFileSync(outPath, out);
console.log('Build successful: content.js generated from src/content modules.');

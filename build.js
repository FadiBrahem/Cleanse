const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src', 'content');
const outPath = path.join(__dirname, 'content.js');

const files = [
    'state.js',
    'cache.js',
    'api.js',
    'ui.js',
    'observers.js',
    'main.js'
];

let out = `// Cleanse (X Region Blocker) v1.0
// Built from modular src/

(function () {
  'use strict';

`;

for (const file of files) {
    const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
    out += `  // ── ${file} ──\n`;
    out += content.split('\n').map(l => l ? '  ' + l : '').join('\n') + '\n\n';
}

out += '})();\n';

fs.writeFileSync(outPath, out);
console.log('Build successful: content.js generated from src/content modules.');

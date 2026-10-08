'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const forbidden = [
  ['chat', 'gpt'].join(''),
  ['co', 'dex'].join(''),
  ['open', 'ai'].join('')
];
const roots = ['electron', 'src'];
let failed = false;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      const text = fs.readFileSync(full, 'utf8').toLowerCase();
      for (const token of forbidden) {
        if (text.includes(token)) {
          process.stderr.write(`Forbidden legacy brand token in ${path.relative(root, full)}\n`);
          failed = true;
        }
      }
    }
  }
}

for (const relative of roots) walk(path.join(root, relative));
if (failed) process.exitCode = 1;
else process.stdout.write('Brand verification passed.\n');
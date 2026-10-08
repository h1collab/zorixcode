'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

async function main() {
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'src', 'zorix-code-logo.svg');
  const outDir = path.join(root, 'build');
  fs.mkdirSync(outDir, { recursive: true });

  const sizes = [256, 128, 64, 48, 32, 16];
  const files = [];
  for (const size of sizes) {
    const file = path.join(outDir, `icon-${size}.png`);
    await sharp(source).resize(size, size).png().toFile(file);
    files.push(file);
  }

  fs.copyFileSync(files[0], path.join(outDir, 'icon.png'));
  const ico = await pngToIco(files);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
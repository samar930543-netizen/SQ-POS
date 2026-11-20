import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const svgPath = path.resolve('public/icon.svg');
const svgBuffer = fs.readFileSync(svgPath);

async function generate() {
  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile(path.resolve('public/icon-192.png'));

  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.resolve('public/icon-512.png'));

  // Maskable icon with 10% safe zone padding
  await sharp(svgBuffer)
    .resize(410, 410)
    .extend({
      top: 51,
      bottom: 51,
      left: 51,
      right: 51,
      background: '#0f172a'
    })
    .png()
    .toFile(path.resolve('public/icon-maskable-512.png'));

  console.log('PWA PNG icons generated successfully!');
}

generate().catch(err => {
  console.error(err);
  process.exit(1);
});

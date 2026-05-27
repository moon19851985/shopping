/**
 * Builds launcher mipmaps from assets/icon.png (no sharp — uses jimp).
 * Also writes icons/icon-192.png and icons/icon-512.png for PWA / www sync.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'assets', 'icon.png');
const androidRes = path.join(root, 'android', 'app', 'src', 'main', 'res');
const iconsDir = path.join(root, 'icons');

const LAUNCHER = [
  { folder: 'mipmap-mdpi', px: 48 },
  { folder: 'mipmap-hdpi', px: 72 },
  { folder: 'mipmap-xhdpi', px: 96 },
  { folder: 'mipmap-xxhdpi', px: 144 },
  { folder: 'mipmap-xxxhdpi', px: 192 },
];

/** Adaptive foreground layer sizes (108dp base). */
const FOREGROUND = [
  { folder: 'mipmap-mdpi', px: 108 },
  { folder: 'mipmap-hdpi', px: 162 },
  { folder: 'mipmap-xhdpi', px: 216 },
  { folder: 'mipmap-xxhdpi', px: 324 },
  { folder: 'mipmap-xxxhdpi', px: 432 },
];

function writePng(img, dest) {
  return new Promise((resolve, reject) => {
    img.write(dest, (err) => (err ? reject(err) : resolve()));
  });
}

async function main() {
  if (!fs.existsSync(srcPath)) {
    console.warn('generate-icons: missing assets/icon.png — skip.');
    return;
  }

  let Jimp;
  try {
    Jimp = require('jimp');
  } catch (e) {
    console.warn('generate-icons: jimp not installed — skip.');
    return;
  }

  const image = await Jimp.read(srcPath);

  fs.mkdirSync(iconsDir, { recursive: true });
  for (const { px, name } of [
    { px: 192, name: 'icon-192.png' },
    { px: 512, name: 'icon-512.png' },
  ]) {
    const out = path.join(iconsDir, name);
    await writePng(image.clone().cover(px, px), out);
    console.log('wrote', path.relative(root, out));
  }

  for (const { folder, px } of LAUNCHER) {
    const dir = path.join(androidRes, folder);
    fs.mkdirSync(dir, { recursive: true });
    const base = image.clone().cover(px, px);
    await writePng(base, path.join(dir, 'ic_launcher.png'));
    await writePng(base.clone(), path.join(dir, 'ic_launcher_round.png'));
  }

  for (const { folder, px } of FOREGROUND) {
    const dir = path.join(androidRes, folder);
    fs.mkdirSync(dir, { recursive: true });
    await writePng(image.clone().cover(px, px), path.join(dir, 'ic_launcher_foreground.png'));
  }

  console.log('Android mipmaps updated from assets/icon.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

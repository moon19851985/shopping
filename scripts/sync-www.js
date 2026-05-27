/**
 * Copies static web assets into www/ for Capacitor (excludes node_modules, www, android, ios).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');

const SKIP_DIRS = new Set(['node_modules', 'www', 'android', 'ios', '.git', 'scripts', 'server']);
const SKIP_FILES = new Set(['capacitor.config.json', 'package.json', 'package-lock.json']);
const ALLOW_EXT = new Set([
    '.html',
    '.css',
    '.js',
    '.json',
    '.webmanifest',
    /* صور الواجهة (شعار المساعد وغيره) — بدونها لا يظهر الشعار على npm run preview / الجوال */
    '.jpeg',
    '.jpg',
    '.png',
    '.gif',
    '.webp',
    '.svg',
    '.ico',
]);

function rmrf(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

/** يفرّغ المجلد دون حذف المجلد نفسه (يتفادى EBUSY على OneDrive عند حذف مجلد www بالكامل). */
function emptyDirKeepRoot(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    try {
      if (name.isDirectory()) {
        rmrf(p);
      } else {
        fs.unlinkSync(p);
      }
    } catch (e) {
      console.warn('sync-www: تعذر حذف', p, e.code || e.message);
    }
  }
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function walk(srcDir, destDir) {
  for (const name of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, name.name);
    const dest = path.join(destDir, name.name);
    if (name.isDirectory()) {
      if (SKIP_DIRS.has(name.name)) continue;
      walk(src, dest);
      continue;
    }
    const ext = path.extname(name.name).toLowerCase();
    if (!ALLOW_EXT.has(ext)) continue;
    if (SKIP_FILES.has(name.name)) continue;
    copyFile(src, dest);
  }
}

fs.mkdirSync(www, { recursive: true });
emptyDirKeepRoot(www);
walk(root, www);

function copyVendorTree(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, name.name);
    const dest = path.join(destDir, name.name);
    if (name.isDirectory()) {
      copyVendorTree(src, dest);
      continue;
    }
    const ext = path.extname(name.name).toLowerCase();
    if (ext !== '.js' && ext !== '.mjs') continue;
    copyFile(src, dest);
  }
}

const vendorSrc = path.join(root, 'vendor');
const vendorWww = path.join(www, 'vendor');
if (fs.existsSync(vendorSrc)) {
  copyVendorTree(vendorSrc, vendorWww);
}

const iconsSrc = path.join(root, 'icons');
const iconsWww = path.join(www, 'icons');
if (fs.existsSync(iconsSrc)) {
  for (const name of fs.readdirSync(iconsSrc)) {
    if (!name.toLowerCase().endsWith('.png')) continue;
    fs.mkdirSync(iconsWww, { recursive: true });
    fs.copyFileSync(path.join(iconsSrc, name), path.join(iconsWww, name));
  }
}

console.log('www/ synced from project root.');

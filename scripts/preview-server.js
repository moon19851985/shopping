const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..', 'www');
const basePort = Number(process.env.PORT) || 8765;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function handler(req, res) {
  let p = path.join(root, path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!p.startsWith(root)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
    p = path.join(p, 'index.html');
  }
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(p).toLowerCase();
  res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
}

function tryListen(port) {
  if (port >= basePort + 30) {
    console.error('لم يُعثر على منفذ متاح');
    process.exit(1);
  }
  const srv = http.createServer(handler);
  srv.once('error', (err) => {
    if (err.code === 'EADDRINUSE') tryListen(port + 1);
    else {
      console.error(err);
      process.exit(1);
    }
  });
  srv.listen(port, '0.0.0.0', () => {
    console.log(`معاينة التطبيق (هذا الجهاز): http://127.0.0.1:${port}/index.html`);
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        const fam = net.family;
        if ((fam === 'IPv4' || fam === 4) && !net.internal) {
          console.log(`من الجوال (نفس الـ Wi‑Fi): http://${net.address}:${port}/index.html`);
        }
      }
    }
  });
}

tryListen(basePort);

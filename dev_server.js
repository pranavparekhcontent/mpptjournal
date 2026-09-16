const http = require('http');
const fs = require('fs');
const path = require('path');

const root = 'E:\\PRANAV\\pwa apps\\mpptjournal';
const PORT = 8888;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  let parsedUrl = req.url.split('?')[0];
  let decoded = decodeURI(parsedUrl);

  if (decoded === '' || decoded === '/') {
    decoded = '/index.html';
  }

  let filePath = path.join(root, decoded);

  // 1. Direct file
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveFile(filePath, res);
    return;
  }

  // 2. Clean URL fallback (e.g. /track -> /track.html, /certificate -> /certificate.html)
  if (fs.existsSync(filePath + '.html') && fs.statSync(filePath + '.html').isFile()) {
    serveFile(filePath + '.html', res);
    return;
  }

  // 3. Directory index
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    let indexHtml = path.join(filePath, 'index.html');
    if (fs.existsSync(indexHtml) && fs.statSync(indexHtml).isFile()) {
      serveFile(indexHtml, res);
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!DOCTYPE html><html><body><h1>404 Not Found</h1><p>File not found: ' + decoded + '</p><a href="/">Return Home</a></body></html>');
});

function serveFile(f, res) {
  const ext = path.extname(f).toLowerCase();
  const contentType = mime[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(f).pipe(res);
}

server.listen(PORT, () => {
  console.log(`MPPT_JOURNAL_SERVER_READY_ON_${PORT}`);
});

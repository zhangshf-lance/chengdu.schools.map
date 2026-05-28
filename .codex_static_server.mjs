import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT || 8080);
const host = '127.0.0.1';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${host}:${port}`);
    const requestPath = decodeURIComponent(url.pathname);
    const normalized = path.normalize(requestPath).replace(/^[/\\]+/, '');
    let filePath = path.join(root, normalized || 'index.html');

    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}`);
});

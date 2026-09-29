const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ROOT } = require('./config.cjs');

const types = { '.html': 'text/html; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8' };
function safePath(urlPath) {
  const relative = urlPath === '/' ? 'docs/index.html' : urlPath.replace(/^\//, '');
  if (!/^(?:docs|exports)\/[A-Za-z0-9_.-]+$/.test(relative)) return null;
  const resolved = path.resolve(ROOT, relative);
  return resolved.startsWith(ROOT + path.sep) ? resolved : null;
}

function createServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); return response.end(); }
    const target = safePath(request.url.split('?')[0]);
    if (!target) { response.writeHead(404); return response.end('Not found'); }
    try {
      const body = await fs.readFile(target);
      response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
}

if (require.main === module) createServer().listen(Number(process.env.PORT || 4191), '127.0.0.1', function () {
  console.log(`Dashboard: http://127.0.0.1:${this.address().port}`);
});
module.exports = { safePath, createServer };

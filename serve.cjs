// Optional local preview. The game itself also uses classic local scripts.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = __dirname;
const port = Number(process.env.PORT || 4399);
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.md':'text/plain; charset=utf-8'};
const server = http.createServer(async (req, res) => {
  try {
    if(!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const filename = path.resolve(root, '.' + (pathname === '/' ? '/kaiju-destroyer.html' : pathname));
    if(!filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const data = await fs.readFile(filename);
    res.writeHead(200, {'Content-Type':mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control':'no-store'});
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch(error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 400);
    res.end('Unable to open this local file.');
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已在使用，请打开现有预览或用 PORT=4400 node serve.cjs。` : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`巨兽毁灭者：http://127.0.0.1:${port}/kaiju-destroyer.html`));

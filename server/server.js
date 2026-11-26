'use strict';
/** Lokale server: levert de interface en geeft die toegang tot de bibliotheekmap. Luistert alleen op deze computer. */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Library, STORES, BLOBS } = require('./library');

const UI = path.join(__dirname, '..', 'ui');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
const MAX_BODY = 200 * 1024 * 1024;

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { rej(Object.assign(new Error('te groot'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}
const json = (res, status, body) => { const b = JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); };
const fail = (status, msg) => Object.assign(new Error(msg), { status });

async function sendFile(req, res, file, type) {
  let st;
  try { st = await fsp.stat(file); } catch { throw fail(404, 'niet gevonden'); }
  if (!st.isFile()) throw fail(404, 'niet gevonden');
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/**
 * @param {{ library: string, cache: string, port?: number, onInfo?: () => object }} opts
 */
async function start(opts) {
  let lib = await new Library(opts.library, opts.cache).open();
  const state = { get library() { return lib; } };
  let rev = 0;
  const log = opts.onLog || (t => console.error(t));
  const listeners = new Set();
  const notify = what => { for (const r of listeners) r.write('data: ' + what + '\n\n'); };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const own = `http://${req.headers.host}`;
      // Alleen deze computer, en alleen onze eigen pagina mag de API gebruiken (geen andere websites).
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) throw fail(403, 'geweigerd');
      const origin = req.headers.origin;
      if (url.pathname === '/api/capture' || url.pathname === '/api/info') {
        // De browserextensie mag hier bewaren en kijken of de app draait; gewone websites niet.
        if (origin && origin !== own && !/^(moz|chrome|safari-web)-extension:\/\//.test(origin)) throw fail(403, 'geweigerd');
        if (req.method === 'POST' && req.headers['x-collector'] !== '1') throw fail(403, 'geweigerd');
        return await api(req, res, url);
      }
      if (url.pathname.startsWith('/api/')) {
        if (origin && origin !== own) throw fail(403, 'geweigerd');
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-collector'] !== '1') throw fail(403, 'geweigerd');
        return await api(req, res, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw fail(405, 'niet toegestaan');
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      const file = path.join(UI, rel);
      if (!file.startsWith(UI + path.sep)) throw fail(404, 'niet gevonden');
      if (rel === '/index.html') {
        const html = (await fsp.readFile(file, 'utf8')).replace('<html lang="nl">', '<html lang="nl" data-store="http">');
        res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
        return res.end(html);
      }
      await sendFile(req, res, file, TYPES[path.extname(file)] || 'application/octet-stream');
    } catch (e) {
      // De server is alleen lokaal bereikbaar, dus de echte reden mag mee: dat helpt bij het oplossen.
      if (!res.headersSent) json(res, e.status || 500, { error: e.message });
      else res.destroy();
      if (!e.status) log('Fout bij ' + req.method + ' ' + req.url + ': ' + (e.stack || e.message));
    }
  });

  async function api(req, res, url) {
    const parts = url.pathname.split('/').slice(2).map(decodeURIComponent);
    const [what, a, b] = parts, m = req.method;
    // Wijzigingen van buiten de interface (MCP) tellen we, zodat de interface weet dat ze opnieuw moet laden.
    if (m !== 'GET' && m !== 'HEAD' && req.headers['x-collector-client'] === 'mcp') rev++;
    if (what === 'info' && m === 'GET') return json(res, 200, { app: 'collector', library: lib.dir, id: lib.data.id, rev, ...(opts.onInfo ? opts.onInfo() : {}) });
    if (what === 'files' && m === 'GET') return json(res, 200, Object.fromEntries(Object.keys(lib.data.files).map(id => [id, lib.pathOf(id)])));
    if (what === 'store' && STORES.includes(a)) {
      if (m === 'GET' && !b) return json(res, 200, lib.all(a));
      if (m === 'GET') return json(res, 200, lib.get(a, b));
      if (m === 'PUT') { lib.put(a, JSON.parse((await readBody(req)).toString('utf8'))); return json(res, 200, { ok: true }); }
      if (m === 'DELETE') { lib.del(a, b); return json(res, 200, { ok: true }); }
    }
    if (what === 'meta' && a) {
      if (m === 'GET') return json(res, 200, lib.getMeta(a));
      if (m === 'PUT') { lib.putMeta(a, JSON.parse((await readBody(req)).toString('utf8'))); return json(res, 200, { ok: true }); }
    }
    if (what === 'blob' && BLOBS.includes(a) && b) {
      if (m === 'GET' || m === 'HEAD') {
        const p = await lib.blobPath(a, b);
        if (!p) throw fail(404, 'niet gevonden');
        return sendFile(req, res, p, a === 'fulls' ? Library.mime(p) : a === 'thumbs' ? 'image/webp' : 'application/octet-stream');
      }
      if (m === 'PUT') {
        const name = req.headers['x-name'] ? decodeURIComponent(req.headers['x-name']) : '';
        await lib.putBlob(a, b, await readBody(req), (req.headers['content-type'] || '').split(';')[0], name);
        return json(res, 200, { ok: true });
      }
      if (m === 'DELETE') { await lib.delBlob(a, b); return json(res, 200, { ok: true }); }
    }
    if (what === 'capture' && m === 'POST') {
      const d = JSON.parse((await readBody(req)).toString('utf8'));
      const page = /^https?:\/\/\S+$/i.test(d.page || '') ? d.page : '';
      const mm = typeof d.dataUrl === 'string' && /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is.exec(d.dataUrl);
      if (mm) await lib.capture(Buffer.from(mm[2], 'base64'), mm[1].toLowerCase(), { title: d.title, source: page });
      else if (page) { lib.addLink(page, d.title); rev++; }
      else throw fail(400, 'niets om te bewaren');
      notify('changed');
      return json(res, 200, { ok: true });
    }
    if (what === 'events' && m === 'GET') { // de interface luistert hier naar wijzigingen van buiten
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': ok\n\n'); listeners.add(res); req.on('close', () => listeners.delete(res));
      return;
    }
    if (what === 'optimize' && a && m === 'POST') return json(res, 200, { file: await lib.replaceFull(a, await readBody(req), (req.headers['content-type'] || '').split(';')[0]) });
    if (what === 'log' && m === 'POST') { log((await readBody(req)).toString('utf8').slice(0, 4000)); return json(res, 200, { ok: true }); }
    if (what === 'embeddings' && m === 'GET') return json(res, 200, await lib.embeddings());
    if (what === 'unindexed' && m === 'GET') return json(res, 200, await lib.unindexed());
    if (what === 'raw' && a && m === 'GET') { const p = lib.rawPath(a); if (!p) throw fail(404, 'niet gevonden'); return sendFile(req, res, p, Library.mime(p)); }
    if (what === 'adopt' && m === 'POST') { const d = JSON.parse((await readBody(req)).toString('utf8')); await lib.adopt(d.id, d.name); return json(res, 200, { ok: true }); }
    throw fail(404, 'onbekend');
  }

  await new Promise((res, rej) => { server.once('error', rej); server.listen(opts.port || 0, '127.0.0.1', res); });
  const port = server.address().port;
  return {
    port, url: `http://127.0.0.1:${port}/`, state,
    /** Wisselt naar een andere bibliotheekmap (bijvoorbeeld op een NAS). */
    async switchLibrary(dir) { const next = await new Library(dir, opts.cache).open(); await lib.flush(); lib = next; return lib.dir; },
    async close() { for (const r of listeners) r.end(); await lib.flush(); server.closeAllConnections && server.closeAllConnections(); await new Promise(r => server.close(r)); },
  };
}

module.exports = { start };

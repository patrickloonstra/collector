'use strict';
/** Test de browserextensie samen met de motor: Alt-klik op een pagina -> bestand in de bibliotheekmap. Gebruik: node test/extension.js <map met beelden> */
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const { start } = require('../server/server');
let failed = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) failed++; };
(async () => {
  const src = process.argv[2], img = fs.readdirSync(src).find(f => /\.jpe?g$/i.test(f));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-ext-'));
  const library = path.join(tmp, 'lib');
  const srv = await start({ library, cache: path.join(tmp, 'cache'), port: 4317 });
  // een "andere website" met een beeld
  const site = http.createServer((q, r) => { if (q.url === '/foto.jpg') { r.writeHead(200, { 'Content-Type': 'image/jpeg' }); r.end(fs.readFileSync(path.join(src, img))); } else { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<title>Studio Voorbeeld</title><img id="a" src="/foto.jpg" width="400">'); } });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const ext = path.join(__dirname, '..', 'extension');
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { channel: 'chromium', headless: true, args: ['--disable-extensions-except=' + ext, '--load-extension=' + ext] });
  if (!ctx.serviceWorkers()[0]) await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  // de app-interface moet één keer geopend zijn (maakt de bibliotheek aan en neemt nieuwe beelden op)
  const appPage = await ctx.newPage(); await appPage.goto(srv.url); await appPage.waitForSelector('.empty h2');
  const page = await ctx.newPage(); await page.goto('http://localhost:' + site.address().port + '/');
  await page.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
  await page.click('#a', { modifiers: ['Alt'] });
  await page.waitForFunction(() => [...document.querySelectorAll('div')].some(d => /Bewaard in Collector/.test(d.textContent)), null, { timeout: 30000 });
  ok(true, 'Alt-klik: melding "Bewaard in Collector" op de pagina');
  const files = fs.readdirSync(path.join(library, 'Beelden'));
  ok(files.length === 1 && files[0] === 'Studio Voorbeeld.jpg', 'bestand staat in de bibliotheekmap: ' + files.join(', '));
  ok(fs.readFileSync(path.join(library, 'Beelden', files[0])).equals(fs.readFileSync(path.join(src, img))), 'het is het echte, volledige beeldbestand');
  await appPage.waitForFunction(() => document.querySelectorAll('.card').length === 1, null, { timeout: 30000 });
  ok(true, 'het beeld verschijnt vanzelf in de app, zonder het venster aan te raken');
  ok(ctx.pages().filter(x => x.url().startsWith(srv.url)).length === 1 && !ctx.pages().some(x => x.url().includes('dev.patrickloonstra.nl')), 'er is geen extra Collector-tabblad geopend');
  await ctx.close(); site.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? failed + ' mislukt' : 'Alles geslaagd'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });

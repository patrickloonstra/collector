'use strict';
/**
 * Test de motor en de interface samen, in een echte browser.
 * Gebruik: node test/run.js <map met testbeelden>
 * Vereist Playwright (staat niet in package.json; alleen nodig om te testen).
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();
const { start } = require('../server/server');

let failed = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) failed++; };

(async () => {
  const src = process.argv[2] || path.join(__dirname, 'fixtures');
  const imgs = fs.readdirSync(src).filter(f => /\.(jpe?g|png)$/i.test(f)).map(f => path.join(src, f));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-test-'));
  const library = path.join(tmp, 'Mijn Collector'), cache = path.join(tmp, 'cache');
  let srv = await start({ library, cache });
  const beelden = path.join(library, 'Beelden'), bak = path.join(library, 'Prullenbak');
  ok(fs.existsSync(beelden) && fs.existsSync(path.join(library, 'collector.json')), 'bibliotheekmap aangemaakt met Beelden/ en collector.json');

  const browser = await chromium.launch();
  const errs = [];
  const open = async () => { const p = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage(); p.on('pageerror', e => errs.push(e.message)); await p.goto(srv.url); return p; };
  let p = await open();
  await p.waitForSelector('.empty h2');
  ok((await p.textContent('#where')).includes('Mijn Collector'), 'interface toont het pad van de map');

  // toevoegen -> echte bestanden met hun eigen naam
  await p.setInputFiles('#file', imgs.slice(0, 5));
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 5, null, { timeout: 60000 });
  await p.waitForTimeout(500);
  const names = fs.readdirSync(beelden).sort();
  ok(names.length === 5 && names.includes(path.basename(imgs[0])), 'bestanden staan in Beelden/ met hun eigen naam: ' + names.slice(0, 3).join(', ') + '…');
  ok(fs.readFileSync(path.join(beelden, path.basename(imgs[0]))).equals(fs.readFileSync(imgs[0])), 'bestand is byte voor byte gelijk aan het origineel');
  ok(await p.$$eval('.card img', e => e.every(i => i.complete && i.naturalWidth > 0)), 'miniaturen laden vanaf de server');

  // tag, collectie, notitie
  await p.click('.card >> nth=0'); await p.waitForSelector('.detail-panel');
  await p.fill('.tagbox input', 'poster'); await p.keyboard.press('Enter'); await p.fill('.title-input', 'Eerste beeld'); await p.waitForTimeout(600);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.click('.card >> nth=1', { modifiers: ['Control'] }); await p.click('.card >> nth=2');
  await p.click('#selbar >> text=Naar collectie'); await p.click('#menu >> text=Nieuwe collectie'); await p.fill('#dlg input', 'Typografie'); await p.click('#dlg button.primary'); await p.waitForTimeout(400);
  await p.keyboard.press('n'); await p.waitForSelector('.notestage'); await p.keyboard.type('Warm en rustig'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  await p.waitForTimeout(600);
  const data = JSON.parse(fs.readFileSync(path.join(library, 'collector.json'), 'utf8'));
  const items = Object.values(data.items);
  ok(items.length === 6 && items.some(i => i.title === 'Eerste beeld' && i.tags.includes('poster')), 'collector.json bevat titel en tag');
  ok(Object.values(data.cols).some(c => c.name === 'Typografie') && items.filter(i => (i.cols || []).length).length === 2, 'collector.json bevat de collectie met 2 beelden');
  ok(items.some(i => i.type === 'note' && i.text === 'Warm en rustig'), 'collector.json bevat de notitie');
  ok(fs.readdirSync(path.join(cache, data.id, 'thumbs')).length === 5, 'miniaturen staan in de cache, niet in de bibliotheekmap');

  // de cache mag op elk moment verdwijnen (dat gebeurde op de Mac)
  fs.rmSync(path.join(cache, data.id), { recursive: true, force: true });
  ok((await fetch(srv.url + 'api/embeddings')).status === 200, 'cache weggegooid: motor blijft werken');
  ok((await fetch(srv.url + 'api/blob/thumbs/x1', { method: 'PUT', headers: { 'X-Collector': '1' }, body: 'x' })).status === 200, 'cache weggegooid: miniatuur opslaan maakt de map opnieuw aan');

  // herstart van de app: alles is er nog
  await p.context().close(); await srv.close();
  srv = await start({ library, cache });
  p = await open(); await p.waitForSelector('.card');
  ok(await p.$$eval('.card', e => e.length) === 6, 'na herstart: 6 items terug');
  ok((await p.textContent('#nav .nav-item:has-text("Typografie") .count')) === '2', 'na herstart: collectie met 2 beelden');

  // bestand via "Finder" in de map zetten -> verschijnt in de app
  fs.copyFileSync(imgs[5], path.join(beelden, 'Uit Finder.jpg'));
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 7, null, { timeout: 30000 });
  ok(await p.$$eval('.card', e => e.some(c => c.getAttribute('aria-label') === 'Uit Finder')), 'bestand dat je zelf in Beelden/ zet verschijnt in de app');
  ok(fs.readdirSync(beelden).filter(n => n.startsWith('Uit Finder')).length === 1, 'dat bestand is niet gekopieerd of hernoemd');

  // verwijderen: eerst prullenbak in de app, daarna naar de map Prullenbak; nooit definitief weg
  await p.click('.card[aria-label="Uit Finder"]', { modifiers: ['Control'] }); await p.click('#selbar >> text=Verwijderen'); await p.waitForTimeout(400);
  ok(fs.existsSync(path.join(beelden, 'Uit Finder.jpg')), 'in de prullenbak van de app: bestand staat nog in Beelden/');
  await p.click('#storage button'); await p.click('#dlg button.primary'); await p.waitForTimeout(700);
  ok(!fs.existsSync(path.join(beelden, 'Uit Finder.jpg')) && fs.existsSync(path.join(bak, 'Uit Finder.jpg')), 'prullenbak legen: bestand verhuist naar de map Prullenbak/');

  // dubbele naam krijgt een volgnummer, niets wordt overschreven
  await p.setInputFiles('#file', imgs[0]); await p.waitForFunction(() => document.querySelectorAll('.card').length === 7, null, { timeout: 30000 }); await p.waitForTimeout(300);
  const ext0 = path.extname(imgs[0]), stem = path.basename(imgs[0], ext0);
  ok(fs.existsSync(path.join(beelden, stem + ' 2' + ext0)), 'zelfde bestandsnaam nogmaals: bewaard als "' + stem + ' 2' + ext0 + '"');

  // beveiliging: andere websites en paden buiten de map
  const get = async (url, init) => (await fetch(srv.url + url, init)).status;
  ok(await get('api/store/items', { headers: { Origin: 'https://kwaad.example' } }) === 403, 'andere website mag de API niet lezen');
  ok(await get('api/store/items/x', { method: 'DELETE' }) === 403, 'schrijven zonder eigen kenmerk wordt geweigerd');
  ok(await get('api/raw/..%2Fcollector.json') === 404 && await get('..%2F..%2Fpackage.json') === 404, 'geen toegang tot bestanden buiten de map');
  ok(await get('api/blob/fulls/..%2F..%2Fx') === 404, 'ongeldig id wordt geweigerd');

  // browserextensie -> app: beeld landt als bestand in de map en verschijnt vanzelf, met bron en titel
  const ext = { 'Content-Type': 'application/json', 'X-Collector': '1', Origin: 'moz-extension://abc' };
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(imgs.find(f => f.endsWith('.png'))).toString('base64');
  ok(await get('api/capture', { method: 'POST', headers: ext, body: JSON.stringify({ dataUrl, page: 'https://voorbeeld.nl/werk', title: 'Mooi werk: deel 1' }) }) === 200, 'extensie mag een beeld afleveren bij de app');
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 8, null, { timeout: 30000 });
  ok(fs.existsSync(path.join(beelden, 'Mooi werk deel 1.png')), 'afgeleverd beeld staat als "Mooi werk deel 1.png" in Beelden/');
  await p.click('.card[aria-label="Mooi werk: deel 1"]'); await p.waitForSelector('#dSrc');
  ok((await p.inputValue('#dSrc')) === 'https://voorbeeld.nl/werk', 'bron van de pagina is bewaard'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok(await get('api/capture', { method: 'POST', headers: { ...ext, Origin: 'https://kwaad.example' }, body: JSON.stringify({ dataUrl }) }) === 403, 'een gewone website mag niets afleveren');
  ok(await get('api/capture', { method: 'POST', headers: ext, body: JSON.stringify({ page: 'https://voorbeeld.nl/artikel', title: 'Artikel' }) }) === 200, 'extensie levert een link af');
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 9, null, { timeout: 30000 }); ok(true, 'de link verschijnt vanzelf in de app');
  await p.click('#storage button').catch(() => {});

  // andere map kiezen (zoals een NAS): nieuwe lege bibliotheek, oude blijft intact
  const nas = path.join(tmp, 'NAS', 'Collector');
  await srv.switchLibrary(nas);
  await p.reload(); await p.waitForSelector('.empty h2');
  ok(fs.existsSync(path.join(nas, 'Beelden')) && (await p.textContent('#where')).includes('NAS'), 'wisselen naar een andere map (bijv. NAS) geeft een lege bibliotheek daar');
  await srv.switchLibrary(library); await p.reload(); await p.waitForSelector('.card');
  ok(await p.$$eval('.card', e => e.length) === 9, 'terug naar de eerste map: alles staat er nog');

  ok(errs.length === 0, errs.length ? 'fouten: ' + errs.join(' / ') : 'geen fouten in de pagina');
  await browser.close(); await srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? failed + ' mislukt' : 'Alles geslaagd');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });

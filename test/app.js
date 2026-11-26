'use strict';
/** Test de echte app-schil (Electron): bestanden kiezen, slepen, instellingen. Gebruik: node test/app.js <map met beelden> */
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { _electron } = (() => { try { return require('playwright-core'); } catch { return require('playwright'); } })();
let failed = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) failed++; };
(async () => {
  const src = process.argv[2] || path.join(__dirname, 'fixtures');
  const imgs = fs.readdirSync(src).filter(f => /\.(jpe?g|png)$/i.test(f)).map(f => path.join(src, f));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-app-'));
  const library = path.join(tmp, 'Bibliotheek'), ud = path.join(tmp, 'ud');
  // Met COLLECTOR_APP_BIN test je de gebouwde app in plaats van de broncode.
  const bin = process.env.COLLECTOR_APP_BIN;
  const args = [...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...(bin ? [] : [path.join(__dirname, '..')])];
  // nagebootste website: twee nieuwsberichten en een nieuwere versie
  const web = http.createServer((q, r) => {
    const origin = 'http://127.0.0.1:' + web.address().port;
    r.writeHead(200, { 'Content-Type': 'application/json' });
    if (q.url.startsWith('/nieuws.json')) return r.end(JSON.stringify([{ id: 'actie', kind: 'Aanbieding', title: 'Black Friday', text: 'Tot maandag voor de helft.', link: origin + '/actie', label: 'Bekijk' }, { id: 'oud', title: 'Verlopen', until: '2020-01-01' }, { id: 'tip', title: 'Nieuw: rechtsklik', text: 'Voeg snel toe aan een collectie.' }, { id: 'kwaad', title: 'Vreemde link', link: 'https://kwaad.example/x' }]));
    r.end(JSON.stringify([{ tag_name: 'v9.9.9', draft: false, prerelease: false, body: '', assets: [{ name: 'Collector-9.9.9.zip', browser_download_url: origin + '/Collector-9.9.9.zip', size: 1 }] }]));
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  const site = 'http://127.0.0.1:' + web.address().port;
  const envApp = { ...process.env, COLLECTOR_LIBRARY: library, COLLECTOR_USERDATA: ud, COLLECTOR_NEWS_URL: site + '/nieuws.json', COLLECTOR_UPDATE_FEED: site + '/releases' };
  const app = await _electron.launch({ executablePath: bin || require('electron'), args, env: envApp });
  const p = await app.firstWindow();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  // 0. openingsscherm en, de eerste keer, de uitleg
  ok(await p.$eval('#splash h1', e => e.textContent) === 'Collector', 'openingsscherm met logo en naam');
  await p.waitForFunction(() => document.querySelector('#splashHi') && document.querySelector('#splashHi').textContent.length > 3, null, { timeout: 5000 });
  ok(true, 'begroeting wordt getypt: "' + await p.textContent('#splashHi') + '"' + ((await p.textContent('#splashLang')) ? ' (' + await p.textContent('#splashLang') + ')' : ''));
  await p.waitForSelector('#onboard .ob-card', { timeout: 10000 });
  ok(await p.$('#splash') === null, 'openingsscherm verdwijnt vanzelf');
  ok((await p.textContent('#obPath')) === library, 'eerste keer: uitleg toont de bibliotheekmap');
  await p.click('#obNext'); ok(await p.$$eval('.ob-key', e => e.length) === 3, 'uitleg: drie toetsen'); await p.click('#obNext'); await p.click('#obNext');
  ok(await p.$eval('#onboard', e => e.hidden), 'uitleg sluiten');
  await p.waitForSelector('.empty h2');
  await p.click('#mode >> text=Raster');
  // 1. bestandskiezer
  await p.setInputFiles('#file', imgs.slice(0, 3));
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 3, null, { timeout: 30000 }).catch(() => {});
  ok(await p.$$eval('.card', e => e.length) === 3, 'bestanden kiezen: 3 beelden in de app (' + (await p.$$eval('.toast', e => e.map(x => x.textContent).join(' | '))) + ')');
  ok(fs.readdirSync(path.join(library, 'Beelden')).length === 3, 'en 3 bestanden in de map Beelden');
  await p.waitForTimeout(600);
  ok(await p.$$eval('.card img', e => e.length === 3 && e.every(i => i.complete && i.naturalWidth > 0)), 'miniaturen zijn zichtbaar');
  // 2. slepen vanuit Finder (nagebootst met een echte bestandsdrop)
  const buf = fs.readFileSync(imgs[3]).toString('base64');
  await p.evaluate(async ({ b64, name }) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type: 'image/jpeg' }));
    for (const type of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { b64: buf, name: 'Gesleept.jpg' });
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 4, null, { timeout: 30000 }).catch(() => {});
  ok(fs.existsSync(path.join(library, 'Beelden', 'Gesleept.jpg')), 'slepen: bestand staat in Beelden');
  // 3. groot beeld openen
  await p.click('.card >> nth=0'); await p.waitForSelector('.detail-stage img');
  await p.waitForFunction(() => { const i = document.querySelector('.detail-stage img'); return i.complete && i.naturalWidth > 700; }, null, { timeout: 15000 }).catch(() => {});
  ok(await p.$eval('.detail-stage img', i => i.naturalWidth > 700), 'origineel openen op volle grootte');
  await p.keyboard.press('Escape');
  // 4. onbekend bestandstype geeft een duidelijke melding en komt in het logboek
  const odd = path.join(tmp, 'ontwerp.psd'); fs.writeFileSync(odd, 'geen beeld');
  await p.setInputFiles('#file', odd); await p.waitForTimeout(800);
  ok(await p.$$eval('.card', e => e.length) === 4, 'onbekend bestandstype wordt niet toegevoegd');
  // 5. instellingen via het menu en met de sneltoets
  await app.evaluate(({ Menu }) => { const m = Menu.getApplicationMenu(); const find = items => { for (const i of items) { if (i.label === 'Instellingen…') return i; if (i.submenu) { const r = find(i.submenu.items); if (r) return r; } } }; find(m.items).click(); });
  await p.waitForSelector('.settings .set-path');
  ok((await p.textContent('.set-path')) === library, 'menu Instellingen opent het venster met de bibliotheekmap');
  ok(await p.$$eval('.set-actions .btn', e => ['Toon in Finder', 'Kies andere map…', 'Zoek naar updates', 'Toon logboek'].every(t => e.some(b => b.textContent === t))), 'knoppen: Finder, andere map, updates, logboek');
  ok(/Patrick Loonstra/.test(await p.textContent('.about')) && await p.$$eval('.set-actions a', e => e.some(x => x.textContent === 'Collector kopen')), 'instellingen: wie het maakt en waar je hem koopt');
  await p.screenshot({ path: path.join(os.tmpdir(), 'collector-instellingen.png') });
  await p.click('#dlg >> text=Sluiten');
  await p.keyboard.press('Control+,'); await p.waitForSelector('.settings'); ok(true, 'sneltoets opent de instellingen'); await p.click('#dlg >> text=Sluiten');
  // 6. logboek
  await p.waitForTimeout(300);
  const logText = fs.readFileSync(path.join(ud, 'collector.log'), 'utf8');
  ok(/gestart/.test(logText) && /Toevoegen mislukt: ontwerp\.psd/.test(logText), 'logboek bevat de start en het mislukte bestand');
  // 6b. meldingen linksonder: update en nieuws, gestapeld en weg te klikken
  await p.waitForFunction(() => document.querySelectorAll('#notes .note').length === 3, null, { timeout: 15000 });
  const front = () => p.textContent('#notes .note.front strong');
  ok(/9\.9\.9/.test(await front()) && /1 van 4/.test(await p.textContent('#notes .note.front .note-kind')), 'meldingen: bovenop de update ("' + await front() + '"), 4 in totaal, 3 gestapeld zichtbaar');
  await p.screenshot({ path: path.join(os.tmpdir(), 'collector-meldingen.png') });
  await p.click('#notes .note-x'); ok((await front()) === 'Black Friday', 'wegklikken toont de volgende: de aanbieding');
  ok((await p.getAttribute('#notes .note.front a', 'href')) === site + '/actie', 'aanbieding linkt naar de website');
  await p.click('#notes .note-x'); await p.click('#notes .note-x');
  ok((await front()) === 'Vreemde link' && await p.$$eval('#notes .note.front a', e => e.length) === 0, 'een link naar een onbekende website wordt niet getoond');
  await p.click('#notes .note-x'); ok(await p.$eval('#notes', e => e.hidden), 'alles weggeklikt: de hoek is weer leeg');
  await p.click('#btnSettings'); ok(await p.$$eval('.newslist li', e => e.length) === 4 && !(await p.textContent('.newslist')).includes('Verlopen'), 'Instellingen > Nieuws toont alles nog, zonder het verlopen bericht'); await p.click('#dlg >> text=Sluiten');
  // 7. tweede start: geen uitleg meer
  await app.close();
  const app2 = await _electron.launch({ executablePath: bin || require('electron'), args, env: envApp });
  const p2 = await app2.firstWindow(); await p2.waitForSelector('#splash', { state: 'detached', timeout: 10000 }); await p2.waitForTimeout(400);
  ok(await p2.$eval('#onboard', e => e.hidden), 'tweede start: wel het openingsscherm, geen uitleg meer');
  ok(await p2.$eval('#notes', e => e.hidden), 'weggeklikte meldingen komen na een herstart niet terug');
  await app2.close(); web.close();
  ok(errs.length === 0, errs.length ? 'fouten: ' + errs.slice(0, 3).join(' / ') : 'geen fouten in het venster');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? failed + ' mislukt' : 'Alles geslaagd'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message.slice(0, 600)); process.exit(1); });

'use strict';
/** Test de vorm: ontdekwand, sneltoetsen L en C, de verzamelbak, de zijbalk. Gebruik: node test/ui.js */
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();
const { start } = require('../server/server');
let failed = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) failed++; };
(async () => {
  const src = process.argv[2] || path.join(__dirname, 'fixtures'), shots = process.env.SHOTS;
  const imgs = fs.readdirSync(src).filter(f => /\.(jpe?g|png)$/i.test(f)).map(f => path.join(src, f));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-ui-'));
  const srv = await start({ library: path.join(tmp, 'lib'), cache: path.join(tmp, 'cache'), onInfo: () => ({ mcp: { command: '/Applications/Collector.app/Contents/MacOS/Collector', script: '/Applications/Collector.app/Contents/Resources/app.asar/mcp/server.js' } }) });
  const browser = await chromium.launch();
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const shot = n => shots ? p.screenshot({ path: path.join(shots, n + '.png') }) : null;
  await p.goto(srv.url); await p.waitForFunction(() => document.querySelector('#splashHi').textContent.length > 2);
  await p.waitForTimeout(700); await shot('0-opening');
  ok(await p.$eval('#splash h1', e => e.textContent) === 'Collector' && (await p.textContent('#splashHi')).length > 3, 'openingsscherm: logo, naam en begroeting "' + await p.textContent('#splashHi') + '"');
  await p.waitForSelector('#splash', { state: 'detached', timeout: 8000 }); ok(true, 'openingsscherm veegt weg');
  await p.waitForSelector('.empty h2');
  ok(await p.$$eval('.side-foot', e => e.every(x => getComputedStyle(x).display === 'none')) && await p.isVisible('#btnSettings'), 'linksonder staat alleen nog de bibliotheek en een bolletje naar Instellingen');
  ok(await p.$$eval('.swatch', e => e.length) === 0, 'geen kleurbolletjes meer in de zijbalk');
  await p.setInputFiles('#file', imgs);
  await p.waitForSelector('.wtile', { timeout: 60000 });
  await p.waitForTimeout(900);
  ok(await p.$eval('#gridWrap', e => e.hidden) && (await p.$$eval('.wtile', e => e.length)) >= 10, 'met ' + imgs.length + ' beelden opent Ontdek: een wand die het scherm vult (' + (await p.$$eval('.wtile', e => e.length)) + ' tegels)');
  ok((await p.getAttribute('#mode button[data-mode="wall"]', 'aria-pressed')) === 'true', 'onderin staat Ontdek aan');
  // drijven: zonder iets te doen bewegen de tegels
  await p.mouse.move(100, 500); // buiten de wand (zijbalk)
  const pos = () => p.$$eval('.wtile', e => e.slice(0, 6).map(x => x.style.transform).join(';'));
  const a1 = await pos(); await p.waitForTimeout(2200); const a2 = await pos();
  ok(a1 !== a2, 'de wand drijft vanzelf als je niets doet');
  await shot('1-ontdek');
  // slepen verplaatst de wand
  const before = await pos();
  await p.mouse.move(800, 450); await p.mouse.down(); await p.mouse.move(600, 300, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(200);
  ok(before !== await pos(), 'slepen verplaatst de wand');
  await p.waitForTimeout(900);
  // L = love op het beeld onder de muis
  await p.mouse.move(820, 430); await p.waitForTimeout(150);
  const hov = await p.evaluate(() => { const t = document.elementFromPoint(820, 430).closest('.wtile'); return t && t.dataset.id; });
  ok(!!hov, 'er ligt een beeld onder de muis');
  await p.keyboard.press('l'); await p.waitForTimeout(300);
  ok((await p.textContent('#nav .nav-item:has-text("Favorieten") .count')) === '1', 'L zet het beeld onder de muis bij je favorieten');
  // C = collect: vliegt naar de bak onderin
  await p.keyboard.press('c'); await p.waitForTimeout(150);
  ok(await p.$$eval('.ghost', e => e.length) === 1, 'C laat het beeld naar onderen vliegen');
  await shot('2-vlucht');
  await p.waitForTimeout(700);
  ok(!(await p.$eval('#bak', e => e.hidden)) && (await p.textContent('.bak-count')) === '1', 'onderin staat de verzamelbak met 1 beeld');
  for (const [x, y] of [[400, 250], [1330, 760], [900, 820], [1330, 200]]) { await p.mouse.move(x, y); await p.waitForTimeout(120); await p.keyboard.press('c'); await p.waitForTimeout(120); }
  await p.waitForTimeout(800);
  const n = +(await p.textContent('.bak-count'));
  ok(n >= 2, 'meer beelden verzamelen: ' + n + ' in de waaier');
  await shot('3-waaier');
  // eroverheen: de waaier wordt groter en toont acties
  const w0 = (await p.$eval('.bak-fan', e => e.getBoundingClientRect().width));
  await p.hover('.bak-fan'); await p.waitForTimeout(450);
  const w1 = (await p.$eval('.bak-fan', e => e.getBoundingClientRect().width));
  ok(w1 > w0 * 1.25 && await p.isVisible('.bak-actions'), 'eroverheen bewegen vergroot de waaier (' + Math.round(w0) + ' → ' + Math.round(w1) + ' px) en toont de acties');
  await shot('4-waaier-open');
  await p.click('.bak-btn.primary'); await p.fill('#dlg input', 'Najaar'); await p.click('#dlg button.primary'); await p.waitForTimeout(700);
  ok((await p.textContent('#filters h1')) === 'Najaar' && await p.$eval('#bak', e => e.hidden), 'Nieuwe collectie: de verzameling wordt de collectie "Najaar" en de bak is leeg');
  ok((await p.textContent('#nav .colrow:has-text("Najaar") .count')) === String(n) && (await p.$$eval('#nav .colrow:has-text("Najaar") .colstrip img', e => e.length)) === Math.min(3, n), 'de zijbalk toont de collectie met haar laatste beelden');
  await shot('5-collectie');
  // van de bak rechtstreeks naar het canvas
  await p.click('#nav >> text=Alles'); await p.waitForSelector('.wtile'); await p.waitForTimeout(500);
  await p.mouse.move(820, 430); await p.waitForTimeout(150); await p.keyboard.press('c'); await p.waitForTimeout(700);
  await p.hover('.bak-fan'); await p.waitForTimeout(350); await p.click('.bak-btn >> text=Naar canvas'); await p.fill('#dlg input', 'Bord'); await p.click('#dlg button.primary');
  await p.waitForSelector('#viewSpace:not([hidden]) .node'); ok(true, 'Naar canvas: de verzameling staat op een vrij canvas');
  await p.waitForTimeout(500); await p.click('.node'); await p.waitForSelector('#spInfo .detail-panel');
  ok(await p.isVisible('#spInfo .title-input') && await p.$eval('#detail', e => e.hidden), 'klik op een beeld op het canvas: zwevend infovenster rechts, het canvas blijft bruikbaar');
  await shot('6-canvas');
  const hgt = () => p.$eval('#spInfo .detail-panel', e => e.getBoundingClientRect().height);
  const h0 = await hgt(); await p.click('#spInfo .detail-head .icon-btn[title="In- of uitklappen"]'); await p.waitForTimeout(200); const h1 = await hgt();
  ok(h1 < h0 / 3, 'het infovenster is in te klappen (' + Math.round(h0) + ' → ' + Math.round(h1) + ' px)');
  await p.click('#spInfo .detail-head .icon-btn[title="In- of uitklappen"]');
  await p.mouse.click(300, 700); await p.waitForTimeout(200); ok(await p.$('#spInfo .detail-panel') === null, 'klik naast het beeld sluit het infovenster');
  await p.click('#nav >> text=Alles'); await p.waitForSelector('.wtile');
  // rechtsklik op een beeld: ruim menu om aan een collectie toe te voegen
  await p.waitForTimeout(600); await p.mouse.click(820, 430, { button: 'right' }); await p.waitForSelector('#menu.big .colrow');
  ok(await p.$$eval('#menu.big .colrow', e => e.length) === 2 && await p.isVisible('#menu.big .ctx-new'), 'rechtsklik: menu met je collecties en "Nieuwe collectie"');
  await shot('8-rechtsklik');
  const c0 = +(await p.textContent('#nav .colrow:has-text("Najaar") .count'));
  await p.click('#menu.big .colrow:has-text("Najaar")'); await p.waitForTimeout(500);
  const c1 = +(await p.textContent('#nav .colrow:has-text("Najaar") .count'));
  ok(Math.abs(c1 - c0) === 1, 'klik op een collectie in het menu zet het beeld erin (of haalt het eruit): ' + c0 + ' → ' + c1);
  // Raster en terug, zoomen, sorteren
  await p.click('#mode >> text=Raster'); await p.waitForSelector('.card');
  ok(await p.$$eval('.card', e => e.length) === imgs.length && await p.$eval('#wall', e => e.hidden), 'Raster toont dezelfde beelden als lijst');
  await p.hover('.card >> nth=1'); await p.keyboard.press('c'); await p.waitForTimeout(700);
  ok((await p.textContent('.bak-count')) === '1', 'C werkt ook in het raster');
  await p.keyboard.press('c'); await p.waitForTimeout(300); ok(await p.$eval('#bak', e => e.hidden), 'nogmaals C haalt het beeld weer uit de verzameling');
  await p.keyboard.press('Control+a'); await p.waitForTimeout(300);
  ok((await p.textContent('#selbar strong')) === imgs.length + ' geselecteerd', '⌘A selecteert alles'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.click('#mode >> text=Ontdek'); await p.waitForSelector('.wtile');
  const tw0 = await p.$eval('.wtile', e => e.offsetWidth); await p.keyboard.press('+'); await p.waitForTimeout(250);
  for (let i = 0; i < 5; i++) await p.keyboard.press('+'); await p.waitForTimeout(250);
  ok(await p.$eval('.wtile', e => e.offsetWidth) >= tw0, 'zoomen met + werkt op de wand');
  await p.selectOption('#sort', 'shuffle'); await p.waitForTimeout(300); ok(await p.$$eval('.wtile', e => e.length) > 0, 'sorteren op Willekeurig');
  // klik opent het beeld; Tags zijn ingeklapt; kleur zoeken via het snelmenu
  await p.mouse.click(820, 430); await p.waitForSelector('.detail-panel'); ok(true, 'klik op een tegel opent het beeld'); await p.waitForTimeout(400);
  // Love werkt ook als het beeld groot open staat, met een hartje dat omhoog dwarrelt
  const was = await p.$eval('.detail-panel .like', e => e.classList.contains('on'));
  if (was) { await p.keyboard.press('l'); await p.waitForTimeout(200); }
  await p.keyboard.press('l'); await p.waitForTimeout(250);
  ok(await p.$$eval('.heart-float', e => e.length) === 1 && await p.$eval('.detail-panel .like', e => e.classList.contains('on')), 'L bij een geopend beeld: hartje dwarrelt omhoog en het hartje in het infovenster staat aan');
  await shot('7-beeld'); await p.waitForTimeout(1200);
  ok(await p.$$eval('.heart-float', e => e.length) === 0 && await p.$$eval('.field .lbl, .field label', e => e.every(x => getComputedStyle(x).textTransform === 'none')), 'het hartje verdwijnt weer; kopjes in het infovenster zijn gewone woorden, geen hoofdletters');
  // X gooit het geopende beeld weg, naar de prullenbak
  const t0 = +(await p.textContent('#nav .nav-item:has-text("Prullenbak") .count'));
  await p.keyboard.press('x'); await p.waitForTimeout(900);
  ok(await p.$eval('#detail', e => e.hidden) && +(await p.textContent('#nav .nav-item:has-text("Prullenbak") .count')) === t0 + 1, 'R gooit het geopende beeld weg: het staat in de prullenbak');
  await p.mouse.move(820, 430); await p.waitForTimeout(300); await p.keyboard.press('x'); await p.waitForTimeout(900);
  ok(+(await p.textContent('#nav .nav-item:has-text("Prullenbak") .count')) === t0 + 2, 'R op het beeld onder de muis gooit dat weg');
  await p.click('#nav >> text=Prullenbak'); await p.waitForSelector('.card'); await p.click('.card >> nth=0'); await p.click('.card >> nth=1'); await p.click('#selbar >> text=Terugzetten'); await p.waitForTimeout(400);
  ok(+(await p.textContent('#nav .nav-item:has-text("Prullenbak") .count')) === t0, 'en uit de prullenbak haal je ze gewoon terug');
  await p.click('#nav >> text=Alles'); await p.click('#mode >> text=Ontdek'); await p.waitForSelector('.wtile'); await p.waitForTimeout(300);
  ok(await p.$$eval('#nav .auto-dot', e => e.length) === 0, 'tags zijn ingeklapt');
  await p.click('.foldbtn'); await p.waitForTimeout(150); ok(await p.$$eval('#nav .auto-dot', e => e.length) > 0, 'klik op Tags klapt ze uit');
  await p.keyboard.press('Control+k'); await p.keyboard.type('kleur: blauw'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  ok((await p.textContent('#filters')).includes('Kleur'), 'zoeken op kleur zit in het snelmenu (⌘K)');
  // Dubbele beelden: hetzelfde bestand komt er niet nog eens bij; hetzelfde beeld in een andere maat wordt gemeld
  await p.waitForTimeout(1500);
  const nAll = async () => +(await p.textContent('#nav .nav-item:has-text("Alles") .count'));
  const n0 = await nAll();
  await p.setInputFiles('#file', path.join(src, 'groot-foto.png')); await p.waitForTimeout(900);
  ok(await nAll() === n0 && (await p.textContent('#toasts')).includes('stond al'), 'hetzelfde bestand nog eens toevoegen wordt overgeslagen, met een melding');
  ok(await p.$$eval('#nav .nav-item:has-text("Dubbele")', e => e.length) === 0, 'zonder dubbele staat er geen melding in de zijbalk');
  const klein = path.join(tmp, 'poster-klein.jpg');
  require('child_process').execFileSync('python3', ['-c', 'import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert("RGB")\nim.resize((im.width//2, im.height//2)).save(sys.argv[2], quality=88)', path.join(src, 'poster-oranje.jpg'), klein]);
  await p.setInputFiles('#file', klein); await p.waitForTimeout(1200);
  ok(await nAll() === n0 + 1 && await p.$$eval('#nav .nav-item:has-text("Dubbele") .warn svg', e => e.length) === 1 && (await p.textContent('#nav .nav-item:has-text("Dubbele") .count')) === '1', 'hetzelfde beeld in een andere maat: melding met driehoek in de zijbalk');
  await p.click('#nav >> text=Dubbele beelden'); await p.waitForSelector('.dupmark'); await p.waitForTimeout(500);
  ok(await p.$$eval('.dupmark', e => e.map(x => x.textContent).join()) === 'blijft,dubbel', 'de groep toont welk beeld blijft (het grootste) en welk dubbel is');
  if (shots) await p.screenshot({ path: path.join(shots, 'dubbele.png') });
  const tr0 = +(await p.textContent('#nav .nav-item:has-text("Prullenbak") .count'));
  await p.click('#filters >> text=Dubbele opruimen'); await p.click('#dlg .row button:has-text("Opruimen")'); await p.waitForTimeout(600);
  ok(+(await p.textContent('#nav .nav-item:has-text("Prullenbak") .count')) === tr0 + 1 && await nAll() === n0 && await p.$$eval('#nav .nav-item:has-text("Dubbele")', e => e.length) === 0, 'opruimen zet het kleinere beeld in de prullenbak en de melding verdwijnt');
  await p.click('[aria-label="Kleurfilter wissen"]'); await p.waitForTimeout(200);
  await p.click('#mode >> text=Ontdek'); await p.waitForSelector('.wtile'); await p.mouse.move(700, 300); await p.mouse.move(820, 430, { steps: 4 }); await p.waitForTimeout(300);
  await p.keyboard.press('l'); await p.waitForTimeout(250);
  if (!await p.$$eval('.wtile .ripple i', e => e.length)) { await p.keyboard.press('l'); await p.waitForTimeout(250); } // het beeld was al een favoriet
  ok(await p.$$eval('.wtile .ripple i', e => e.length) >= 3, 'een like geeft een rimpeling over het beeld');
  if (shots) await p.screenshot({ path: path.join(shots, 'rimpel.png') });
  await p.keyboard.press('l'); await p.waitForTimeout(300);
  // Soort beeld: keuzelijst onderin; zonder het beeldmodel biedt hij aan de soorten te herkennen
  ok((await p.$$eval('#soort option', e => e.map(x => x.textContent))).join('|') === 'Alle soorten|Soorten herkennen…', 'onderin staat een keuzelijst voor de soort beeld');
  { const its = await (await fetch(srv.url + 'api/store/items', { headers: { 'X-Collector': '1' } })).json(), one = its.find(i => i.type === 'image' && !i.trashed);
    one.auto = [...(one.auto || []), 'typografie']; await fetch(srv.url + 'api/store/items/' + one.id, { method: 'PUT', headers: { 'X-Collector': '1' }, body: JSON.stringify(one) }); }
  await p.reload(); await p.waitForFunction(() => [...document.querySelectorAll('#soort option')].some(o => o.textContent.startsWith('Typografie (1)')), null, { timeout: 20000 });
  await p.waitForFunction(() => !document.querySelector('#splash'), null, { timeout: 10000 }); await p.waitForTimeout(500);
  await p.selectOption('#soort', 'typografie'); await p.waitForTimeout(400);
  ok((await p.textContent('#filters')).includes('1 item') && (await p.textContent('#filters .chip')).includes('Typografie'), 'kiezen van een soort filtert de beelden en toont wat er gekozen is');
  await p.click('[aria-label="Soort wissen"]'); await p.waitForTimeout(300);
  // Snelle weergave: inzoomen met het wiel, plus en min, slepen en terug
  await p.click('#mode >> text=Ontdek'); await p.waitForSelector('.wtile'); await p.waitForTimeout(300);
  { const at = await p.evaluate(() => { for (const t of document.querySelectorAll('.wtile')) { const r = t.getBoundingClientRect(); if (r.left > 300 && r.top > 120 && r.bottom < innerHeight - 140 && r.right < innerWidth - 20) return [r.left + r.width / 2, r.top + r.height / 2]; } const r = document.querySelector('.wtile').getBoundingClientRect(); return [Math.max(320, r.left + 40), Math.max(200, Math.min(innerHeight - 200, r.top + 40))]; });
    await p.mouse.move(at[0] - 30, at[1] - 30); await p.mouse.move(at[0], at[1], { steps: 3 }); }
  await p.waitForTimeout(200); await p.keyboard.press(' '); await p.waitForSelector('#ql .ql-zoom');
  await p.mouse.move(760, 400); await p.mouse.wheel(0, -300); await p.waitForTimeout(200);
  const pct = async () => parseInt(await p.textContent('.ql-pct'), 10);
  const z1 = await pct(); ok(z1 > 100, 'scrollen in de snelle weergave zoomt in (' + z1 + '%)');
  await p.click('.ql-zoom button[aria-label="Inzoomen"]'); await p.waitForTimeout(300);
  const z2 = await pct(); ok(z2 > z1, 'de plus zoomt verder in (' + z2 + '%)');
  if (shots) await p.screenshot({ path: path.join(shots, 'zoom.png') });
  await p.mouse.move(760, 400); await p.mouse.down(); await p.mouse.move(700, 360, { steps: 3 }); await p.mouse.up(); await p.waitForTimeout(150);
  ok(await p.$eval('#ql', e => !e.hidden) && await pct() === z2, 'slepen schuift het beeld en sluit de weergave niet');
  await p.keyboard.press('-'); await p.waitForTimeout(250); ok(await pct() < z2, 'de mintoets zoomt uit');
  await p.keyboard.press('0'); await p.waitForTimeout(250); ok(await pct() === 100, '0 zet het beeld terug op passend');
  await p.keyboard.press(' '); await p.waitForTimeout(200); ok(await p.$eval('#ql', e => e.hidden), 'spatie sluit de snelle weergave');
  await p.click('#nav >> text=Najaar'); await p.waitForTimeout(400); await p.click('#filters >> text=Delen'); await p.waitForSelector('.share-canvas.polaroid');
  ok(await p.$eval('.share-canvas', c => c.width === 1080 && c.height === 1350), 'Delen tekent een polaroid van 1080 × 1350');
  if (shots) await p.screenshot({ path: path.join(shots, 'delen.png') });
  if (shots) fs.writeFileSync(path.join(shots, 'polaroid.png'), Buffer.from((await p.$eval('.share-canvas', c => c.toDataURL('image/png'))).split(',')[1], 'base64'));
  await p.click('.share-kinds >> text=Verhaal'); await p.waitForSelector('.share-canvas.verhaal');
  ok(await p.$eval('.share-canvas', c => c.height === 1920), 'en een verhaal van 1080 × 1920');
  if (shots) fs.writeFileSync(path.join(shots, 'verhaal.png'), Buffer.from((await p.$eval('.share-canvas', c => c.toDataURL('image/png'))).split(',')[1], 'base64'));
  await p.click('.share-kinds >> text=PDF'); await p.waitForSelector('.share-canvas.pdf');
  if (shots) fs.writeFileSync(path.join(shots, 'pdf-voorblad.png'), Buffer.from((await p.$eval('.share-canvas', c => c.toDataURL('image/png'))).split(',')[1], 'base64'));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#shareSave')]);
  const pdf = fs.readFileSync(await dl.path());
  ok(dl.suggestedFilename() === 'najaar.pdf' && pdf.subarray(0, 5).toString() === '%PDF-' && /\/Count 2\b/.test(pdf.toString('latin1')) && pdf.toString('latin1').trimEnd().endsWith('%%EOF'), 'de PDF heeft een voorblad en een blad met de beelden (' + Math.round(pdf.length / 1024) + ' kB)');
  if (shots) fs.writeFileSync(path.join(shots, 'najaar.pdf'), pdf);
  await p.click('#dlg >> text=Sluiten'); await p.waitForTimeout(200);
  const mcpState = async () => (await (await fetch(srv.url + 'api/info')).json()).assistant;
  await p.click('#btnSettings'); await p.waitForSelector('.settings');
  ok(await p.$$eval('#setMcpOn', e => e.length) === 0, 'de AI-assistent staat nog niet in Instellingen (wordt later aangekondigd)');
  await p.click('#dlg .row button:has-text("Sluiten")'); await p.keyboard.press('Control+k'); await p.keyboard.type('mcp'); await p.keyboard.press('Enter'); await p.waitForSelector('#setMcpOn');
  ok(!(await mcpState()).on && await p.$eval('#setMcpWrite', e => e.disabled), 'de assistent staat standaard uit en ordenen is dan niet te kiezen');
  await p.check('#setMcpOn'); await p.waitForTimeout(200);
  ok((await mcpState()).on && !(await mcpState()).write, 'aanzetten in Instellingen geeft de assistent alleen leesrecht');
  await p.check('#setMcpWrite'); await p.waitForTimeout(200); ok((await mcpState()).write, 'ordenen zet je apart aan');
  await p.$eval('#setMcpOn', e => e.scrollIntoView({ block: 'center' })); if (shots) await p.screenshot({ path: path.join(shots, 'assistent-instelling.png') });
  await p.click('#dlg >> text=Zo sluit je hem aan'); await p.waitForSelector('.asks li');
  ok(await p.$$eval('.asks li', e => e.length) === 6 && (await p.textContent('#dlg')).includes('Config bewerken'), 'de uitleg toont de stappen en voorbeeldvragen');
  if (shots) await p.screenshot({ path: path.join(shots, 'assistent-uitleg.png') });
  await p.click('#dlg .row button:has-text("Sluiten")'); await p.waitForTimeout(200);
  await p.keyboard.press('Control+k'); await p.keyboard.type('Bonjour'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  ok(await p.$$eval('.egg-hi span', e => e.length === 1 && e[0].textContent.length > 2), 'wie teruggroet in het snelmenu krijgt een groet terug');
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'groet.png') });
  await p.waitForTimeout(3000); ok(await p.$$eval('.egg-hi', e => e.length) === 0, 'en die verdwijnt vanzelf');
  ok(errs.length === 0, errs.length ? 'fouten: ' + errs.slice(0, 3).join(' / ') : 'geen fouten in de pagina');
  await browser.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? failed + ' mislukt' : 'Alles geslaagd'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message.slice(0, 400)); process.exit(1); });

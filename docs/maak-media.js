'use strict';
/**
 * Maakt de beelden voor de README: de kop (docs/kop.png) en een bewegende schermopname (docs/collector.gif).
 * Gebruik: node docs/maak-media.js <map met voorbeeldbeelden>   (zie docs/maak-voorbeelden.py)
 * Vereist Playwright met browsers en Python met Pillow.
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();
const { start } = require('../server/server');
const { krabbels } = require('../build/krabbels');
const font = f => fs.readFileSync(path.join(__dirname, '..', 'ui', 'assets', 'fonts', f)).toString('base64');

(async () => {
  const src = process.argv[2]; if (!src) throw new Error('Geef de map met voorbeeldbeelden op.');
  const browser = await chromium.launch();

  // ----- kop -----
  const W = 1600, H = 520;
  const { marks, INK } = krabbels({ W, H, seed0: 77, step: 40, quiet: (x, y) => Math.hypot((x - W / 2) / 420, (y - H / 2) / 190) < 1 });
  const icon = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.png')).toString('base64');
  const kop = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await kop.setContent(`<style>@font-face{font-family:IS;font-weight:600;src:url(data:font/woff2;base64,${font('instrument-sans-latin-600-normal.woff2')})}@font-face{font-family:IS;font-weight:400;src:url(data:font/woff2;base64,${font('instrument-sans-latin-400-normal.woff2')})}
    body{margin:0;position:relative;width:${W}px;height:${H}px;background:#fbfaf6;font-family:IS,sans-serif;color:${INK}}svg{position:absolute;inset:0}
    .mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
    img{width:150px;height:150px;filter:drop-shadow(0 10px 24px rgba(6,43,30,.16))}h1{font:600 76px/1 IS;letter-spacing:-.035em;margin:6px 0 0}p{font:400 27px/1.3 IS;margin:8px 0 0;opacity:.78}</style>
    <svg viewBox="0 0 ${W} ${H}"><g fill="none" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">${marks}</g></svg>
    <div class="mid"><img src="data:image/png;base64,${icon}"><h1>Collector</h1><p>Verzamel, orden en vind je beeldreferenties terug.</p></div>`);
  await kop.waitForTimeout(300);
  await kop.screenshot({ path: path.join(__dirname, 'kop.png') }); await kop.close();

  // ----- bewegende schermopname -----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-media-'));
  const srv = await start({ library: path.join(tmp, 'Afbeeldingen', 'Collector'), cache: path.join(tmp, 'c') });
  const p = await (await browser.newContext({ viewport: { width: 1200, height: 750 }, deviceScaleFactor: 1 })).newPage();
  await p.goto(srv.url); await p.waitForSelector('.empty h2');
  await p.setInputFiles('#file', fs.readdirSync(src).filter(f => /\.(jpe?g|png)$/i.test(f)).map(f => path.join(src, f)));
  await p.waitForSelector('.wtile', { timeout: 120000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  const frames = path.join(tmp, 'frames'); fs.mkdirSync(frames); let n = 0;
  const film = async ms => { const end = Date.now() + ms; while (Date.now() < end) await p.screenshot({ path: path.join(frames, String(n++).padStart(4, '0') + '.png') }); };
  await p.mouse.move(120, 400); await film(1700);                                   // de wand drijft
  await p.mouse.move(700, 360, { steps: 8 }); await film(350);
  await p.keyboard.press('l'); await film(550);                                     // love
  for (const [x, y] of [[700, 360], [420, 250], [1000, 520]]) { await p.mouse.move(x, y, { steps: 6 }); await film(200); await p.keyboard.press('c'); await film(800); } // collect
  await p.mouse.move(90, 690, { steps: 10 }); await film(1500);                     // de waaier gaat open
  await p.mouse.move(700, 330, { steps: 10 }); await film(900);
  await browser.close(); await srv.close();
  execFileSync('python3', ['-I', '-c', `
import sys, glob
from PIL import Image
fr = sorted(glob.glob(sys.argv[1] + '/*.png'))
ims = [Image.open(f).convert('RGB').resize((840, 525), Image.LANCZOS) for f in fr]
pal = ims[len(ims)//2].quantize(colors=160, method=Image.MEDIANCUT)
q = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im in ims]
q[0].save(sys.argv[2], save_all=True, append_images=q[1:], duration=int(sys.argv[3]), loop=0, optimize=True)
print(len(q), 'beelden')
`, frames, path.join(__dirname, 'collector.gif'), String(Math.round(8400 / n))], { stdio: 'inherit' });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('kop.png ' + fs.statSync(path.join(__dirname, 'kop.png')).size + ' bytes, collector.gif ' + (fs.statSync(path.join(__dirname, 'collector.gif')).size / 1e6).toFixed(1) + ' MB');
})().catch(e => { console.error(e.message); process.exit(1); });

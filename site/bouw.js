'use strict';
/**
 * Bouwt de website (landingspagina, demo, "Wat is er nieuw", nieuws voor de app).
 * Gebruik: node site/bouw.js <doelmap> <map met voorbeeldbeelden>
 * De voorbeeldbeelden komen van docs/maak-voorbeelden.py. Vereist Python met Pillow.
 * Het resultaat hoort in de map collector/ van de repo patrickloonstra/dev.
 */
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..'), out = path.resolve(process.argv[2] || ''), samples = process.argv[3];
if (!process.argv[2] || !samples) { console.error('Gebruik: node site/bouw.js <doelmap> <map met voorbeeldbeelden>'); process.exit(1); }
const cp = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true }); };
const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');

fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const version = require(path.join(root, 'package.json')).version;
let commit = 'onbekend'; try { commit = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD']).toString().trim(); } catch { /* geen git */ }
const pubdate = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Amsterdam' }).format(new Date());
const fill = html => html
  .replaceAll('__DMG__', 'https://github.com/patrickloonstra/collector/releases/latest/download/Collector.dmg')
  .replaceAll('__CONTACT__', 'https://patrickloonstra.nl')
  .replaceAll('__VERSION__', version).replaceAll('__PUBDATE__', pubdate).replaceAll('__COMMIT__', commit);

// landingspagina
fs.writeFileSync(path.join(out, 'index.html'), fill(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')));
cp(path.join(__dirname, 'site.css'), path.join(out, 'site.css'));
cp(path.join(__dirname, 'nieuws.json'), path.join(out, 'nieuws.json'));
cp(path.join(root, 'ui', 'assets', 'icon.svg'), path.join(out, 'assets', 'icon.svg'));
cp(path.join(root, 'ui', 'assets', 'krabbels.svg'), path.join(out, 'assets', 'krabbels.svg'));
cp(path.join(__dirname, 'fonts'), path.join(out, 'fonts'));
cp(path.join(root, 'docs', 'kop.png'), path.join(out, 'media', 'kop.png'));
cp(path.join(root, 'docs', 'collector.gif'), path.join(out, 'media', 'collector.gif'));
fs.writeFileSync(path.join(out, '.htaccess'), '# Nog niet vindbaar voor zoekmachines zolang dit op het dev-adres staat.\n<IfModule mod_headers.c>\n  Header set X-Robots-Tag "noindex, nofollow, noimageindex, noarchive"\n  <FilesMatch "\\.(html|js|css|json)$">\n    Header set Cache-Control "no-cache"\n  </FilesMatch>\n</IfModule>\n');

// demo: de echte interface, zonder het AI-model, met eigen voorbeeldbeelden
const demo = path.join(out, 'demo');
for (const f of ['app.js', 'app.css', 'assets']) cp(path.join(root, 'ui', f), path.join(demo, f));
fs.writeFileSync(path.join(demo, 'index.html'), fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8').replace('<html lang="nl">', '<html lang="nl" data-demo>'));
const vb = path.join(demo, 'voorbeelden'); fs.mkdirSync(vb);
execFileSync('python3', ['-I', '-c', `
import sys, os, json
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
names = sorted(f for f in os.listdir(src) if f.lower().endswith(('.jpg', '.jpeg', '.png')))[:24]
for n in names:
    im = Image.open(os.path.join(src, n)).convert('RGB'); im.thumbnail((900, 900)); im.save(os.path.join(dst, os.path.splitext(n)[0] + '.jpg'), quality=80)
json.dump([os.path.splitext(n)[0] + '.jpg' for n in names], open(os.path.join(dst, 'lijst.json'), 'w'), ensure_ascii=False)
`, samples, vb], { stdio: 'inherit' });

// Wat is er nieuw
const log = fs.readFileSync(path.join(root, 'WIJZIGINGEN.md'), 'utf8').split(/^## /m).slice(1).map(block => {
  const [head, ...rest] = block.split('\n');
  const items = rest.join('\n').split(/^- /m).slice(1).map(x => '<li>' + md(x.trim().replace(/\s*\n\s*/g, ' ')) + '</li>').join('');
  return `<section id="v${esc(head.trim())}"><h2>${esc(head.trim())}</h2><ul>${items}</ul></section>`;
}).join('\n');
fs.mkdirSync(path.join(out, 'wijzigingen'));
fs.writeFileSync(path.join(out, 'wijzigingen', 'index.html'), fill(`<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wat is er nieuw · Collector</title><meta name="robots" content="noindex, nofollow">
<link rel="icon" href="../assets/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="../site.css"><base href="../"></head><body>
<header class="nav"><a class="brand" href="./"><img src="assets/icon.svg" alt="" width="26" height="26"><span>Collector</span></a><nav aria-label="Pagina"><a href="./#demo">Demo</a><a href="./#kopen">Prijs</a></nav><a class="btn dark small" href="__DMG__">Download</a></header>
<main class="log"><h1>Wat is er nieuw</h1><p class="lead">Collector werkt zichzelf bij. Hier lees je wat er per versie veranderde.</p>
${log}
</main><footer><p>Gemaakt door <a href="https://patrickloonstra.nl">Patrick Loonstra</a></p><p class="fine">Versie __VERSION__ · gepubliceerd __PUBDATE__ · bron __COMMIT__</p></footer></body></html>`));
const size = d => fs.readdirSync(d, { withFileTypes: true }).reduce((t, e) => t + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log('Website gebouwd in ' + out + ' (' + (size(out) / 1e6).toFixed(1) + ' MB), versie ' + version + ', bron ' + commit);

'use strict';
/**
 * Tekent de achtergrond van het installatievenster: een patroon van kleine handgetekende krabbels.
 * Gebruik: node build/dmg-background.js   (Playwright met browsers nodig; de PNG's staan in de repo)
 */
const fs = require('fs'), path = require('path');
const W = 540, H = 380, INK = '#062b1e', PAPER = '#fbfaf6';
const { krabbels } = require('./krabbels');
// Rustige plekken: rond het app-icoon, de pijl en de map Programma's, en de namen eronder.
const quiet = (x, y) => Math.hypot((x - 140) / 82, (y - 222) / 92) < 1 || Math.hypot((x - 400) / 82, (y - 222) / 92) < 1 || (Math.abs(x - 270) < 62 && Math.abs(y - 208) < 34);
const { marks, S } = krabbels({ W, H, quiet });
// Handgetekende pijl van de app naar de map
const arrow = `<g stroke-width="2.6" opacity=".95"><path d="${S([[226, 212], [244, 205], [262, 211], [282, 204], [304, 209]])}"/><path d="${S([[291, 196], [300, 203], [307, 209]])}"/><path d="${S([[307, 209], [299, 216], [290, 223]])}"/></g>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${PAPER}"/><g fill="none" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">${marks}${arrow}</g></svg>`;
fs.writeFileSync(path.join(__dirname, 'dmg-background.svg'), svg);
(async () => {
  const { chromium } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();
  const b = await chromium.launch();
  for (const [scale, name] of [[1, 'dmg-background.png'], [2, 'dmg-background@2x.png']]) {
    const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
    await p.setContent('<body style="margin:0">' + svg + '</body>');
    await p.screenshot({ path: path.join(__dirname, name) }); await p.close();
  }
  if (process.argv[2]) { // voorbeeld met de iconen erop, om het resultaat te beoordelen
    const icon = fs.readFileSync(path.join(__dirname, 'icon.png')).toString('base64');
    const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    await p.setContent(`<body style="margin:0;position:relative;font:12px -apple-system,Helvetica,sans-serif">${svg}
      <img src="data:image/png;base64,${icon}" style="position:absolute;left:92px;top:162px;width:96px;height:96px">
      <div style="position:absolute;left:70px;top:262px;width:140px;text-align:center">Collector.app</div>
      <div style="position:absolute;left:352px;top:166px;width:96px;height:80px;border-radius:10px;background:linear-gradient(#8ec5f5,#4a9be8)"></div>
      <div style="position:absolute;left:330px;top:262px;width:140px;text-align:center">Applications</div></body>`);
    await p.screenshot({ path: process.argv[2] }); await p.close();
  }
  await b.close();
})();

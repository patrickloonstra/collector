'use strict';
/** Kleine handgetekende krabbels als patroon. Gebruikt voor het installatievenster en de kop van de README. */
const INK = '#062b1e';
function krabbels({ W, H, quiet = () => false, seed0 = 20261126, step = 34 }) {
  let seed = seed0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const r = (a, b) => a + rnd() * (b - a), j = v => v + r(-0.9, 0.9);
  const P = pts => pts.map((p, i) => (i ? 'L' : 'M') + j(p[0]).toFixed(1) + ' ' + j(p[1]).toFixed(1)).join(' ');
  /** Vloeiende lijn door punten (handschrift-gevoel). */
  const S = pts => { let d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1); for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; d += ' Q' + j(a[0]).toFixed(1) + ' ' + j(a[1]).toFixed(1) + ' ' + ((a[0] + b[0]) / 2).toFixed(1) + ' ' + ((a[1] + b[1]) / 2).toFixed(1); } const l = pts[pts.length - 1]; return d + ' L' + l[0].toFixed(1) + ' ' + l[1].toFixed(1); };
  const kinds = [
    () => S(Array.from({ length: 26 }, (_, i) => { const a = i / 25 * Math.PI * 6; return [-9 + i * 0.72 + 4.2 * Math.sin(a), 4.2 * Math.cos(a)]; })),            // lusjes
    () => P(Array.from({ length: 6 }, (_, i) => [-9 + i * 3.6, i % 2 ? -4 : 4])),                                                                              // zigzag
    () => S(Array.from({ length: 17 }, (_, i) => [-9 + i * 1.12, 3.6 * Math.sin(i / 16 * Math.PI * 4)])),                                                      // golfje
    () => S(Array.from({ length: 14 }, (_, i) => { const a = 0.7 + i / 13 * 4.9; return [6 * Math.cos(a), 6 * Math.sin(a)]; })),                               // c'tje
    () => P([[-5, 0], [5, 0]]) + ' ' + P([[0, -5], [0, 5]]),                                                                                                  // kruisje
    () => [0, 1, 2].map(k => { const a = k * Math.PI / 3; return P([[-5 * Math.cos(a), -5 * Math.sin(a)], [5 * Math.cos(a), 5 * Math.sin(a)]]); }).join(' '),  // sterretje
    () => [-4, 0, 4].map(x => P([[x - 2, 5], [x + 2, -5]])).join(' '),                                                                                        // arcering
    () => S(Array.from({ length: 30 }, (_, i) => { const a = i / 29 * Math.PI * 4.6, q = 1 + i * 0.2; return [q * Math.cos(a), q * Math.sin(a)]; })),          // krul
    () => S(Array.from({ length: 13 }, (_, i) => { const a = i / 12 * Math.PI * 2.1; return [5 * Math.cos(a), 5 * Math.sin(a)]; })),                           // rondje
    () => P([[-6, 3], [-2, -4], [1, 2], [5, -3]]),                                                                                                            // bliksempje
    () => S([[-7, 2], [-3, -3], [0, 3], [3, -3], [7, 2]]),                                                                                                    // boogjes
  ];
  const dots = () => Array.from({ length: 3 }, (_, i) => `<circle cx="${(-5 + i * 5 + r(-1, 1)).toFixed(1)}" cy="${r(-1.5, 1.5).toFixed(1)}" r="1.15" fill="${INK}" stroke="none"/>`).join('');
  let marks = '';
  for (let cy = step / 2 - 4; cy < H + 10; cy += step) for (let cx = ((Math.round(cy / step) % 2) * step) / 2 + 6; cx < W + 10; cx += step) {
    const x = cx + r(-7, 7), y = cy + r(-7, 7);
    if (quiet(x, y)) continue;
    const rot = r(-40, 40), sc = r(0.82, 1.18), op = r(0.5, 0.92).toFixed(2), w = r(1.25, 1.75).toFixed(2);
    const k = Math.floor(rnd() * (kinds.length + 1));
    marks += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(0)}) scale(${sc.toFixed(2)})" opacity="${op}" stroke-width="${w}">${k === kinds.length ? dots() : `<path d="${kinds[k]()}"/>`}</g>`;
  }
  return { marks, S, INK };
}
module.exports = { krabbels, INK };

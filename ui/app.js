/* Collector: verzamel, orden en vind beeldreferenties terug. Alles staat lokaal in IndexedDB. */
(() => {
'use strict';

// ---------- Hulpjes ----------
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
function toast(msg, ms = 2600) {
  const t = h('div', { class: 'toast', text: msg });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}
/** Fouten gaan in de app naar het logboek, zodat ze terug te vinden zijn. */
function logError(text) {
  console.warn(text);
  if (document.documentElement.dataset.store === 'http') fetch('api/log', { method: 'POST', headers: { 'X-Collector': '1' }, body: String(text).slice(0, 4000) }).catch(() => {});
}
addEventListener('error', e => logError('Fout in de interface: ' + (e.error && e.error.stack || e.message)));
addEventListener('unhandledrejection', e => logError('Fout in de interface: ' + (e.reason && e.reason.stack || e.reason)));
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const fmtDate = ts => new Date(ts).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' kB';
function domainOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
function isUrl(s) { return /^https?:\/\/\S+$/i.test(s.trim()); }

// ---------- Opslag ----------
const IdbDB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('collector', 3);
      r.onupgradeneeded = () => {
        const d = r.result, mk = (s, o) => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, o); };
        for (const s of ['libs', 'items', 'spaces', 'cols']) mk(s, { keyPath: 'id' });
        for (const s of ['thumbs', 'fulls', 'meta', 'embs']) mk(s);
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  req(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r ? r.result : undefined);
      t.onerror = t.onabort = () => rej(t.error);
    });
  },
  all(s) { return this.req(s, 'readonly', o => o.getAll()); },
  async entries(s) {
    const t = this.db.transaction(s, 'readonly'), o = t.objectStore(s), k = o.getAllKeys(), v = o.getAll();
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    return k.result.map((key, i) => [key, v.result[i]]);
  },
  get(s, k) { return this.req(s, 'readonly', o => o.get(k)); },
  put(s, v, k) { return this.req(s, 'readwrite', o => k === undefined ? o.put(v) : o.put(v, k)); },
  del(s, k) { return this.req(s, 'readwrite', o => o.delete(k)); },
};

/** In de Mac-app: dezelfde opslaglaag, maar dan naar de bibliotheekmap op schijf via de lokale server. */
const HttpDB = {
  http: true, info: null,
  blob: s => s === 'thumbs' || s === 'fulls' || s === 'embs',
  async call(method, url, body, headers) {
    const r = await fetch('api/' + url, { method, body, headers: { 'X-Collector': '1', ...(headers || {}) } });
    if (!r.ok) { let why = ''; try { why = (await r.json()).error || ''; } catch (e) { /* geen uitleg */ } throw new Error(why || 'fout ' + r.status); }
    return r;
  },
  async open() { this.info = await (await this.call('GET', 'info')).json(); },
  async all(s) { return (await this.call('GET', 'store/' + s)).json(); },
  async entries() {
    const o = await (await this.call('GET', 'embeddings')).json();
    return Object.entries(o).map(([id, b64]) => [id, new Float32Array(Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer)]);
  },
  async get(s, k) {
    if (s === 'meta') return (await this.call('GET', 'meta/' + encodeURIComponent(k))).json();
    if (this.blob(s)) { const r = await fetch('api/blob/' + s + '/' + encodeURIComponent(k)); return r.ok ? r.blob() : undefined; }
    return (await this.call('GET', 'store/' + s + '/' + encodeURIComponent(k))).json();
  },
  async put(s, v, k, opt) {
    if (s === 'meta') return this.call('PUT', 'meta/' + encodeURIComponent(k), JSON.stringify(v));
    if (this.blob(s)) {
      const body = v instanceof Blob ? v : new Blob([v]);
      const head = { 'Content-Type': (v instanceof Blob && v.type) || 'application/octet-stream' };
      if (opt && opt.name) head['X-Name'] = encodeURIComponent(opt.name);
      return this.call('PUT', 'blob/' + s + '/' + encodeURIComponent(k), body, head);
    }
    return this.call('PUT', 'store/' + s + '/' + encodeURIComponent(v.id), JSON.stringify(v));
  },
  async del(s, k) { return this.call('DELETE', (this.blob(s) ? 'blob/' : 'store/') + s + '/' + encodeURIComponent(k)); },
};
const DB = document.documentElement.dataset.store === 'http' ? HttpDB : IdbDB;

const state = {
  libs: [], items: [], spaces: [], cols: [],
  libId: null,
  view: { kind: 'all' },      // all | bookmarks | unsorted | trash | tag | col | collections | space (= canvas van een collectie)
  sort: 'new',
  q: '', color: null,
  selected: new Set(),
  size: 200, gap: 1, radius: 0,
  display: 'wall',   // wall (Ontdek) of grid (Raster)
  bak: [],           // verzamelbak: ids die je met C hebt opgepakt
  tagsOpen: false,
};
const urls = { thumb: new Map(), full: new Map() };
function blobUrl(kind, id) {
  const m = urls[kind];
  if (!m.has(id)) m.set(id, DB.get(kind === 'thumb' ? 'thumbs' : 'fulls', id).then(b => b ? URL.createObjectURL(b) : ''));
  return m.get(id);
}
function dropUrls(id) {
  for (const m of [urls.thumb, urls.full]) { const p = m.get(id); if (p) p.then(u => u && URL.revokeObjectURL(u)); m.delete(id); }
}
const saveMeta = () => DB.put('meta', { libId: state.libId, size3: state.size, gap: state.gap, radius: state.radius, bak: state.bak, tagsOpen: state.tagsOpen, sort: state.sort, ai: AI.on }, 'settings');
const libItems = () => state.items.filter(i => i.lib === state.libId && !i.trashed);
const trashItems = () => state.items.filter(i => i.lib === state.libId && i.trashed);
const libCols = () => state.cols.filter(c => c.lib === state.libId);
const colItems = id => libItems().filter(i => (i.cols || []).includes(id));
const curCols = () => state.view.kind === 'col' || state.view.kind === 'space' ? [state.view.id] : [];
const hasSource = i => i.type === 'link' || isUrl(i.source || '');
const visual = it => it.type === 'image' || !!it.remote;
const allTags = it => [...(it.tags || []), ...(it.auto || [])];

// ---------- Kleur ----------
const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const rgbOf = hx => [1, 3, 5].map(i => parseInt(hx.slice(i, i + 2), 16));
function dist(a, b) { // "redmean": goedkope benadering van waargenomen kleurverschil
  const rm = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let hh = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh = (hh * 60 + 360) % 360;
  }
  return [hh, s, l];
}
function colorName(rgb) {
  const [hh, s, l] = hsl(rgb);
  if (l < 0.13) return 'zwart';
  if (l > 0.9 && s < 0.25) return 'wit';
  if (s < 0.13) return 'grijs';
  if (hh >= 18 && hh < 62 && s < 0.4 && l > 0.68) return 'beige';
  if (hh >= 10 && hh < 48 && l < 0.38) return 'bruin';
  if (hh < 14 || hh >= 345) return 'rood';
  if (hh < 42) return 'oranje';
  if (hh < 68) return 'geel';
  if (hh < 165) return 'groen';
  if (hh < 195) return 'turquoise';
  if (hh < 248) return 'blauw';
  if (hh < 292) return 'paars';
  return 'roze';
}
function paletteOf(data) {
  const bins = new Map(); let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5);
    let bin = bins.get(key);
    if (!bin) bins.set(key, bin = [0, 0, 0, 0]);
    bin[0] += r; bin[1] += g; bin[2] += b; bin[3]++; n++;
  }
  if (!n) return [];
  const sorted = [...bins.values()].map(b => ({ rgb: [b[0] / b[3], b[1] / b[3], b[2] / b[3]], c: b[3] })).sort((a, b) => b.c - a.c);
  const picked = [];
  for (const s of sorted) {
    const near = picked.find(p => dist(p.rgb, s.rgb) < 70);
    if (near) near.c += s.c;
    else if (picked.length < 6) picked.push({ rgb: s.rgb, c: s.c });
  }
  return picked.sort((a, b) => b.c - a.c).map(p => ({ hex: hex(...p.rgb), pct: Math.round(p.c / n * 100) })).filter(p => p.pct >= 2);
}
function autoTags({ palette, w, h: hh, mime, name }) {
  const t = [];
  for (const p of palette) { if (p.pct < 14) continue; const nm = colorName(rgbOf(p.hex)); if (!t.includes(nm)) t.push(nm); if (t.length >= 3) break; }
  if (palette.length) {
    const tot = palette.reduce((a, p) => a + p.pct, 0) || 1;
    const lum = palette.reduce((a, p) => a + hsl(rgbOf(p.hex))[2] * p.pct, 0) / tot;
    const sat = palette.reduce((a, p) => a + hsl(rgbOf(p.hex))[1] * p.pct, 0) / tot;
    if (lum < 0.28) t.push('donker'); else if (lum > 0.78) t.push('licht');
    if (sat < 0.1) t.push('zwart-wit'); else if (sat > 0.6) t.push('kleurrijk');
  }
  if (w && hh) t.push(w / hh > 1.15 ? 'liggend' : w / hh < 0.87 ? 'staand' : 'vierkant');
  if (/gif/.test(mime || '')) t.push('gif');
  if (/svg/.test(mime || '')) t.push('vector');
  if (/^(screenshot|schermafbeelding|cleanshot)/i.test(name || '')) t.push('screenshot');
  return t;
}

// ---------- Beeld analyseren ----------
async function loadBitmap(blob) {
  try { return await createImageBitmap(blob); } catch { /* bv. SVG in sommige browsers */ }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Geen afbeelding')); img.src = url; });
    if (!img.naturalWidth) { img.width = 800; img.height = 600; }
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
async function analyse(blob) {
  const bmp = await loadBitmap(blob);
  const w = bmp.width || bmp.naturalWidth, hh = bmp.height || bmp.naturalHeight;
  const sc = Math.min(1, 720 / w, 1800 / hh);
  const c = h('canvas'); c.width = Math.max(1, Math.round(w * sc)); c.height = Math.max(1, Math.round(hh * sc));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const thumb = await new Promise(res => c.toBlob(b => res(b), 'image/webp', 0.82));
  const s = h('canvas'); s.width = s.height = 48;
  const sx = s.getContext('2d', { willReadFrequently: true });
  sx.drawImage(bmp, 0, 0, 48, 48);
  const palette = paletteOf(sx.getImageData(0, 0, 48, 48).data);
  if (bmp.close) bmp.close();
  return { w, h: hh, thumb: thumb || blob, palette };
}

// ---------- Toevoegen ----------
let askedPersist = false;
async function addImage(blob, meta = {}) {
  let info;
  try { info = await analyse(blob); } catch (e) { throw Object.assign(new Error('kan dit beeld niet lezen'), { kind: 'decode' }); }
  const item = {
    id: uid(), lib: state.libId, type: 'image',
    title: meta.title || '', note: '', source: meta.source || '',
    cols: curCols(), tags: meta.tags || [], auto: autoTags({ palette: info.palette, w: info.w, h: info.h, mime: blob.type, name: meta.name }),
    palette: info.palette, w: info.w, h: info.h, mime: blob.type, size: blob.size, created: Date.now(),
  };
  if (item.source) { const d = domainOf(item.source); if (d) item.auto.push(d); }
  if (meta.adopt) await DB.call('POST', 'adopt', JSON.stringify({ id: item.id, name: meta.adopt }), { 'Content-Type': 'application/json' });
  else await DB.put('fulls', blob, item.id, { name: meta.name || item.title });
  await DB.put('thumbs', info.thumb, item.id);
  await DB.put('items', item);
  state.items.unshift(item);
  if (!askedPersist && navigator.storage && navigator.storage.persist) { askedPersist = true; navigator.storage.persist().catch(() => {}); }
  return item;
}
async function addLink(url, remoteImage, meta = {}) {
  const d = domainOf(meta.page || url);
  const item = {
    id: uid(), lib: state.libId, type: 'link', url, remote: remoteImage ? url : '',
    title: meta.title || '', note: '', source: meta.page || url, cols: curCols(), tags: [], auto: [remoteImage ? 'afbeelding' : 'link', d].filter(Boolean),
    palette: [], created: Date.now(),
  };
  await DB.put('items', item);
  state.items.unshift(item);
  return item;
}
async function addNote(text) {
  const item = { id: uid(), lib: state.libId, type: 'note', text: String(text).slice(0, 20000), title: '', note: '', source: '', cols: curCols(), tags: [], auto: ['notitie'], palette: [], created: Date.now() };
  await DB.put('items', item); state.items.unshift(item);
  return item;
}
async function addUrl(url, meta = {}) {
  url = url.trim();
  const looksImage = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(url) || url.startsWith('data:image/');
  try {
    const r = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
    const b = await r.blob();
    if (r.ok && b.type.startsWith('image/')) return await addImage(b, { source: meta.page || (url.startsWith('data:') ? '' : url), title: meta.title });
  } catch { /* andere site staat ophalen niet toe: dan bewaren we de link */ }
  if (url.startsWith('data:')) throw new Error('Kon de afbeelding niet lezen');
  return addLink(url, looksImage || meta.image, meta);
}
async function addFiles(files, extra) {
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  const out = [];
  for (const f of imgs) {
    try { out.push(await addImage(f, { name: f.name, title: (f.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/^image$/i, ''), ...extra })); }
    catch (e) {
      const name = f.name || 'bestand';
      toast(e.kind === 'decode' ? name + ': dit bestandstype kan Collector nog niet openen' : name + ' bewaren mislukt: ' + e.message, 6000);
      logError('Toevoegen mislukt: ' + name + ' (' + (f.type || 'onbekend type') + ', ' + f.size + ' bytes): ' + (e.stack || e.message));
    }
  }
  return out;
}
/** Verwerkt een drop of plakactie. Geeft de nieuwe items terug. */
async function ingest(dt) {
  const out = [];
  if (dt.files && dt.files.length) out.push(...await addFiles(dt.files));
  if (!out.length) {
    const html = dt.getData && dt.getData('text/html');
    const uri = dt.getData && (dt.getData('text/uri-list') || dt.getData('text/plain'));
    let url = '';
    if (html) { const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html); if (m) url = m[1].replace(/&amp;/g, '&'); }
    if (!url && uri) url = uri.split(/\r?\n/).find(l => l && !l.startsWith('#')) || '';
    if (url && (isUrl(url) || url.startsWith('data:image/'))) {
      try { out.push(await addUrl(url)); } catch (e) { toast(e.message); }
    }
  }
  return out;
}
function afterAdd(items) {
  if (!items.length) return;
  toast(items.length === 1 ? 'Toegevoegd' : items.length + ' items toegevoegd');
  renderAll();
  aiIndex();
}
async function screenshot() {
  let stream;
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true }); }
  catch { return; }
  try {
    const v = h('video'); v.srcObject = stream; v.muted = true; await v.play();
    await new Promise(r => setTimeout(r, 350));
    const c = h('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const it = await addImage(blob, { title: 'Schermafbeelding ' + new Date().toLocaleString('nl-NL'), tags: ['screenshot'] });
    afterAdd([it]);
  } finally { stream.getTracks().forEach(t => t.stop()); }
}

// ---------- Voorbeelden ----------
async function addSamples() {
  const specs = [
    ['Zonsondergang', 900, 1200, ['#ff7a3d', '#ffd166', '#7b2d5b']],
    ['Diepzee', 1200, 800, ['#0b2545', '#13a4b4', '#8de4d5']],
    ['Mos', 1000, 1000, ['#2f4f2f', '#8fbf5a', '#e8f0c2']],
    ['Inkt', 800, 1100, ['#111111', '#555555', '#f4f4f4']],
    ['Kersenbloesem', 1200, 900, ['#ffd6e0', '#ff8fab', '#fff6f0']],
    ['Terracotta', 900, 900, ['#b5532a', '#e8b98a', '#3a2418']],
    ['Lavendel', 800, 1200, ['#5e3fbf', '#c9b6ff', '#f3eefe']],
    ['Signaal', 1400, 800, ['#ffe600', '#111111', '#ff2e2e']],
  ];
  const out = [];
  for (const [name, w, hh, cols] of specs) {
    const c = h('canvas'); c.width = w; c.height = hh;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w * 0.3, hh);
    g.addColorStop(0, cols[0]); g.addColorStop(1, cols[1]);
    x.fillStyle = g; x.fillRect(0, 0, w, hh);
    x.fillStyle = cols[2];
    x.beginPath(); x.arc(w * 0.68, hh * 0.36, Math.min(w, hh) * 0.24, 0, 7); x.fill();
    x.fillStyle = cols[0]; x.globalAlpha = 0.85;
    x.fillRect(w * 0.1, hh * 0.62, w * 0.42, hh * 0.26);
    x.globalAlpha = 1;
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    out.push(await addImage(blob, { title: name, tags: ['voorbeeld'] }));
  }
  afterAdd(out);
}

// ---------- Filteren ----------
const shuffleKeys = new Map();
const shuffleKey = id => { if (!shuffleKeys.has(id)) shuffleKeys.set(id, Math.random()); return shuffleKeys.get(id); };
function sortItems(a) {
  const key = i => { const p = i.palette && i.palette[0]; if (!p) return 1000; const c = hsl(rgbOf(p.hex)); return c[1] < 0.13 ? 500 + c[2] * 100 : c[0]; };
  a = a.slice();
  if (state.sort === 'old') a.sort((x, y) => x.created - y.created);
  else if (state.sort === 'title') a.sort((x, y) => (x.title || '\uffff').localeCompare(y.title || '\uffff', 'nl'));
  else if (state.sort === 'color') a.sort((x, y) => key(x) - key(y));
  else if (state.sort === 'shuffle') a.sort((x, y) => shuffleKey(x.id) - shuffleKey(y.id));
  else a.sort((x, y) => y.created - x.created);
  return a;
}
function visibleItems() {
  const v = state.view;
  let a = v.kind === 'trash' ? trashItems() : libItems();
  if (v.kind === 'unsorted') a = a.filter(i => !(i.cols || []).length);
  else if (v.kind === 'bookmarks') a = a.filter(hasSource);
  else if (v.kind === 'liked') a = a.filter(i => i.liked);
  else if (v.kind === 'tag') a = a.filter(i => allTags(i).includes(v.tag));
  else if (v.kind === 'col') a = a.filter(i => (i.cols || []).includes(v.id));
  const toks = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  let ranked = false;
  if (toks.length) {
    const lit = new Set(a.filter(i => {
      const hay = [i.title, i.note, i.text, i.source, i.url, ...allTags(i), ...(i.cols || []).map(id => (state.cols.find(c => c.id === id) || {}).name), ...(i.palette || []).map(p => p.hex)].join(' ').toLowerCase();
      return toks.every(t => hay.includes(t));
    }));
    if (AI.on && AI.qEmb && AI.qText === state.q) { // AI: wat er op het beeld te zien is
      // Score ten opzichte van hoe sterk een beeld op willekeurige tekst reageert; dat maakt de grens bruikbaar.
      const sc = a.map(i => { const e = AI.embs.get(i.id); return [i, e ? dot(AI.qEmb, e) - aiBase(i.id, e) : -1]; });
      AI.scores = new Map(sc.map(x => [x[0].id, x[1]]));
      const top = Math.max(0, ...sc.map(x => x[1]));
      a = sc.filter(x => lit.has(x[0]) || (x[1] >= AI_MIN && x[1] >= top - AI_BAND)).sort((x, y) => (lit.has(y[0]) - lit.has(x[0])) || y[1] - x[1]).map(x => x[0]);
      ranked = true;
    } else a = a.filter(i => lit.has(i));
  }
  if (!state.color) return ranked ? a : sortItems(a);
  const c = rgbOf(state.color);
  return a.map(i => {
    let best = Infinity;
    for (const p of i.palette || []) if (p.pct >= 4) best = Math.min(best, dist(c, rgbOf(p.hex)) - Math.min(p.pct, 40) * 0.6);
    return [i, best];
  }).filter(x => x[1] < 115).sort((x, y) => x[1] - y[1]).map(x => x[0]);
}
/** Beelden met een vergelijkbaar kleurpalet. */
function similar(it, n = 6) {
  const e = AI.on && AI.embs.get(it.id);
  if (e) return libItems().filter(o => o.id !== it.id && AI.embs.has(o.id)).map(o => [o, dot(e, AI.embs.get(o.id))]).sort((x, y) => y[1] - x[1]).slice(0, n).map(x => x[0]);
  if (!it.palette || !it.palette.length) return [];
  const a = it.palette.slice(0, 4).map(p => [rgbOf(p.hex), p.pct]);
  return libItems().filter(o => o.id !== it.id && o.palette && o.palette.length).map(o => {
    const b = o.palette.map(p => rgbOf(p.hex));
    let sc = 0, tot = 0;
    for (const [rgb, pct] of a) { let best = 1e9; for (const q of b) best = Math.min(best, dist(rgb, q)); sc += best * pct; tot += pct; }
    return [o, sc / tot];
  }).filter(x => x[1] < 150).sort((x, y) => x[1] - y[1]).slice(0, n).map(x => x[0]);
}
function tagCounts() {
  const m = new Map();
  for (const i of libItems()) {
    for (const t of i.tags || []) { const e = m.get(t) || { n: 0, user: false }; e.n++; e.user = true; m.set(t, e); }
    for (const t of i.auto || []) { const e = m.get(t) || { n: 0, user: false }; e.n++; m.set(t, e); }
  }
  return [...m.entries()].sort((a, b) => (b[1].user - a[1].user) || b[1].n - a[1].n || a[0].localeCompare(b[0]));
}

// ---------- Menu en dialoog ----------
function openMenu(anchor, entries) {
  const m = $('#menu'); m.replaceChildren();
  for (const e of entries) {
    if (e === '-') m.append(h('hr'));
    else if (e.head) m.append(h('div', { class: 'mhead', text: e.head }));
    else m.append(h('button', { type: 'button', class: (e.on ? 'on ' : '') + (e.danger ? 'danger' : ''), onclick: () => { closeMenu(); e.run(); } }, e.label));
  }
  m.hidden = false;
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = clamp(r.left, 8, innerWidth - mw - 8) + 'px';
  m.style.top = (r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', menuAway, { once: true }), 0);
}
function menuAway(e) { if ($('#menu').contains(e.target)) document.addEventListener('pointerdown', menuAway, { once: true }); else closeMenu(); }
function closeMenu() { $('#menu').hidden = true; }

function dialog({ title, text, value, ok = 'Opslaan', danger, placeholder }) {
  return new Promise(res => {
    const d = $('#dlg');
    const input = value !== undefined ? h('input', { type: 'text', value, placeholder: placeholder || '' }) : null;
    const done = v => { d.close(); res(v); };
    const form = h('form', { method: 'dialog', onsubmit: e => { e.preventDefault(); done(input ? input.value.trim() : true); } },
      h('h3', { text: title }), text && h('p', { text }), input,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: () => done(null) }, 'Annuleren'),
        h('button', { type: 'submit', class: 'btn primary' }, ok)));
    d.replaceChildren(form);
    d.oncancel = () => res(null);
    d.showModal();
    if (input) { input.focus(); input.select(); }
  });
}

// ---------- Zijbalk ----------
const calm = matchMedia('(prefers-reduced-motion: reduce)');
/** Voert een schermwissel uit met een zachte overgang, waar de browser dat kan. */
function smooth(fn) {
  if (document.startViewTransition && !calm.matches && !document.hidden) { try { document.startViewTransition(fn); return; } catch (e) { /* dan zonder overgang */ } }
  fn();
}
function setView(v) {
  state.view = v; state.selected.clear();
  $('#side').classList.remove('open');
  smooth(renderAll);
}
function renderSide() {
  const lib = state.libs.find(l => l.id === state.libId);
  const items = libItems();
  $('#libSwitch').replaceChildren(h('span', null, lib.name, h('small', { text: items.length + (items.length === 1 ? ' item' : ' items') })));
  const v = state.view;
  const item = (label, count, view, cur, extra) => h('button', { type: 'button', class: 'nav-item', 'data-drop': view.kind === 'col' || view.kind === 'space' ? 'col:' + view.id : null, 'aria-current': cur ? 'true' : null, onclick: () => setView(view) }, extra, h('span', { class: 'label', text: label }), count != null && h('span', { class: 'count', text: count }));
  const nav = $('#nav'); nav.replaceChildren(
    item('Alles', items.length, { kind: 'all' }, v.kind === 'all'),
    item('Bladwijzers', items.filter(hasSource).length, { kind: 'bookmarks' }, v.kind === 'bookmarks'),
    item('Inbox', items.filter(i => !(i.cols || []).length).length, { kind: 'unsorted' }, v.kind === 'unsorted'),
    item('Favorieten', items.filter(i => i.liked).length, { kind: 'liked' }, v.kind === 'liked'),
    item('Prullenbak', trashItems().length, { kind: 'trash' }, v.kind === 'trash'),
    h('h2', null, 'Collecties', h('button', { type: 'button', title: 'Nieuwe collectie', 'aria-label': 'Nieuwe collectie', onclick: async () => { const c = await newCol(); if (c) setView({ kind: 'col', id: c.id }); } }, '+')),
    ...(libCols().length ? libCols().map(c => colRow(c, (v.kind === 'col' || v.kind === 'space') && v.id === c.id)) : [h('div', { class: 'nav-empty', text: 'Groepeer beelden per onderwerp, als raster of op een vrij canvas.' })]),
  );

  const tags = tagCounts();
  nav.append(h('h2', { class: 'fold' }, h('button', { type: 'button', class: 'foldbtn', 'aria-expanded': state.tagsOpen ? 'true' : 'false', onclick: () => { state.tagsOpen = !state.tagsOpen; saveMeta(); renderSide(); } }, 'Tags', h('span', { class: 'foldn', text: tags.length || '' }))));
  if (state.tagsOpen || v.kind === 'tag') {
    if (!tags.length) nav.append(h('div', { class: 'nav-empty', text: 'Tags verschijnen zodra je iets toevoegt.' }));
    for (const [t, e] of tags) nav.append(item(t, e.n, { kind: 'tag', tag: t }, v.kind === 'tag' && v.tag === t, !e.user && h('span', { class: 'auto-dot', title: 'Automatische tag' })));
  }

  const bytes = a => a.reduce((t, i) => t + (i.size || 0), 0), tr = trashItems();
  $('#storage').replaceChildren(h('span', { text: nItems(items.length) + ' · ' + fmtSize(bytes(items)) + (DB.http ? ' in je map' : ' in deze browser') }));
  if (tr.length) $('#storage').append(h('button', { type: 'button', class: 'btn-text', title: 'Maakt ' + fmtSize(bytes(tr)) + ' vrij', onclick: emptyTrash }, 'Prullenbak legen (' + fmtSize(bytes(tr)) + ')'));
}
/** Een collectie in de zijbalk: de laatste beelden erbij, zodat je ziet wat erin zit. */
function colRow(c, cur) {
  const its = colItems(c.id), strip = h('span', { class: 'colstrip' });
  for (const it of its.filter(visual).slice(0, 3)) strip.append(thumbEl(it));
  if (!strip.children.length) strip.append(h('span', { class: 'colstrip-empty' }));
  return h('button', { type: 'button', class: 'nav-item colrow', 'data-drop': 'col:' + c.id, 'aria-current': cur ? 'true' : null, onclick: () => setView(colView(c)) },
    strip, h('span', { class: 'label', text: c.name }), h('span', { class: 'count', text: its.length }));
}
function setColor(c) {
  state.color = c;
  if (['space', 'collections'].includes(state.view.kind)) state.view = { kind: 'all' };
  renderAll();
}
function libMenu() {
  const lib = state.libs.find(l => l.id === state.libId);
  openMenu($('#libSwitch'), [
    { head: 'Bibliotheken' },
    ...state.libs.map(l => ({ label: l.name, on: l.id === state.libId, run: () => { state.libId = l.id; saveMeta(); setView({ kind: 'all' }); } })),
    '-',
    { label: 'Nieuwe bibliotheek', run: async () => {
      const name = await dialog({ title: 'Nieuwe bibliotheek', value: '', placeholder: 'Bijv. Huisstijl klant X', ok: 'Maken' });
      if (!name) return;
      const l = { id: uid(), name, created: Date.now() };
      await DB.put('libs', l); state.libs.push(l); state.libId = l.id; saveMeta(); setView({ kind: 'all' });
    } },
    { label: 'Naam wijzigen', run: async () => {
      const name = await dialog({ title: 'Naam wijzigen', value: lib.name });
      if (!name) return;
      lib.name = name; await DB.put('libs', lib); renderAll();
    } },
    state.libs.length > 1 && { label: 'Bibliotheek verwijderen', danger: true, run: async () => {
      const n = libItems().length;
      if (!await dialog({ title: '"' + lib.name + '" verwijderen?', text: n + ' items en ' + libCols().length + ' collecties verdwijnen. Dit kun je niet terugdraaien.', ok: 'Verwijderen' })) return;
      for (const i of state.items.filter(x => x.lib === lib.id)) await purgeItem(i);
      for (const c of libCols()) await DB.del('cols', c.id);
      state.cols = state.cols.filter(c => c.lib !== lib.id);
      await DB.del('libs', lib.id);
      state.libs = state.libs.filter(l => l.id !== lib.id);
      state.libId = state.libs[0].id; saveMeta(); setView({ kind: 'all' });
    } },
  ].filter(Boolean));
}

// ---------- Raster ----------
function linkCard(it) {
  if (it.type === 'note') return h('div', { class: 'linkcard notecard' }, h('div', { class: 'notetext', text: it.text || '' }));
  return h('div', { class: 'linkcard' },
    h('span', { class: 'badge', text: 'Link' }),
    h('div', null, h('div', { class: 'dom', text: it.title || domainOf(it.url) || it.url }), h('div', { class: 'ttl', text: it.url })));
}
function thumbEl(it) {
  if (it.type === 'link' && !it.remote) return linkCard(it);
  const img = h('img', { alt: it.title || '', loading: 'lazy', decoding: 'async', draggable: 'false' });
  if (it.remote) { img.referrerPolicy = 'no-referrer'; img.src = it.remote; }
  else blobUrl('thumb', it.id).then(u => { img.src = u; });
  return img;
}
let lastVisible = [];
function stackCard(name, sub, items, onclick) {
  const stack = h('span', { class: 'stack' });
  items.slice(0, 4).forEach((it, i) => {
    const el = it.type === 'image' || it.remote ? thumbEl(it) : h('span', { class: 'stack-link', text: domainOf(it.url) || 'link' });
    el.classList.add('s' + i); stack.append(el);
  });
  return h('button', { type: 'button', class: 'ccard', onclick }, stack, h('span', { class: 'ccard-name', text: name }), h('span', { class: 'ccard-count', text: sub }));
}
const nItems = n => n + (n === 1 ? ' item' : ' items');
const colView = c => ({ kind: c.view === 'canvas' ? 'space' : 'col', id: c.id });
const colCard = c => { const its = colItems(c.id); return stackCard(c.name, nItems(its.length), its, () => setView(colView(c))); };
/** Schakelaar Raster | Canvas bovenin een collectie. */
function viewToggle(c, cur) {
  const go = kind => { if (kind === cur) return; c.view = kind === 'space' ? 'canvas' : 'grid'; DB.put('cols', c); setView({ kind, id: c.id }); };
  return h('div', { class: 'vt', role: 'group', 'aria-label': 'Weergave van de collectie' },
    h('button', { type: 'button', 'aria-pressed': cur === 'col' ? 'true' : 'false', onclick: () => go('col') }, 'Raster'),
    h('button', { type: 'button', 'aria-pressed': cur === 'space' ? 'true' : 'false', onclick: () => go('space') }, 'Canvas'));
}
async function deleteCol(col) {
  if (!await dialog({ title: '"' + col.name + '" verwijderen?', text: 'De beelden blijven in je bibliotheek staan. Notities op het canvas verdwijnen.', ok: 'Verwijderen' })) return;
  for (const it of state.items) if ((it.cols || []).includes(col.id)) { it.cols = it.cols.filter(x => x !== col.id); await DB.put('items', it); }
  await DB.del('cols', col.id); state.cols = state.cols.filter(c => c.id !== col.id);
  if (sp.space === col) sp.space = null;
  setView({ kind: 'collections' });
}
function renderGrid() {
  const v = state.view;
  const overview = v.kind === 'collections';
  const list = lastVisible = overview ? [] : visibleItems();
  const grid = $('#grid'); grid.replaceChildren();
  grid.style.setProperty('--col', state.size + 'px');
  $('#viewLibrary').classList.toggle('selecting', state.selected.size > 0 || v.kind === 'trash');
  for (const it of list) {
    const card = h('button', { type: 'button', draggable: v.kind === 'trash' ? null : 'true', class: 'card' + (state.selected.has(it.id) ? ' sel' : ''), 'data-id': it.id, 'aria-label': it.title || (it.type === 'link' ? it.url : 'Afbeelding') });
    if (it.type === 'image' || it.remote) {
      const ph = h('span', { class: 'ph' }, thumbEl(it));
      ph.style.aspectRatio = it.w ? it.w + ' / ' + it.h : '4 / 3';
      card.append(ph);
    } else card.append(linkCard(it));
    card.append(h('span', { class: 'check' }), h('span', { class: 'cap', text: it.title || domainOf(it.source || '') || '' }));
    if (v.kind !== 'trash') card.append(h('span', { class: 'heart' + (it.liked ? ' on' : ''), title: 'Favoriet (⌥-klik)', text: '♥' }));
    if (AI.scores && AI.scores.has(it.id)) card.dataset.score = AI.scores.get(it.id).toFixed(3);
    grid.append(card);
  }
  // Ontdek (drijvende wand) of Raster
  const useWall = state.display === 'wall' && !overview && v.kind !== 'trash' && list.length >= WALL_MIN && !state.selected.size;
  $('#gridWrap').hidden = useWall; $('#wall').hidden = !useWall;
  if (useWall) wallShow(list); else wallStop();
  grid.querySelectorAll('.card').forEach((c, i) => { if (i < 36) c.style.setProperty('--i', i); });
  // Tabbladen onderin
  const mode = v.kind === 'collections' ? 'collections' : useWall ? 'wall' : 'library';
  for (const b of document.querySelectorAll('#mode button')) b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false');
  // Kop en actieve filters
  const f = $('#filters'), col = v.kind === 'col' && state.cols.find(c => c.id === v.id);
  if (v.kind === 'col' && !col) return setView({ kind: 'collections' });
  const title = { tag: '#' + v.tag, bookmarks: 'Bladwijzers', unsorted: 'Inbox', liked: 'Favorieten', trash: 'Prullenbak', collections: 'Collecties', col: col && col.name }[v.kind] || 'Alles';
  const count = v.kind === 'collections' ? libCols().length + (libCols().length === 1 ? ' collectie' : ' collecties') : nItems(list.length);
  f.replaceChildren(h('h1', { text: title }), h('span', { class: 'n', text: count }));
  if (col) f.append(viewToggle(col, 'col'));
  if (state.color && !overview) f.append(h('span', { class: 'chip' }, h('i', { style: { background: state.color } }), 'Kleur ' + state.color, h('button', { type: 'button', 'aria-label': 'Kleurfilter wissen', onclick: () => setColor(null) }, '×')));
  if (state.q && !overview) f.append(h('span', { class: 'chip' }, '"' + state.q + '"', h('button', { type: 'button', 'aria-label': 'Zoekterm wissen', onclick: () => { state.q = ''; $('#q').value = ''; renderGrid(); } }, '×')));
  const act = (label, run, cls) => f.append(h('button', { type: 'button', class: 'btn small ' + (cls || ''), onclick: run }, label));
  if (col) act('Meer', e => openMenu(e.currentTarget, [
    { label: 'Naam wijzigen', run: async () => { const name = await dialog({ title: 'Naam wijzigen', value: col.name }); if (name) { col.name = name; await DB.put('cols', col); renderAll(); } } },
    { label: 'Collectie verwijderen', danger: true, run: () => deleteCol(col) }]));
  if (v.kind === 'trash' && list.length) act('Prullenbak legen', emptyTrash, 'danger');
  if (v.kind === 'collections') act('Nieuwe collectie', async () => { const c = await newCol(); if (c) setView({ kind: 'col', id: c.id }); });

  // Subtabs, sorteren en grootte
  const tabs = $('#tabs'); tabs.replaceChildren();
  if (['all', 'bookmarks', 'unsorted', 'trash'].includes(v.kind))
    for (const [k, label] of [['all', 'Alles'], ['bookmarks', 'Bladwijzers'], ['unsorted', 'Inbox'], ['trash', 'Prullenbak']])
      tabs.append(h('button', { type: 'button', class: 'tab', 'aria-pressed': v.kind === k ? 'true' : 'false', onclick: () => setView({ kind: k }) }, label));
  $('#subtools').hidden = overview;

  // Uitgelichte collecties (in "Alles") en de overzichten
  const feat = $('#featured'); feat.replaceChildren(); feat.className = 'featured' + (overview ? ' wall' : '');
  if (v.kind === 'all' && !state.q && !state.color) feat.append(...libCols().map(colCard));
  if (v.kind === 'collections') feat.append(...libCols().map(colCard));
  feat.hidden = !feat.children.length;

  const empty = $('#empty');
  const say = (ttl, txt, ...btns) => { empty.hidden = false; empty.replaceChildren(h('h2', { text: ttl }), h('p', null, txt), h('div', { class: 'row' }, btns)); };
  const btn = (label, run, primary) => h('button', { type: 'button', class: 'btn' + (primary ? ' primary' : ''), onclick: run }, label);
  empty.hidden = true;
  if (overview) {
    if (v.kind === 'collections' && !libCols().length) say('Nog geen collecties', 'Een collectie is een groep beelden rond één onderwerp, zoals "Typografie" of "Moodboard najaar". Bekijk hem als raster, of leg de beelden vrij neer op een canvas met notities erbij. Een beeld kan in meerdere collecties zitten.', btn('Nieuwe collectie', async () => { const c = await newCol(); if (c) setView({ kind: 'col', id: c.id }); }, true));
  } else if (!list.length) {
    if (v.kind === 'trash') say('De prullenbak is leeg', 'Wat je verwijdert blijft hier staan tot je de prullenbak leegt.');
    else if (v.kind === 'col' && !state.q && !state.color) say('Deze collectie is nog leeg', 'Sleep of plak hier beelden, of selecteer ze in je bibliotheek en kies "Naar collectie".', btn('Bestanden kiezen', () => $('#file').click(), true), btn('Naar bibliotheek', () => setView({ kind: 'all' })));
    else if (!libItems().length) {
      empty.hidden = false;
      empty.replaceChildren(
        h('h2', { text: 'Begin met verzamelen' }),
        h('p', null, 'Sleep afbeeldingen hierheen, plak met ', h('kbd', { text: 'Ctrl/⌘ V' }), ' of plak een link. Collector haalt de kleuren eruit en zet er automatisch tags op.'),
        h('div', { class: 'row' }, btn('Bestanden kiezen', () => $('#file').click(), true), btn('Voorbeelden laden', addSamples)));
    } else say('Niets gevonden', 'Geen items die bij dit filter passen.', btn('Filters wissen', () => { state.q = ''; state.color = null; $('#q').value = ''; setView({ kind: 'all' }); }));
  }
  renderSelbar();
  measureWave();
  renderBak();
}
function renderSelbar() {
  const bar = $('#selbar'), n = state.selected.size;
  bar.hidden = !n;
  if (!n) return;
  const b = (label, run) => h('button', { type: 'button', onclick: run }, label);
  const sel = () => [...state.selected].map(id => state.items.find(i => i.id === id)).filter(Boolean);
  const done = msg => { state.selected.clear(); if (msg) toast(msg); renderAll(); };
  bar.replaceChildren(h('strong', { text: n + ' geselecteerd' }));
  if (state.view.kind === 'trash') bar.append(
    b('Terugzetten', async () => { for (const it of sel()) { delete it.trashed; await DB.put('items', it); } done('Teruggezet'); }),
    b('Definitief verwijderen', bulkDelete));
  else bar.append(...[
    b('Tag toevoegen', bulkTag),
    b('Naar collectie', e => colMenu(e.currentTarget, [...state.selected])),
    state.view.kind === 'col' && b('Uit collectie halen', async () => { const id = state.view.id; for (const it of sel()) { it.cols = (it.cols || []).filter(x => x !== id); await DB.put('items', it); } done('Uit de collectie gehaald'); }),
    b('Verwijderen', bulkDelete)].filter(Boolean));
  bar.append(b('Klaar', () => done()));
}
async function newCol() {
  const name = await dialog({ title: 'Nieuwe collectie', value: '', placeholder: 'Bijv. Typografie', ok: 'Maken' });
  if (!name) return null;
  const c = { id: uid(), lib: state.libId, name, created: Date.now() };
  await DB.put('cols', c); state.cols.push(c);
  return c;
}
function colMenu(anchor, ids) {
  const put = async c => {
    for (const id of ids) { const it = state.items.find(i => i.id === id); if (it && !(it.cols || []).includes(c.id)) { it.cols = [...(it.cols || []), c.id]; await DB.put('items', it); } }
    state.selected.clear(); toast((ids.length === 1 ? 'Item' : ids.length + ' items') + ' in "' + c.name + '" gezet');
    if (detailId != null) { renderSide(); openDetail(detailId); } else renderAll();
  };
  openMenu(anchor, [{ head: 'Naar collectie' }, ...libCols().map(c => ({ label: c.name, run: () => put(c) })), libCols().length ? '-' : null,
    { label: 'Nieuwe collectie', run: async () => { const c = await newCol(); if (c) put(c); } }].filter(Boolean));
}
async function bulkTag() {
  const t = await dialog({ title: 'Tag toevoegen', value: '', placeholder: 'Bijv. typografie', ok: 'Toevoegen' });
  if (!t) return;
  const tag = t.toLowerCase();
  for (const id of state.selected) {
    const it = state.items.find(i => i.id === id);
    if (it && !it.tags.includes(tag)) { it.tags.push(tag); it.auto = (it.auto || []).filter(a => a !== tag); await DB.put('items', it); }
  }
  state.selected.clear(); toast('Tag "' + tag + '" toegevoegd'); renderAll();
}
async function bulkDelete() {
  const n = state.selected.size, its = [...state.selected].map(id => state.items.find(i => i.id === id)).filter(Boolean);
  if (state.view.kind === 'trash') {
    if (!await dialog({ title: nItems(n) + ' definitief verwijderen?', text: 'Dit kun je niet terugdraaien.', ok: 'Verwijderen' })) return;
    for (const it of its) await purgeItem(it);
  } else {
    for (const it of its) { it.trashed = Date.now(); await DB.put('items', it); }
    toast(nItems(n) + ' naar de prullenbak');
  }
  state.selected.clear(); renderAll();
}
async function emptyTrash() {
  const its = trashItems();
  if (!await dialog({ title: 'Prullenbak legen?', text: nItems(its.length) + ' verdwijnen definitief, ook uit je collecties.', ok: 'Legen' })) return;
  for (const it of its) await purgeItem(it);
  state.selected.clear(); renderAll();
}
/** Naar de prullenbak. Terugzetten kan daar. */
async function removeItem(it) {
  it.trashed = Date.now(); await DB.put('items', it);
  toast('Naar de prullenbak'); renderAll();
}
async function purgeItem(it) {
  await DB.del('items', it.id); await DB.del('thumbs', it.id); await DB.del('fulls', it.id); await DB.del('embs', it.id);
  AI.embs.delete(it.id); dropUrls(it.id);
  state.items = state.items.filter(i => i.id !== it.id);
  for (const c of state.cols) {
    if (!c.nodes) continue;
    const before = c.nodes.length;
    c.nodes = c.nodes.filter(n => n.item !== it.id);
    if (c.nodes.length !== before) await DB.put('cols', c);
  }
}
// ---------- Detail ----------
let detailId = null;
function openDetail(id) {
  const it = state.items.find(i => i.id === id);
  if (!it) return;
  detailId = id;
  const save = debounce(() => DB.put('items', it), 300);
  const box = $('#detail');
  const idx = lastVisible.findIndex(i => i.id === id);
  const go = d => { const n = lastVisible[idx + d]; if (n) openDetail(n.id); };

  let stage;
  if (it.type === 'image') { stage = h('img', { alt: it.title || '' }); blobUrl('thumb', it.id).then(u => { if (!stage.src) stage.src = u; }); blobUrl('full', it.id).then(u => { if (u) stage.src = u; }); }
  else if (it.remote) { stage = h('img', { alt: '', src: it.remote }); stage.referrerPolicy = 'no-referrer'; }
  else if (it.type === 'note') stage = h('textarea', { class: 'notestage', 'aria-label': 'Notitie', oninput: e => { it.text = e.target.value; save(); } }, it.text || '');
  else stage = linkCard(it);

  const tagbox = h('div', { class: 'tagbox' });
  const drawTags = () => {
    const wrap = h('div', { class: 'tags' });
    for (const t of it.tags) wrap.append(h('span', { class: 'chip' }, t, h('button', { type: 'button', 'aria-label': 'Tag ' + t + ' verwijderen', onclick: () => { it.tags = it.tags.filter(x => x !== t); save(); drawTags(); } }, '×')));
    for (const t of it.auto || []) wrap.append(h('span', { class: 'chip auto', title: 'Automatische tag' }, t, h('button', { type: 'button', 'aria-label': 'Tag ' + t + ' verwijderen', onclick: () => { it.auto = it.auto.filter(x => x !== t); save(); drawTags(); } }, '×')));
    const inp = h('input', { type: 'text', placeholder: 'Tag toevoegen', list: 'taglist', 'aria-label': 'Tag toevoegen' });
    const commit = () => {
      const parts = inp.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (!parts.length) return;
      for (const p of parts) if (!it.tags.includes(p)) { it.tags.push(p); it.auto = (it.auto || []).filter(a => a !== p); }
      save(); drawTags(); tagbox.querySelector('input').focus();
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
      else if (e.key === 'Backspace' && !inp.value && it.tags.length) { it.tags.pop(); save(); drawTags(); tagbox.querySelector('input').focus(); }
    });
    inp.addEventListener('change', commit);
    wrap.append(inp);
    tagbox.replaceChildren(wrap, h('datalist', { id: 'taglist' }, tagCounts().map(([t]) => h('option', { value: t }))));
  };
  drawTags();

  const pal = it.palette && it.palette.length ? h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Kleuren' }),
    h('div', { class: 'palette' }, it.palette.map(p => h('button', { type: 'button', 'data-hex': p.hex, 'aria-label': 'Zoek op ' + p.hex, style: { background: p.hex, flex: p.pct + ' 0 0' }, onclick: () => { closeDetail(); setColor(p.hex); } }))),
    h('div', { class: 'hexes' }, it.palette.map(p => h('button', { type: 'button', title: 'Kopieer', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(p.hex).then(() => toast(p.hex + ' gekopieerd'), () => toast(p.hex)); } }, p.hex)))) : null;

  const colField = h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Collecties' }), h('div', { class: 'tags' },
    (it.cols || []).map(id => { const c = state.cols.find(x => x.id === id); return c && h('span', { class: 'chip' }, c.name, h('button', { type: 'button', 'aria-label': 'Uit ' + c.name + ' halen', onclick: async () => { it.cols = it.cols.filter(x => x !== id); await DB.put('items', it); renderSide(); openDetail(it.id); } }, '×')); }),
    h('button', { type: 'button', class: 'chip add', onclick: e => colMenu(e.currentTarget, [it.id]) }, '+ Collectie')));
  const sim = similar(it);
  const simField = sim.length ? h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Vergelijkbaar' }), h('div', { class: 'simrow' }, sim.map(o => h('button', { type: 'button', title: o.title || 'Openen', 'aria-label': 'Open ' + (o.title || 'vergelijkbaar beeld'), onclick: () => openDetail(o.id) }, thumbEl(o))))) : null;
  const meta = h('dl', { class: 'metalist' });
  const row = (k, v) => v && meta.append(h('dt', { text: k }), h('dd', null, v));
  if (it.w) row('Formaat', it.w + ' × ' + it.h + ' px');
  if (it.size) row('Grootte', fmtSize(it.size));
  row('Toegevoegd', fmtDate(it.created));

  box.replaceChildren(
    h('div', { class: 'detail-stage', onclick: e => { if (e.target === e.currentTarget) closeDetail(); } }, stage,
      idx > 0 && h('button', { type: 'button', class: 'detail-nav prev', 'aria-label': 'Vorige', onclick: () => go(-1) }, '‹'),
      idx > -1 && idx < lastVisible.length - 1 && h('button', { type: 'button', class: 'detail-nav next', 'aria-label': 'Volgende', onclick: () => go(1) }, '›')),
    h('div', { class: 'detail-panel' },
      h('div', { class: 'detail-head' }, h('span', { text: idx > -1 ? (idx + 1) + ' van ' + lastVisible.length : '' }), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Sluiten', onclick: closeDetail }, '×')),
      h('div', { class: 'field' }, h('input', { type: 'text', class: 'title-input', value: it.title || '', placeholder: 'Titel', 'aria-label': 'Titel', oninput: e => { it.title = e.target.value; save(); } })),
      pal,
      colField,
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Tags' }), tagbox),
      h('div', { class: 'field' }, h('label', { for: 'dNote', text: 'Notitie' }), h('textarea', { id: 'dNote', placeholder: 'Waarom bewaar je dit?', oninput: e => { it.note = e.target.value; save(); } }, it.note || '')),
      h('div', { class: 'field' }, h('label', { for: 'dSrc', text: 'Bron' }), h('input', { id: 'dSrc', type: 'url', value: it.source || '', placeholder: 'https://', oninput: e => { it.source = e.target.value.trim(); if (it.type === 'link') it.url = it.source; save(); } })),
      simField,
      meta,
      h('div', { class: 'detail-actions' },
        isUrl(it.source || '') && h('a', { class: 'btn', href: it.source, target: '_blank', rel: 'noopener noreferrer', style: { display: 'inline-flex', alignItems: 'center', textDecoration: 'none' } }, 'Bron openen'),
        it.type === 'image' && h('button', { type: 'button', class: 'btn', onclick: async () => { const b = await DB.get('fulls', it.id); download(b, (it.title || 'collector-' + it.id) + '.' + ((b.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg'))); } }, 'Downloaden'),
        h('button', { type: 'button', class: 'btn danger', onclick: () => { closeDetail(); removeItem(it); } }, 'Verwijderen'))));
  box.hidden = false;
}
function closeDetail() {
  if (detailId == null) return;
  detailId = null; $('#detail').hidden = true; $('#detail').replaceChildren();
  renderAll();
}

// ---------- AI: visueel zoeken en tags, volledig in de browser ----------
const AI = { on: false, m: null, base: new Map(), loading: null, embs: new Map(), qEmb: null, qText: '', status: '', indexing: false, labels: null };
const AI_MODEL = 'Xenova/clip-vit-base-patch32', AI_MIN = 0.0125, AI_BAND = 0.03;
const AI_LABELS = [['typography', 'typografie'], ['a logo', 'logo'], ['a poster', 'poster'], ['a website screenshot', 'website'], ['a mobile app interface', 'app'], ['an illustration', 'illustratie'], ['a photograph', 'fotografie'], ['product packaging', 'verpakking'], ['architecture', 'architectuur'], ['an interior', 'interieur'], ['fashion', 'mode'], ['a portrait of a person', 'portret'], ['a landscape', 'landschap'], ['a pattern', 'patroon'], ['a 3D render', '3d'], ['icons', 'iconen'], ['a book cover', 'boekomslag'], ['a magazine layout', 'editorial'], ['food', 'eten'], ['a car', 'auto'], ['an animal', 'dier'], ['a chart or diagram', 'diagram'], ['a painting', 'schilderij'], ['a pencil sketch', 'schets'], ['abstract shapes', 'abstract'], ['a product photo', 'product']];
function aiBase(id, e) {
  if (!AI.base.has(id)) AI.base.set(id, AI.labels ? AI.labels.reduce((t, l) => t + dot(e, l), 0) / AI.labels.length : 0);
  return AI.base.get(id);
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const unit = v => { const n = Math.sqrt(dot(v, v)) || 1, o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / n; return o; };
function aiStatus(t) { AI.status = t; renderAi(); }
function renderAi() {
  const el = $('#ai'); if (!el) return;
  const n = libItems().filter(i => AI.embs.has(i.id)).length;
  el.replaceChildren(h('span', { text: AI.status || (AI.on ? 'AI-zoeken aan · ' + n + (n === 1 ? ' beeld' : ' beelden') + ' geïndexeerd' : 'AI-zoeken uit') }),
    h('button', { type: 'button', class: 'btn-text', onclick: () => AI.on ? aiDisable() : aiAsk() }, AI.on ? 'Uitzetten' : 'Aanzetten'));
  $('#q').placeholder = AI.on && AI.m ? 'Zoek op wat je ziet (Engels werkt het best), titel of tag' : 'Zoek op titel, tag, notitie of bron';
}
async function aiAsk() {
  if (!await dialog({ title: 'AI-zoeken aanzetten?', text: 'Collector haalt één keer een beeldmodel op (ongeveer 155 MB, van Hugging Face) en bewaart het in je browser. Daarna zoek je op wat er op een beeld staat en krijgt elk beeld extra tags. Het model draait op je eigen apparaat: je beelden worden nergens heen gestuurd.', ok: 'Aanzetten' })) return;
  aiEnable();
}
function aiDisable() { AI.on = false; AI.qEmb = null; saveMeta(); aiStatus(''); renderAll(); }
async function aiEnable() {
  AI.on = true; saveMeta(); aiStatus('Model laden');
  try { await aiLoad(); aiStatus(''); await aiIndex(); renderAll(); }
  catch (e) { console.error(e); AI.on = false; AI.loading = null; saveMeta(); aiStatus(''); toast('AI-model laden is mislukt. Probeer het later opnieuw.'); }
}
function aiLoad() {
  if (AI.loading) return AI.loading;
  return AI.loading = (async () => {
    const T = await import(new URL('vendor/transformers.min.js', location.href).href);
    T.env.allowLocalModels = false;
    T.env.backends.onnx.wasm.wasmPaths = new URL('vendor/', location.href).href;
    T.env.backends.onnx.wasm.numThreads = 1;
    const prog = {}, cb = p => { if (p.status === 'progress' && /onnx$/.test(p.file)) { prog[p.file] = [p.loaded, p.total]; const v = Object.values(prog); aiStatus('Model laden ' + Math.round(v.reduce((a, x) => a + x[0], 0) / Math.max(1, v.reduce((a, x) => a + x[1], 0)) * 100) + '%'); } };
    const [tok, tm, proc, vm] = await Promise.all([
      T.AutoTokenizer.from_pretrained(AI_MODEL), T.CLIPTextModelWithProjection.from_pretrained(AI_MODEL, { quantized: true, progress_callback: cb }),
      T.AutoProcessor.from_pretrained(AI_MODEL), T.CLIPVisionModelWithProjection.from_pretrained(AI_MODEL, { quantized: true, progress_callback: cb })]);
    AI.m = { T, tok, tm, proc, vm };
  })();
}
async function embedText(texts) {
  const { tok, tm } = AI.m;
  const { text_embeds } = await tm(tok(texts, { padding: true, truncation: true }));
  const d = text_embeds.dims[1], out = [];
  for (let i = 0; i < texts.length; i++) out.push(unit(text_embeds.data.slice(i * d, (i + 1) * d)));
  return out;
}
async function embedImage(blob) {
  const { T, proc, vm } = AI.m;
  const { image_embeds } = await vm(await proc(await T.RawImage.fromBlob(blob)));
  return unit(image_embeds.data);
}
/** Indexeert beelden die nog geen vingerafdruk hebben en zet er AI-tags op. */
async function aiIndex() {
  if (!AI.on || AI.indexing) return;
  AI.indexing = true;
  try {
    await aiLoad();
    if (!AI.labels) AI.labels = await embedText(AI_LABELS.map(l => 'a picture of ' + l[0]));
    const todo = state.items.filter(i => i.type === 'image' && !AI.embs.has(i.id));
    let k = 0;
    for (const it of todo) {
      if (!AI.on) break;
      aiStatus('Indexeren ' + (++k) + ' van ' + todo.length);
      try {
        const blob = await DB.get('thumbs', it.id); if (!blob) continue;
        const e = await embedImage(blob);
        AI.embs.set(it.id, e); await DB.put('embs', e, it.id);
        if (!it.aiTagged) {
          const logits = AI.labels.map(l => 100 * dot(e, l)), mx = Math.max(...logits), ex = logits.map(v => Math.exp(v - mx)), sum = ex.reduce((a, b) => a + b, 0);
          const best = ex.map((v, i) => [v / sum, AI_LABELS[i][1]]).sort((a, b) => b[0] - a[0]).filter(x => x[0] >= 0.3).slice(0, 2);
          for (const [, tag] of best) if (!allTags(it).includes(tag)) (it.auto = it.auto || []).push(tag);
          it.aiTagged = true; await DB.put('items', it);
        }
      } catch (err) { console.warn('Indexeren mislukt', it.id, err); }
      await new Promise(r => setTimeout(r, 0));
    }
    if (todo.length) renderAll();
  } finally { AI.indexing = false; aiStatus(''); }
}
const aiQuery = debounce(async () => {
  const q = state.q;
  if (!AI.on || !AI.m || !q) return;
  try { const [e] = await embedText([q]); if (state.q === q) { AI.qEmb = e; AI.qText = q; renderGrid(); } } catch (e) { console.warn(e); }
}, 250);

// ---------- Paneel (breed dialoogvenster) ----------
function openPanel(title, sub, body, actions = []) {
  const d = $('#dlg'), close = () => { d.classList.remove('wide'); d.close(); };
  d.classList.add('wide');
  d.replaceChildren(h('h3', { text: title }), sub && h('p', { text: sub }), body,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Sluiten'), actions));
  d.oncancel = () => d.classList.remove('wide');
  d.showModal();
  return close;
}

// ---------- Vastleggen vanuit de browser (bladwijzerknop) ----------
function bookmarkletHref() {
  const base = location.origin + location.pathname;
  const code = "(()=>{const s=[...document.images].filter(i=>i.naturalWidth>=300&&i.naturalHeight>=200).map(i=>({u:(i.currentSrc||i.src).replace(/([?&]name=)\\w+/,'$1large'),a:i.naturalWidth*i.naturalHeight})).filter(x=>/^https?:/.test(x.u)).sort((a,b)=>b.a-a.a).map(x=>x.u);const p=new URLSearchParams();p.set('src',location.href);p.set('title',document.title);[...new Set(s)].slice(0,12).forEach(x=>p.append('add',x));window.open(" + JSON.stringify(base) + "+'?'+p,'_blank')})()";
  return 'javascript:' + encodeURIComponent(code);
}
function openCaptureHelp() {
  const a = h('a', { class: 'btn bml', href: bookmarkletHref(), onclick: e => { e.preventDefault(); toast('Sleep deze knop naar je bladwijzerbalk'); } }, '+ Collector');
  const step = (n, t) => h('li', null, h('b', { text: n + ' ' }), t);
  openPanel('Bewaren vanuit je browser', 'Met de extensie bewaar je een beeld zonder de pagina te verlaten: rechtsklik op het beeld en kies "Bewaar beeld in Collector", of houd Alt (⌥) ingedrukt en klik erop. De knop in de werkbalk laat je kiezen uit alle beelden van de pagina.',
    h('div', { class: 'extbox' },
      h('a', { class: 'btn primary', href: 'downloads/collector-extensie.zip', download: '' }, 'Extensie downloaden'),
      h('div', { class: 'extcols' },
        h('div', null, h('h4', { text: 'Zen en Firefox' }), h('ol', null,
          step('1.', 'Pak het zip-bestand uit.'), step('2.', 'Open about:debugging en kies "Deze Firefox" (in Zen: "Deze Zen").'),
          step('3.', 'Klik "Tijdelijke add-on laden" en kies manifest.json.')),
          h('p', { text: 'Tijdelijk laden verdwijnt na een herstart. Voor blijvend gebruik moet de extensie door Mozilla ondertekend worden, net als bij de Designer Toolkit.' })),
        h('div', null, h('h4', { text: 'Chrome, Arc, Brave, Edge' }), h('ol', null,
          step('1.', 'Pak het zip-bestand uit.'), step('2.', 'Open chrome://extensions en zet "Ontwikkelaarsmodus" aan.'),
          step('3.', 'Klik "Uitgepakte extensie laden" en kies de map.')))),
      h('p', { class: 'extalt' }, 'Liever zonder extensie? Sleep deze knop naar je bladwijzerbalk: ', a)));
}
async function handleCapture() {
  const u = new URL(location.href);
  const src = u.searchParams.get('src') || '', page = isUrl(src) ? src : '', title = (u.searchParams.get('title') || '').slice(0, 200);
  const adds = [...new Set(u.searchParams.getAll('add').filter(isUrl))].slice(0, 24);
  if (!adds.length && !page) return;
  history.replaceState(null, '', u.pathname);
  const savePage = async () => { afterAdd([await addLink(page, false, { title })]); };
  if (!adds.length) return savePage();
  const chosen = new Set(adds.length === 1 ? adds : []);
  const grid = h('div', { class: 'pickgrid' });
  for (const url of adds) {
    const img = h('img', { alt: '', src: url, loading: 'lazy' }); img.referrerPolicy = 'no-referrer';
    const b = h('button', { type: 'button', class: 'pick', 'aria-pressed': chosen.has(url) ? 'true' : 'false' }, img, h('span', { class: 'check' }));
    b.onclick = () => { chosen.has(url) ? chosen.delete(url) : chosen.add(url); b.setAttribute('aria-pressed', chosen.has(url) ? 'true' : 'false'); };
    grid.append(b);
  }
  const close = openPanel('Wat wil je bewaren?', (title ? '"' + title + '" · ' : '') + (domainOf(page) || 'Beelden van de pagina'), grid, [
    page && h('button', { type: 'button', class: 'btn', onclick: () => { close(); savePage(); } }, 'Alleen de pagina'),
    h('button', { type: 'button', class: 'btn primary', onclick: async () => {
      if (!chosen.size) return toast('Kies eerst een of meer beelden');
      close(); toast('Bezig met bewaren');
      const out = [];
      for (const url of chosen) { try { out.push(await addUrl(url, { page, title, image: true })); } catch { /* overslaan */ } }
      afterAdd(out);
    } }, 'Bewaar selectie')]);
}

/** Beelden die de browserextensie doorgeeft. */
function initExtensionBridge() {
  addEventListener('message', async e => {
    const d = e.data;
    if (e.source !== window || e.origin !== location.origin || !d || d.type !== 'collector-ext-add') return;
    let ok = false;
    try {
      const page = isUrl(d.page || '') ? d.page : '', title = String(d.title || '').slice(0, 200);
      if (typeof d.dataUrl === 'string' && d.dataUrl.startsWith('data:image/')) {
        const it = await addImage(await (await fetch(d.dataUrl)).blob(), { source: page, title });
        landInSpace([it]); afterAdd([it]); ok = true;
      } else if (page) { afterAdd([await addLink(page, false, { title })]); ok = true; }
    } catch (err) { console.warn(err); }
    window.postMessage({ type: 'collector-ext-done', id: d.id, ok }, location.origin);
  });
  document.documentElement.dataset.collectorReady = '1';
}

// ---------- Herontdekken ----------
const redo = { seen: new Set(), cur: null };
function rediscover() {
  const pool = libItems();
  if (!pool.length) return toast('Je bibliotheek is nog leeg');
  let cand = pool.filter(i => !redo.seen.has(i.id));
  if (!cand.length) { redo.seen.clear(); cand = pool.filter(i => i.id !== redo.cur); if (!cand.length) cand = pool; }
  const now = Date.now(), w = cand.map(i => 1 + Math.min(60, (now - i.created) / 864e5)); // oudere beelden komen vaker langs
  let r = Math.random() * w.reduce((a, b) => a + b, 0), it = cand[0];
  for (let k = 0; k < cand.length; k++) { r -= w[k]; if (r <= 0) { it = cand[k]; break; } }
  redo.seen.add(it.id); redo.cur = it.id;
  let stage;
  if (it.type === 'image') { stage = h('img', { alt: it.title || '' }); blobUrl('full', it.id).then(u => { stage.src = u; }); }
  else if (it.remote) { stage = h('img', { alt: '', src: it.remote }); stage.referrerPolicy = 'no-referrer'; }
  else stage = linkCard(it);
  const days = Math.floor((now - it.created) / 864e5);
  const box = $('#redo');
  box.replaceChildren(
    h('div', { class: 'redo-stage' }, stage),
    h('div', { class: 'redo-bar' },
      h('div', { class: 'redo-text' }, h('strong', { text: it.title || 'Zonder titel' }),
        h('span', { text: 'Bewaard op ' + fmtDate(it.created) + (days > 0 ? ', ' + days + (days === 1 ? ' dag' : ' dagen') + ' geleden' : ', vandaag') + (allTags(it).length ? ' · ' + allTags(it).slice(0, 5).join(', ') : '') })),
      h('div', { class: 'redo-actions' },
        h('button', { type: 'button', class: 'btn', onclick: closeRedo }, 'Sluiten'),
        h('button', { type: 'button', class: 'btn', onclick: () => { closeRedo(); openDetail(it.id); } }, 'Openen'),
        h('button', { type: 'button', class: 'btn primary', id: 'redoNext', onclick: rediscover }, 'Nog een'))));
  box.hidden = false;
}
function closeRedo() { redo.cur = null; $('#redo').hidden = true; $('#redo').replaceChildren(); }

// ---------- Canvas van een collectie ----------
// Een collectie bewaart naast de leden (item.cols) ook een vrije indeling: nodes (beelden en notities) en een camera.
/** Zet items in de collectie (lidmaatschap). */
async function addToCol(c, ids) {
  for (const id of ids) {
    const it = state.items.find(i => i.id === id);
    if (it && !(it.cols || []).includes(c.id)) { it.cols = [...(it.cols || []), c.id]; await DB.put('items', it); }
  }
}
/** Houd het canvas gelijk aan de collectie: wat er niet meer in zit eruit, nieuwe leden onderaan erbij. */
function syncCanvas(c) {
  c.nodes = (c.nodes || []).filter(n => n.kind === 'note' || state.items.some(i => i.id === n.item && (i.cols || []).includes(c.id)));
  const placed = new Set(c.nodes.map(n => n.item));
  const missing = colItems(c.id).filter(i => !placed.has(i.id)).reverse().map(i => i.id);
  if (missing.length) placeItems(c, missing);
  c.cam = c.cam || { x: 0, y: 0, k: 1 };
  return missing.length > 0;
}
/** Oude spaces (tot v1.4) worden collecties met een canvas. */
async function migrateSpaces(spaces) {
  let n = 0;
  for (const s of spaces || []) {
    if (!s || !s.id || !Array.isArray(s.nodes)) continue;
    const lib = state.libs.some(l => l.id === s.lib) ? s.lib : state.libId;
    let c = state.cols.find(x => x.lib === lib && x.name === s.name && !(x.nodes || []).length);
    if (!c) { c = { id: state.cols.some(x => x.id === s.id) ? uid() : String(s.id), lib, name: String(s.name || 'Canvas'), created: +s.created || Date.now() }; state.cols.push(c); }
    c.nodes = s.nodes; c.cam = s.cam || { x: 0, y: 0, k: 1 }; c.view = 'canvas';
    await addToCol(c, s.nodes.filter(nd => nd.item).map(nd => nd.item));
    await DB.put('cols', c); n++;
  }
  return n;
}
function nodeFor(it, x, y, w = 280) {
  const ratio = it.w ? it.h / it.w : 0.6;
  return { id: uid(), kind: 'item', item: it.id, x, y, w, h: Math.round(w * ratio) };
}
/** Zet items in rijen naast wat er al staat. */
function placeItems(space, ids, at) {
  let x0 = 60, y = 60;
  if (at) { x0 = at.x; y = at.y; }
  else if (space.nodes.length) y = Math.max(...space.nodes.map(n => n.y + (n.h || 120))) + 40;
  let x = x0, rowH = 0, col = 0;
  for (const id of ids) {
    const it = state.items.find(i => i.id === id); if (!it) continue;
    const n = nodeFor(it, x, y);
    space.nodes.push(n);
    rowH = Math.max(rowH, n.h); x += n.w + 24; col++;
    if (col % 4 === 0) { x = x0; y += rowH + 24; rowH = 0; }
  }
}

const sp = { space: null, sel: new Set(), els: new Map(), pointers: new Map(), drag: null };
const shown = () => sp.space.nodes.filter(n => sp.els.has(n.id));
const saveSpace = debounce(() => { if (sp.space) DB.put('cols', sp.space); }, 350);
function applyCam() {
  const { x, y, k } = sp.space.cam, vp = $('#viewport');
  $('#world').style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  $('#world').style.setProperty('--k', k);
  const g = 24 * k * (k < 0.5 ? 2 : 1);
  vp.style.backgroundSize = g + 'px ' + g + 'px';
  vp.style.backgroundPosition = x + 'px ' + y + 'px';
  $('#zVal').textContent = Math.round(k * 100) + '%';
}
function toWorld(cx, cy) {
  const r = $('#viewport').getBoundingClientRect(), c = sp.space.cam;
  return { x: (cx - r.left - c.x) / c.k, y: (cy - r.top - c.y) / c.k };
}
function zoomAt(cx, cy, factor) {
  const c = sp.space.cam, r = $('#viewport').getBoundingClientRect();
  const k = clamp(c.k * factor, 0.08, 6), px = cx - r.left, py = cy - r.top;
  c.x = px - (px - c.x) * (k / c.k); c.y = py - (py - c.y) * (k / c.k); c.k = k;
  applyCam(); saveSpace();
}
function fitSpace() {
  const s = sp.space, r = $('#viewport').getBoundingClientRect();
  if (!shown().length) { s.cam = { x: 0, y: 0, k: 1 }; applyCam(); return; }
  const b = bounds(shown());
  const k = clamp(Math.min((r.width - 96) / b.w, (r.height - 96) / b.h), 0.08, 1.5);
  s.cam = { k, x: (r.width - b.w * k) / 2 - b.x * k, y: (r.height - b.h * k) / 2 - b.y * k };
  applyCam(); saveSpace();
}
function nodeH(n) { const el = sp.els.get(n.id); return n.kind === 'note' && el ? el.offsetHeight : n.h; }
function bounds(nodes) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const n of nodes) { x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y); x2 = Math.max(x2, n.x + n.w); y2 = Math.max(y2, n.y + nodeH(n)); }
  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
}
function nodeEl(n) {
  let el;
  if (n.kind === 'note') {
    el = h('div', { class: 'node note', text: n.text || '' });
    el.addEventListener('dblclick', () => editNote(n, el));
  } else {
    const it = state.items.find(i => i.id === n.item);
    if (!it || it.trashed) return null;
    if (it.type === 'image' || it.remote) {
      const img = h('img', { alt: it.title || '', draggable: 'false' });
      if (it.remote) { img.referrerPolicy = 'no-referrer'; img.src = it.remote; }
      else { blobUrl('thumb', it.id).then(u => { if (!img.src) img.src = u; }); blobUrl('full', it.id).then(u => { if (u) img.src = u; }); }
      el = h('div', { class: 'node' }, img);
    } else el = h('div', { class: 'node link' }, linkCard(it));
    el.addEventListener('dblclick', () => openDetail(it.id));
  }
  el.dataset.id = n.id;
  el.append(h('span', { class: 'grip' }));
  placeNode(n, el);
  return el;
}
function placeNode(n, el) {
  el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; el.style.width = n.w + 'px';
  if (n.kind !== 'note') el.style.height = n.h + 'px';
}
function editNote(n, el) {
  el.querySelector('.grip')?.remove();
  el.contentEditable = 'true'; el.focus();
  const range = document.createRange(); range.selectNodeContents(el);
  const s = getSelection(); s.removeAllRanges(); s.addRange(range);
  el.addEventListener('blur', () => {
    el.contentEditable = 'false';
    n.text = el.innerText.replace(/\n$/, '');
    el.textContent = n.text; el.append(h('span', { class: 'grip' }));
    saveSpace();
  }, { once: true });
}
function selectNodes(ids) {
  sp.sel = new Set(ids);
  for (const [id, el] of sp.els) el.classList.toggle('sel', sp.sel.has(id));
}
function renderSpace() {
  const s = sp.space = state.cols.find(x => x.id === state.view.id && x.lib === state.libId);
  if (!s) return setView({ kind: 'collections' });
  const first = !s.cam;
  if (syncCanvas(s) || first) DB.put('cols', s);
  $('#spaceTitle').textContent = s.name;
  $('#spToggle').replaceChildren(viewToggle(s, 'space'));
  const world = $('#world'); world.replaceChildren(); sp.els.clear(); sp.sel.clear();
  for (const n of s.nodes) { const el = nodeEl(n); if (el) { sp.els.set(n.id, el); world.append(el); } }
  applyCam();
  if (first && sp.els.size) requestAnimationFrame(fitSpace);
  const hint = $('#spaceHint'); hint.hidden = sp.els.size > 0;
  hint.replaceChildren(h('div', null, h('b', { text: 'Een leeg canvas' }), 'Sleep of plak beelden hierheen, of kies ze uit je bibliotheek. Alles wat je hier neerlegt, zit in deze collectie. Scroll om te bewegen, Ctrl/⌘ + scroll om te zoomen.'));
  if (!$('#tray').hidden) renderTray();
}
function addNode(n) {
  sp.space.nodes.push(n);
  const el = nodeEl(n); if (!el) return;
  sp.els.set(n.id, el); $('#world').append(el);
  $('#spaceHint').hidden = true;
  selectNodes([n.id]); saveSpace(); renderSideSoon();
}
const renderSideSoon = debounce(() => renderSide(), 200);
function viewCenter() { const r = $('#viewport').getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); }
async function deleteSelectedNodes() {
  if (!sp.sel.size) return;
  const c = sp.space, gone = c.nodes.filter(n => sp.sel.has(n.id) && n.item).map(n => n.item);
  c.nodes = c.nodes.filter(n => !sp.sel.has(n.id));
  // Beelden die nergens meer op dit canvas staan, gaan uit de collectie (niet uit de bibliotheek)
  let out = 0;
  for (const id of new Set(gone)) {
    if (c.nodes.some(n => n.item === id)) continue;
    const it = state.items.find(i => i.id === id);
    if (it && (it.cols || []).includes(c.id)) { it.cols = it.cols.filter(x => x !== c.id); await DB.put('items', it); out++; }
  }
  if (out) toast(nItems(out) + ' uit de collectie gehaald, ze blijven in je bibliotheek');
  for (const id of sp.sel) { sp.els.get(id)?.remove(); sp.els.delete(id); }
  sp.sel.clear(); $('#spaceHint').hidden = sp.space.nodes.length > 0;
  saveSpace(); renderSideSoon();
}
function renderTray() {
  const g = $('#trayGrid'); g.replaceChildren();
  const items = libItems();
  if (!items.length) g.append(h('p', { class: 'nav-empty', text: 'Je bibliotheek is nog leeg.' }));
  for (const it of items) {
    const b = h('button', { type: 'button', draggable: 'true', 'data-id': it.id, title: 'Klik of sleep naar het canvas', onclick: async () => { await addToCol(sp.space, [it.id]); const c = viewCenter(); const n = nodeFor(it, 0, 0); n.x = Math.round(c.x - n.w / 2 + (Math.random() - .5) * 60); n.y = Math.round(c.y - n.h / 2 + (Math.random() - .5) * 60); addNode(n); } });
    if (it.type === 'image' || it.remote) b.append(thumbEl(it)); else b.append(h('div', { class: 't-link', text: domainOf(it.url) || it.url }));
    g.append(b);
  }
}
function initSpaceEvents() {
  const vp = $('#viewport');
  vp.addEventListener('wheel', e => {
    if (!sp.space) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-clamp(e.deltaY, -30, 30) * 0.01));
    else { sp.space.cam.x -= e.deltaX; sp.space.cam.y -= e.deltaY; applyCam(); saveSpace(); }
  }, { passive: false });

  vp.addEventListener('pointerdown', e => {
    if (!sp.space || e.target.closest('.zoom') || e.button > 1) return;
    const editing = e.target.closest('[contenteditable="true"]');
    if (editing) return;
    if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
    vp.setPointerCapture(e.pointerId);
    sp.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (sp.pointers.size === 2) { // knijpen om te zoomen
      const [a, b] = [...sp.pointers.values()];
      sp.drag = { mode: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    const el = e.target.closest('.node');
    const start = { x: e.clientX, y: e.clientY };
    if (el && e.button === 0) {
      const id = el.dataset.id, n = sp.space.nodes.find(x => x.id === id);
      if (e.shiftKey) { const s = new Set(sp.sel); s.has(id) ? s.delete(id) : s.add(id); selectNodes(s); }
      else if (!sp.sel.has(id)) selectNodes([id]);
      if (e.target.classList.contains('grip')) sp.drag = { mode: 'resize', n, el, start, w: n.w, h: n.h };
      else {
        // naar voren halen
        for (const sid of sp.sel) { const se = sp.els.get(sid); if (se) $('#world').append(se); }
        sp.space.nodes.sort((a, b) => sp.sel.has(a.id) - sp.sel.has(b.id));
        sp.drag = { mode: 'move', start, orig: sp.space.nodes.filter(x => sp.sel.has(x.id)).map(x => ({ n: x, x: x.x, y: x.y })) };
      }
    } else {
      if (!e.shiftKey) selectNodes([]);
      sp.drag = { mode: 'pan', start, cx: sp.space.cam.x, cy: sp.space.cam.y };
      vp.classList.add('panning');
    }
  });
  vp.addEventListener('pointermove', e => {
    const d = sp.drag; if (!d || !sp.pointers.has(e.pointerId)) return;
    sp.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const k = sp.space.cam.k;
    if (d.mode === 'pinch') {
      const [a, b] = [...sp.pointers.values()]; if (!b) return;
      const nd = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, nd / d.d); d.d = nd;
    } else if (d.mode === 'pan') {
      sp.space.cam.x = d.cx + e.clientX - d.start.x; sp.space.cam.y = d.cy + e.clientY - d.start.y; applyCam();
    } else if (d.mode === 'move') {
      const dx = (e.clientX - d.start.x) / k, dy = (e.clientY - d.start.y) / k;
      for (const o of d.orig) { o.n.x = Math.round(o.x + dx); o.n.y = Math.round(o.y + dy); placeNode(o.n, sp.els.get(o.n.id)); }
    } else if (d.mode === 'resize') {
      const w = Math.max(60, d.w + (e.clientX - d.start.x) / k);
      d.n.w = Math.round(w);
      if (d.n.kind !== 'note') d.n.h = Math.round(w * d.h / d.w);
      placeNode(d.n, d.el);
    }
  });
  const up = e => {
    sp.pointers.delete(e.pointerId);
    if (sp.drag) { if (sp.drag.mode === 'pinch' && sp.pointers.size) return; sp.drag = null; vp.classList.remove('panning'); saveSpace(); }
  };
  vp.addEventListener('pointerup', up); vp.addEventListener('pointercancel', up);

  $('#zIn').onclick = () => { const r = vp.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); };
  $('#zOut').onclick = () => { const r = vp.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.8); };
  $('#spFit').onclick = fitSpace;
  $('#spNote').onclick = () => {
    const c = viewCenter();
    const n = { id: uid(), kind: 'note', text: 'Nieuwe notitie', x: Math.round(c.x - 110), y: Math.round(c.y - 40), w: 220 };
    addNode(n); editNote(n, sp.els.get(n.id));
  };
  $('#spTray').onclick = () => { const t = $('#tray'); t.hidden = !t.hidden; if (!t.hidden) renderTray(); };
  $('#trayClose').onclick = () => { $('#tray').hidden = true; };
  $('#spPng').onclick = exportSpace;
  $('#spMore').onclick = e => openMenu(e.currentTarget, [
    { label: 'Naam wijzigen', run: async () => { const name = await dialog({ title: 'Naam wijzigen', value: sp.space.name }); if (name) { sp.space.name = name; await DB.put('cols', sp.space); renderAll(); } } },
    { label: 'Selectie uit collectie halen', run: deleteSelectedNodes },
    { label: 'Collectie verwijderen', danger: true, run: () => deleteCol(sp.space) },
  ]);
}
async function exportSpace() {
  const s = sp.space;
  if (!shown().length) return toast('Dit canvas is nog leeg');
  const b = bounds(shown()), pad = 48;
  const sc = Math.min(2, 5000 / Math.max(b.w + pad * 2, b.h + pad * 2));
  const c = h('canvas'); c.width = Math.round((b.w + pad * 2) * sc); c.height = Math.round((b.h + pad * 2) * sc);
  const x = c.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  x.fillStyle = css.getPropertyValue('--canvas').trim() || '#eee'; x.fillRect(0, 0, c.width, c.height);
  x.scale(sc, sc); x.translate(pad - b.x, pad - b.y);
  for (const n of shown()) {
    if (n.kind === 'note') {
      const hh = nodeH(n);
      x.fillStyle = '#fff3b0'; x.fillRect(n.x, n.y, n.w, hh);
      x.fillStyle = '#2b2613'; x.font = '500 16px "Instrument Sans", system-ui, sans-serif'; x.textBaseline = 'top';
      let yy = n.y + 14;
      for (const para of (n.text || '').split('\n')) {
        let line = '';
        for (const word of para.split(' ')) {
          const test = line ? line + ' ' + word : word;
          if (x.measureText(test).width > n.w - 32 && line) { x.fillText(line, n.x + 16, yy); yy += 22.4; line = word; } else line = test;
        }
        x.fillText(line, n.x + 16, yy); yy += 22.4;
      }
      continue;
    }
    const it = state.items.find(i => i.id === n.item); if (!it) continue;
    let drawn = false;
    if (it.type === 'image') {
      try { const bmp = await loadBitmap(await DB.get('fulls', it.id)); x.drawImage(bmp, n.x, n.y, n.w, n.h); drawn = true; } catch { /* valt terug op kaart */ }
    }
    if (!drawn) {
      x.fillStyle = '#ffffff'; x.fillRect(n.x, n.y, n.w, n.h);
      x.strokeStyle = '#c4bdae'; x.strokeRect(n.x + .5, n.y + .5, n.w - 1, n.h - 1);
      x.fillStyle = '#17140f'; x.font = '700 18px "Bricolage Grotesque", system-ui, sans-serif'; x.textBaseline = 'top';
      x.fillText(it.type === 'note' ? (it.text || '').slice(0, 40) : domainOf(it.url || it.source || '') || 'Link', n.x + 14, n.y + 14, n.w - 28);
    }
  }
  c.toBlob(blob => { download(blob, s.name.replace(/[^\w\- ]+/g, '').trim() + '.png'); toast('PNG gemaakt'); }, 'image/png');
}

// ---------- Back-up ----------
const toDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
async function exportAll() {
  toast('Back-up wordt gemaakt');
  const parts = ['{"app":"collector","version":1,"libs":', JSON.stringify(state.libs), ',"cols":', JSON.stringify(state.cols), ',"items":', JSON.stringify(state.items), ',"files":{'];
  let first = true;
  for (const it of state.items) {
    if (it.type !== 'image') continue;
    const b = await DB.get('fulls', it.id); if (!b) continue;
    parts.push((first ? '' : ',') + JSON.stringify(it.id) + ':' + JSON.stringify(await toDataUrl(b))); first = false;
  }
  parts.push('}}');
  download(new Blob(parts, { type: 'application/json' }), 'collector-backup-' + new Date().toISOString().slice(0, 10) + '.json');
}
async function importAll(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('Dit is geen geldige back-up'); }
  if (!data || data.app !== 'collector' || !Array.isArray(data.items)) return toast('Dit is geen Collector-back-up');
  let n = 0;
  // Een lege bibliotheek met dezelfde naam hergebruiken, zodat er geen dubbele ontstaat.
  const remap = new Map();
  for (const l of data.libs || []) {
    if (!l || !l.id || state.libs.some(x => x.id === l.id)) continue;
    const twin = state.libs.find(x => x.name === l.name && !state.items.some(i => i.lib === x.id) && !state.cols.some(c2 => c2.lib === x.id) && ![...remap.values()].includes(x.id));
    if (twin) remap.set(l.id, twin.id);
    else { const nl = { id: String(l.id), name: String(l.name || 'Bibliotheek'), created: +l.created || Date.now() }; await DB.put('libs', nl); state.libs.push(nl); }
  }
  for (const c of Array.isArray(data.cols) ? data.cols : []) {
    if (!c || !c.id || state.cols.some(x => x.id === c.id)) continue;
    const nc = { id: String(c.id), lib: remap.get(c.lib) || c.lib, name: String(c.name || 'Collectie'), created: +c.created || Date.now() };
    if (Array.isArray(c.nodes)) { nc.nodes = c.nodes; nc.cam = c.cam || { x: 0, y: 0, k: 1 }; }
    if (c.view === 'canvas') nc.view = 'canvas';
    if (!state.libs.some(l => l.id === nc.lib)) nc.lib = state.libId;
    await DB.put('cols', nc); state.cols.push(nc);
  }
  for (const it of data.items) {
    if (!it || !it.id || state.items.some(x => x.id === it.id)) continue;
    it.cols = Array.isArray(it.cols) ? it.cols.map(String).filter(id => state.cols.some(c => c.id === id)) : [];
    it.lib = remap.get(it.lib) || it.lib;
    if (!state.libs.some(l => l.id === it.lib)) it.lib = state.libId;
    if (it.type === 'image') {
      const src = data.files && data.files[it.id];
      if (typeof src !== 'string' || !src.startsWith('data:image/')) continue;
      try {
        const blob = await (await fetch(src)).blob();
        const info = await analyse(blob);
        await DB.put('fulls', blob, it.id); await DB.put('thumbs', info.thumb, it.id);
      } catch { continue; }
    }
    it.tags = Array.isArray(it.tags) ? it.tags.map(String) : []; it.auto = Array.isArray(it.auto) ? it.auto.map(String) : [];
    await DB.put('items', it); state.items.push(it); n++;
  }
  // Back-ups van vóór v1.5 hebben nog losse spaces: die worden collecties met een canvas
  await migrateSpaces((data.spaces || []).filter(s => s && !state.cols.some(c => c.id === s.id)).map(s => ({ ...s, lib: remap.get(s.lib) || s.lib })));
  state.items.sort((a, b) => b.created - a.created);
  toast(n + ' items teruggezet'); renderAll();
}

async function toggleLike(id) {
  const it = state.items.find(i => i.id === id); if (!it) return;
  it.liked = !it.liked; await DB.put('items', it);
  for (const el of document.querySelectorAll('.card[data-id="' + id + '"] .heart, .wtile[data-id="' + id + '"] .heart')) { el.classList.toggle('on', it.liked); if (it.liked) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); } }
  if (state.view.kind === 'liked') renderGrid();
  renderSide();
}

// ---------- Snel voorbeeld (spatie) ----------
const ql = { id: null, hover: null };
function quickLook(id) {
  const it = state.items.find(i => i.id === id); if (!it) return;
  ql.id = id;
  let stage;
  if (it.type === 'image') { stage = h('img', { alt: it.title || '' }); blobUrl('thumb', it.id).then(u => { if (!stage.src) stage.src = u; }); blobUrl('full', it.id).then(u => { if (u) stage.src = u; }); }
  else if (it.remote) { stage = h('img', { alt: '', src: it.remote }); stage.referrerPolicy = 'no-referrer'; }
  else stage = linkCard(it);
  const box = $('#ql');
  box.replaceChildren(h('div', { class: 'redo-stage', onclick: closeQuickLook }, stage), h('div', { class: 'ql-cap', text: [it.title, it.w ? it.w + ' × ' + it.h : '', domainOf(it.source || '')].filter(Boolean).join(' · ') }));
  box.hidden = false;
}
function closeQuickLook() { ql.id = null; $('#ql').hidden = true; $('#ql').replaceChildren(); }

// ---------- Snelmenu (⌘K) ----------
const km = { open: false, list: [], idx: 0 };
function kmItems(q) {
  q = q.trim().toLowerCase();
  const out = [], add = (label, hint, run) => { if (!q || label.toLowerCase().includes(q)) out.push({ label, hint, run }); };
  add('Toevoegen: bestanden kiezen', 'Actie', () => $('#file').click());
  add('Nieuwe notitie', 'Actie · N', newNote);
  add('Nieuwe collectie', 'Actie', async () => { const c = await newCol(); if (c) setView({ kind: 'col', id: c.id }); });
  add('Herontdek', 'Actie · R', rediscover);
  add(AI.on ? 'AI-zoeken uitzetten' : 'AI-zoeken aanzetten', 'Actie', () => AI.on ? aiDisable() : aiAsk());
  add('Bewaren vanuit je browser', 'Actie', openCaptureHelp);
  for (const [label, kind] of [['Ontdek', 'wall'], ['Alles', 'all'], ['Inbox', 'unsorted'], ['Favorieten', 'liked'], ['Bladwijzers', 'bookmarks'], ['Prullenbak', 'trash'], ['Collecties', 'collections']]) add(label, 'Ga naar', () => { if (kind === 'wall') { state.display = 'wall'; return setView({ kind: 'all' }); } setView({ kind }); });
  for (const c of libCols()) add(c.name, 'Collectie', () => setView(colView(c)));
  for (const c of ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#8e24aa', '#ec407a', '#795548', '#111111', '#9e9e9e', '#ffffff']) add('Kleur: ' + colorName(rgbOf(c)), 'Zoek op kleur', () => setColor(c));
  add('Volledig scherm', 'Actie · F', toggleFullscreen);
  if (q) {
    for (const [t] of tagCounts()) if (t.includes(q)) out.push({ label: '#' + t, hint: 'Tag', run: () => setView({ kind: 'tag', tag: t }) });
    for (const it of libItems()) { const name = it.title || (it.type === 'note' ? (it.text || '').slice(0, 60) : domainOf(it.source || '')); if (name && (name + ' ' + (it.source || '')).toLowerCase().includes(q)) out.push({ label: name, hint: it.type === 'note' ? 'Notitie' : it.type === 'link' ? 'Link' : 'Beeld', run: () => openDetail(it.id) }); if (out.length > 40) break; }
  }
  return out.slice(0, 40);
}
function openKm() {
  km.open = true;
  const box = $('#km'), input = h('input', { type: 'text', placeholder: 'Zoek een actie, collectie, tag of beeld', 'aria-label': 'Snelmenu' }), list = h('div', { class: 'km-list', role: 'listbox' });
  const draw = () => {
    km.list = kmItems(input.value); km.idx = clamp(km.idx, 0, Math.max(0, km.list.length - 1));
    list.replaceChildren(...(km.list.length ? km.list.map((x, i) => h('button', { type: 'button', class: 'km-row' + (i === km.idx ? ' on' : ''), onclick: () => run(i) }, h('span', { text: x.label }), h('small', { text: x.hint }))) : [h('div', { class: 'km-empty', text: 'Niets gevonden' })]));
    const on = list.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  };
  const run = i => { const x = km.list[i]; closeKm(); if (x) x.run(); };
  input.oninput = () => { km.idx = 0; draw(); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); km.idx++; draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); km.idx--; draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(km.idx); }
  };
  box.replaceChildren(h('div', { class: 'km-box' }, input, list)); box.hidden = false;
  box.onclick = e => { if (e.target === box) closeKm(); };
  km.idx = 0; draw(); input.focus();
}
function closeKm() { km.open = false; $('#km').hidden = true; $('#km').replaceChildren(); }
async function newNote() {
  const it = await addNote(''); renderAll(); openDetail(it.id);
  const ta = document.querySelector('.notestage'); if (ta) ta.focus();
}

// ---------- Weergave-instellingen: tussenruimte en hoeken ----------
function applyLook() {
  const r = document.documentElement.style;
  r.setProperty('--gapk', state.gap); r.setProperty('--radius', state.radius + 'px');
}
function openLook(anchor) {
  const m = $('#menu');
  const row = (label, key, min, max, step) => h('label', { class: 'look-row' }, h('span', { text: label }), h('input', { type: 'range', min, max, step, value: state[key], oninput: e => { state[key] = +e.target.value; applyLook(); saveMetaSoon(); measureWaveSoon(); } }));
  m.replaceChildren(h('div', { class: 'mhead', text: 'Weergave' }), row('Tussenruimte', 'gap', 0, 2.5, 0.1), row('Ronde hoeken', 'radius', 0, 24, 1));
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  m.style.left = clamp(r.left - 60, 8, innerWidth - m.offsetWidth - 8) + 'px'; m.style.top = Math.max(8, r.top - m.offsetHeight - 10) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', menuAway, { once: true }), 0);
}

// ---------- Ontdek: een eindeloze wand die zacht drijft ----------
const WALL_MIN = 6;
const wall = { on: false, items: [], cols: [], W: 0, gap: 0, ox: 0, oy: 0, drift: 0, vx: 0, vy: 0, raf: 0, live: new Map(), drag: null, quiet: 0, over: false, speed: 0 };
const mod = (a, n) => ((a % n) + n) % n;
function wallLayout() {
  const el = $('#wall'), vw = el.clientWidth; if (!vw) return;
  let W = Math.round(state.size * 1.2), gap = Math.round((W * 0.09 + 8) * state.gap);
  // Aantal kolommen volgt het aantal beelden: bij weinig beelden worden de tegels groter, zodat hetzelfde beeld niet steeds terugkomt.
  const fit = Math.ceil(vw / (W + gap)) + 1, n = Math.max(3, Math.min(wall.items.length, Math.max(Math.round(Math.sqrt(wall.items.length * 1.6)), Math.min(fit, Math.round(wall.items.length / 4)))));
  if (n < fit) { W = Math.ceil(vw / (n - 1)) - gap; gap = Math.round((W * 0.09 + 8) * state.gap); W = Math.ceil(vw / (n - 1)) - gap; }
  wall.W = W; wall.gap = gap; wall.base = Math.round(state.size * 1.2);
  wall.cols = Array.from({ length: n }, () => ({ h: 0, tiles: [] }));
  for (const it of wall.items) {
    const c = wall.cols.reduce((a, b) => b.h < a.h ? b : a), hh = Math.round(visual(it) ? W * (it.w ? it.h / it.w : 0.75) : W * 0.72);
    c.tiles.push({ it, y: c.h, h: hh }); c.h += hh + gap;
  }
  for (const el2 of wall.live.values()) el2.remove();
  wall.live.clear();
}
function wallTile(t) {
  const it = t.it;
  const el = h('button', { type: 'button', class: 'wtile', 'data-id': it.id, 'aria-label': it.title || (it.type === 'image' ? 'Afbeelding' : it.type === 'note' ? 'Notitie' : it.url) }, visual(it) ? thumbEl(it) : linkCard(it), h('span', { class: 'heart' + (it.liked ? ' on' : ''), text: '♥' }));
  el.style.width = wall.W + 'px'; el.style.height = t.h + 'px';
  return el;
}
function wallFrame() {
  wall.raf = 0;
  if (!wall.on) return;
  const el = $('#wall'), vw = el.clientWidth, vh = el.clientHeight, step = wall.W + wall.gap, n = wall.cols.length;
  // beweging: uitrollen na slepen, en zacht drijven als je niets doet
  if (!wall.drag) { wall.ox += wall.vx; wall.oy += wall.vy; wall.vx *= 0.93; wall.vy *= 0.93; }
  const idle = performance.now() - wall.quiet > 900 && !wall.drag && !wall.over && !calm.matches && detailId == null && !ql.id && !km.open;
  wall.speed += ((idle ? 0.32 : 0) - wall.speed) * 0.04;
  wall.drift += wall.speed;
  const used = new Set(), world = $('#wallWorld');
  for (let k = Math.floor(wall.ox / step) - 1; k * step - wall.ox < vw; k++) {
    const col = wall.cols[mod(k, n)]; if (!col.h) continue;
    const x = k * step - wall.ox, off = wall.oy + wall.drift * (1 + (mod(k, 3) - 1) * 0.35) + mod(k * 197, col.h);
    const base = mod(off, col.h);
    for (let i = 0; i < col.tiles.length; i++) {
      const t = col.tiles[i], y0 = t.y - base;
      for (let m = Math.floor((-t.h - 120 - y0) / col.h) + 1; y0 + m * col.h < vh + 120; m++) {
        const key = k + '|' + m + '|' + i; used.add(key);
        let node = wall.live.get(key);
        if (!node) { node = wallTile(t); wall.live.set(key, node); world.append(node); }
        node.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + (y0 + m * col.h).toFixed(1) + 'px,0)';
      }
    }
  }
  for (const [key, node] of wall.live) if (!used.has(key)) { node.remove(); wall.live.delete(key); }
  wall.raf = requestAnimationFrame(wallFrame);
}
function wallShow(list) {
  const same = wall.on && wall.items.length === list.length && wall.items.every((it, i) => it === list[i]) && wall.base === Math.round(state.size * 1.2);
  wall.items = list; wall.on = true;
  if (!same) wallLayout();
  if (!wall.raf) wall.raf = requestAnimationFrame(wallFrame);
}
function wallStop() { wall.on = false; if (wall.raf) cancelAnimationFrame(wall.raf); wall.raf = 0; }
function initWall() {
  const el = $('#wall');
  const touch = () => { wall.quiet = performance.now(); };
  el.addEventListener('wheel', e => {
    e.preventDefault(); touch();
    if (e.ctrlKey || e.metaKey) { setSize(state.size * Math.exp(-clamp(e.deltaY, -30, 30) * 0.012)); return; }
    wall.ox += e.deltaX; wall.oy += e.deltaY;
  }, { passive: false });
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    touch(); wall.vx = wall.vy = 0;
    const tile = e.target.closest('.wtile');
    wall.drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, id: tile ? tile.dataset.id : null, heart: e.target.classList.contains('heart'), alt: e.altKey, lx: 0, ly: 0 };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    touch();
    const d = wall.drag;
    if (!d) { const tile = e.target.closest && e.target.closest('.wtile'); ql.hover = tile ? tile.dataset.id : null; return; }
    const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY;
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) { d.moved = true; el.classList.add('panning'); }
    if (d.moved) { wall.ox -= dx; wall.oy -= dy; d.lx = -dx; d.ly = -dy; }
  });
  const up = e => {
    const d = wall.drag; if (!d) return; wall.drag = null; el.classList.remove('panning'); touch();
    if (d.moved) { wall.vx = clamp(d.lx, -60, 60); wall.vy = clamp(d.ly, -60, 60); return; }
    if (!d.id || e.type === 'pointercancel') return;
    if (d.heart || d.alt) toggleLike(d.id); else openDetail(d.id);
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('pointerenter', () => { wall.over = true; });
  el.addEventListener('pointerleave', () => { wall.over = false; ql.hover = null; });
  addEventListener('resize', debounce(() => { if (wall.on) wallLayout(); }, 150));
}

// ---------- Verzamelbak: met C pak je beelden op, onderin groeit een waaier ----------
function hoverTarget() {
  if (detailId != null) return [detailId];
  if (ql.id) return [ql.id];
  if (ql.hover) return [ql.hover];
  return [...state.selected];
}
/** Laat een kopie van het beeld naar de verzamelbak vliegen. */
function flyToBak(id) {
  if (calm.matches) return;
  const src = document.querySelector('.detail-stage img, #ql img') || document.querySelector('.wtile[data-id="' + id + '"]:hover img') || document.querySelector('.card[data-id="' + id + '"] img, .wtile[data-id="' + id + '"] img');
  const dst = $('#bak'); if (!src || !src.src) return;
  const a = src.getBoundingClientRect(), b = dst.getBoundingClientRect();
  const ghost = h('img', { class: 'ghost', src: src.src, alt: '' });
  Object.assign(ghost.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px' });
  document.body.append(ghost);
  const tx = (b.left + 56) - (a.left + a.width / 2), ty = (b.top + b.height / 2) - (a.top + a.height / 2), sc = Math.min(1, 64 / Math.max(a.width, a.height));
  ghost.animate([
    { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
    { transform: 'translate(' + tx * 0.5 + 'px,' + (ty * 0.5 - 60) + 'px) scale(' + (1 + sc) / 2 + ') rotate(-6deg)', opacity: 1, offset: 0.55 },
    { transform: 'translate(' + tx + 'px,' + ty + 'px) scale(' + sc + ') rotate(4deg)', opacity: 0.9 }], { duration: 520, easing: 'cubic-bezier(.3,.7,.2,1)' }).onfinish = () => ghost.remove();
}
function collect(ids) {
  ids = ids.filter(id => state.items.some(i => i.id === id && !i.trashed)); if (!ids.length) return;
  const fresh = ids.filter(id => !state.bak.includes(id));
  if (!fresh.length) { state.bak = state.bak.filter(id => !ids.includes(id)); toast(ids.length === 1 ? 'Uit je verzameling gehaald' : ids.length + ' uit je verzameling gehaald'); }
  else {
    $('#bak').hidden = false;
    for (const id of fresh) flyToBak(id);
    state.bak.push(...fresh);
  }
  saveMeta(); setTimeout(renderBak, fresh.length && !calm.matches ? 380 : 0);
}
function renderBak() {
  const el = $('#bak');
  state.bak = state.bak.filter(id => state.items.some(i => i.id === id && !i.trashed));
  el.hidden = !state.bak.length || state.view.kind === 'trash';
  if (el.hidden) { el.replaceChildren(); return; }
  const its = state.bak.map(id => state.items.find(i => i.id === id)), n = its.length, show = its.slice(-7);
  const fan = h('div', { class: 'bak-fan' }); fan.style.setProperty('--n', show.length);
  show.forEach((it, i) => {
    const t = h('button', { type: 'button', class: 'bak-card', title: 'Klik om uit je verzameling te halen', 'aria-label': 'Haal ' + (it.title || 'beeld') + ' uit je verzameling', onclick: () => { state.bak = state.bak.filter(x => x !== it.id); saveMeta(); renderBak(); } }, visual(it) ? thumbEl(it) : h('span', { class: 'bak-text', text: it.type === 'note' ? 'Aa' : '↗' }));
    t.style.setProperty('--i', i); t.style.setProperty('--d', Math.abs(i - (show.length - 1) / 2));
    fan.append(t);
  });
  const done = msg => { state.bak = []; saveMeta(); if (msg) toast(msg); };
  const ids = () => state.bak.slice();
  const act = (label, run, primary) => h('button', { type: 'button', class: 'bak-btn' + (primary ? ' primary' : ''), onclick: run }, label);
  el.replaceChildren(fan, h('span', { class: 'bak-count', text: n }),
    h('div', { class: 'bak-actions' },
      h('strong', { text: n + (n === 1 ? ' beeld verzameld' : ' beelden verzameld') }),
      h('div', { class: 'bak-row' },
        act('Nieuwe collectie', async () => { const c = await newCol(); if (!c) return; const list = ids(); await addToCol(c, list); done(); setView({ kind: 'col', id: c.id }); }, true),
        libCols().length ? act('Aan collectie…', e => openMenu(e.currentTarget, libCols().map(c => ({ label: c.name, run: async () => { const list = ids(); await addToCol(c, list); done((list.length === 1 ? 'Beeld' : list.length + ' beelden') + ' in "' + c.name + '" gezet'); renderAll(); } })))) : null,
        act('Naar canvas', async () => { const c = await newCol(); if (!c) return; const list = ids(); await addToCol(c, list); c.view = 'canvas'; await DB.put('cols', c); done(); setView({ kind: 'space', id: c.id }); }),
        act('Leegmaken', () => { done(); renderBak(); }))));
}
function toggleFullscreen() {
  const app = window.collectorApp;
  if (app && app.toggleFullscreen) return app.toggleFullscreen();
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
}

// ---------- Slepen binnen Collector ----------
const DND = 'application/x-collector';
function initDragDrop() {
  document.addEventListener('dragstart', e => {
    const el = e.target.closest && e.target.closest('.card[draggable], #trayGrid button[draggable]');
    if (!el) return;
    const id = el.dataset.id, ids = state.selected.has(id) ? [...state.selected] : [id];
    e.dataTransfer.setData(DND, JSON.stringify(ids)); e.dataTransfer.effectAllowed = 'copy';
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragend', () => { document.body.classList.remove('dragging'); document.querySelectorAll('.drop-on').forEach(x => x.classList.remove('drop-on')); });
  const isOurs = e => e.dataTransfer && [...e.dataTransfer.types].includes(DND);
  const target = e => e.target.closest && e.target.closest('[data-drop], #viewport');
  document.addEventListener('dragover', e => {
    if (!isOurs(e)) return;
    const t = target(e);
    document.querySelectorAll('.drop-on').forEach(x => x !== t && x.classList.remove('drop-on'));
    if (!t) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; t.classList.add('drop-on');
  });
  document.addEventListener('drop', async e => {
    if (!isOurs(e)) return;
    const t = target(e); if (!t) return;
    e.preventDefault();
    let ids = []; try { ids = JSON.parse(e.dataTransfer.getData(DND)); } catch { return; }
    ids = ids.filter(id => state.items.some(i => i.id === id));
    if (!ids.length) return;
    const n = ids.length === 1 ? 'Item' : ids.length + ' items';
    if (t.id === 'viewport' && sp.space) { // uit de lade op het canvas, op de plek van de muis
      const at = toWorld(e.clientX, e.clientY);
      await addToCol(sp.space, ids);
      placeItems(sp.space, ids, { x: Math.round(at.x - 140), y: Math.round(at.y - 100) });
      await DB.put('cols', sp.space); renderAll(); return;
    }
    const [kind, id] = (t.dataset.drop || '').split(':');
    if (kind === 'col') {
      const c = state.cols.find(x => x.id === id); if (!c) return;
      await addToCol(c, ids);
      toast(n + ' in "' + c.name + '" gezet');
    }
    state.selected.clear(); renderAll();
  });
}

// ---------- Deining: het raster beweegt zacht mee met scrollen ----------
const wave = { cards: [], vel: 0, last: 0, phase: 0, raf: 0, still: matchMedia('(prefers-reduced-motion: reduce)') };
function measureWave() {
  wave.cards = [...document.querySelectorAll('#grid .card')].map(el => ({ el, x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop, h: el.offsetHeight }));
}
function waveTick() {
  const wrap = $('#gridWrap'), top = wrap.scrollTop, H = wrap.clientHeight;
  wave.vel *= 0.9; wave.phase += wave.vel * 0.004;
  const amp = clamp(wave.vel, -1, 1) * 9, live = Math.abs(wave.vel) > 0.02;
  for (const c of wave.cards) {
    if (c.y + c.h < top - 200 || c.y > top + H + 200) continue;
    c.el.style.transform = live ? 'translateY(' + (amp * Math.sin(c.x / 210 + c.y / 520 + wave.phase)).toFixed(2) + 'px)' : '';
  }
  wave.raf = live ? requestAnimationFrame(waveTick) : 0;
}
function initWave() {
  const wrap = $('#gridWrap');
  wrap.addEventListener('scroll', () => {
    const d = wrap.scrollTop - wave.last; wave.last = wrap.scrollTop;
    if (wave.still.matches) return;
    wave.vel = clamp(wave.vel + d * 0.02, -1.6, 1.6);
    if (!wave.raf) wave.raf = requestAnimationFrame(waveTick);
  }, { passive: true });
  addEventListener('resize', debounce(measureWave, 150));
  // Zoomen: Ctrl/⌘ + scrollen, of de toetsen + en −
  wrap.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const el = document.elementFromPoint(e.clientX, e.clientY), card = el && el.closest('.card');
    const r0 = card && card.getBoundingClientRect(), rel = r0 ? (e.clientY - r0.top) / r0.height : 0;
    setSize(state.size * Math.exp(-clamp(e.deltaY, -30, 30) * 0.012));
    if (card) { const r1 = card.getBoundingClientRect(); wrap.scrollTop += r1.top + rel * r1.height - e.clientY; wave.last = wrap.scrollTop; }
  }, { passive: false });
}
function setSize(v) {
  state.size = Math.round(clamp(v, 90, 420));
  $('#size').value = state.size; $('#grid').style.setProperty('--col', state.size + 'px');
  saveMetaSoon(); measureWaveSoon();
  if (wall.on) { const cx = wall.ox + $('#wall').clientWidth / 2, old = wall.W + wall.gap; wallLayout(); wall.ox = cx * (wall.W + wall.gap) / old - $('#wall').clientWidth / 2; }
}
const saveMetaSoon = debounce(() => saveMeta(), 400), measureWaveSoon = debounce(() => measureWave(), 120);

// ---------- Bestanden die je zelf in de map zet ----------
let adopting = false;
async function adoptNew() {
  if (!DB.http || adopting) return;
  adopting = true;
  try {
    const list = await (await DB.call('GET', 'unindexed')).json();
    const out = [];
    for (const f of list) {
      try {
        const blob = await (await fetch('api/raw/' + encodeURIComponent(f.name))).blob();
        out.push(await addImage(blob, { adopt: f.name, name: f.name, source: f.source, title: f.title || f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') }));
      } catch (e) { console.warn('Overslaan', f.name, e); }
    }
    if (out.length) { toast(out.length === 1 ? '1 nieuw beeld uit je map' : out.length + ' nieuwe beelden uit je map'); renderAll(); aiIndex(); }
  } catch (e) { console.warn(e); }
  finally { adopting = false; }
}
let updState = null, settingsDraw = null;
function updText(st) {
  if (!st) return '';
  if (st.status === 'checking') return 'Zoeken naar updates…';
  if (st.status === 'none') return 'Je hebt de nieuwste versie.';
  if (st.status === 'available') return 'Versie ' + st.version + ' is beschikbaar.' + (st.blocked ? ' ' + st.blocked : '');
  if (st.status === 'downloading') return 'Versie ' + st.version + ' downloaden… ' + st.progress + '%';
  if (st.status === 'ready') return 'Versie ' + st.version + ' staat klaar en wordt geïnstalleerd als je Collector afsluit.';
  if (st.status === 'error') return st.message;
  return '';
}
function initUpdates() {
  const upd = window.collectorApp && window.collectorApp.update; if (!upd) return;
  let told = false;
  upd.onState(st => {
    updState = st;
    if (settingsDraw && document.querySelector('.settings')) settingsDraw(st);
    const pill = $('#updPill'); pill.hidden = st.status !== 'ready';
    if (st.status === 'ready') { pill.textContent = 'Versie ' + st.version + ' klaar · herstart'; if (!told) { told = true; toast('Collector ' + st.version + ' staat klaar. Herstart om bij te werken.', 6000); } }
  });
  $('#updPill').onclick = () => upd.restart();
}
function openSettings() {
  const app = window.collectorApp, info = DB.info || {};
  const row = (label, ...kids) => h('div', { class: 'set-row' }, h('div', { class: 'set-label', text: label }), h('div', { class: 'set-body' }, kids));
  const btn = (label, run) => h('button', { type: 'button', class: 'btn small', onclick: run }, label);
  const body = h('div', { class: 'settings' });
  if (DB.http) body.append(row('Bibliotheekmap',
    h('div', { class: 'set-path', text: info.library }),
    h('p', { class: 'set-help', text: 'Hier staan je beelden als gewone bestanden, in de map Beelden. Kies een andere map om je bibliotheek ergens anders te bewaren, bijvoorbeeld op een netwerkschijf. Een andere map kiezen verplaatst niets: je begint daar een eigen bibliotheek, of opent de bibliotheek die er al staat.' }),
    app && h('div', { class: 'set-actions' },
      btn('Toon in Finder', () => app.showLibrary()),
      btn('Kies andere map…', async () => { if (await app.chooseLibrary()) location.reload(); }),
      info.defaultLibrary && info.library !== info.defaultLibrary && btn('Terug naar standaardmap', async () => { if (await app.resetLibrary()) location.reload(); }))));
  const n = libItems().filter(i => AI.embs.has(i.id)).length;
  body.append(row('Zoeken op beeldinhoud',
    h('p', { class: 'set-help', text: AI.on ? 'Staat aan. ' + n + (n === 1 ? ' beeld' : ' beelden') + ' doorzoekbaar op wat erop te zien is.' : 'Staat uit. Zet je het aan, dan haalt Collector eenmalig een beeldmodel op (ongeveer 155 MB). Het draait op je eigen computer; je beelden worden nergens heen gestuurd.' }),
    h('div', { class: 'set-actions' }, btn(AI.on ? 'Uitzetten' : 'Aanzetten', () => { close(); AI.on ? aiDisable() : aiAsk(); }))));
  body.append(row('Back-up',
    h('p', { class: 'set-help', text: DB.http ? 'Je bibliotheekmap is zelf je back-up: kopieer de hele map. Daarnaast kun je alles in één bestand bewaren.' : 'Bewaar alles in één bestand, of zet zo\'n bestand terug.' }),
    h('div', { class: 'set-actions' }, btn('Back-up maken', () => { close(); exportAll(); }), btn('Terugzetten…', () => { close(); $('#fileImport').click(); }))));
  if (DB.http) {
    const upd = app && app.update, status = h('p', { class: 'set-help' }), acts = h('div', { class: 'set-actions' });
    const auto = h('input', { type: 'checkbox', id: 'setAuto', onchange: async e => draw(await upd.setAuto(e.target.checked)) });
    const draw = st => {
      updState = st; auto.checked = st.auto;
      status.textContent = updText(st) || 'Collector kijkt bij elke start of er een nieuwere versie is.';
      acts.replaceChildren(
        st.status === 'ready' ? btn('Herstart en werk bij', () => upd.restart()) : st.status === 'available' && !st.blocked ? btn('Downloaden en installeren', async () => draw(await upd.download())) : btn('Zoek naar updates', async () => { status.textContent = 'Zoeken…'; draw(await upd.check()); }),
        btn('Toon logboek', () => app.showLog()));
    };
    body.append(row('Versie',
      h('div', { text: 'Collector ' + (info.version || '') + (info.build ? ' (build ' + info.build + ')' : '') }),
      upd && status, upd && h('label', { class: 'set-check' }, auto, ' Updates automatisch downloaden en installeren'), upd ? acts : null));
    if (upd) { settingsDraw = draw; upd.get().then(draw); }
  }
  const close = openPanel('Instellingen', '', body);
}
function initLibraryInfo() {
  $('#btnSettings').onclick = openSettings;
  addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); } });
  if (!DB.http) return;
  const app = window.collectorApp, where = $('#where');
  const parts = DB.info.library.split(/[\\/]/).filter(Boolean);
  where.replaceChildren(h('span', { class: 'libpath', title: DB.info.library, text: (parts.length > 2 ? '…/' : '') + parts.slice(-2).join('/') }));
  if (app && app.onOpenSettings) app.onOpenSettings(openSettings);
  initUpdates();
  if (DB.info.version) $('#appver').textContent = 'Collector ' + DB.info.version + (DB.info.build ? ' (build ' + DB.info.build + ')' : '');
  const checkOutside = async () => {
    try { const info = await (await DB.call('GET', 'info')).json(); if (info.rev !== DB.info.rev) return location.reload(); } catch (e) { /* motor even weg */ }
    adoptNew();
  };
  try { new EventSource('api/events').onmessage = () => checkOutside(); } catch (e) { /* zonder live meldingen */ }
  addEventListener('focus', debounce(async () => {
    try { const info = await (await DB.call('GET', 'info')).json(); if (info.rev !== DB.info.rev) return location.reload(); } catch (e) { /* motor even weg */ }
    adoptNew();
  }, 400));
}

// ---------- Alles tekenen ----------
function renderAll() {
  const inSpace = state.view.kind === 'space';
  $('#viewLibrary').hidden = inSpace; $('#viewSpace').hidden = !inSpace;
  renderSide();
  if (inSpace) renderSpace(); else { sp.space = null; renderGrid(); }
  $('#sort').value = state.sort;
  renderAi();
}

// ---------- Gebeurtenissen ----------
function initEvents() {
  $('#libSwitch').onclick = libMenu;
  $('#btnAdd').onclick = e => openMenu(e.currentTarget, [
    { label: 'Bestanden kiezen', run: () => $('#file').click() },
    { label: 'Link of beeld-URL plakken', run: async () => {
      const u = await dialog({ title: 'Link toevoegen', text: 'Een beeld-URL wordt opgehaald als de site dat toestaat. Anders bewaren we de link.', value: '', placeholder: 'https://', ok: 'Toevoegen' });
      if (!u) return;
      if (!isUrl(u)) return toast('Dat is geen geldige link');
      try { afterAdd([await addUrl(u)]); } catch (e) { toast(e.message); }
    } },
    navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && { label: 'Schermafbeelding maken', run: screenshot },
    { label: 'Bewaren vanuit je browser', run: openCaptureHelp },
    { label: 'Voorbeelden laden', run: addSamples },
  ].filter(Boolean));
  $('#btnRedo').onclick = rediscover;
  $('#btnLook').onclick = e => openLook(e.currentTarget);
  $('#grid').addEventListener('mouseover', e => { const c = e.target.closest('.card'); ql.hover = c ? c.dataset.id : null; });
  $('#grid').addEventListener('mouseleave', () => { ql.hover = null; });
  $('#sort').onchange = e => { state.sort = e.target.value; saveMeta(); renderGrid(); };
  for (const b of document.querySelectorAll('#mode button')) b.onclick = () => {
    const m = b.dataset.mode;
    if (m === 'collections') return setView({ kind: 'collections' });
    state.display = m === 'wall' ? 'wall' : 'grid';
    setView(['collections', 'trash'].includes(state.view.kind) ? { kind: 'all' } : state.view);
  };
  $('#file').onchange = async e => { const out = await addFiles(e.target.files); e.target.value = ''; landInSpace(out); afterAdd(out); };
  $('#q').oninput = debounce(e => { state.q = e.target.value.trim(); AI.qEmb = null; renderGrid(); aiQuery(); }, 120);
  $('#size').oninput = e => setSize(+e.target.value);
  $('#btnExport').onclick = exportAll;
  $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileImport').onchange = e => { if (e.target.files[0]) importAll(e.target.files[0]); e.target.value = ''; };
  for (const id of ['#btnMenu', '#btnMenu2']) $(id).onclick = () => $('#side').classList.add('open');
  $('#sideScrim').onclick = () => $('#side').classList.remove('open');

  $('#grid').addEventListener('click', e => {
    const card = e.target.closest('.card'); if (!card) return;
    const id = card.dataset.id;
    if (e.target.classList.contains('heart') || (e.altKey && state.view.kind !== 'trash')) { toggleLike(id); return; }
    if (e.target.classList.contains('check') || e.metaKey || e.ctrlKey || e.shiftKey || state.selected.size || state.view.kind === 'trash') {
      if (e.shiftKey && state.selected.size) { // bereik selecteren
        const ids = lastVisible.map(i => i.id), last = [...state.selected].pop();
        const [a, b] = [ids.indexOf(last), ids.indexOf(id)].sort((x, y) => x - y);
        for (let i = a; i <= b; i++) state.selected.add(ids[i]);
      } else state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
      renderGrid();
    } else openDetail(id);
  });

  // Slepen en plakken
  let depth = 0;
  const hasPayload = e => e.dataTransfer && [...e.dataTransfer.types].some(t => t === 'Files' || t === 'text/uri-list' || t === 'text/html');
  addEventListener('dragenter', e => { if (!hasPayload(e)) return; e.preventDefault(); depth++; $('#drop').hidden = false; });
  addEventListener('dragover', e => { if (hasPayload(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  addEventListener('dragleave', e => { if (!hasPayload(e)) return; depth = Math.max(0, depth - 1); if (!depth) $('#drop').hidden = true; });
  addEventListener('drop', async e => {
    if (!hasPayload(e)) return;
    e.preventDefault(); depth = 0; $('#drop').hidden = true;
    const at = sp.space ? toWorld(e.clientX, e.clientY) : null;
    const out = await ingest(e.dataTransfer);
    landInSpace(out, at); afterAdd(out);
  });
  addEventListener('paste', async e => {
    const t = e.target, typing = t.closest && t.closest('input, textarea, [contenteditable="true"]');
    const cd = e.clipboardData; if (!cd) return;
    if (typing && !(cd.files && cd.files.length)) return;
    const plain = (cd.getData('text/plain') || '').trim();
    if (!(cd.files && cd.files.length) && !isUrl(plain) && !/<img/i.test(cd.getData('text/html') || '')) {
      if (!typing && plain && !sp.space) { e.preventDefault(); afterAdd([await addNote(plain)]); }
      return;
    }
    e.preventDefault();
    const out = await ingest(cd);
    landInSpace(out); afterAdd(out);
  });

  addEventListener('keydown', e => {
    const typing = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return km.open ? closeKm() : openKm(); }
    if (e.key === 'Escape') {
      if (km.open) return closeKm();
      if (ql.id) return closeQuickLook();
      if (!$('#menu').hidden) return closeMenu();
      if (typing && e.target.isContentEditable) return e.target.blur();
      if (redo.cur) return closeRedo();
      if (detailId != null) return closeDetail();
      if (state.selected.size) { state.selected.clear(); renderGrid(); }
      if (sp.space) selectNodes([]);
      return;
    }
    if (typing || $('#dlg').open || km.open) return;
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'f') { e.preventDefault(); return toggleFullscreen(); }
      if (!sp.space && (k === 'l' || k === 'c')) {
        const ids = hoverTarget();
        if (ids.length) { e.preventDefault(); if (k === 'l') ids.forEach(toggleLike); else collect(ids); return; }
      }
    }
    if (ql.id) {
      const i = lastVisible.findIndex(x => x.id === ql.id);
      if (e.key === ' ') { e.preventDefault(); closeQuickLook(); }
      else if (e.key === 'ArrowRight' && lastVisible[i + 1]) quickLook(lastVisible[i + 1].id);
      else if (e.key === 'ArrowLeft' && lastVisible[i - 1]) quickLook(lastVisible[i - 1].id);
      else if (e.key === 'Enter') { const id = ql.id; closeQuickLook(); openDetail(id); }
      return;
    }
    if (e.key === ' ' && !sp.space && detailId == null && !redo.cur) {
      const id = ql.hover || (state.selected.size === 1 ? [...state.selected][0] : null);
      if (id) { e.preventDefault(); return quickLook(id); }
    }
    if (redo.cur) { if (e.key === 'ArrowRight') rediscover(); return; }
    if (detailId != null) {
      const idx = lastVisible.findIndex(i => i.id === detailId);
      if (e.key === 'ArrowLeft' && lastVisible[idx - 1]) openDetail(lastVisible[idx - 1].id);
      if (e.key === 'ArrowRight' && lastVisible[idx + 1]) openDetail(lastVisible[idx + 1].id);
      return;
    }
    if (e.key === '/' && !sp.space) { e.preventDefault(); $('#q').focus(); }
    if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey && !sp.space) rediscover();
    if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !sp.space) { e.preventDefault(); newNote(); }
    if (!sp.space && (e.key === '+' || e.key === '=')) { e.preventDefault(); setSize(state.size * 1.15); }
    if (!sp.space && (e.key === '-' || e.key === '_')) { e.preventDefault(); setSize(state.size / 1.15); }
    if (sp.space) {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelectedNodes(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectNodes(sp.space.nodes.map(n => n.id)); }
      if (e.key === '1') fitSpace();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected.size) bulkDelete();
  });
}
/** Staat er een canvas open? Zet nieuwe items er dan meteen op (ze zitten al in de collectie). */
function landInSpace(items, at) {
  if (!sp.space || !items.length) return;
  const c = at || viewCenter();
  placeItems(sp.space, items.map(i => i.id), { x: Math.round(c.x - 140), y: Math.round(c.y - 100) });
  DB.put('cols', sp.space);
}

// ---------- Start ----------
async function start() {
  try { await DB.open(); }
  catch (e) {
    document.body.replaceChildren(h('div', { class: 'empty' }, h('h2', { text: 'Opslag niet beschikbaar' }), h('p', { text: 'Collector bewaart alles in je browser (IndexedDB). In deze browser of privémodus is dat uitgeschakeld.' })));
    return;
  }
  [state.libs, state.items, state.spaces, state.cols] = await Promise.all([DB.all('libs'), DB.all('items'), DB.all('spaces'), DB.all('cols')]);
  state.items.sort((a, b) => b.created - a.created);
  if (!state.libs.length) { const l = { id: uid(), name: 'Mijn bibliotheek', created: Date.now() }; await DB.put('libs', l); state.libs.push(l); }
  const meta = await DB.get('meta', 'settings') || {};
  state.libId = state.libs.some(l => l.id === meta.libId) ? meta.libId : state.libs[0].id;
  state.size = meta.size3 || 200; $('#size').value = state.size;
  state.sort = meta.sort || 'new';
  if (meta.gap != null) state.gap = meta.gap; if (meta.radius != null) state.radius = meta.radius; applyLook();
  state.tagsOpen = !!meta.tagsOpen;
  state.bak = (Array.isArray(meta.bak) ? meta.bak : []).filter(id => state.items.some(i => i.id === id && !i.trashed));
  if (state.spaces.length) { // eenmalig: spaces worden collecties
    const n = await migrateSpaces(state.spaces);
    for (const s of state.spaces) await DB.del('spaces', s.id);
    state.spaces = [];
    if (n) setTimeout(() => toast(n === 1 ? 'Je space is nu een collectie met een canvas' : 'Je ' + n + ' spaces zijn nu collecties met een canvas'), 600);
  }
  for (const [id, e] of await DB.entries('embs')) AI.embs.set(id, e);
  initEvents(); initSpaceEvents(); initDragDrop(); initWave(); initWall(); renderAll();
  initExtensionBridge();
  initLibraryInfo(); adoptNew();
  await handleCapture();
  if (meta.ai) aiEnable();
}
start();
})();

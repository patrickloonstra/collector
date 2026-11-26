/* Collector-extensie: haalt het beeld op en bewaart het in de Mac-app als die draait, anders in een open Collector-tab. */
const api = globalThis.browser || globalThis.chrome;
const DEFAULT_BASE = 'https://dev.patrickloonstra.nl/collector/';
const getBase = async () => ((await api.storage.local.get('base')).base || DEFAULT_BASE);
const sleep = ms => new Promise(r => setTimeout(r, ms));

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({ id: 'img', title: 'Bewaar beeld in Collector', contexts: ['image'] });
    api.contextMenus.create({ id: 'page', title: 'Bewaar deze pagina in Collector', contexts: ['page', 'link'] });
    api.contextMenus.create({ id: 'pick', title: 'Kies beelden van deze pagina…', contexts: ['page'] });
  });
});

const bigger = url => url.replace(/([?&]name=)\w+/, '$1large'); // X levert anders een kleine versie
async function toDataUrl(url) {
  const r = await fetch(bigger(url), { credentials: 'omit' });
  if (!r.ok) throw new Error('ophalen mislukt');
  const b = await r.blob();
  if (!b.type.startsWith('image/')) throw new Error('geen beeld');
  if (b.size > 40e6) throw new Error('te groot');
  return new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); });
}
async function collectorTab() {
  const base = await getBase(), u = new URL(base);
  const tabs = await api.tabs.query({ url: u.origin + u.pathname + '*' });
  const tab = tabs[0] || await api.tabs.create({ url: base, active: false });
  for (let i = 0; i < 40; i++) { // wachten tot Collector geladen is
    try { const r = await api.tabs.sendMessage(tab.id, { ping: true }); if (r && r.ready) return tab; } catch (e) { /* nog niet klaar */ }
    await sleep(400);
  }
  throw new Error('Collector reageert niet');
}
const APP = 'http://127.0.0.1:4317/';
/** Draait de Mac-app? Dan bewaren we daar, rechtstreeks in je map. */
async function appRunning() {
  if ((await api.storage.local.get('base')).base) return false; // eigen adres ingesteld: dat gaat voor
  try {
    const c = new AbortController(), t = setTimeout(() => c.abort(), 700);
    const r = await fetch(APP + 'api/info', { signal: c.signal }); clearTimeout(t);
    return r.ok && (await r.json()).app === 'collector';
  } catch (e) { return false; }
}
async function deliver(payload) {
  if (await appRunning()) {
    const r = await fetch(APP + 'api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Collector': '1' }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error('bewaren mislukt');
    return;
  }
  const tab = await collectorTab();
  const r = await api.tabs.sendMessage(tab.id, { collectorAdd: payload });
  if (!r || !r.ok) throw new Error('bewaren mislukt');
}
async function saveImage(url, page, title) { await deliver({ dataUrl: await toDataUrl(url), page, title }); }
const toast = (tabId, text, ok) => api.tabs.sendMessage(tabId, { toast: text, ok }).catch(() => {});

async function pick(tab) {
  const [res] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: () =>
    [...new Set([...document.images].filter(i => i.naturalWidth >= 300 && i.naturalHeight >= 200)
      .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)
      .map(i => i.currentSrc || i.src).filter(u => /^https?:/.test(u)))].slice(0, 12) });
  const p = new URLSearchParams(); p.set('src', tab.url); p.set('title', tab.title || '');
  for (const u of (res && res.result) || []) p.append('add', bigger(u));
  await api.tabs.create({ url: (await getBase()) + '?' + p });
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'pick') return pick(tab);
    toast(tab.id, 'Bewaren…');
    if (info.menuItemId === 'img') await saveImage(info.srcUrl, tab.url, tab.title);
    else await deliver({ page: info.linkUrl || tab.url, title: info.linkUrl ? '' : tab.title });
    toast(tab.id, 'Bewaard in Collector', true);
  } catch (e) { toast(tab.id, 'Niet gelukt: ' + e.message, false); }
});
api.action.onClicked.addListener(tab => pick(tab).catch(() => {}));
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.save) return;
  saveImage(msg.save.url, msg.save.page, msg.save.title).then(() => sendResponse({ ok: true }), e => sendResponse({ ok: false, error: e.message }));
  return true;
});

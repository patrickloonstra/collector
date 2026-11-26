#!/usr/bin/env node
'use strict';
/**
 * MCP-server voor Collector: laat Claude, Cursor en andere agents in je bibliotheek zoeken.
 * Praat met de draaiende Collector-app op deze computer; er gaat niets naar buiten.
 * Standaard alleen lezen. Schrijven (tags, notities, links) staat aan met COLLECTOR_MCP_WRITE=1.
 */
const readline = require('readline');
const BASE = (process.env.COLLECTOR_URL || 'http://127.0.0.1:4317/').replace(/\/?$/, '/');
const WRITE = process.env.COLLECTOR_MCP_WRITE === '1';
const VERSION = '0.1.0';

async function api(method, url, body) {
  let r;
  try { r = await fetch(BASE + 'api/' + url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'X-Collector': '1', 'X-Collector-Client': 'mcp', 'Content-Type': 'application/json' } }); }
  catch { throw new Error('Collector draait niet. Open de Collector-app en probeer het opnieuw.'); }
  if (!r.ok) throw new Error('Collector gaf een fout (' + r.status + ').');
  return r;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
async function load() {
  const [items, cols, libs, files] = await Promise.all(['store/items', 'store/cols', 'store/libs', 'files'].map(async u => (await api('GET', u)).json()));
  return { items: items.filter(i => !i.trashed), cols, libs, files };
}
function view(it, d) {
  return {
    id: it.id, type: it.type === 'image' ? 'beeld' : it.type === 'note' ? 'notitie' : 'link',
    title: it.title || undefined, tags: [...(it.tags || []), ...(it.auto || [])],
    collections: (it.cols || []).map(id => (d.cols.find(c => c.id === id) || {}).name).filter(Boolean),
    source: it.source || undefined, note: it.note || undefined, text: it.text || undefined,
    colors: (it.palette || []).slice(0, 4).map(p => p.hex), size: it.w ? it.w + 'x' + it.h : undefined,
    favorite: it.liked || undefined, file: d.files[it.id] || undefined, added: new Date(it.created).toISOString().slice(0, 10),
  };
}
const text = v => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });

const tools = [
  { name: 'search_library', write: false,
    description: 'Zoek in de Collector-bibliotheek van de gebruiker (beelden, links en notities met ontwerpinspiratie). Zoekt in titel, tags, notitie, tekst, bron en collectienaam. Laat query weg om alles (of een hele collectie of tag) op te vragen. Geeft per item onder meer het bestandspad terug.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Zoekwoorden; alle woorden moeten voorkomen' }, collection: { type: 'string', description: 'Naam van een collectie' }, tag: { type: 'string' }, type: { type: 'string', enum: ['beeld', 'link', 'notitie'] }, favorites: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 30 } } },
    async run(a) {
      const d = await load();
      let list = d.items.map(i => view(i, d));
      if (a.collection) list = list.filter(i => i.collections.some(c => c.toLowerCase() === String(a.collection).toLowerCase()));
      if (a.tag) list = list.filter(i => i.tags.includes(String(a.tag).toLowerCase()));
      if (a.type) list = list.filter(i => i.type === a.type);
      if (a.favorites) list = list.filter(i => i.favorite);
      const toks = String(a.query || '').toLowerCase().split(/\s+/).filter(Boolean);
      if (toks.length) list = list.filter(i => { const hay = [i.title, i.note, i.text, i.source, ...i.tags, ...i.collections, ...i.colors].join(' ').toLowerCase(); return toks.every(t => hay.includes(t)); });
      const total = list.length; list = list.slice(0, Math.min(200, a.limit || 30));
      return text({ total, shown: list.length, items: list });
    } },
  { name: 'list_collections', write: false, description: 'Geeft alle collecties en tags in de Collector-bibliotheek, met het aantal items.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      const d = await load(), tags = {};
      for (const i of d.items) for (const t of [...(i.tags || []), ...(i.auto || [])]) tags[t] = (tags[t] || 0) + 1;
      return text({ items: d.items.length, collections: d.cols.map(c => ({ name: c.name, items: d.items.filter(i => (i.cols || []).includes(c.id)).length })), tags: Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([name, items]) => ({ name, items })) });
    } },
  { name: 'get_item', write: false, description: 'Geeft alle gegevens van één item uit Collector en, als het een beeld is, een miniatuur om naar te kijken.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async run(a) {
      const d = await load(), it = d.items.find(i => i.id === a.id);
      if (!it) throw new Error('Geen item met dit id.');
      const out = text(view(it, d));
      if (it.type === 'image') { try { const r = await api('GET', 'blob/thumbs/' + encodeURIComponent(it.id)); out.content.push({ type: 'image', data: Buffer.from(await r.arrayBuffer()).toString('base64'), mimeType: 'image/webp' }); } catch { /* zonder miniatuur */ } }
      return out;
    } },
  { name: 'add_tags', write: true, description: 'Zet tags op een item in Collector.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, tags: { type: 'array', items: { type: 'string' }, minItems: 1 } }, required: ['id', 'tags'] },
    async run(a) {
      const it = await (await api('GET', 'store/items/' + encodeURIComponent(a.id))).json();
      if (!it) throw new Error('Geen item met dit id.');
      const add = a.tags.map(t => String(t).trim().toLowerCase().slice(0, 60)).filter(Boolean);
      it.tags = [...new Set([...(it.tags || []), ...add])]; it.auto = (it.auto || []).filter(t => !add.includes(t));
      await api('PUT', 'store/items/' + encodeURIComponent(it.id), it);
      return text('Tags gezet: ' + add.join(', '));
    } },
  { name: 'add_note', write: true, description: 'Bewaart een tekstnotitie in Collector, eventueel in een bestaande collectie.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, collection: { type: 'string', description: 'Naam van een bestaande collectie' } }, required: ['text'] },
    async run(a) { return text('Notitie bewaard (id ' + await addItem({ type: 'note', text: String(a.text).slice(0, 20000), auto: ['notitie'] }, a.collection) + ').'); } },
  { name: 'add_link', write: true, description: 'Bewaart een link als bladwijzer in Collector, eventueel in een bestaande collectie.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' }, collection: { type: 'string' } }, required: ['url'] },
    async run(a) {
      if (!/^https?:\/\/\S+$/i.test(a.url)) throw new Error('Geen geldige link.');
      let host = ''; try { host = new URL(a.url).hostname.replace(/^www\./, ''); } catch { /* laat leeg */ }
      return text('Link bewaard (id ' + await addItem({ type: 'link', url: a.url, source: a.url, title: String(a.title || '').slice(0, 200), remote: '', auto: ['link', host].filter(Boolean) }, a.collection) + ').');
    } },
];
async function addItem(fields, collection) {
  const d = await load(), lib = d.libs[0];
  if (!lib) throw new Error('Open Collector eerst één keer, dan bestaat de bibliotheek.');
  let cols = [];
  if (collection) { const c = d.cols.find(x => x.name.toLowerCase() === String(collection).toLowerCase()); if (!c) throw new Error('Collectie "' + collection + '" bestaat niet.'); cols = [c.id]; }
  const item = { id: uid(), lib: lib.id, title: '', note: '', source: '', tags: [], auto: [], palette: [], cols, created: Date.now(), ...fields };
  await api('PUT', 'store/items/' + item.id, item);
  return item.id;
}
const visible = () => tools.filter(t => WRITE || !t.write);

async function handle(msg) {
  const { id, method, params = {} } = msg;
  if (method === 'initialize') return { protocolVersion: params.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'collector', version: VERSION }, instructions: 'Collector is de lokale bibliotheek met ontwerpinspiratie van de gebruiker. Gebruik search_library om referenties te vinden en get_item om een beeld te bekijken.' };
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: visible().map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
  if (method === 'tools/call') {
    const t = visible().find(x => x.name === params.name);
    if (!t) throw Object.assign(new Error('Onbekende tool: ' + params.name), { code: -32602 });
    try { return await t.run(params.arguments || {}); }
    catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
  }
  if (id === undefined) return undefined; // melding zonder antwoord
  throw Object.assign(new Error('Onbekende methode: ' + method), { code: -32601 });
}
const send = o => process.stdout.write(JSON.stringify(o) + '\n');
readline.createInterface({ input: process.stdin }).on('line', async line => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Ongeldige JSON' } }); }
  try { const result = await handle(msg); if (msg.id !== undefined && result !== undefined) send({ jsonrpc: '2.0', id: msg.id, result }); }
  catch (e) { if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } }); }
});

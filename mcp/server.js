#!/usr/bin/env node
'use strict';
/**
 * MCP-server voor Collector: laat Claude, Cursor en andere agents in je bibliotheek zoeken.
 * Praat met de draaiende Collector-app op deze computer; er gaat niets naar buiten.
 * De gebruiker zet de koppeling aan in Collector (Instellingen > AI-assistent) en kiest daar of de agent ook mag ordenen.
 * Weggooien kan een agent nooit.
 */
const readline = require('readline');
const BASE = (process.env.COLLECTOR_URL || 'http://127.0.0.1:4317/').replace(/\/?$/, '/');
const VERSION = '0.2.0';

async function api(method, url, body) {
  let r;
  try { r = await fetch(BASE + 'api/' + url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'X-Collector': '1', 'X-Collector-Client': 'mcp', 'Content-Type': 'application/json' } }); }
  catch { throw new Error('Collector draait niet. Open de Collector-app en probeer het opnieuw.'); }
  if (r.status === 403) {
    const why = await r.json().then(j => j.error, () => '');
    if (why === 'mcp-uit') throw new Error('De koppeling met Collector staat uit. Vraag de gebruiker hem aan te zetten in Collector: Instellingen > AI-assistent.');
    if (why === 'mcp-alleen-lezen') throw new Error('Je mag in Collector alleen kijken. Wil de gebruiker dat je ordent, dan zet hij dat aan in Collector: Instellingen > AI-assistent.');
  }
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
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Zoekwoorden; alle woorden moeten voorkomen' }, collection: { type: 'string', description: 'Naam van een collectie' }, tag: { type: 'string' }, type: { type: 'string', enum: ['beeld', 'link', 'notitie'] }, favorites: { type: 'boolean' }, unsorted: { type: 'boolean', description: 'Alleen items die nog in geen enkele collectie zitten' }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 30 } } },
    async run(a) {
      const d = await load();
      let list = d.items.map(i => view(i, d));
      if (a.collection) list = list.filter(i => i.collections.some(c => c.toLowerCase() === String(a.collection).toLowerCase()));
      if (a.tag) list = list.filter(i => i.tags.includes(String(a.tag).toLowerCase()));
      if (a.type) list = list.filter(i => i.type === a.type);
      if (a.favorites) list = list.filter(i => i.favorite);
      if (a.unsorted) list = list.filter(i => !i.collections.length);
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
  { name: 'view_items', write: false, description: 'Laat tot 12 items tegelijk zien: per item de gegevens en, als het een beeld is, de miniatuur. Gebruik dit om een reeks beelden te bekijken voordat je ze ordent.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 } }, required: ['ids'] },
    async run(a) {
      const d = await load(), content = [];
      for (const id of a.ids.slice(0, 12)) {
        const it = d.items.find(i => i.id === id);
        if (!it) { content.push({ type: 'text', text: 'Geen item met id ' + id + '.' }); continue; }
        content.push({ type: 'text', text: JSON.stringify(view(it, d)) });
        if (it.type === 'image') { try { const r = await api('GET', 'blob/thumbs/' + encodeURIComponent(it.id)); content.push({ type: 'image', data: Buffer.from(await r.arrayBuffer()).toString('base64'), mimeType: 'image/webp' }); } catch { /* zonder miniatuur */ } }
      }
      return { content };
    } },
  { name: 'add_to_collection', write: true, description: 'Zet een of meer items in een collectie. Bestaat de collectie nog niet, dan wordt ze aangemaakt (tenzij create op false staat). Een item kan in meer collecties zitten; er wordt niets verplaatst of weggehaald.',
    inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'Naam van de collectie' }, ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 200 }, create: { type: 'boolean', default: true } }, required: ['collection', 'ids'] },
    async run(a) {
      const d = await load(), name = String(a.collection || '').trim().slice(0, 80);
      if (!name) throw new Error('Geef de collectie een naam.');
      let c = d.cols.find(x => x.name.toLowerCase() === name.toLowerCase()), made = false;
      if (!c) {
        if (a.create === false) throw new Error('Collectie "' + name + '" bestaat niet.');
        if (!d.libs[0]) throw new Error('Open Collector eerst één keer, dan bestaat de bibliotheek.');
        c = { id: uid(), lib: d.libs[0].id, name, created: Date.now() }; await api('PUT', 'store/cols/' + c.id, c); made = true;
      }
      let n = 0; const missing = [];
      for (const id of [...new Set(a.ids)]) {
        const it = d.items.find(i => i.id === id);
        if (!it) { missing.push(id); continue; }
        if ((it.cols || []).includes(c.id)) continue;
        it.cols = [...(it.cols || []), c.id]; await api('PUT', 'store/items/' + encodeURIComponent(it.id), it); n++;
      }
      return text((made ? 'Collectie "' + c.name + '" gemaakt. ' : '') + n + (n === 1 ? ' item' : ' items') + ' toegevoegd aan "' + c.name + '".' + (missing.length ? ' Niet gevonden: ' + missing.join(', ') + '.' : ''));
    } },
  { name: 'remove_from_collection', write: true, description: 'Haalt items uit een collectie. De items zelf blijven in de bibliotheek staan.',
    inputSchema: { type: 'object', properties: { collection: { type: 'string' }, ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 200 } }, required: ['collection', 'ids'] },
    async run(a) {
      const d = await load(), c = d.cols.find(x => x.name.toLowerCase() === String(a.collection).toLowerCase());
      if (!c) throw new Error('Collectie "' + a.collection + '" bestaat niet.');
      let n = 0;
      for (const id of [...new Set(a.ids)]) {
        const it = d.items.find(i => i.id === id);
        if (!it || !(it.cols || []).includes(c.id)) continue;
        it.cols = it.cols.filter(x => x !== c.id); await api('PUT', 'store/items/' + encodeURIComponent(it.id), it); n++;
      }
      return text(n + (n === 1 ? ' item' : ' items') + ' uit "' + c.name + '" gehaald.');
    } },
  { name: 'remove_tags', write: true, description: 'Haalt tags van een item af.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, tags: { type: 'array', items: { type: 'string' }, minItems: 1 } }, required: ['id', 'tags'] },
    async run(a) {
      const it = await (await api('GET', 'store/items/' + encodeURIComponent(a.id))).json();
      if (!it) throw new Error('Geen item met dit id.');
      const drop = a.tags.map(t => String(t).trim().toLowerCase());
      it.tags = (it.tags || []).filter(t => !drop.includes(t)); it.auto = (it.auto || []).filter(t => !drop.includes(t));
      await api('PUT', 'store/items/' + encodeURIComponent(it.id), it);
      return text('Tags weggehaald: ' + drop.join(', '));
    } },
  { name: 'set_details', write: true, description: 'Geeft een item een titel en/of een notitie. Wat je niet meegeeft blijft zoals het is.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, note: { type: 'string' } }, required: ['id'] },
    async run(a) {
      const it = await (await api('GET', 'store/items/' + encodeURIComponent(a.id))).json();
      if (!it) throw new Error('Geen item met dit id.');
      if (a.title === undefined && a.note === undefined) throw new Error('Geef een titel of een notitie mee.');
      if (a.title !== undefined) it.title = String(a.title).slice(0, 200);
      if (a.note !== undefined) it.note = String(a.note).slice(0, 20000);
      await api('PUT', 'store/items/' + encodeURIComponent(it.id), it);
      return text('Bijgewerkt.');
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
/** Ordenen laten we alleen zien als de gebruiker het in de app heeft aangezet. De app zelf weigert het anders ook. */
const mayWrite = async () => { try { return !!(await (await api('GET', 'info')).json()).assistant.write; } catch { return false; } };

async function handle(msg) {
  const { id, method, params = {} } = msg;
  if (method === 'initialize') return { protocolVersion: params.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'collector', version: VERSION }, instructions: 'Collector is de lokale bibliotheek met ontwerpinspiratie van de gebruiker. Gebruik search_library om referenties te vinden en get_item of view_items om beelden te bekijken. Heeft de gebruiker ordenen aangezet, bekijk dan eerst wat er is (list_collections, search_library met unsorted), stel een indeling voor en voer die na akkoord uit met add_to_collection, add_tags en set_details. Weggooien kan niet.' };
  if (method === 'ping') return {};
  if (method === 'tools/list') { const w = await mayWrite(); return { tools: tools.filter(t => w || !t.write).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }; }
  if (method === 'tools/call') {
    const t = tools.find(x => x.name === params.name);
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

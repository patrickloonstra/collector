'use strict';
/** Test de MCP-server tegen een draaiende motor. Gebruik: node test/mcp.js */
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { start } = require('../server/server');
let failed = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) failed++; };

function client(env) {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'server.js')], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '', n = 0; const wait = new Map();
  p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); const w = wait.get(m.id); if (w) { wait.delete(m.id); w(m); } } });
  return { call: (method, params) => new Promise(res => { const id = ++n; wait.set(id, res); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }), notify: method => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'), close: () => p.kill() };
}
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-mcp-'));
  const srv = await start({ library: path.join(tmp, 'lib'), cache: path.join(tmp, 'cache') });
  const put = (store, v) => fetch(srv.url + 'api/store/' + store + '/' + v.id, { method: 'PUT', headers: { 'X-Collector': '1' }, body: JSON.stringify(v) });
  await put('libs', { id: 'lib1', name: 'Mijn bibliotheek' });
  await put('cols', { id: 'c1', lib: 'lib1', name: 'Landingspagina\'s' });
  await put('items', { id: 'a1', lib: 'lib1', type: 'image', title: 'Warme landingspagina', tags: ['warm'], auto: ['oranje'], cols: ['c1'], palette: [{ hex: '#ff7a3d', pct: 60 }], w: 1200, h: 800, created: Date.now() });
  await put('items', { id: 'a2', lib: 'lib1', type: 'image', title: 'Koel dashboard', tags: [], auto: ['blauw'], cols: [], palette: [], created: Date.now() });
  await put('items', { id: 'a3', lib: 'lib1', type: 'image', title: 'Weg', tags: ['warm'], auto: [], cols: [], palette: [], trashed: Date.now(), created: Date.now() });
  await fetch(srv.url + 'api/blob/fulls/a1', { method: 'PUT', headers: { 'X-Collector': '1', 'Content-Type': 'image/png', 'X-Name': 'warm.png' }, body: Buffer.from('iVBORw0KGgo=', 'base64') });
  await fetch(srv.url + 'api/blob/thumbs/a1', { method: 'PUT', headers: { 'X-Collector': '1' }, body: Buffer.from('RIFF') });

  let c = client({ COLLECTOR_URL: srv.url });
  const init = await c.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  ok(init.result.serverInfo.name === 'collector' && init.result.protocolVersion === '2025-06-18', 'initialize');
  c.notify('notifications/initialized');
  const list = await c.call('tools/list', {});
  ok(list.result.tools.map(t => t.name).join() === 'search_library,list_collections,get_item,view_items', 'standaard alleen leestools: ' + list.result.tools.map(t => t.name).join(', '));
  let r = JSON.parse((await c.call('tools/call', { name: 'search_library', arguments: { query: 'warm' } })).result.content[0].text);
  ok(r.total === 1 && r.items[0].title === 'Warme landingspagina' && r.items[0].file.endsWith(path.join('Beelden', 'warm.png')), 'zoeken op "warm": 1 treffer met bestandspad, prullenbak telt niet mee');
  r = JSON.parse((await c.call('tools/call', { name: 'search_library', arguments: { collection: "landingspagina's" } })).result.content[0].text);
  ok(r.total === 1, 'zoeken binnen een collectie');
  r = JSON.parse((await c.call('tools/call', { name: 'list_collections', arguments: {} })).result.content[0].text);
  ok(r.items === 2 && r.collections[0].items === 1 && r.tags.some(t => t.name === 'oranje'), 'collecties en tags opvragen');
  r = (await c.call('tools/call', { name: 'get_item', arguments: { id: 'a1' } })).result;
  ok(r.content.length === 2 && r.content[1].type === 'image', 'get_item geeft gegevens en een miniatuur');
  r = (await c.call('tools/call', { name: 'add_tags', arguments: { id: 'a1', tags: ['x'] } }));
  ok(r.error && r.error.code === -32602, 'schrijven is standaard niet beschikbaar');
  ok((await c.call('nope', {})).error.code === -32601, 'onbekende methode geeft een nette fout');
  c.close();

  c = client({ COLLECTOR_URL: srv.url, COLLECTOR_MCP_WRITE: '1' });
  await c.call('initialize', {});
  const rev0 = (await (await fetch(srv.url + 'api/info')).json()).rev;
  r = (await c.call('tools/call', { name: 'add_tags', arguments: { id: 'a2', tags: ['Dashboard'] } })).result;
  r = (await c.call('tools/call', { name: 'add_link', arguments: { url: 'https://example.com/inspiratie', title: 'Voorbeeld', collection: "Landingspagina's" } })).result;
  r = (await c.call('tools/call', { name: 'add_note', arguments: { text: 'Minder maar beter' } })).result;
  const items = await (await fetch(srv.url + 'api/store/items')).json();
  ok(items.find(i => i.id === 'a2').tags.includes('dashboard') && items.some(i => i.type === 'link' && i.cols[0] === 'c1') && items.some(i => i.type === 'note'), 'met schrijfrecht: tag, link in collectie en notitie bewaard');
  ok((await (await fetch(srv.url + 'api/info')).json()).rev === rev0 + 3, 'de app merkt wijzigingen van de agent op (herlaadsignaal)');
  const rev1 = (await (await fetch(srv.url + 'api/info')).json()).rev;
  r = (await c.call('tools/call', { name: 'view_items', arguments: { ids: ['a1', 'a2', 'bestaat-niet'] } })).result;
  ok(r.content.filter(x => x.type === 'image').length === 1 && r.content.length === 4, 'view_items laat meer items tegelijk zien, met miniatuur waar die er is');
  r = JSON.parse((await c.call('tools/call', { name: 'search_library', arguments: { unsorted: true, type: 'beeld' } })).result.content[0].text);
  ok(r.total === 1 && r.items[0].id === 'a2', 'zoeken naar wat nog in geen collectie zit');
  r = (await c.call('tools/call', { name: 'add_to_collection', arguments: { collection: 'Dashboards', ids: ['a2', 'a2', 'weg'] } })).result;
  ok(/gemaakt/.test(r.content[0].text) && /1 item toegevoegd/.test(r.content[0].text) && /Niet gevonden: weg/.test(r.content[0].text), 'add_to_collection maakt de collectie en meldt wat niet bestaat: ' + r.content[0].text);
  r = (await c.call('tools/call', { name: 'add_to_collection', arguments: { collection: 'Bestaat niet', ids: ['a2'], create: false } })).result;
  ok(r.isError, 'zonder create wordt een onbekende collectie geweigerd');
  await c.call('tools/call', { name: 'set_details', arguments: { id: 'a2', title: 'Dashboard in blauw' } });
  await c.call('tools/call', { name: 'remove_tags', arguments: { id: 'a2', tags: ['Blauw'] } });
  let all = await (await fetch(srv.url + 'api/store/items')).json(), cols = await (await fetch(srv.url + 'api/store/cols')).json();
  const dash = cols.find(x => x.name === 'Dashboards'), a2 = all.find(i => i.id === 'a2');
  ok(dash && dash.lib === 'lib1' && a2.cols.includes(dash.id) && a2.title === 'Dashboard in blauw' && !a2.auto.includes('blauw') && a2.tags.includes('dashboard'), 'ordenen: collectie, titel en tags staan goed');
  await c.call('tools/call', { name: 'remove_from_collection', arguments: { collection: 'dashboards', ids: ['a2'] } });
  all = await (await fetch(srv.url + 'api/store/items')).json();
  ok(!all.find(i => i.id === 'a2').cols.includes(dash.id) && all.length === 5, 'uit een collectie halen laat het item zelf staan');
  ok(!(await c.call('tools/list', {})).result.tools.some(t => /delete|trash|weggooi/i.test(t.name)), 'weggooien kan een agent niet');
  r = (await c.call('tools/call', { name: 'add_link', arguments: { url: 'javascript:alert(1)' } })).result;
  ok(r.isError, 'ongeldige link wordt geweigerd');
  c.close(); await srv.close();

  c = client({ COLLECTOR_URL: 'http://127.0.0.1:9/' });
  await c.call('initialize', {});
  r = (await c.call('tools/call', { name: 'list_collections', arguments: {} })).result;
  ok(r.isError && /draait niet/.test(r.content[0].text), 'app niet open: duidelijke melding');
  c.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? failed + ' mislukt' : 'Alles geslaagd'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

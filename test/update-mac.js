'use strict';
/**
 * Test het bijwerken op een echte Mac: een "geïnstalleerde" app werkt zichzelf bij naar een nieuwere versie.
 * Gebruik: node test/update-mac.js dist/mac-arm64/Collector.app
 */
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
let failed = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) failed++; };
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (process.platform !== 'darwin') { console.log('Overgeslagen: deze test draait alleen op macOS.'); return; }
  const built = path.resolve(process.argv[2]);
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'collector-upd-')));
  const installed = path.join(tmp, 'Programmas', 'Collector.app');
  fs.mkdirSync(path.dirname(installed)); sh('/bin/cp', ['-R', built, installed]);

  // De "nieuwe versie": dezelfde app met versie 9.9.9 en een herkenbaar bestand, opnieuw ondertekend en ingepakt.
  const stage = path.join(tmp, 'nieuw'); fs.mkdirSync(stage);
  const fresh = path.join(stage, 'Collector.app'); sh('/bin/cp', ['-R', built, fresh]);
  fs.writeFileSync(path.join(fresh, 'Contents', 'Resources', 'nieuw.txt'), 'dit is de nieuwe versie');
  sh('/usr/bin/plutil', ['-replace', 'CFBundleShortVersionString', '-string', '9.9.9', path.join(fresh, 'Contents', 'Info.plist')]);
  sh('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', fresh]);
  const zip = path.join(tmp, 'Collector-9.9.9.zip'); sh('/usr/bin/ditto', ['-c', '-k', '--keepParent', fresh, zip]);
  const sum = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');

  let digest = 'sha256:' + sum;
  const srv = http.createServer((q, r) => {
    const origin = 'http://127.0.0.1:' + srv.address().port;
    if (q.url.startsWith('/releases')) { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify([
      { tag_name: 'v0.0.1', draft: false, prerelease: false, assets: [] },
      { tag_name: 'v9.9.9-build3', draft: false, prerelease: true, assets: [] },
      { tag_name: 'v9.9.9', draft: false, prerelease: false, body: 'Testversie', assets: [{ name: 'Collector-9.9.9.zip', browser_download_url: origin + '/Collector-9.9.9.zip', size: fs.statSync(zip).size, digest }] }])); }
    if (q.url === '/Collector-9.9.9.zip') { r.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': fs.statSync(zip).size }); return fs.createReadStream(zip).pipe(r); }
    r.writeHead(404); r.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const marker = path.join(installed, 'Contents', 'Resources', 'nieuw.txt');
  const runApp = extra => spawnSync(path.join(installed, 'Contents', 'MacOS', 'Collector'), [], { encoding: 'utf8', timeout: 120000,
    env: { ...process.env, COLLECTOR_UPDATE_TEST: '1', COLLECTOR_UPDATE_FEED: 'http://127.0.0.1:' + srv.address().port + '/releases', COLLECTOR_LIBRARY: path.join(tmp, 'lib'), COLLECTOR_USERDATA: path.join(tmp, 'ud'), ...extra } });

  // 1. Een download die niet klopt met de controlesom wordt geweigerd; de app blijft zoals hij was.
  digest = 'sha256:' + '0'.repeat(64);
  let r = runApp();
  ok(r.status === 1 && /controlesom/.test(r.stdout + r.stderr), 'download met verkeerde controlesom wordt geweigerd');
  await sleep(1500);
  ok(!fs.existsSync(marker), 'de geïnstalleerde app is dan niet aangeraakt');

  // 2. De echte update: zoeken, downloaden, controleren, en na afsluiten de app vervangen.
  digest = 'sha256:' + sum;
  r = runApp();
  console.log((r.stdout + r.stderr).split('\n').filter(l => /UPDATE TEST|Update/.test(l)).join('\n'));
  ok(r.status === 0 && /status: ready 9\.9\.9/.test(r.stdout), 'app vindt versie 9.9.9, downloadt en zet hem klaar');
  for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await sleep(300);
  ok(fs.existsSync(marker), 'na afsluiten is de app-map vervangen door de nieuwe versie');
  ok(sh('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(installed, 'Contents', 'Info.plist')]) === '9.9.9', 'de geïnstalleerde app is nu versie 9.9.9');
  ok(!fs.existsSync(installed + '.vorige'), 'de oude versie is opgeruimd');
  let signed = true; try { sh('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed]); } catch { signed = false; }
  ok(signed, 'de vervangen app is geldig ondertekend');

  // 3. De vervangen app start en werkt, en de bibliotheek van vóór de update staat er nog.
  fs.mkdirSync(path.join(tmp, 'lib', 'Beelden'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'lib', 'Beelden', 'van-voor-de-update.txt'), 'x');
  r = spawnSync(path.join(installed, 'Contents', 'MacOS', 'Collector'), [], { encoding: 'utf8', timeout: 120000, env: { ...process.env, COLLECTOR_SMOKE: '1', COLLECTOR_LIBRARY: path.join(tmp, 'lib'), COLLECTOR_USERDATA: path.join(tmp, 'ud') } });
  ok(r.status === 0 && /SMOKE OK/.test(r.stdout), 'de bijgewerkte app start en bewaart een beeld');
  ok(fs.existsSync(path.join(tmp, 'lib', 'Beelden', 'van-voor-de-update.txt')), 'de bibliotheekmap is door de update niet aangeraakt');

  // 4. Is de app al de nieuwste, dan gebeurt er niets.
  r = runApp({ COLLECTOR_FAKE_VERSION: '9.9.9' });
  ok(/status: none/.test(r.stdout), 'nieuwste versie: geen update');
  srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? failed + ' mislukt' : 'Alles geslaagd'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

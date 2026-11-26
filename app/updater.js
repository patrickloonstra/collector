'use strict';
/**
 * Eigen updater voor macOS. De standaardmanier (Squirrel) eist een door Apple ondertekende app; die hebben we niet.
 *
 * Stappen: kijken of er een nieuwere release is -> zip downloaden -> controleren -> uitpakken ->
 * na afsluiten de app-map vervangen (met een klein script, want een draaiende app kan zichzelf niet vervangen).
 * De bibliotheekmap van de gebruiker wordt nooit aangeraakt.
 */
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const TEST_FEED = process.env.COLLECTOR_UPDATE_FEED || '';
const FEED = TEST_FEED || 'https://api.github.com/repos/patrickloonstra/collector/releases?per_page=15';
const BUNDLE_ID = 'nl.patrickloonstra.collector';
const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { maxBuffer: 4e6 }, (e, out, err) => e ? rej(new Error((err || e.message).trim().split('\n').pop())) : res(String(out).trim())));
const parse = v => { const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim()); return m ? m.slice(1).map(Number) : null; };
const newer = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };

class Updater {
  constructor({ log, currentVersion }) {
    this.log = log;
    this.current = currentVersion;
    this.state = { status: 'idle', version: null, notes: '', progress: 0, message: '' };
    this.listeners = new Set();
    this.found = null; this.newApp = null; this.busy = null;
  }
  set(patch) { this.state = { ...this.state, ...patch }; for (const l of this.listeners) { try { l(this.state); } catch { /* venster weg */ } } }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** De map van de draaiende app, of de reden waarom bijwerken hier niet kan. */
  target() {
    if (process.platform !== 'darwin') return { error: 'Automatisch bijwerken werkt alleen op de Mac.' };
    const bundle = path.resolve(process.execPath, '..', '..', '..');
    if (!bundle.endsWith('.app')) return { error: 'Automatisch bijwerken werkt alleen in de geïnstalleerde app.' };
    if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) return { error: 'Sleep Collector eerst naar de map Programma\'s en start hem daar. Dan kan hij zichzelf bijwerken.' };
    try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); fs.accessSync(bundle, fs.constants.W_OK); }
    catch { return { error: 'Collector mag de map waarin hij staat niet wijzigen. Zet hem in Programma\'s.' }; }
    return { bundle };
  }

  async check() {
    if (this.busy) return this.busy;
    if (['downloading', 'ready'].includes(this.state.status)) return this.state;
    this.set({ status: 'checking', message: '' });
    try {
      const r = await fetch(FEED, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Collector-app' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 404) throw new Error('De downloadplek is niet openbaar bereikbaar. Zolang de repo privé is, kan Collector niet zelf naar updates kijken.');
      if (!r.ok) throw new Error('De downloadplek gaf een fout (' + r.status + ').');
      const cur = parse(this.current); let best = null;
      for (const rel of await r.json()) {
        const v = parse(rel.tag_name);
        if (!v || rel.draft || rel.prerelease || !newer(v, cur)) continue;
        const name = 'Collector-' + v.join('.') + '.zip';
        const asset = (rel.assets || []).find(a => a.name === name);
        if (asset && (!best || newer(v, best.v))) best = { v, version: v.join('.'), url: asset.browser_download_url, size: asset.size, digest: asset.digest || '', notes: String(rel.body || '').slice(0, 4000) };
      }
      if (!best) { this.found = null; this.set({ status: 'none', version: null, notes: '' }); return this.state; }
      const ok = TEST_FEED ? new URL(best.url).origin === new URL(TEST_FEED).origin : /^https:\/\/github\.com\/patrickloonstra\/collector\/releases\/download\//.test(best.url);
      if (!ok) throw new Error('De update komt van een onverwacht adres en is geweigerd.');
      this.found = best;
      this.set({ status: 'available', version: best.version, notes: best.notes });
      this.log('Update gevonden: ' + best.version);
    } catch (e) {
      const msg = e.name === 'TimeoutError' ? 'De downloadplek reageert niet. Controleer je internetverbinding.' : /fetch failed/i.test(e.message) ? 'Geen verbinding met de downloadplek. Controleer je internetverbinding.' : e.message;
      this.log('Zoeken naar updates mislukt: ' + msg); this.set({ status: 'error', message: msg });
    }
    return this.state;
  }

  /** Downloadt en controleert de update en zet hem klaar. Daarna is de status 'ready'. */
  download() {
    if (this.busy) return this.busy;
    if (this.state.status === 'ready' || !this.found) return Promise.resolve(this.state);
    this.busy = this._download().finally(() => { this.busy = null; });
    return this.busy;
  }
  async _download() {
    const f = this.found, t = this.target();
    try {
      if (t.error) throw new Error(t.error);
      const dir = path.join(app.getPath('temp'), 'collector-update');
      await fsp.rm(dir, { recursive: true, force: true }); await fsp.mkdir(dir, { recursive: true });
      const zip = path.join(dir, 'update.zip');
      this.set({ status: 'downloading', progress: 0 });
      const r = await fetch(f.url, { headers: { 'User-Agent': 'Collector-app' } });
      if (!r.ok || !r.body) throw new Error('Downloaden mislukt (' + r.status + ').');
      const hash = crypto.createHash('sha256'), out = fs.createWriteStream(zip);
      let got = 0, last = 0;
      for await (const chunk of r.body) {
        hash.update(chunk); got += chunk.length;
        if (!out.write(chunk)) await new Promise(res => out.once('drain', res));
        const pct = f.size ? Math.round(got / f.size * 100) : 0;
        if (pct !== last) { last = pct; this.set({ progress: pct }); }
      }
      await new Promise((res, rej) => out.end(e => e ? rej(e) : res()));
      if (f.size && got !== f.size) throw new Error('De download is onvolledig.');
      const sum = hash.digest('hex');
      if (f.digest && f.digest.toLowerCase() !== 'sha256:' + sum) throw new Error('De download komt niet overeen met de controlesom.');
      // Uitpakken en controleren dat dit echt een geldige Collector van de verwachte versie is.
      const stage = path.join(dir, 'nieuw'); await fsp.mkdir(stage);
      await run('/usr/bin/ditto', ['-x', '-k', zip, stage]);
      const fresh = path.join(stage, 'Collector.app'), plist = path.join(fresh, 'Contents', 'Info.plist');
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', fresh]);
      if (await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', plist]) !== BUNDLE_ID) throw new Error('Dit is geen Collector.');
      if (await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist]) !== f.version) throw new Error('De versie in de download klopt niet.');
      await fsp.rm(zip, { force: true });
      this.newApp = fresh;
      this.set({ status: 'ready', progress: 100 });
      this.log('Update ' + f.version + ' staat klaar.');
    } catch (e) { this.newApp = null; this.log('Update klaarzetten mislukt: ' + e.message); this.set({ status: 'error', message: e.message }); }
    return this.state;
  }

  /**
   * Vervangt de app zodra dit proces gestopt is. Roep daarna zelf app.quit() aan.
   * Mislukt het vervangen, dan zet het script de oude app terug.
   */
  installOnQuit(relaunch) {
    const t = this.target();
    if (this.state.status !== 'ready' || !this.newApp || t.error) return false;
    const script = path.join(path.dirname(path.dirname(this.newApp)), 'vervang.sh');
    fs.writeFileSync(script, `#!/bin/sh
PID="$1"; APP="$2"; NEW="$3"; RELAUNCH="$4"; OLD="$APP.vorige"
i=0; while kill -0 "$PID" 2>/dev/null && [ $i -lt 150 ]; do sleep 0.2; i=$((i+1)); done
rm -rf "$OLD"
mv "$APP" "$OLD" || exit 1
if mv "$NEW" "$APP"; then rm -rf "$OLD"; else mv "$OLD" "$APP"; exit 1; fi
[ "$RELAUNCH" = "1" ] && /usr/bin/open "$APP"
exit 0
`, { mode: 0o755 });
    spawn('/bin/sh', [script, String(process.pid), t.bundle, this.newApp, relaunch ? '1' : '0'], { detached: true, stdio: 'ignore' }).unref();
    this.log('Update ' + this.state.version + ' wordt geïnstalleerd' + (relaunch ? ' en Collector start opnieuw.' : ' bij het afsluiten.'));
    this.newApp = null;
    return true;
  }
}

module.exports = { Updater, parse, newer };

'use strict';
/** De Mac-app: start de lokale motor en toont de interface in een venster. */
const { app, BrowserWindow, dialog, shell, ipcMain, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { start } = require('../server/server');
const { Updater } = require('./updater');

const SMOKE = process.env.COLLECTOR_SMOKE === '1';
const UPDATE_TEST = process.env.COLLECTOR_UPDATE_TEST === '1'; // alleen voor de automatische test van de updater
if (process.env.COLLECTOR_USERDATA) app.setPath('userData', process.env.COLLECTOR_USERDATA);
const configFile = () => path.join(app.getPath('userData'), 'config.json');
const readConfig = () => { try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; } };
const writeConfig = c => { fs.mkdirSync(path.dirname(configFile()), { recursive: true }); fs.writeFileSync(configFile(), JSON.stringify(c, null, 1)); };
const defaultLibrary = () => path.join(app.getPath('pictures'), 'Collector');

let server = null, win = null, updater = null;
const RELEASES = 'https://github.com/patrickloonstra/collector/releases';
const buildInfo = (() => { try { return require('./build.json'); } catch { return {}; } })();

// Logboek: fouten komen in een bestand dat de gebruiker kan openen (Help > Toon logboek).
const logFile = () => path.join(app.getPath('userData'), 'collector.log');
function log(text) {
  const line = new Date().toISOString() + '  ' + String(text).replace(/\s+$/, '') + '\n';
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    try { if (fs.statSync(logFile()).size > 1024 * 1024) fs.renameSync(logFile(), logFile() + '.oud'); } catch { /* nog geen logboek */ }
    fs.appendFileSync(logFile(), line);
  } catch { /* loggen mag nooit de app breken */ }
  if (SMOKE) console.error(line.trim());
}
process.on('uncaughtException', e => log('Onverwachte fout: ' + (e.stack || e)));
process.on('unhandledRejection', e => log('Onverwachte fout: ' + (e && e.stack || e)));
const info = () => ({ version: app.getVersion(), build: buildInfo.build || null, defaultLibrary: defaultLibrary(), firstRun: !readConfig().onboarded && !SMOKE && !UPDATE_TEST });
const showLog = () => { if (!fs.existsSync(logFile())) fs.writeFileSync(logFile(), ''); shell.showItemInFolder(logFile()); };
const openSettings = () => { if (!win) createWindow(); win.show(); win.webContents.send('open-settings'); };

async function pickFolder(title) {
  const r = await dialog.showOpenDialog(win || undefined, { title, buttonLabel: 'Kies deze map', properties: ['openDirectory', 'createDirectory'], defaultPath: app.getPath('pictures') });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
}

/** Start de motor. Is de map onbereikbaar (bijvoorbeeld een NAS die niet gekoppeld is), dan vragen we wat te doen. */
async function boot() {
  const cfg = readConfig();
  let library = process.env.COLLECTOR_LIBRARY || cfg.library || defaultLibrary();
  // Niet 'cache' noemen: op een Mac is dat dezelfde map als de 'Cache' van de browsermotor, en die wordt leeggemaakt.
  const cache = path.join(app.getPath('userData'), 'Collector-miniaturen');
  for (;;) {
    try {
      server = await start({ library, cache, port: SMOKE ? 0 : 4317, onInfo: info, onLog: log });
      break;
    } catch (e) {
      if (e.code === 'EADDRINUSE') { server = await start({ library, cache, port: 0, onInfo: info, onLog: log }); break; }
      log('Bibliotheekmap niet bereikbaar: ' + library + ': ' + (e.stack || e.message));
      if (SMOKE) throw e;
      const r = await dialog.showMessageBox({ type: 'warning', message: 'De bibliotheekmap is niet bereikbaar', detail: library + '\n\nStaat de map op een netwerkschijf, koppel die dan eerst in Finder.\n\n(' + e.message + ')', buttons: ['Opnieuw proberen', 'Andere map kiezen', 'Standaardmap gebruiken', 'Stoppen'], defaultId: 0, cancelId: 3 });
      if (r.response === 3) { app.quit(); return false; }
      if (r.response === 1) { const d = await pickFolder('Kies je bibliotheekmap'); if (d) library = d; }
      if (r.response === 2) library = defaultLibrary();
    }
  }
  if (!process.env.COLLECTOR_LIBRARY && cfg.library !== library) writeConfig({ ...cfg, library });
  log('Collector ' + app.getVersion() + (buildInfo.build ? ' build ' + buildInfo.build : '') + ' gestart (' + process.platform + ' ' + process.arch + '), bibliotheek: ' + server.state.library.dir);
  return true;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 720, minHeight: 480, title: 'Collector', backgroundColor: '#ffffff', ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } } : {}), show: !SMOKE && !UPDATE_TEST,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Links naar buiten openen in je gewone browser, nooit in het app-venster.
  const own = u => u.startsWith(server.url);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!own(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.loadURL(server.url);
  win.on('closed', () => { win = null; });
}

ipcMain.handle('show-library', () => shell.openPath(server.state.library.dir));
ipcMain.handle('show-log', () => showLog());
ipcMain.handle('set-onboarded', () => { writeConfig({ ...readConfig(), onboarded: true }); });
// ----- bijwerken -----
const autoUpdate = () => readConfig().autoUpdate !== false;
const updateInfo = () => ({ ...updater.state, auto: autoUpdate(), blocked: updater.target().error || '' });
/** Kijkt of er een nieuwere versie is en zet die, als automatisch bijwerken aan staat, meteen klaar. */
const CHECK_EVERY = 2 * 3600 * 1000;
let lastCheck = 0;
async function checkForUpdates(andDownload = autoUpdate()) {
  if (!updater) return null;
  lastCheck = Date.now();
  await updater.check();
  if (andDownload && updater.state.status === 'available' && !updater.target().error) await updater.download();
  return updateInfo();
}
ipcMain.handle('update-get', () => updateInfo());
ipcMain.handle('update-check', () => checkForUpdates());
ipcMain.handle('update-download', async () => { await updater.download(); return updateInfo(); });
ipcMain.handle('update-restart', () => { if (updater.installOnQuit(true)) { app.quit(); return true; } return false; });
ipcMain.handle('update-set-auto', (e, on) => { writeConfig({ ...readConfig(), autoUpdate: !!on }); return updateInfo(); });
// Nieuws en aanbiedingen voor de meldingskaartjes: een klein lijstje op de website.
const NEWS_URL = process.env.COLLECTOR_NEWS_URL || 'https://dev.patrickloonstra.nl/collector/nieuws.json';
async function fetchNews() {
  try {
    const r = await fetch(NEWS_URL, { headers: { 'User-Agent': 'Collector-app' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const list = JSON.parse(await r.text()), now = Date.now();
    if (!Array.isArray(list)) return [];
    const okLink = u => typeof u === 'string' && (/^https:\/\/(dev\.)?patrickloonstra\.nl\//.test(u) || (process.env.COLLECTOR_NEWS_URL && u.startsWith(new URL(NEWS_URL).origin + '/')));
    return list.filter(n => n && typeof n.id === 'string' && typeof n.title === 'string')
      .filter(n => (!n.from || Date.parse(n.from) <= now) && (!n.until || Date.parse(n.until) >= now)).slice(0, 10)
      .map(n => ({ id: n.id.slice(0, 40), kind: String(n.kind || 'Nieuws').slice(0, 20), title: n.title.slice(0, 80), text: String(n.text || '').slice(0, 300), link: okLink(n.link) ? n.link : '', label: String(n.label || '').slice(0, 30) }));
  } catch (e) { return []; } // geen verbinding of geen geldig lijstje: dan gewoon geen nieuws
}
ipcMain.handle('news-get', () => fetchNews());
ipcMain.handle('toggle-fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
ipcMain.handle('reset-library', async () => {
  try { await server.switchLibrary(defaultLibrary()); } catch (e) { dialog.showErrorBox('De standaardmap kan niet gebruikt worden', defaultLibrary() + '\n\n' + e.message); return false; }
  writeConfig({ ...readConfig(), library: server.state.library.dir });
  return true;
});

function buildMenu() {
  const mac = process.platform === 'darwin';
  const settings = { label: 'Instellingen…', accelerator: 'CmdOrCtrl+,', click: openSettings };
  const updates = { label: 'Zoek naar updates…', click: () => { openSettings(); checkForUpdates(); } };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, settings, updates, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }]
      : [{ label: 'Bestand', submenu: [settings, updates, { type: 'separator' }, { role: 'quit' }] }]),
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Toon bibliotheek in Finder', click: () => shell.openPath(server.state.library.dir) }, { label: 'Toon logboek', click: showLog }, { label: 'Downloads en versies', click: () => shell.openExternal(RELEASES) }] },
  ]));
}
ipcMain.handle('choose-library', async () => {
  const dir = await pickFolder('Kies een map voor je bibliotheek');
  if (!dir) return false;
  try { await server.switchLibrary(dir); }
  catch (e) { log('Map kiezen mislukt: ' + dir + ': ' + (e.stack || e.message)); dialog.showErrorBox('Deze map kan niet gebruikt worden', dir + '\n\n' + e.message); return false; }
  writeConfig({ ...readConfig(), library: server.state.library.dir });
  return true;
});

async function smoke() {
  // Zelftest voor de automatische build: voegt één beeld toe en kijkt of het als bestand in de map staat.
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';
  const done = await win.webContents.executeJavaScript(`new Promise((res, rej) => {
    const t0 = Date.now();
    (function wait() {
      if (document.documentElement.dataset.collectorReady === '1') {
        addEventListener('message', e => { if (e.data && e.data.type === 'collector-ext-done') res(e.data.ok); });
        postMessage({ type: 'collector-ext-add', id: 'smoke', dataUrl: ${JSON.stringify(png)}, page: 'https://example.com/', title: 'Zelftest' }, location.origin);
      } else if (Date.now() - t0 > 20000) rej(new Error('interface start niet')); else setTimeout(wait, 100);
    })();
  })`);
  await new Promise(r => setTimeout(r, 800));
  const dir = path.join(server.state.library.dir, 'Beelden');
  const files = fs.readdirSync(dir);
  const data = JSON.parse(fs.readFileSync(path.join(server.state.library.dir, 'collector.json'), 'utf8'));
  const item = Object.values(data.items)[0];
  if (!done || files.length !== 1 || !item || item.title !== 'Zelftest') throw new Error('zelftest mislukt: ' + JSON.stringify({ done, files, item: item && item.title }));
  console.log('SMOKE OK ' + files[0] + ' in ' + dir + ' (app ' + app.getVersion() + ', ' + process.arch + ')');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    if (!await boot()) return;
    updater = new Updater({ log, currentVersion: process.env.COLLECTOR_FAKE_VERSION || app.getVersion() });
    updater.onChange(() => { if (win && !win.isDestroyed()) win.webContents.send('update-state', updateInfo()); });
    buildMenu();
    createWindow();
    if (UPDATE_TEST) { // zelftest: zoek, download, zet klaar en vervang de app bij het afsluiten
      await checkForUpdates(true);
      console.log('UPDATE TEST status: ' + updater.state.status + ' ' + (updater.state.version || '') + ' ' + (updater.state.message || updater.target().error || ''));
      const done = updater.installOnQuit(false);
      await server.close(); app.exit(done ? 0 : 1);
      return;
    }
    if (SMOKE) {
      try { await smoke(); await server.close(); app.exit(0); }
      catch (e) { console.error('SMOKE FAIL ' + e.message); app.exit(1); }
      return;
    }
    app.on('activate', () => { if (!win) createWindow(); });
    // Bij elke start kijken of er een nieuwere versie is, en daarna elke zes uur.
    setTimeout(() => checkForUpdates().catch(() => {}), 4000);
    // Staat de app de hele dag open: elke twee uur opnieuw, en ook als je na lange tijd terugkomt.
    setInterval(() => checkForUpdates().catch(() => {}), CHECK_EVERY);
    app.on('browser-window-focus', () => { if (Date.now() - lastCheck > CHECK_EVERY) checkForUpdates().catch(() => {}); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => {
    if (server) server.state.library.flush().catch(() => {});
    if (updater && updater.state.status === 'ready') updater.installOnQuit(false); // staat er een update klaar, dan installeren we die bij het afsluiten
  });
}

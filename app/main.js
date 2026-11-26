'use strict';
/** De Mac-app: start de lokale motor en toont de interface in een venster. */
const { app, BrowserWindow, dialog, shell, ipcMain, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { start } = require('../server/server');

const SMOKE = process.env.COLLECTOR_SMOKE === '1';
if (process.env.COLLECTOR_USERDATA) app.setPath('userData', process.env.COLLECTOR_USERDATA);
const configFile = () => path.join(app.getPath('userData'), 'config.json');
const readConfig = () => { try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; } };
const writeConfig = c => { fs.mkdirSync(path.dirname(configFile()), { recursive: true }); fs.writeFileSync(configFile(), JSON.stringify(c, null, 1)); };
const defaultLibrary = () => path.join(app.getPath('pictures'), 'Collector');

let server = null, win = null;

async function pickFolder(title) {
  const r = await dialog.showOpenDialog(win || undefined, { title, buttonLabel: 'Kies deze map', properties: ['openDirectory', 'createDirectory'], defaultPath: app.getPath('pictures') });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
}

/** Start de motor. Is de map onbereikbaar (bijvoorbeeld een NAS die niet gekoppeld is), dan vragen we wat te doen. */
async function boot() {
  const cfg = readConfig();
  let library = process.env.COLLECTOR_LIBRARY || cfg.library || defaultLibrary();
  const cache = path.join(app.getPath('userData'), 'cache');
  for (;;) {
    try {
      server = await start({ library, cache, port: SMOKE ? 0 : 4317, onInfo: () => ({ version: app.getVersion() }) });
      break;
    } catch (e) {
      if (e.code === 'EADDRINUSE') { server = await start({ library, cache, port: 0, onInfo: () => ({ version: app.getVersion() }) }); break; }
      if (SMOKE) throw e;
      const r = await dialog.showMessageBox({ type: 'warning', message: 'De bibliotheekmap is niet bereikbaar', detail: library + '\n\nStaat de map op een netwerkschijf, koppel die dan eerst in Finder.\n\n(' + e.message + ')', buttons: ['Opnieuw proberen', 'Andere map kiezen', 'Standaardmap gebruiken', 'Stoppen'], defaultId: 0, cancelId: 3 });
      if (r.response === 3) { app.quit(); return false; }
      if (r.response === 1) { const d = await pickFolder('Kies je bibliotheekmap'); if (d) library = d; }
      if (r.response === 2) library = defaultLibrary();
    }
  }
  if (!process.env.COLLECTOR_LIBRARY && cfg.library !== library) writeConfig({ ...cfg, library });
  return true;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 720, minHeight: 480, title: 'Collector', backgroundColor: '#ffffff', show: !SMOKE,
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
ipcMain.handle('choose-library', async () => {
  const dir = await pickFolder('Kies een map voor je bibliotheek');
  if (!dir) return false;
  try { await server.switchLibrary(dir); }
  catch (e) { dialog.showErrorBox('Deze map kan niet gebruikt worden', dir + '\n\n' + e.message); return false; }
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
    createWindow();
    if (SMOKE) {
      try { await smoke(); await server.close(); app.exit(0); }
      catch (e) { console.error('SMOKE FAIL ' + e.message); app.exit(1); }
      return;
    }
    app.on('activate', () => { if (!win) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { if (server) server.state.library.flush().catch(() => {}); });
}

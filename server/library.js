'use strict';
/**
 * Een Collector-bibliotheek is een gewone map:
 *
 *   <map>/Beelden/        de originele bestanden, met hun eigen naam
 *   <map>/Prullenbak/     wat je verwijdert (nooit meteen weg)
 *   <map>/collector.json  titels, tags, collecties, notities en links
 *
 * Miniaturen en de zoekindex zijn afgeleid en staan in een cachemap op de
 * computer zelf, zodat een netwerkschijf traag of even weg mag zijn.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const STORES = ['libs', 'items', 'cols', 'spaces'];
const BLOBS = ['thumbs', 'fulls', 'embs'];
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/heic': 'heic', 'image/tiff': 'tif', 'image/bmp': 'bmp' };
const EXT_MIME = Object.fromEntries(Object.entries(IMAGE_EXT).map(([m, e]) => [e, m]));
EXT_MIME.jpeg = 'image/jpeg'; EXT_MIME.tiff = 'image/tiff';

const safeId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
function safeName(name) {
  const base = path.basename(String(name || '')).normalize('NFC').replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return base.slice(0, 120);
}

class Library {
  constructor(dir, cacheRoot) {
    this.dir = path.resolve(dir);
    this.images = path.join(this.dir, 'Beelden');
    this.trash = path.join(this.dir, 'Prullenbak');
    this.file = path.join(this.dir, 'collector.json');
    this.cacheRoot = cacheRoot;
    this.data = null;
    this.timer = null;
    this.writing = Promise.resolve();
  }

  async open() {
    await fsp.mkdir(this.images, { recursive: true });
    await fsp.mkdir(this.trash, { recursive: true });
    let raw = null;
    try { raw = await fsp.readFile(this.file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (raw) {
      try { this.data = JSON.parse(raw); }
      catch (e) { // nooit een kapot bestand overschrijven: bewaar het en begin opnieuw
        await fsp.copyFile(this.file, this.file + '.kapot-' + Date.now());
        this.data = null;
      }
    }
    if (!this.data || typeof this.data !== 'object') this.data = {};
    const d = this.data;
    d.app = 'collector'; d.version = 1;
    d.id = d.id || crypto.randomBytes(8).toString('hex');
    for (const s of STORES) if (!d[s] || typeof d[s] !== 'object' || Array.isArray(d[s])) d[s] = {};
    if (!d.meta || typeof d.meta !== 'object') d.meta = {};
    if (!d.files || typeof d.files !== 'object') d.files = {}; // item-id -> bestandsnaam in Beelden/
    this.cache = path.join(this.cacheRoot, d.id);
    await fsp.mkdir(path.join(this.cache, 'thumbs'), { recursive: true });
    await fsp.mkdir(path.join(this.cache, 'embs'), { recursive: true });
    if (!raw) await this.flush();
    return this;
  }

  // ----- opslaan: uitgesteld en atomair (eerst tijdelijk bestand, dan hernoemen) -----
  save() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush().catch(e => console.error('Opslaan mislukt:', e.message)), 150); }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    const json = JSON.stringify(this.data, null, 1);
    this.writing = this.writing.catch(() => {}).then(async () => {
      const tmp = this.file + '.tmp';
      await fsp.writeFile(tmp, json);
      await fsp.rename(tmp, this.file);
    });
    return this.writing;
  }

  // ----- gegevens -----
  all(store) { this.check(store); return Object.values(this.data[store]); }
  get(store, id) { this.check(store); return this.data[store][id] || null; }
  put(store, value) {
    this.check(store);
    if (!value || !safeId(value.id)) throw new Error('ongeldig id');
    this.data[store][value.id] = value; this.save();
  }
  del(store, id) { this.check(store); delete this.data[store][id]; this.save(); }
  check(store) { if (!STORES.includes(store)) throw new Error('onbekende opslag'); }
  getMeta(key) { return this.data.meta[key] ?? null; }
  putMeta(key, value) { this.data.meta[String(key).slice(0, 64)] = value; this.save(); }

  // ----- bestanden -----
  pathOf(id) {
    const name = this.data.files[id];
    return name ? path.join(this.images, name) : null;
  }
  async uniqueName(wanted) {
    const ext = path.extname(wanted), stem = wanted.slice(0, wanted.length - ext.length) || 'beeld';
    const taken = new Set(Object.values(this.data.files).map(n => n.toLowerCase()));
    for (let i = 0; i < 10000; i++) {
      const name = i ? `${stem} ${i + 1}${ext}` : stem + ext;
      if (taken.has(name.toLowerCase())) continue;
      try { await fsp.access(path.join(this.images, name)); } catch { return name; }
    }
    throw new Error('geen vrije bestandsnaam');
  }
  async putFull(id, buf, type, name) {
    if (!safeId(id)) throw new Error('ongeldig id');
    const ext = IMAGE_EXT[type] || (path.extname(safeName(name)).slice(1).toLowerCase() || 'bin');
    let wanted = safeName(name);
    if (!wanted) wanted = id + '.' + ext;
    else if (!path.extname(wanted)) wanted += '.' + ext;
    const old = this.pathOf(id);
    const file = old ? path.basename(old) : await this.uniqueName(wanted);
    await fsp.writeFile(path.join(this.images, file), buf);
    this.data.files[id] = file; this.save();
    return file;
  }
  async blobPath(kind, id) {
    if (!BLOBS.includes(kind) || !safeId(id)) return null;
    if (kind === 'fulls') return this.pathOf(id);
    return path.join(this.cache, kind, id + (kind === 'thumbs' ? '.webp' : '.f32'));
  }
  async putBlob(kind, id, buf, type, name) {
    if (kind === 'fulls') return this.putFull(id, buf, type, name);
    const p = await this.blobPath(kind, id); if (!p) throw new Error('ongeldig');
    await fsp.writeFile(p, buf);
  }
  /** Verwijderen = naar de map Prullenbak. Er wordt nooit iets definitief gewist. */
  async delBlob(kind, id) {
    const p = await this.blobPath(kind, id); if (!p) return;
    if (kind !== 'fulls') { await fsp.rm(p, { force: true }); return; }
    const name = path.basename(p);
    let dest = path.join(this.trash, name);
    try { await fsp.access(dest); dest = path.join(this.trash, Date.now() + ' ' + name); } catch { /* vrij */ }
    try { await fsp.rename(p, dest); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    delete this.data.files[id]; this.save();
  }
  async embeddings() {
    const dir = path.join(this.cache, 'embs'), out = {};
    for (const f of await fsp.readdir(dir)) if (f.endsWith('.f32')) out[f.slice(0, -4)] = (await fsp.readFile(path.join(dir, f))).toString('base64');
    return out;
  }
  /** Bestanden die je zelf in Beelden/ hebt gezet (via Finder) en die Collector nog niet kent. */
  async unindexed() {
    const known = new Set(Object.values(this.data.files));
    const out = [];
    for (const e of await fsp.readdir(this.images, { withFileTypes: true })) {
      if (!e.isFile() || e.name.startsWith('.') || known.has(e.name)) continue;
      const ext = path.extname(e.name).slice(1).toLowerCase();
      if (EXT_MIME[ext]) out.push({ name: e.name, type: EXT_MIME[ext] });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Koppelt een bestaand bestand in Beelden/ aan een item, zonder het te kopiëren. */
  async adopt(id, name) {
    if (!safeId(id)) throw new Error('ongeldig id');
    const clean = path.basename(String(name));
    if (clean !== name || Object.values(this.data.files).includes(clean)) throw new Error('ongeldig bestand');
    await fsp.access(path.join(this.images, clean));
    this.data.files[id] = clean; this.save();
  }
  rawPath(name) { // alleen bestanden direct in Beelden/
    const clean = path.basename(String(name));
    return clean === name && !clean.startsWith('.') ? path.join(this.images, clean) : null;
  }
  static mime(file) { return EXT_MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream'; }
}

module.exports = { Library, STORES, BLOBS, safeId };

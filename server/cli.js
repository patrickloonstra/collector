#!/usr/bin/env node
'use strict';
/** Start Collector zonder app-venster: `node server/cli.js [bibliotheekmap]`, daarna open je het adres in je browser. */
const os = require('os');
const path = require('path');
const { start } = require('./server');

const library = process.argv[2] || process.env.COLLECTOR_LIBRARY || path.join(os.homedir(), 'Pictures', 'Collector');
const cache = process.env.COLLECTOR_CACHE || path.join(os.homedir(), '.collector-cache');
const port = Number(process.env.COLLECTOR_PORT) || 4317;

start({ library, cache, port }).then(s => {
  console.log('Collector draait op ' + s.url);
  console.log('Bibliotheek: ' + s.state.library.dir);
  const stop = () => s.close().then(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}).catch(e => { console.error('Starten mislukt: ' + e.message); process.exit(1); });

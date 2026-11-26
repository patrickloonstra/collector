'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('collectorApp', {
  platform: process.platform,
  showLibrary: () => ipcRenderer.invoke('show-library'),
  chooseLibrary: () => ipcRenderer.invoke('choose-library'),
  resetLibrary: () => ipcRenderer.invoke('reset-library'),
  showLog: () => ipcRenderer.invoke('show-log'),
  setOnboarded: () => ipcRenderer.invoke('set-onboarded'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  update: {
    get: () => ipcRenderer.invoke('update-get'),
    check: () => ipcRenderer.invoke('update-check'),
    download: () => ipcRenderer.invoke('update-download'),
    restart: () => ipcRenderer.invoke('update-restart'),
    setAuto: on => ipcRenderer.invoke('update-set-auto', on),
    onState: cb => ipcRenderer.on('update-state', (e, s) => cb(s)),
  },
  onOpenSettings: cb => ipcRenderer.on('open-settings', () => cb()),
});

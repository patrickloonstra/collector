'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('collectorApp', {
  showLibrary: () => ipcRenderer.invoke('show-library'),
  chooseLibrary: () => ipcRenderer.invoke('choose-library'),
  resetLibrary: () => ipcRenderer.invoke('reset-library'),
  showLog: () => ipcRenderer.invoke('show-log'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  onOpenSettings: cb => ipcRenderer.on('open-settings', () => cb()),
});

'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('collectorApp', {
  showLibrary: () => ipcRenderer.invoke('show-library'),
  chooseLibrary: () => ipcRenderer.invoke('choose-library'),
});

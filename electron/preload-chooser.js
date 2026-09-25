// Bruecke fuer das Startfenster (Maschinen-/Einstellungsauswahl).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chooser', {
  list: function () { return ipcRenderer.invoke('chooser:list'); },
  browse: function () { return ipcRenderer.invoke('chooser:browse'); },
  accept: function (path) { ipcRenderer.send('chooser:accept', path); },
});

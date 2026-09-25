// Bruecke fuer die Auswahl des seriellen Anschlusses.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('serialPick', {
  list: function () { return ipcRenderer.invoke('serial:list'); },
  pick: function (portId) { ipcRenderer.send('serial:pick', portId); },
});

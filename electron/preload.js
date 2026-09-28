const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  saveFile: (name, bytes) => ipcRenderer.invoke('save-file', name, bytes),
  openInExcel: (name, bytes) => ipcRenderer.invoke('open-in-excel', name, bytes),
});

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jichoCentre', {
  getSnapshot: () => ipcRenderer.invoke('jicho:dashboard:get'),
  answer: (id, decision) => ipcRenderer.invoke('jicho:answer', id, decision),
  onSnapshot: (callback) => ipcRenderer.on('jicho:dashboard:update', (_event, snapshot) => callback(snapshot))
});

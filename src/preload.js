const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jicho', {
  answer: (id, decision) => ipcRenderer.invoke('jicho:answer', id, decision),
  togglePhone: (visible) => ipcRenderer.invoke('jicho:toggle-phone', visible),
  setPhoneEnabled: (enabled) => ipcRenderer.invoke('jicho:phone-enabled', enabled),
  setPhoneContentFree: (contentFree) => ipcRenderer.invoke('jicho:phone-content-free', contentFree),
  onState: (callback) => ipcRenderer.on('jicho:state', (_event, state) => callback(state)),
  onCursor: (callback) => ipcRenderer.on('jicho:cursor', (_event, point) => callback(point)),
  onError: (callback) => ipcRenderer.on('jicho:error', (_event, message) => callback(message))
});

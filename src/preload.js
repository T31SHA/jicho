const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jicho', {
  answer: (id, decision) => ipcRenderer.invoke('jicho:answer', id, decision),
  togglePhone: (visible) => ipcRenderer.invoke('jicho:toggle-phone', visible),
  setPhoneEnabled: (enabled) => ipcRenderer.invoke('jicho:phone-enabled', enabled),
  setAllowlistEnabled: (enabled) => ipcRenderer.invoke('jicho:allowlist-enabled', enabled),
  setAutostartEnabled: (enabled) => ipcRenderer.invoke('jicho:autostart-enabled', enabled),
  toggleExpanded: () => ipcRenderer.invoke('jicho:island:toggle-expanded'),
  selectSession: (agentId, sessionId) => ipcRenderer.invoke('jicho:island:select-session', agentId, sessionId),
  setDisplay: (displayId) => ipcRenderer.invoke('jicho:island:set-display', displayId),
  setOffset: (offset) => ipcRenderer.invoke('jicho:island:set-offset', offset),
  openCommandCentre: () => ipcRenderer.invoke('jicho:command-centre:open'),
  onState: (callback) => ipcRenderer.on('jicho:state', (_event, state) => callback(state)),
  onError: (callback) => ipcRenderer.on('jicho:error', (_event, message) => callback(message))
});

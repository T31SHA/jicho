const { app, BrowserWindow, ipcMain, screen, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const { Core } = require('./core');
const { createServer } = require('./server');
const { PhoneBridge } = require('./phone');

const PORT = Number(process.env.JICHO_PORT || 47821);
const WIDTH = 390;
const IDLE_HEIGHT = 76;
const CARD_HEIGHT = 330;
const PHONE_HEIGHT = 455;

let core;
let server;
let windowRef;
let sessions = [];
let pending = [];
let cursorTimer;
let phoneBridge;
let showPhone = false;
let preferences = { allowlistEnabled: false };
let preferencesFile;
const phoneNotifications = new Set();

function savePreferences() {
  if (!preferencesFile) return;
  try {
    fs.mkdirSync(path.dirname(preferencesFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(preferencesFile, JSON.stringify(preferences, null, 2) + '\n', { mode: 0o600 });
  } catch (error) { console.error('Could not save Jicho settings:', error.message); }
}

function loadPreferences(dataDirectory) {
  preferencesFile = path.join(dataDirectory, 'preferences.json');
  try {
    preferences = JSON.parse(fs.readFileSync(preferencesFile, 'utf8'));
    if (typeof preferences.allowlistEnabled !== 'boolean') preferences.allowlistEnabled = false;
  } catch (_) {
    preferences = { allowlistEnabled: false };
    savePreferences();
  }
}

function placeWindow(layout) {
  if (!windowRef || windowRef.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workArea;
  const height = layout === 'phone' ? PHONE_HEIGHT : layout === 'card' ? CARD_HEIGHT : IDLE_HEIGHT;
  const x = Math.round(area.x + (area.width - WIDTH) / 2);
  const y = area.y + area.height - height - 18;
  windowRef.setBounds({ x, y, width: WIDTH, height });
  windowRef.webContents.send('jicho:layout', { layout });
}

function publishState() {
  if (!windowRef || windowRef.isDestroyed()) return;
  const layout = pending.length ? 'card' : showPhone ? 'phone' : 'idle';
  placeWindow(layout);
  windowRef.webContents.send('jicho:state', {
    layout,
    pending,
    sessions,
    working: sessions.some((session) => session.state === 'working'),
    allowlistEnabled: Boolean(preferences.allowlistEnabled),
    phone: phoneBridge ? phoneBridge.viewState() : null
  });
}

function createWindow() {
  windowRef = new BrowserWindow({
    width: WIDTH,
    height: IDLE_HEIGHT,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#101820',
    title: 'Jicho',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  windowRef.setAlwaysOnTop(true, 'floating');
  windowRef.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  windowRef.loadFile(path.join(__dirname, 'ui', 'index.html'));
  windowRef.once('ready-to-show', () => {
    placeWindow('idle');
    windowRef.showInactive();
    publishState();
  });
  windowRef.on('closed', () => { windowRef = null; });
  windowRef.webContents.on('did-finish-load', () => {
    if (cursorTimer) clearInterval(cursorTimer);
    cursorTimer = setInterval(() => {
      if (!windowRef || windowRef.isDestroyed()) return;
      const point = screen.getCursorScreenPoint();
      if (!point || (point.x === 0 && point.y === 0)) return;
      const bounds = windowRef.getBounds();
      windowRef.webContents.send('jicho:cursor', {
        x: point.x - (bounds.x + bounds.width / 2),
        y: point.y - (bounds.y + 27)
      });
    }, 80);
    publishState();
  });
}

function startServer() {
  const dataDirectory = app.getPath('userData');
  loadPreferences(dataDirectory);
  core = new Core({
    policyEnabled: preferences.allowlistEnabled,
    auditFile: path.join(dataDirectory, 'audit.jsonl')
  });
  phoneBridge = new PhoneBridge(core, app.getPath('userData'));
  showPhone = phoneBridge.isFirstRun && !phoneBridge.config.pairingDismissed;
  phoneBridge.on('status', publishState);
  phoneBridge.qrPromise.then((uri) => { phoneBridge.qrDataUrl = uri; publishState(); }).catch(() => {
    phoneBridge.qrDataUrl = null;
    publishState();
  });
  core.on('pending', (items) => {
    pending = items;
    for (const item of items) {
      if (phoneNotifications.has(item.id)) continue;
      phoneNotifications.add(item.id);
      phoneBridge.publishRequest(item).catch(() => {});
    }
    publishState();
  });
  core.on('settled', ({ id }) => { phoneNotifications.delete(id); });
  core.on('sessions', (items) => { sessions = items; publishState(); });
  server = createServer(core);
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      if (windowRef && !windowRef.isDestroyed()) {
        windowRef.webContents.send('jicho:error', 'Port ' + PORT + ' is already in use.');
      }
    } else {
      console.error('Jicho server error:', error.message);
    }
  });
  server.listen(PORT, '127.0.0.1');
}

app.whenReady().then(() => {
  app.setAppUserModelId('org.jicho.desktop');
  nativeTheme.themeSource = 'dark';
  createWindow();
  startServer();
  app.on('activate', () => {
    if (!windowRef) createWindow();
  });
});

ipcMain.handle('jicho:answer', (_event, id, decision) => {
  if (!core) return false;
  if (decision === 'always') {
    const answered = core.allowAlways(id);
    if (answered) { preferences.allowlistEnabled = true; savePreferences(); publishState(); }
    return answered;
  }
  if (!['allow', 'deny'].includes(decision)) return false;
  return core.settle(id, decision, 'desktop');
});

ipcMain.handle('jicho:toggle-phone', (_event, visible) => {
  showPhone = Boolean(visible);
  if (!showPhone && phoneBridge) phoneBridge.dismissPairing();
  publishState();
  return true;
});

ipcMain.handle('jicho:phone-enabled', (_event, enabled) => {
  if (!phoneBridge) return false;
  phoneBridge.setEnabled(Boolean(enabled));
  publishState();
  return true;
});

ipcMain.handle('jicho:phone-content-free', (_event, contentFree) => {
  if (!phoneBridge) return false;
  phoneBridge.setContentFree(Boolean(contentFree));
  publishState();
  return true;
});

ipcMain.handle('jicho:allowlist-enabled', (_event, enabled) => {
  if (!core) return false;
  preferences.allowlistEnabled = Boolean(enabled);
  core.setPolicyEnabled(preferences.allowlistEnabled);
  savePreferences();
  publishState();
  return true;
});

app.on('before-quit', () => {
  if (cursorTimer) clearInterval(cursorTimer);
  if (phoneBridge) phoneBridge.close();
  if (server) server.close();
});

app.on('window-all-closed', (event) => { event.preventDefault(); });

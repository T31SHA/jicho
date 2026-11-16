const { app, BrowserWindow, ipcMain, screen, nativeTheme, Tray, Menu, nativeImage, globalShortcut } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { Core } = require('./core');
const { createServer } = require('./server');
const { PhoneBridge } = require('./phone');
const { createTrayIcon } = require('./tray-icon');
const { Store } = require('./store');
const { isTrustedMainFrame } = require('./ipc-security');

const PORT = Number(process.env.JICHO_PORT || 47821);
const WIDTH = 390;
const IDLE_HEIGHT = 76;
const CARD_HEIGHT = 330;
const PHONE_HEIGHT = 455;
const COMPANION_PAGE = path.join(__dirname, 'ui', 'index.html');
const COMMAND_CENTRE_PAGE = path.join(__dirname, 'command-centre.html');

let core;
let store;
let server;
let windowRef;
let commandCentreWindow;
let sessions = [];
let pending = [];
let cursorTimer;
let phoneBridge;
let showPhone = false;
let preferences = { allowlistEnabled: false, autostartEnabled: false };
let preferencesFile;
const phoneNotifications = new Set();
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let tray;
let serverError = '';
let autostartError = '';

if (!hasSingleInstanceLock) app.quit();
else app.on('second-instance', () => showCommandCentre());

function savePreferences() {
  if (!preferencesFile) return;
  try {
    fs.mkdirSync(path.dirname(preferencesFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(preferencesFile, JSON.stringify(preferences, null, 2) + '\n', { mode: 0o600 });
  } catch (error) { console.error('Could not save Jicho settings:', error.message); }
}

function desktopExecArg(value) {
  return '"' + String(value).replace(/%/g, '%%').replace(/([\\"])/g, '\\$1') + '"';
}

function linuxAutostartPath() {
  return path.join(os.homedir(), '.config', 'autostart', 'jicho.desktop');
}

function applyAutostart(enabled) {
  try {
    if (process.platform === 'linux') {
      const file = linuxAutostartPath();
      if (!enabled) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        return true;
      }
      const args = [process.env.APPIMAGE || process.execPath];
      if (!app.isPackaged && !process.env.APPIMAGE) args.push(app.getAppPath());
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const entry = [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Jicho',
        'Comment=Local coding-agent approval companion',
        'Exec=' + args.map(desktopExecArg).join(' '),
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        ''
      ].join('\n');
      fs.writeFileSync(file, entry, { mode: 0o644 });
      autostartError = '';
      return true;
    }
    if (process.platform === 'darwin' || process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
      autostartError = '';
      return true;
    }
    return false;
  } catch (error) {
    autostartError = 'Could not update start-at-login: ' + error.message;
    return false;
  }
}

function showSettings() {
  showPhone = true;
  if (!windowRef) createWindow();
  if (windowRef && !windowRef.isDestroyed()) {
    windowRef.showInactive();
    publishState();
  }
}

function showCommandCentre() {
  if (!commandCentreWindow || commandCentreWindow.isDestroyed()) createCommandCentre();
  if (commandCentreWindow && !commandCentreWindow.isDestroyed()) {
    if (commandCentreWindow.isMinimized()) commandCentreWindow.restore();
    commandCentreWindow.show();
    commandCentreWindow.focus();
    publishDashboard();
  }
}

function setAllowlistEnabled(enabled) {
  if (!core) return false;
  preferences.allowlistEnabled = Boolean(enabled);
  core.setPolicyEnabled(preferences.allowlistEnabled);
  savePreferences();
  refreshTray();
  publishState();
  return true;
}

function setAutostartEnabled(enabled) {
  const value = Boolean(enabled);
  if (!applyAutostart(value)) { publishState(); return false; }
  autostartError = '';
  preferences.autostartEnabled = value;
  savePreferences();
  refreshTray();
  publishState();
  return true;
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open command centre', accelerator: 'CommandOrControl+Shift+J', click: showCommandCentre },
    { type: 'separator' },
    { label: 'Phone and safety settings', click: showSettings },
    { type: 'separator' },
    { label: 'Auto-allow exact safe patterns', type: 'checkbox', checked: Boolean(preferences.allowlistEnabled), click: (item) => setAllowlistEnabled(item.checked) },
    { label: 'Start Jicho when I sign in', type: 'checkbox', checked: Boolean(preferences.autostartEnabled), click: (item) => setAutostartEnabled(item.checked) },
    { type: 'separator' },
    { label: 'Quit Jicho', click: () => app.quit() }
  ]));
}

function createTray() {
  tray = new Tray(createTrayIcon(nativeImage));
  tray.setToolTip('Jicho — local approval companion');
  refreshTray();
  tray.on('click', showSettings);
  tray.on('double-click', showSettings);
}

function loadPreferences(dataDirectory) {
  preferencesFile = path.join(dataDirectory, 'preferences.json');
  try {
    preferences = JSON.parse(fs.readFileSync(preferencesFile, 'utf8'));
    if (typeof preferences.allowlistEnabled !== 'boolean') preferences.allowlistEnabled = false;
    if (typeof preferences.autostartEnabled !== 'boolean') preferences.autostartEnabled = false;
  } catch (_) {
    preferences = { allowlistEnabled: false, autostartEnabled: false };
    savePreferences();
  }
  if (preferences.autostartEnabled) applyAutostart(true);
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
    autostartEnabled: Boolean(preferences.autostartEnabled),
    error: serverError || autostartError,
    phone: phoneBridge ? phoneBridge.viewState() : null
  });
}

function dashboardSnapshot() {
  const storeAvailable = Boolean(store);
  const serverListening = Boolean(server && server.listening);
  let sessions = [];
  let activity = [];
  let error = serverError || '';
  try {
    sessions = storeAvailable ? store.listSessions() : core ? [...core.sessions.values()] : [];
    activity = storeAvailable ? store.listRecentActivity(100) : [];
  } catch (failure) {
    error = 'Jicho could not read local history: ' + failure.message;
  }
  const message = !storeAvailable ? 'Local history unavailable' : serverListening ? 'Local hook server online' : 'Waiting for the local hook server';
  return {
    generatedAt: Date.now(), sessions, activity, pending: core ? core.list() : [],
    connection: { storeAvailable, serverListening, message, error }
  };
}

function publishDashboard() {
  if (!commandCentreWindow || commandCentreWindow.isDestroyed() || commandCentreWindow.webContents.isLoading()) return;
  commandCentreWindow.webContents.send('jicho:dashboard:update', dashboardSnapshot());
}

function guardLocalNavigation(win, expectedPage) {
  const expectedUrl = pathToFileURL(expectedPage).href;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== expectedUrl) event.preventDefault();
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
  guardLocalNavigation(windowRef, COMPANION_PAGE);
  windowRef.loadFile(COMPANION_PAGE);
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

function createCommandCentre() {
  commandCentreWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 850,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1116',
    title: 'JICHO Command Centre',
    webPreferences: {
      preload: path.join(__dirname, 'command-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false
    }
  });
  guardLocalNavigation(commandCentreWindow, COMMAND_CENTRE_PAGE);
  commandCentreWindow.loadFile(COMMAND_CENTRE_PAGE);
  commandCentreWindow.once('ready-to-show', () => {
    if (commandCentreWindow && !commandCentreWindow.isDestroyed()) commandCentreWindow.show();
    publishDashboard();
  });
  commandCentreWindow.on('closed', () => { commandCentreWindow = null; });
}

function startServer() {
  const dataDirectory = app.getPath('userData');
  loadPreferences(dataDirectory);
  try {
    store = new Store(path.join(dataDirectory, 'jicho.sqlite3'));
    core = new Core({
      policyEnabled: preferences.allowlistEnabled,
      auditFile: path.join(dataDirectory, 'audit.jsonl'),
      store
    });
  } catch (error) {
    serverError = 'Jicho could not open its local history database. Approval routing is disabled until this is fixed.';
    console.error('Jicho database startup failed:', error.message);
    if (store) {
      try { store.close(); }
      catch (closeError) { console.error('Jicho database cleanup failed:', closeError.message); }
      store = null;
    }
    core = new Core({ policyEnabled: preferences.allowlistEnabled });
    publishState();
    return;
  }
  sessions = [...core.sessions.values()];
  phoneBridge = new PhoneBridge(core, app.getPath('userData'));
  showPhone = (phoneBridge.isFirstRun && !phoneBridge.config.pairingDismissed) || phoneBridge.storageBlocked;
  phoneBridge.on('status', publishState);
  phoneBridge.qrPromise.then((uri) => { phoneBridge.qrDataUrl = uri; publishState(); }).catch((error) => {
    console.error('Could not generate phone pairing QR code:', error.message);
    phoneBridge.qrDataUrl = null;
    phoneBridge.setStatus(false, 'Could not generate the pairing QR code.');
    publishState();
  });
  core.on('pending', (items) => {
    pending = items;
    for (const item of items) {
      if (phoneNotifications.has(item.id)) continue;
      phoneNotifications.add(item.id);
      phoneBridge.publishRequest(item).catch((error) => console.error('Could not publish approval notification:', error.message));
    }
    publishState();
    publishDashboard();
  });
  core.on('audit-error', (error) => console.error('Jicho could not write its audit record:', error.message));
  core.on('store-error', (error) => console.error('Jicho could not persist local state:', error.message));
  core.on('ingress-error', ({ kind, message }) => console.warn('Jicho hook ingress:', kind, message));
  core.on('request-rejected', ({ reason, event }) => console.warn('Jicho rejected request:', event, reason));
  core.on('settled', ({ id }) => { phoneNotifications.delete(id); publishDashboard(); });
  core.on('sessions', (items) => { sessions = items; publishState(); publishDashboard(); });
  core.on('activity', publishDashboard);
  server = createServer(core);
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      serverError = 'Port ' + PORT + ' is already in use. Close the other app using it, then restart Jicho.';
    } else {
      serverError = 'The local hook server failed (' + (error.code || 'error') + ').';
      console.error('Jicho server error:', error.message);
    }
    publishState();
    publishDashboard();
  });
  server.on('listening', () => { serverError = ''; publishState(); publishDashboard(); });
  server.listen(PORT, '127.0.0.1');
}

if (hasSingleInstanceLock) app.whenReady().then(() => {
  app.setAppUserModelId('org.jicho.desktop');
  nativeTheme.themeSource = 'dark';
  createWindow();
  startServer();
  createTray();
  if (!globalShortcut.register('CommandOrControl+Shift+J', showCommandCentre)) {
    console.warn('Jicho could not register CommandOrControl+Shift+J; use the companion button or tray menu.');
  }
  app.on('activate', () => {
    if (!windowRef) createWindow();
  });
});

function trustedCompanion(event) {
  return isTrustedMainFrame(event, [COMPANION_PAGE]);
}

function trustedDesktopWindow(event) {
  return isTrustedMainFrame(event, [COMPANION_PAGE, COMMAND_CENTRE_PAGE]);
}

ipcMain.handle('jicho:answer', (event, id, decision) => {
  if (!trustedDesktopWindow(event)) return false;
  if (!core) return false;
  if (decision === 'always') {
    const answered = core.allowAlways(id);
    if (answered) { preferences.allowlistEnabled = true; savePreferences(); publishState(); }
    return answered;
  }
  if (!['allow', 'deny'].includes(decision)) return false;
  return core.settle(id, decision, 'desktop');
});

ipcMain.handle('jicho:toggle-phone', (event, visible) => {
  if (!trustedCompanion(event)) return false;
  showPhone = Boolean(visible);
  if (!showPhone && phoneBridge) phoneBridge.dismissPairing();
  publishState();
  return true;
});

ipcMain.handle('jicho:phone-enabled', (event, enabled) => {
  if (!trustedCompanion(event)) return false;
  if (!phoneBridge) return false;
  phoneBridge.setEnabled(Boolean(enabled));
  publishState();
  return true;
});

ipcMain.handle('jicho:phone-content-free', (event, contentFree) => {
  if (!trustedCompanion(event)) return false;
  if (!phoneBridge) return false;
  phoneBridge.setContentFree(Boolean(contentFree));
  publishState();
  return true;
});

ipcMain.handle('jicho:allowlist-enabled', (event, enabled) => {
  if (!trustedCompanion(event)) return false;
  return setAllowlistEnabled(enabled);
});

ipcMain.handle('jicho:autostart-enabled', (event, enabled) => {
  if (!trustedCompanion(event)) return false;
  return setAutostartEnabled(enabled);
});

ipcMain.handle('jicho:command-centre:open', (event) => {
  if (!trustedCompanion(event)) return false;
  showCommandCentre();
  return true;
});

ipcMain.handle('jicho:dashboard:get', (event) => {
  if (!isTrustedMainFrame(event, [COMMAND_CENTRE_PAGE])) throw new Error('Untrusted Jicho window.');
  return dashboardSnapshot();
});

app.on('before-quit', () => {
  if (cursorTimer) clearInterval(cursorTimer);
  if (core) {
    for (const item of core.list()) core.settle(item.id, null, 'app-shutdown');
  }
  if (phoneBridge) phoneBridge.close();
  if (server && server.listening) server.close();
  if (store) {
    try { store.close(); }
    catch (error) { console.error('Jicho database shutdown failed:', error.message); }
  }
  if (tray) tray.destroy();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {});

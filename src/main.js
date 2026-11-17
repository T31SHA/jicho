const { app, BrowserWindow, ipcMain, screen, nativeTheme, Tray, Menu, nativeImage, globalShortcut } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { Core } = require('./core');
const { createServer } = require('./server');
const { PhoneBridge } = require('./phone');
const { Store } = require('./store');
const { isTrustedMainFrame } = require('./ipc-security');
const { selectMascotMood } = require('./mascot-state');
const { buildIslandModel } = require('./island-model');
const { selectIslandLayout, selectIslandBounds } = require('./island-layout');
const { CredentialManager } = require('../bin/hook-support/credentials');

const PORT = Number(process.env.JICHO_PORT || 47821);
const IDLE_WIDTH = 448;
const IDLE_HEIGHT = 92;
const COMPANION_PAGE = path.join(__dirname, 'ui', 'index.html');
const COMMAND_CENTRE_PAGE = path.join(__dirname, 'command-centre.html');
const MASCOT_ICON_DIR = path.join(__dirname, '..', 'mascot', 'icons');

let core;
let store;
let server;
let windowRef;
let commandCentreWindow;
let sessions = [];
let pending = [];
let phoneBridge;
let showPhone = false;
let preferences = { allowlistEnabled: false, autostartEnabled: false, displayId: 'auto', offsetX: 0, offsetY: 0 };
let preferencesFile;
const phoneNotifications = new Set();
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let tray;
let serverError = '';
let credentialError = '';
let autostartError = '';
let doneUntil = 0;
let doneTimer;
let trayMood = 'idle';
let sessionExpiryTimer;
let manuallyExpanded = false;
let selectedSession = null;
let activeLayout = 'idle';
let placementInProgress = false;
let moveSaveTimer;
let displayRepositionHandler;

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
      if (process.env.XDG_SESSION_TYPE === 'wayland' && process.env.DISPLAY) args.push('--ozone-platform=x11');
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

function trayIconPath(mood) {
  const candidate = path.join(MASCOT_ICON_DIR, 'tray-' + mood + '.png');
  return fs.existsSync(candidate) ? candidate : path.join(MASCOT_ICON_DIR, 'tray-idle.png');
}

function setTrayMood(mood) {
  if (!tray || trayMood === mood) return;
  trayMood = mood;
  tray.setImage(nativeImage.createFromPath(trayIconPath(mood)));
}

function showDoneMood() {
  doneUntil = Date.now() + 4000;
  if (doneTimer) clearTimeout(doneTimer);
  doneTimer = setTimeout(() => { doneUntil = 0; publishState(); }, 4000);
  publishState();
}

function startSessionExpiry() {
  if (sessionExpiryTimer) clearInterval(sessionExpiryTimer);
  sessionExpiryTimer = setInterval(() => { if (core) core.expireIdleSessions(); }, 15_000);
  if (typeof sessionExpiryTimer.unref === 'function') sessionExpiryTimer.unref();
}

function createTray() {
  const mood = selectMascotMood({ pendingCount: pending.length, working: sessions.some((session) => session.state === 'working'), doneUntil, error: serverError });
  trayMood = mood;
  tray = new Tray(nativeImage.createFromPath(trayIconPath(mood)));
  tray.setToolTip('Jicho — local approval companion');
  refreshTray();
  tray.on('click', showSettings);
  tray.on('double-click', showSettings);
}

function loadPreferences(dataDirectory) {
  preferencesFile = path.join(dataDirectory, 'preferences.json');
  try {
    preferences = { ...preferences, ...JSON.parse(fs.readFileSync(preferencesFile, 'utf8')) };
    if (typeof preferences.allowlistEnabled !== 'boolean') preferences.allowlistEnabled = false;
    if (typeof preferences.autostartEnabled !== 'boolean') preferences.autostartEnabled = false;
    if (typeof preferences.displayId !== 'string') preferences.displayId = 'auto';
    if (!Number.isFinite(preferences.offsetX)) preferences.offsetX = 0;
    if (!Number.isFinite(preferences.offsetY)) preferences.offsetY = 0;
    preferences.offsetX = Math.max(-2000, Math.min(2000, Math.round(preferences.offsetX)));
    preferences.offsetY = Math.max(-2000, Math.min(2000, Math.round(preferences.offsetY)));
  } catch (_) {
    preferences = { allowlistEnabled: false, autostartEnabled: false, displayId: 'auto', offsetX: 0, offsetY: 0 };
    savePreferences();
  }
  if (preferences.autostartEnabled) applyAutostart(true);
}

function placeWindow(layout) {
  if (!windowRef || windowRef.isDestroyed()) return;
  const displays = screen.getAllDisplays();
  const selected = displays.find((display) => String(display.id) === preferences.displayId) || screen.getPrimaryDisplay();
  const bounds = selectIslandBounds(selected, layout, preferences.offsetX, preferences.offsetY);
  placementInProgress = true;
  windowRef.setBounds(bounds);
  setTimeout(() => { placementInProgress = false; }, 120);
  windowRef.webContents.send('jicho:layout', { layout });
}

function publishState() {
  const working = sessions.some((session) => session.state === 'working');
  const error = serverError || credentialError || autostartError;
  const mood = selectMascotMood({ pendingCount: pending.length, working, doneUntil, error, now: Date.now() });
  setTrayMood(mood);
  if (!windowRef || windowRef.isDestroyed()) return;
  const layout = selectIslandLayout({
    pendingCount: pending.length,
    showSettings: showPhone,
    expanded: manuallyExpanded
  });
  if (layout !== activeLayout) {
    activeLayout = layout;
    placeWindow(layout);
    if (windowRef && !windowRef.isDestroyed() && process.platform !== 'linux') {
      windowRef.setFocusable(layout !== 'idle');
      if (layout === 'idle') windowRef.blur();
    }
  }
  let island;
  try {
    const recentActivity = store ? store.listRecentActivity(150) : [];
    island = buildIslandModel({ sessions, events: recentActivity, pending, selectedSession, now: Date.now() });
  } catch (failure) {
    island = buildIslandModel({ sessions, pending, selectedSession, now: Date.now() });
    island.historyError = 'Local activity history could not be read.';
  }
  windowRef.webContents.send('jicho:state', {
    layout,
    pending,
    sessions,
    working,
    mood,
    allowlistEnabled: Boolean(preferences.allowlistEnabled),
    autostartEnabled: Boolean(preferences.autostartEnabled),
    error,
    phone: phoneBridge ? phoneBridge.viewState() : null,
    island,
    displays: screen.getAllDisplays().map((display) => ({ id: String(display.id), label: display.label || 'Display', bounds: display.bounds })),
    placement: { displayId: preferences.displayId, offsetX: preferences.offsetX, offsetY: preferences.offsetY }
  });
}

function dashboardSnapshot() {
  const storeAvailable = Boolean(store);
  const serverListening = Boolean(server && server.listening);
  let sessions = [];
  let activity = [];
  let error = serverError || '';
  try {
    sessions = storeAvailable ? (store.listAllSessions ? store.listAllSessions() : store.listSessions()) : core ? [...core.sessions.values()] : [];
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
  activeLayout = '';
  windowRef = new BrowserWindow({
    width: IDLE_WIDTH,
    height: IDLE_HEIGHT,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: process.platform !== 'linux',
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    title: 'Jicho',
    icon: path.join(MASCOT_ICON_DIR, 'icon.png'),
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
  windowRef.on('closed', () => {
    if (displayRepositionHandler) {
      screen.removeListener('display-added', displayRepositionHandler);
      screen.removeListener('display-removed', displayRepositionHandler);
      screen.removeListener('display-metrics-changed', displayRepositionHandler);
      displayRepositionHandler = null;
    }
    windowRef = null;
  });
  windowRef.on('move', () => {
    if (placementInProgress || !windowRef || windowRef.isDestroyed()) return;
    if (moveSaveTimer) clearTimeout(moveSaveTimer);
    moveSaveTimer = setTimeout(() => {
      if (!windowRef || windowRef.isDestroyed()) return;
      const bounds = windowRef.getBounds();
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + 12 };
      const nearest = screen.getAllDisplays().slice().sort((a, b) => {
        const distance = (display) => {
          const area = display.workArea || display.bounds;
          return Math.hypot(area.x + area.width / 2 - center.x, area.y - center.y);
        };
        return distance(a) - distance(b);
      })[0] || screen.getPrimaryDisplay();
      const area = nearest.workArea || nearest.bounds;
      preferences.displayId = String(nearest.id);
      preferences.offsetX = Math.max(-2000, Math.min(2000, Math.round(center.x - (area.x + area.width / 2))));
      preferences.offsetY = Math.max(-2000, Math.min(2000, Math.round(bounds.y - area.y - 8)));
      savePreferences();
    }, 250);
  });
  displayRepositionHandler = () => {
    if (!windowRef || windowRef.isDestroyed()) return;
    if (!screen.getAllDisplays().some((display) => String(display.id) === preferences.displayId)) preferences.displayId = 'auto';
    activeLayout = '';
    publishState();
  };
  screen.on('display-added', displayRepositionHandler);
  screen.on('display-removed', displayRepositionHandler);
  screen.on('display-metrics-changed', displayRepositionHandler);
  windowRef.webContents.on('did-finish-load', publishState);
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
    icon: path.join(MASCOT_ICON_DIR, 'icon.png'),
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
  const credentialManager = new CredentialManager();
  try {
    const credentialStatus = credentialManager.status();
    if (credentialStatus.status !== 'active') {
      credentialError = 'Hook authentication is unavailable. Run `npm run jicho -- install` or `npm run jicho -- credential rotate`.';
    }
  } catch (_) {
    credentialError = 'Hook authentication state is unavailable or unsafe. Check Jicho credential status before reinstalling hooks.';
  }
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
    startSessionExpiry();
    publishState();
    return;
  }
  sessions = [...core.sessions.values()];
  startSessionExpiry();
  phoneBridge = new PhoneBridge(core, app.getPath('userData'));
  showPhone = phoneBridge.storageBlocked;
  phoneBridge.on('status', publishState);
  phoneBridge.qrPromise.then((uri) => { phoneBridge.qrDataUrl = uri; publishState(); }).catch((error) => {
    console.error('Could not generate phone alert subscription QR code:', error.message);
    phoneBridge.qrDataUrl = null;
    phoneBridge.setStatus(false, 'Could not generate the pairing QR code.');
    publishState();
  });
  core.on('pending', (items) => {
    pending = items;
    for (const item of items) {
      if (phoneNotifications.has(item.id)) continue;
      phoneNotifications.add(item.id);
      phoneBridge.publishRequest(item).catch((error) => console.error('Could not publish generic phone alert:', error.message));
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
  core.on('activity', (event) => {
    if (event.type === 'Stop') showDoneMood();
    publishState();
    publishDashboard();
  });
  server = createServer(core, { credentialProvider: () => {
    let credential = null;
    try { credential = credentialManager.getCredential(); }
    catch (_) { credential = null; }
    const previousError = credentialError;
    credentialError = credential ? '' : 'Hook authentication is unavailable. Run `npm run jicho -- install` or `npm run jicho -- credential rotate`.';
    if (previousError !== credentialError) {
      if (serverError === previousError) serverError = credentialError;
      publishState();
      publishDashboard();
    }
    return credential;
  } });
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
  server.on('listening', () => { serverError = credentialError; publishState(); publishDashboard(); });
  server.listen(PORT, '127.0.0.1');
}

if (hasSingleInstanceLock) app.whenReady().then(() => {
  app.setAppUserModelId('org.jicho.desktop');
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(nativeImage.createFromPath(path.join(MASCOT_ICON_DIR, 'icon.png')));
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

ipcMain.handle('jicho:island:toggle-expanded', (event) => {
  if (!trustedCompanion(event)) return false;
  manuallyExpanded = !manuallyExpanded;
  publishState();
  return manuallyExpanded;
});

ipcMain.handle('jicho:island:select-session', (event, agentId, sessionId) => {
  if (!trustedCompanion(event) || typeof agentId !== 'string' || typeof sessionId !== 'string' ||
      agentId.length > 64 || sessionId.length > 256) return false;
  const session = sessions.find((item) => (item.agentId || 'claude-code') === agentId && item.id === sessionId);
  if (!session) return false;
  selectedSession = { agentId, id: sessionId };
  publishState();
  return true;
});

ipcMain.handle('jicho:island:set-display', (event, displayId) => {
  if (!trustedCompanion(event)) return false;
  if (displayId !== 'auto' && !screen.getAllDisplays().some((display) => String(display.id) === displayId)) return false;
  preferences.displayId = displayId;
  activeLayout = '';
  savePreferences();
  publishState();
  return true;
});

ipcMain.handle('jicho:island:set-offset', (event, offset) => {
  if (!trustedCompanion(event) || !offset || !Number.isInteger(offset.x) || !Number.isInteger(offset.y)) return false;
  preferences.offsetX = Math.max(-2000, Math.min(2000, offset.x));
  preferences.offsetY = Math.max(-2000, Math.min(2000, offset.y));
  activeLayout = '';
  savePreferences();
  publishState();
  return true;
});

ipcMain.handle('jicho:answer', (event, id, decision) => {
  if (!trustedDesktopWindow(event)) return false;
  if (!core) return false;
  if (decision === 'always') {
    const answered = core.allowAlways(id);
    if (answered) { preferences.allowlistEnabled = true; savePreferences(); publishState(); }
    return answered;
  }
  if (!['allow', 'deny'].includes(decision)) return false;
  return core.handleRequestDecision(id, decision, 'desktop');
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
  if (doneTimer) clearTimeout(doneTimer);
  if (sessionExpiryTimer) clearInterval(sessionExpiryTimer);
  if (moveSaveTimer) clearTimeout(moveSaveTimer);
  if (displayRepositionHandler) {
    screen.removeListener('display-added', displayRepositionHandler);
    screen.removeListener('display-removed', displayRepositionHandler);
    screen.removeListener('display-metrics-changed', displayRepositionHandler);
  }
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

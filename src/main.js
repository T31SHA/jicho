const { app, BrowserWindow, ipcMain, screen, nativeTheme } = require('electron');
const path = require('path');
const { Core } = require('./core');
const { createServer } = require('./server');

const PORT = Number(process.env.JICHO_PORT || 47821);
const WIDTH = 390;
const IDLE_HEIGHT = 76;
const CARD_HEIGHT = 330;

let core;
let server;
let windowRef;
let sessions = [];
let pending = [];
let cursorTimer;

function placeWindow(expanded) {
  if (!windowRef || windowRef.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workArea;
  const height = expanded ? CARD_HEIGHT : IDLE_HEIGHT;
  const x = Math.round(area.x + (area.width - WIDTH) / 2);
  const y = area.y + area.height - height - 18;
  windowRef.setBounds({ x, y, width: WIDTH, height });
  windowRef.webContents.send('jicho:layout', { expanded });
}

function publishState() {
  if (!windowRef || windowRef.isDestroyed()) return;
  const expanded = pending.length > 0;
  placeWindow(expanded);
  windowRef.webContents.send('jicho:state', {
    pending,
    sessions,
    working: sessions.some((session) => session.state === 'working')
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
    placeWindow(false);
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
  core = new Core();
  core.on('pending', (items) => { pending = items; publishState(); });
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
  if (!core || !['allow', 'deny'].includes(decision)) return false;
  return core.settle(id, decision, 'desktop');
});

app.on('before-quit', () => {
  if (cursorTimer) clearInterval(cursorTimer);
  if (server) server.close();
});

app.on('window-all-closed', (event) => { event.preventDefault(); });

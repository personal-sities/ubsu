const { app, BrowserWindow, Menu, Tray } = require('electron');
const path = require('path');
require('./server');

let win = null;
let tray = null;
let isQuitting = false;

function showWindow() {
  if (!win) createWindow();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  win.loadURL(`http://localhost:${process.env.PORT || 3000}`);

  win.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
  });

  win.on('closed', () => {
    win = null;
  });
}

function createTray() {
  if (tray) return;

  tray = new Tray(path.join(__dirname, 'favicon.ico'));
  tray.setToolTip('AloqaPro - Nazorat tizimi');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ochish', click: showWindow },
    {
      label: 'Chiqish',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on('double-click', showWindow);
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('activate', showWindow);

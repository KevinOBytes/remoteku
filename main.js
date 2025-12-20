const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    resizable: true,
    title: 'Roku Remote'
  });

  mainWindow.loadFile('index.html');

  // Open DevTools in development
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
  // On macOS, apps typically stay open until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});

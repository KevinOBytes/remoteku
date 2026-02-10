const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const RokuClient = require('./roku-client');
const fs = require('fs');
const util = require('util');
const os = require('os');

const logPath = path.join(app.getPath('userData'), 'remoteku_debug.log');
const logFile = fs.createWriteStream(logPath, { flags: 'w' });
const logStdout = process.stdout;

console.log = function () {
  const msg = util.format.apply(null, arguments) + '\n';
  logFile.write(msg);
  logStdout.write(msg);
};
console.error = function () {
  const msg = util.format.apply(null, arguments) + '\n';
  logFile.write(msg);
  logStdout.write(msg);
};

let mainWindow;
const rokuClient = new RokuClient();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
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

// IPC Handlers
ipcMain.handle('roku:discover', async (_event, options = {}) => {
  console.log('IPC: roku:discover called', options);
  try {
    const devices = await rokuClient.discoverDevices(options);
    console.log(`IPC: roku:discover finishing with ${devices.length} devices`);
    return devices;
  } catch (e) {
    console.error('IPC: roku:discover failed:', e);
    if (e?.code === 'EACCES' || e?.code === 'EPERM') {
      throw e;
    }
    return [];
  }
});

ipcMain.handle('roku:get-devices', () => {
  return rokuClient.getDevices();
});

ipcMain.handle('roku:set-device', (event, device) => {
  rokuClient.setDevice(device);
});

ipcMain.handle('roku:get-current-device', () => {
  return rokuClient.getCurrentDevice();
});

ipcMain.handle('roku:get-device-info', async (event, host) => {
  return await rokuClient.getDeviceInfo(host);
});

ipcMain.handle('roku:probe-device', async (event, host) => {
  return await rokuClient.probeDeviceInfo(host);
});

ipcMain.handle('roku:add-device', (event, device) => {
  return rokuClient.addDevice(device);
});

ipcMain.handle('roku:get-network-info', () => {
  const interfaces = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      results.push({
        name,
        address: net.address,
        family: net.family,
        internal: net.internal
      });
    }
  }
  return results;
});

ipcMain.handle('roku:get-apps', async () => {
  return await rokuClient.getApps();
});

ipcMain.handle('roku:launch-app', async (event, appId) => {
  return await rokuClient.launchApp(appId);
});

ipcMain.handle('roku:send-key', async (event, key) => {
  return await rokuClient.sendKey(key);
});

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

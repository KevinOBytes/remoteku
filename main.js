const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  TouchBar,
  nativeImage,
  globalShortcut,
  powerMonitor,
  shell
} = require('electron');
const path = require('path');
const fs = require('fs');
const util = require('util');
const os = require('os');
const RokuClient = require('./roku-client');
const WindowStateManager = require('./window-state');

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

let mainWindow = null;
let tray = null;
let isQuitting = false;
let boundsSaveTimer = null;
let isModeTransitioning = false;
let modeTransitionTimer = null;

const rokuClient = new RokuClient();
const stateFilePath = path.join(app.getPath('userData'), 'window-state.json');
const windowStateManager = new WindowStateManager(stateFilePath);

function createTrayIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4, 0);

  const setPixel = (x, y, alpha = 255) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    buf[idx] = 0;     // B
    buf[idx + 1] = 0; // G
    buf[idx + 2] = 0; // R
    buf[idx + 3] = alpha;
  };

  // Draw rounded remote body outline (x: 9..22, y: 3..28)
  for (let y = 3; y <= 28; y += 1) {
    for (let x = 9; x <= 22; x += 1) {
      const dx = Math.min(x - 9, 22 - x);
      const dy = Math.min(y - 3, 28 - y);
      if (dx === 0 && dy === 0) continue; // rounded corners
      const isBorder = x <= 10 || x >= 21 || y <= 4 || y >= 27;
      if (isBorder) {
        setPixel(x, y, 245);
      }
    }
  }

  // Draw circular D-pad ring at center (cx: 15.5, cy: 13.5, r: 3.5)
  for (let y = 9; y <= 18; y += 1) {
    for (let x = 11; x <= 20; x += 1) {
      const dist = Math.hypot(x - 15.5, y - 13.5);
      if (dist >= 2.2 && dist <= 3.8) {
        setPixel(x, y, 240);
      }
    }
  }

  // Draw lower mini button dots
  const dots = [
    [13, 21], [18, 21],
    [13, 24], [18, 24]
  ];
  for (const [dx, dy] of dots) {
    setPixel(dx, dy, 235);
    setPixel(dx + 1, dy, 235);
    setPixel(dx, dy + 1, 235);
    setPixel(dx + 1, dy + 1, 235);
  }

  const image = nativeImage.createFromBitmap(buf, {
    width: size,
    height: size,
    scaleFactor: 2.0
  });
  image.setTemplateImage(true);
  return image;
}

function notifyRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send(channel, payload);
  }
}

function applyMiniModeToWindow(isMiniMode) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return windowStateManager.getState();
  }

  if (boundsSaveTimer) {
    clearTimeout(boundsSaveTimer);
    boundsSaveTimer = null;
  }
  if (modeTransitionTimer) {
    clearTimeout(modeTransitionTimer);
  }
  isModeTransitioning = true;

  const currentBounds = mainWindow.getBounds();
  const { targetBounds } = windowStateManager.setMiniMode(isMiniMode, currentBounds);
  const state = windowStateManager.getState();

  const applyTargetBounds = (defaultWidth, defaultHeight) => {
    const nextWidth = targetBounds.width || defaultWidth;
    const nextHeight = targetBounds.height || defaultHeight;
    if (Number.isFinite(targetBounds.x) && Number.isFinite(targetBounds.y)) {
      mainWindow.setBounds(
        {
          x: Math.round(targetBounds.x),
          y: Math.round(targetBounds.y),
          width: nextWidth,
          height: nextHeight
        },
        true
      );
    } else {
      mainWindow.setSize(nextWidth, nextHeight, true);
    }
  };

  if (isMiniMode) {
    mainWindow.setMinimumSize(320, 660);
    applyTargetBounds(340, 780);
    mainWindow.setAlwaysOnTop(true, 'floating');
  } else {
    mainWindow.setMinimumSize(760, 680);
    applyTargetBounds(1080, 840);
    mainWindow.setAlwaysOnTop(Boolean(state.alwaysOnTop), state.alwaysOnTop ? 'floating' : 'normal');
  }

  modeTransitionTimer = setTimeout(() => {
    isModeTransitioning = false;
  }, 400);

  rebuildTrayMenu();
  buildAppMenu();
  return windowStateManager.getState();
}

function showAndFocusWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindowVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    showAndFocusWindow();
  }
}

function rebuildTrayMenu() {
  if (!tray) return;

  const state = windowStateManager.getState();
  const current = rokuClient.getCurrentDevice();
  const devices = rokuClient.getDevices();

  const deviceSubmenu = devices.length > 0
    ? devices.map((device) => ({
      label: `${device.friendlyName || 'Roku Device'} (${device.ip || device.host})`,
      type: 'radio',
      checked: Boolean(current && current.host === device.host),
      click: () => {
        rokuClient.setDevice(device);
        notifyRenderer('roku:device-changed', device);
        rebuildTrayMenu();
      }
    }))
    : [{ label: 'No devices discovered yet', enabled: false }];

  deviceSubmenu.push(
    { type: 'separator' },
    {
      label: 'Rescan Network',
      click: () => {
        showAndFocusWindow();
        notifyRenderer('menu:action', { action: 'rescan' });
      }
    }
  );

  const hasDevice = Boolean(current);
  const statusLabel = current
    ? `Connected: ${current.friendlyName || 'Roku'} (${current.ip || current.host})`
    : 'RemoteKu · Disconnected';

  const contextMenu = Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { label: 'Switch Roku Device', submenu: deviceSubmenu },
    { type: 'separator' },
    {
      label: 'Play / Pause',
      enabled: hasDevice,
      click: () => rokuClient.sendKey('Play').catch(() => {})
    },
    {
      label: 'Mute / Unmute',
      enabled: hasDevice,
      click: () => rokuClient.sendKey('VolumeMute').catch(() => {})
    },
    {
      label: 'Volume Up',
      enabled: hasDevice,
      click: () => rokuClient.sendKey('VolumeUp').catch(() => {})
    },
    {
      label: 'Volume Down',
      enabled: hasDevice,
      click: () => rokuClient.sendKey('VolumeDown').catch(() => {})
    },
    { type: 'separator' },
    {
      label: 'Home Screen',
      enabled: hasDevice,
      click: () => rokuClient.sendKey('Home').catch(() => {})
    },
    {
      label: 'Back',
      enabled: hasDevice,
      click: () => rokuClient.sendKey('Back').catch(() => {})
    },
    {
      label: 'Power Toggle',
      enabled: hasDevice,
      click: () => rokuClient.sendKey('Power').catch(() => {})
    },
    {
      label: 'Find Remote (Chime)',
      enabled: hasDevice,
      click: () => rokuClient.sendKey('FindRemote').catch(() => {})
    },
    { type: 'separator' },
    {
      label: 'Mini Remote Mode',
      type: 'checkbox',
      checked: Boolean(state.isMiniMode),
      click: (menuItem) => {
        applyMiniModeToWindow(menuItem.checked);
        notifyRenderer('menu:action', { action: 'set-mini-mode', value: menuItem.checked });
      }
    },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: Boolean(state.alwaysOnTop || state.isMiniMode),
      enabled: !state.isMiniMode,
      click: (menuItem) => {
        windowStateManager.updatePreferences({ alwaysOnTop: menuItem.checked });
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(menuItem.checked, menuItem.checked ? 'floating' : 'normal');
        }
        rebuildTrayMenu();
      }
    },
    {
      label: 'Keep in Menu Bar on Close',
      type: 'checkbox',
      checked: Boolean(state.closeToTray),
      click: (menuItem) => {
        windowStateManager.updatePreferences({ closeToTray: menuItem.checked });
        rebuildTrayMenu();
      }
    },
    { type: 'separator' },
    {
      label: 'Show RemoteKu (⌘⇧R)',
      click: () => showAndFocusWindow()
    },
    {
      label: 'Quit RemoteKu',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip(statusLabel);
  tray.setContextMenu(contextMenu);
}

function setupTray() {
  if (tray) return;
  try {
    const icon = createTrayIcon();
    tray = new Tray(icon);
    tray.on('click', () => {
      toggleWindowVisibility();
    });
    tray.on('right-click', () => {
      rebuildTrayMenu();
      tray.popUpContextMenu();
    });
    rebuildTrayMenu();
  } catch (error) {
    console.error('Unable to initialize system tray:', error);
  }
}

function buildTouchBar() {
  if (process.platform !== 'darwin' || !TouchBar) {
    return null;
  }
  const { TouchBarButton, TouchBarSpacer } = TouchBar;
  return new TouchBar({
    items: [
      new TouchBarButton({
        label: '⚡ Power',
        backgroundColor: '#7f1d1d',
        click: () => rokuClient.sendKey('Power').catch(() => {})
      }),
      new TouchBarSpacer({ size: 'small' }),
      new TouchBarButton({
        label: '🏠 Home',
        click: () => rokuClient.sendKey('Home').catch(() => {})
      }),
      new TouchBarButton({
        label: '← Back',
        click: () => rokuClient.sendKey('Back').catch(() => {})
      }),
      new TouchBarSpacer({ size: 'small' }),
      new TouchBarButton({
        label: '⏯ Play',
        backgroundColor: '#0e7490',
        click: () => rokuClient.sendKey('Play').catch(() => {})
      }),
      new TouchBarSpacer({ size: 'small' }),
      new TouchBarButton({
        label: '🔇 Mute',
        click: () => rokuClient.sendKey('VolumeMute').catch(() => {})
      }),
      new TouchBarButton({
        label: '🔉 -',
        click: () => rokuClient.sendKey('VolumeDown').catch(() => {})
      }),
      new TouchBarButton({
        label: '🔊 +',
        click: () => rokuClient.sendKey('VolumeUp').catch(() => {})
      })
    ]
  });
}

function buildAppMenu() {
  const state = windowStateManager.getState();
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [{
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          {
            label: 'Local Network Privacy Settings…',
            click: () => {
              shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork').catch(() => {});
            }
          },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          {
            label: 'Quit RemoteKu',
            accelerator: 'CommandOrControl+Q',
            click: () => {
              isQuitting = true;
              app.quit();
            }
          }
        ]
      }]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Remote',
      submenu: [
        {
          label: 'Type to Roku…',
          accelerator: 'CommandOrControl+K',
          click: () => {
            showAndFocusWindow();
            notifyRenderer('menu:action', { action: 'focus-keyboard' });
          }
        },
        {
          label: 'Filter Installed Apps…',
          accelerator: 'CommandOrControl+F',
          click: () => {
            showAndFocusWindow();
            notifyRenderer('menu:action', { action: 'focus-apps-search' });
          }
        },
        {
          label: 'Rescan Roku Devices',
          accelerator: 'CommandOrControl+R',
          click: () => {
            showAndFocusWindow();
            notifyRenderer('menu:action', { action: 'rescan' });
          }
        },
        { type: 'separator' },
        {
          label: 'Play / Pause',
          click: () => rokuClient.sendKey('Play').catch(() => {})
        },
        {
          label: 'Mute / Unmute',
          click: () => rokuClient.sendKey('VolumeMute').catch(() => {})
        },
        {
          label: 'Home Screen',
          click: () => rokuClient.sendKey('Home').catch(() => {})
        },
        {
          label: 'Find Remote Chime',
          click: () => rokuClient.sendKey('FindRemote').catch(() => {})
        },
        { type: 'separator' },
        {
          label: 'Keyboard Shortcuts Reference',
          accelerator: 'CommandOrControl+/',
          click: () => {
            showAndFocusWindow();
            notifyRenderer('menu:action', { action: 'toggle-shortcuts-modal' });
          }
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Mini Remote Mode',
          type: 'checkbox',
          checked: Boolean(state.isMiniMode),
          accelerator: 'CommandOrControl+Shift+M',
          click: (menuItem) => {
            applyMiniModeToWindow(menuItem.checked);
            notifyRenderer('menu:action', { action: 'set-mini-mode', value: menuItem.checked });
          }
        },
        {
          label: 'Always on Top',
          type: 'checkbox',
          checked: Boolean(state.alwaysOnTop || state.isMiniMode),
          enabled: !state.isMiniMode,
          click: (menuItem) => {
            windowStateManager.updatePreferences({ alwaysOnTop: menuItem.checked });
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setAlwaysOnTop(menuItem.checked, menuItem.checked ? 'floating' : 'normal');
            }
            rebuildTrayMenu();
          }
        },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function scheduleSaveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || isModeTransitioning) return;
  if (boundsSaveTimer) {
    clearTimeout(boundsSaveTimer);
  }
  boundsSaveTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || isModeTransitioning) return;
    const state = windowStateManager.getState();
    const bounds = mainWindow.getBounds();
    if (state.isMiniMode) {
      windowStateManager.updateMiniBounds(bounds);
    } else {
      windowStateManager.updateNormalBounds(bounds);
    }
  }, 250);
}

function createWindow() {
  const savedState = windowStateManager.load();
  const initialBounds = savedState.isMiniMode ? savedState.miniBounds : savedState.normalBounds;

  mainWindow = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    x: initialBounds.x,
    y: initialBounds.y,
    minWidth: savedState.isMiniMode ? 320 : 760,
    minHeight: savedState.isMiniMode ? 660 : 680,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#080d18',
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    visualEffectState: process.platform === 'darwin' ? 'active' : undefined,
    alwaysOnTop: Boolean(savedState.isMiniMode || savedState.alwaysOnTop),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    resizable: true,
    title: 'RemoteKu'
  });

  if (savedState.isMiniMode || savedState.alwaysOnTop) {
    mainWindow.setAlwaysOnTop(true, 'floating');
  }

  const touchBar = buildTouchBar();
  if (touchBar) {
    mainWindow.setTouchBar(touchBar);
  }

  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
    console.log(`[Renderer] ${message} (${sourceId}:${line})`);
  });

  mainWindow.on('resize', scheduleSaveWindowBounds);
  mainWindow.on('move', scheduleSaveWindowBounds);

  mainWindow.on('close', (event) => {
    const state = windowStateManager.getState();
    if (!isQuitting && process.platform === 'darwin' && state.closeToTray && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

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
    rebuildTrayMenu();
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

ipcMain.handle('roku:set-device', (_event, device) => {
  rokuClient.setDevice(device);
  rebuildTrayMenu();
});

ipcMain.handle('roku:get-current-device', () => {
  return rokuClient.getCurrentDevice();
});

ipcMain.handle('roku:get-device-info', async (_event, host) => {
  return await rokuClient.getDeviceInfo(host);
});

ipcMain.handle('roku:probe-device', async (_event, host) => {
  return await rokuClient.probeDeviceInfo(host);
});

ipcMain.handle('roku:add-device', (_event, device) => {
  const added = rokuClient.addDevice(device);
  rebuildTrayMenu();
  return added;
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
        internal: net.internal,
        virtual: RokuClient.isVirtualInterfaceName(name)
      });
    }
  }
  return results;
});

ipcMain.handle('roku:get-apps', async () => {
  return await rokuClient.getApps();
});

ipcMain.handle('roku:get-app-icon', async (_event, appId) => {
  return await rokuClient.getAppIcon(appId);
});

ipcMain.handle('roku:launch-app', async (_event, appId) => {
  return await rokuClient.launchApp(appId);
});

ipcMain.handle('roku:send-key', async (_event, key) => {
  return await rokuClient.sendKey(key);
});

ipcMain.handle('roku:key-down', async (_event, key) => {
  return await rokuClient.keyDown(key);
});

ipcMain.handle('roku:key-up', async (_event, key) => {
  return await rokuClient.keyUp(key);
});

ipcMain.handle('roku:send-text', async (_event, text, options = {}) => {
  return await rokuClient.sendText(text, options);
});

ipcMain.handle('roku:get-now-playing', async () => {
  return await rokuClient.getNowPlaying();
});

// Window State Handlers
ipcMain.handle('window:toggle-mini-mode', (_event, isMiniMode) => {
  return applyMiniModeToWindow(isMiniMode);
});

ipcMain.handle('window:get-state', () => {
  return windowStateManager.getState();
});

ipcMain.handle('window:update-preferences', (_event, prefs = {}) => {
  const next = windowStateManager.updatePreferences(prefs);
  if (mainWindow && !mainWindow.isDestroyed() && typeof prefs.alwaysOnTop === 'boolean' && !next.isMiniMode) {
    mainWindow.setAlwaysOnTop(prefs.alwaysOnTop, prefs.alwaysOnTop ? 'floating' : 'normal');
  }
  rebuildTrayMenu();
  buildAppMenu();
  return next;
});

ipcMain.handle('system:open-network-settings', async () => {
  if (process.platform === 'darwin') {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork');
    return true;
  }
  return false;
});

app.whenReady().then(() => {
  createWindow();
  setupTray();
  buildAppMenu();

  try {
    globalShortcut.register('CommandOrControl+Shift+R', () => {
      toggleWindowVisibility();
    });
  } catch (error) {
    console.warn('Unable to register global shortcut:', error);
  }

  if (powerMonitor) {
    powerMonitor.on('resume', () => {
      notifyRenderer('system:resume', { reason: 'resume' });
    });
    powerMonitor.on('unlock-screen', () => {
      notifyRenderer('system:resume', { reason: 'unlock-screen' });
    });
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll();
  } catch (error) {
    // Ignore cleanup errors
  }
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  } else {
    showAndFocusWindow();
  }
});

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the Roku client running in the main process via IPC
contextBridge.exposeInMainWorld('rokuAPI', {
  discoverDevices: (options) => ipcRenderer.invoke('roku:discover', options),
  getDevices: () => ipcRenderer.invoke('roku:get-devices'),
  setDevice: (device) => ipcRenderer.invoke('roku:set-device', device),
  getCurrentDevice: () => ipcRenderer.invoke('roku:get-current-device'),
  getDeviceInfo: (host) => ipcRenderer.invoke('roku:get-device-info', host),
  probeDevice: (host) => ipcRenderer.invoke('roku:probe-device', host),
  addDevice: (device) => ipcRenderer.invoke('roku:add-device', device),
  getNetworkInfo: () => ipcRenderer.invoke('roku:get-network-info'),
  getApps: () => ipcRenderer.invoke('roku:get-apps'),
  getAppIcon: (appId) => ipcRenderer.invoke('roku:get-app-icon', appId),
  launchApp: (appId) => ipcRenderer.invoke('roku:launch-app', appId),
  sendKey: (key) => ipcRenderer.invoke('roku:send-key', key),
  keyDown: (key) => ipcRenderer.invoke('roku:key-down', key),
  keyUp: (key) => ipcRenderer.invoke('roku:key-up', key),
  sendText: (text, options) => ipcRenderer.invoke('roku:send-text', text, options),
  getNowPlaying: () => ipcRenderer.invoke('roku:get-now-playing'),
  toggleMiniMode: (isMiniMode) => ipcRenderer.invoke('window:toggle-mini-mode', isMiniMode),
  getWindowState: () => ipcRenderer.invoke('window:get-state'),
  updatePreferences: (prefs) => ipcRenderer.invoke('window:update-preferences', prefs),
  openNetworkSettings: () => ipcRenderer.invoke('system:open-network-settings'),
  onSystemResume: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('system:resume', listener);
    return () => ipcRenderer.removeListener('system:resume', listener);
  },
  onMenuAction: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
  onShortcutAction: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
  onDeviceChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('roku:device-changed', listener);
    return () => ipcRenderer.removeListener('roku:device-changed', listener);
  }
});

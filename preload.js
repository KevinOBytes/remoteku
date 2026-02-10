const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the Roku client running in the main process via IPC
contextBridge.exposeInMainWorld('rokuAPI', {
  discoverDevices: () => ipcRenderer.invoke('roku:discover'),
  getDevices: () => ipcRenderer.invoke('roku:get-devices'),
  setDevice: (device) => ipcRenderer.invoke('roku:set-device', device),
  getCurrentDevice: () => ipcRenderer.invoke('roku:get-current-device'),
  getDeviceInfo: (host) => ipcRenderer.invoke('roku:get-device-info', host),
  probeDevice: (host) => ipcRenderer.invoke('roku:probe-device', host),
  addDevice: (device) => ipcRenderer.invoke('roku:add-device', device),
  getNetworkInfo: () => ipcRenderer.invoke('roku:get-network-info'),
  getApps: () => ipcRenderer.invoke('roku:get-apps'),
  launchApp: (appId) => ipcRenderer.invoke('roku:launch-app', appId),
  sendKey: (key) => ipcRenderer.invoke('roku:send-key', key)
});

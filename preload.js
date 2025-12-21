const { contextBridge } = require('electron');
const RokuClient = require('./roku-client');

const rokuClient = new RokuClient();

// Expose protected methods that allow the renderer process to use
// the Roku client without giving it full access to Node.js
contextBridge.exposeInMainWorld('rokuAPI', {
  discoverDevices: () => rokuClient.discoverDevices(),
  getDevices: () => rokuClient.getDevices(),
  setDevice: (device) => rokuClient.setDevice(device),
  getCurrentDevice: () => rokuClient.getCurrentDevice(),
  getApps: () => rokuClient.getApps(),
  launchApp: (appId) => rokuClient.launchApp(appId),
  sendKey: (key) => rokuClient.sendKey(key)
});

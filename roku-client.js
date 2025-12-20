const axios = require('axios');
const dgram = require('dgram');

class RokuClient {
  constructor() {
    this.devices = [];
    this.currentDevice = null;
  }

  // Discover Roku devices on the network using SSDP
  async discoverDevices() {
    return new Promise((resolve, reject) => {
      const devices = [];
      const socket = dgram.createSocket('udp4');
      
      const ssdpMessage = Buffer.from(
        'M-SEARCH * HTTP/1.1\r\n' +
        'HOST: 239.255.255.250:1900\r\n' +
        'MAN: "ssdp:discover"\r\n' +
        'MX: 3\r\n' +
        'ST: roku:ecp\r\n\r\n'
      );

      socket.on('message', async (msg, rinfo) => {
        const message = msg.toString();
        if (message.includes('roku:ecp')) {
          // Extract location from SSDP response
          const locationMatch = message.match(/LOCATION: (.*)\r\n/i);
          if (locationMatch) {
            const locationUrl = locationMatch[1].trim();
            try {
              const url = new URL(locationUrl);
              const deviceInfo = await this.getDeviceInfo(`${url.protocol}//${url.host}`);
              
              // Avoid duplicates
              if (!devices.find(d => d.host === `${url.protocol}//${url.host}`)) {
                devices.push({
                  host: `${url.protocol}//${url.host}`,
                  ip: rinfo.address,
                  ...deviceInfo
                });
              }
            } catch (err) {
              console.error('Error getting device info:', err.message);
            }
          }
        }
      });

      socket.on('error', (err) => {
        socket.close();
        reject(err);
      });

      socket.bind(() => {
        socket.addMembership('239.255.255.250');
        socket.send(ssdpMessage, 0, ssdpMessage.length, 1900, '239.255.255.250', (err) => {
          if (err) {
            socket.close();
            reject(err);
          }
        });
      });

      // Wait for responses
      setTimeout(() => {
        socket.close();
        this.devices = devices;
        if (devices.length > 0) {
          this.currentDevice = devices[0];
        }
        resolve(devices);
      }, 3000);
    });
  }

  // Get device information
  async getDeviceInfo(host) {
    try {
      const response = await axios.get(`${host}/query/device-info`, {
        timeout: 5000
      });
      
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(response.data, 'text/xml');
      
      return {
        friendlyName: xmlDoc.getElementsByTagName('friendly-device-name')[0]?.textContent || 'Roku Device',
        modelName: xmlDoc.getElementsByTagName('model-name')[0]?.textContent || 'Unknown',
        serialNumber: xmlDoc.getElementsByTagName('serial-number')[0]?.textContent || 'Unknown'
      };
    } catch (error) {
      return {
        friendlyName: 'Roku Device',
        modelName: 'Unknown',
        serialNumber: 'Unknown'
      };
    }
  }

  // Get installed apps
  async getApps() {
    if (!this.currentDevice) {
      throw new Error('No device selected');
    }

    try {
      const response = await axios.get(`${this.currentDevice.host}/query/apps`, {
        timeout: 5000
      });
      
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(response.data, 'text/xml');
      const appElements = xmlDoc.getElementsByTagName('app');
      
      const apps = [];
      for (let i = 0; i < appElements.length; i++) {
        const app = appElements[i];
        apps.push({
          id: app.getAttribute('id'),
          name: app.textContent,
          version: app.getAttribute('version')
        });
      }
      
      return apps;
    } catch (error) {
      console.error('Error getting apps:', error.message);
      return [];
    }
  }

  // Launch an app
  async launchApp(appId) {
    if (!this.currentDevice) {
      throw new Error('No device selected');
    }

    try {
      await axios.post(`${this.currentDevice.host}/launch/${appId}`, null, {
        timeout: 5000
      });
      return true;
    } catch (error) {
      console.error('Error launching app:', error.message);
      return false;
    }
  }

  // Send key press command
  async sendKey(key) {
    if (!this.currentDevice) {
      throw new Error('No device selected');
    }

    try {
      await axios.post(`${this.currentDevice.host}/keypress/${key}`, null, {
        timeout: 5000
      });
      return true;
    } catch (error) {
      console.error('Error sending key:', error.message);
      return false;
    }
  }

  // Set current device
  setDevice(device) {
    this.currentDevice = device;
  }

  // Get current device
  getCurrentDevice() {
    return this.currentDevice;
  }

  // Get all discovered devices
  getDevices() {
    return this.devices;
  }
}

module.exports = RokuClient;

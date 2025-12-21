const axios = require('axios');
const dgram = require('dgram');
const { XMLParser } = require('fast-xml-parser');

class RokuClient {
  constructor() {
    this.devices = [];
    this.currentDevice = null;
  }

  // SSDP constants
  static SSDP_ADDRESS = '239.255.255.250';
  static SSDP_PORT = 1900;
  static DISCOVERY_TIMEOUT = 3000;
  static API_TIMEOUT = 5000;
  static MULTICAST_FIRST_OCTET_MIN = 224;
  static MULTICAST_FIRST_OCTET_MAX = 239;

  // Discover Roku devices on the network using SSDP
  async discoverDevices({
    address = RokuClient.SSDP_ADDRESS,
    port = RokuClient.SSDP_PORT,
    discoveryTimeout = RokuClient.DISCOVERY_TIMEOUT
  } = {}) {
    return new Promise((resolve, reject) => {
      const devices = [];
      const pendingRequests = [];
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      let isSettled = false;
      const isMulticastTarget = RokuClient.isMulticastAddress(address);
      
      const ssdpMessage = Buffer.from(
         'M-SEARCH * HTTP/1.1\r\n' +
         `HOST: ${address}:${port}\r\n` +
         'MAN: "ssdp:discover"\r\n' +
         'MX: 3\r\n' +
         'ST: roku:ecp\r\n\r\n'
       );

      const messageHandler = async (msg, rinfo) => {
        const message = msg.toString();
        if (message.includes('roku:ecp')) {
          // Extract location from SSDP response
          const locationMatch = message.match(/LOCATION: (.*)\r\n/i);
          if (locationMatch) {
            const locationUrl = locationMatch[1].trim();
            const devicePromise = (async () => {
              try {
                const url = new URL(locationUrl);
                const host = `${url.protocol}//${url.host}`;
                const deviceInfo = await this.getDeviceInfo(host);
                
                // Avoid duplicates
                if (!devices.find(d => d.host === host)) {
                  devices.push({
                    host,
                    ip: rinfo.address,
                    ...deviceInfo
                  });
                }
              } catch (err) {
                console.error('Error getting device info:', err.message);
              }
            })();
            pendingRequests.push(devicePromise);
          }
        }
      };

      socket.on('message', messageHandler);

      socket.on('error', (err) => {
        if (!isSettled) {
          isSettled = true;
          socket.removeListener('message', messageHandler);
          socket.close();
          reject(err);
        }
      });

      socket.bind(() => {
        try {
          if (isMulticastTarget) {
            socket.addMembership(address);
          }
        } catch (err) {
          // Only warn for failures when using the default SSDP multicast address.
          if (isMulticastTarget && address === RokuClient.SSDP_ADDRESS) {
            console.warn(
              'Failed to join SSDP multicast group - discovery may not work properly:',
              err.message
            );
          }
        }
        socket.send(ssdpMessage, 0, ssdpMessage.length, port, address, (err) => {
          if (err && !isSettled) {
            isSettled = true;
            socket.removeListener('message', messageHandler);
            socket.close();
            reject(err);
          }
        });
      });

      // Wait for responses and all pending device info requests
      setTimeout(async () => {
        if (!isSettled) {
          isSettled = true;
          socket.removeListener('message', messageHandler);
          socket.close();
          
          // Wait for all pending device info requests to complete
          await Promise.allSettled(pendingRequests);
          
          this.devices = devices;
          if (devices.length > 0) {
            this.currentDevice = devices[0];
          }
          resolve(devices);
        }
      }, discoveryTimeout);
    });
  }

  // Get device information
  async getDeviceInfo(host) {
    try {
      const response = await axios.get(`${host}/query/device-info`, {
        timeout: RokuClient.API_TIMEOUT
      });
      
      const parser = new XMLParser();
      const result = parser.parse(response.data);
      
      return {
        friendlyName: result['device-info']?.['friendly-device-name'] || 'Roku Device',
        modelName: result['device-info']?.['model-name'] || 'Unknown',
        serialNumber: result['device-info']?.['serial-number'] || 'Unknown'
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
        timeout: RokuClient.API_TIMEOUT
      });
      
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_'
      });
      const result = parser.parse(response.data);
      
      const apps = [];
      const appList = result.apps?.app || [];
      const appArray = Array.isArray(appList) ? appList : [appList];
      
      for (const app of appArray) {
        apps.push({
          id: app['@_id'],
          name: app['#text'] || app,
          version: app['@_version']
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
        timeout: RokuClient.API_TIMEOUT
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
        timeout: RokuClient.API_TIMEOUT
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

  static isMulticastAddress(address) {
    if (typeof address !== 'string') {
      return false;
    }

    const octets = address.split('.');
    if (octets.length !== 4) {
      return false;
    }

    for (const octet of octets) {
      // Ensure each octet is a decimal integer between 0 and 255
      if (!/^(0|[1-9]\d{0,2})$/.test(octet)) {
        return false;
      }
      const value = Number(octet);
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        return false;
      }
    }

    const firstOctet = Number(octets[0]);
    return firstOctet >= RokuClient.MULTICAST_FIRST_OCTET_MIN &&
      firstOctet <= RokuClient.MULTICAST_FIRST_OCTET_MAX;
  }
}

module.exports = RokuClient;

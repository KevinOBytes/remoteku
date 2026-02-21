const axios = require('axios');
const dgram = require('dgram');
const { XMLParser } = require('fast-xml-parser');

class RokuClient {
  constructor() {
    this.devices = [];
    this.currentDevice = null;
    this.httpClient = axios;
  }

  // SSDP constants
  static SSDP_ADDRESS = '239.255.255.250';
  static SSDP_PORT = 1900;
  static DISCOVERY_TIMEOUT = 3000;
  static API_TIMEOUT = 5000;
  static FALLBACK_SCAN_TIMEOUT = 800;
  static FALLBACK_SCAN_CONCURRENCY = 30;
  static FALLBACK_SCAN_MIN_PREFIX = 24;
  static CONTROL_RETRY_ATTEMPTS = 3;
  static CONTROL_RETRY_DELAY_MS = 150;
  static RETRYABLE_ERROR_CODES = new Set([
    'ECONNABORTED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ETIMEDOUT',
    'ERR_NETWORK',
    'ERR_SOCKET_TIMEOUT'
  ]);
  static MULTICAST_RANGE_START = 224;
  static MULTICAST_RANGE_END = 239;

  // Discover Roku devices on the network using SSDP
  async discoverDevices({
    address = RokuClient.SSDP_ADDRESS,
    port = RokuClient.SSDP_PORT,
    discoveryTimeout = RokuClient.DISCOVERY_TIMEOUT,
    fallbackScan = false,
    fallbackScanTimeout = RokuClient.FALLBACK_SCAN_TIMEOUT,
    fallbackScanConcurrency = RokuClient.FALLBACK_SCAN_CONCURRENCY,
    throwOnPermission = false
  } = {}) {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const validInterfaces = [];
    let permissionDenied = false;

    console.log('RokuClient: Starting discovery...');

    // Gather all valid IPv4 interfaces (non-internal)
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name]) {
        if (RokuClient.isIPv4Family(net.family) && !net.internal) {
          validInterfaces.push({ name, address: net.address });
          console.log(`RokuClient: Found interface ${name} (${net.address})`);
        }
      }
    }

    // If no specific interfaces found, fall back to default binding (0.0.0.0)
    if (validInterfaces.length === 0) {
      console.warn('RokuClient: No valid external IPv4 interfaces found. Falling back to default binding.');
      validInterfaces.push({ name: 'default', address: '0.0.0.0' });
    }

    // Helper to run discovery on a single interface IP
    const discoverOnInterface = (interfaceIp) => {
      return new Promise((resolve, reject) => {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        const softErrorCodes = new Set(['EACCES', 'EPERM', 'EADDRINUSE', 'EHOSTUNREACH', 'ENETUNREACH']);
        let isSettled = false;

        const foundDevices = [];
        const pendingProbes = [];

        const ssdpMessage = Buffer.from(
          'M-SEARCH * HTTP/1.1\r\n' +
          `HOST: ${address}:${port}\r\n` +
          'MAN: "ssdp:discover"\r\n' +
          'MX: 3\r\n' +
          'ST: roku:ecp\r\n\r\n'
        );

        const cleanup = () => {
          if (!isSettled) {
            isSettled = true;
            try {
              socket.close();
              console.log(`RokuClient: Socket closed for ${interfaceIp}`);
            } catch (e) {
              console.error(`RokuClient: Error closing socket for ${interfaceIp}:`, e);
            }
          }
        };

        const messageHandler = (msg, rinfo) => {
          const message = msg.toString();
          console.log(`RokuClient: Received message on ${interfaceIp} from ${rinfo.address}`);
          const parsed = RokuClient.parseSsdpResponse(message);
          if (!parsed?.location) {
            return;
          }

          let host;
          try {
            const url = new URL(parsed.location);
            host = `${url.protocol}//${url.host}`;
          } catch (error) {
            console.warn(`RokuClient: Ignoring invalid LOCATION "${parsed.location}"`);
            return;
          }

          if (foundDevices.some(d => d.host === host)) {
            return;
          }

          const probePromise = (async () => {
            try {
              console.log(`RokuClient: Fetching device info for ${host} (2s timeout)`);
              let deviceInfo;
              try {
                deviceInfo = await this.getDeviceInfo(host, { timeout: 2000 });
              } catch (e) {
                console.warn(`RokuClient: Probe failed for ${host}, using defaults:`, e.message);
                deviceInfo = {
                  friendlyName: 'Roku Device',
                  modelName: 'Unknown',
                  serialNumber: 'Unknown',
                  supportsAudioVolumeControl: null,
                  volume: null,
                  muted: null
                };
              }
              console.log(`RokuClient: Found device ${host} (${deviceInfo.friendlyName})`);
              if (!foundDevices.some(d => d.host === host)) {
                foundDevices.push({
                  host,
                  ip: rinfo.address,
                  ...deviceInfo
                });
              }
            } catch (e) {
              console.warn(`RokuClient: Failed to process device info for ${host}: ${e.message}`);
            }
          })();
          pendingProbes.push(probePromise);
        };

        socket.on('message', messageHandler);

        socket.on('error', (err) => {
          if (err?.code === 'EACCES' || err?.code === 'EPERM') {
            permissionDenied = true;
          }
          if (softErrorCodes.has(err?.code)) {
            console.warn(`RokuClient: Socket error on ${interfaceIp} (soft):`, err.message);
            cleanup();
            resolve([]);
          } else {
            console.warn(`RokuClient: Socket error on ${interfaceIp}:`, err.message);
            cleanup();
            resolve([]);
          }
        });

        console.log(`RokuClient: Binding socket to ${interfaceIp}...`);
        socket.bind(0, interfaceIp, () => {
          console.log(`RokuClient: Socket bound to ${interfaceIp}. Configuring socket...`);
          try {
            if (typeof socket.setBroadcast === 'function') {
              socket.setBroadcast(true);
            }
            if (typeof socket.setMulticastTTL === 'function') {
              socket.setMulticastTTL(2);
            }
            if (typeof socket.setMulticastLoopback === 'function') {
              socket.setMulticastLoopback(true);
            }
            if (RokuClient.isMulticastAddress(address)) {
              // Note: Multicast membership (addMembership) and interface selection
              // (setMulticastInterface) are intentionally omitted for ACTIVE discovery.
              // On macOS in an Electron context, binding to a random port and calling
              // addMembership can result in EHOSTUNREACH errors when sending M-SEARCH.
            }
          } catch (e) {
            console.warn(`RokuClient: Socket config failed on ${interfaceIp}:`, e.message);
          }

          console.log(`RokuClient: Sending M-SEARCH on ${interfaceIp}...`);
          socket.send(ssdpMessage, 0, ssdpMessage.length, port, address, (err) => {
            if (err) {
              if (err?.code === 'EACCES' || err?.code === 'EPERM') {
                permissionDenied = true;
              }
              if (softErrorCodes.has(err?.code)) {
                console.warn(`RokuClient: Send error on ${interfaceIp} (soft):`, err.message);
                cleanup();
                resolve([]);
                return;
              }
              console.warn(`RokuClient: Send error on ${interfaceIp}:`, err.message);
              cleanup();
              resolve([]);
            } else {
              console.log(`RokuClient: M-SEARCH sent on ${interfaceIp}`);
            }
          });
        });

        setTimeout(async () => {
          cleanup();
          console.log(`RokuClient: SSDP timeout on ${interfaceIp}. Waiting for ${pendingProbes.length} pending probes...`);
          await Promise.allSettled(pendingProbes);
          console.log(`RokuClient: All probes finished on ${interfaceIp}. Found ${foundDevices.length} devices.`);
          resolve(foundDevices);
        }, discoveryTimeout);
      });
    };

    try {
      console.log('RokuClient: Invoking parallel discovery...');
      const allResults = await Promise.all(
        validInterfaces.map(iface => discoverOnInterface(iface.address))
      );
      console.log('RokuClient: Parallel discovery finished.');

      const uniqueDevices = new Map();
      allResults.flat().forEach(device => {
        if (!uniqueDevices.has(device.host)) {
          uniqueDevices.set(device.host, device);
        }
      });

      let devices = Array.from(uniqueDevices.values());
      console.log(`RokuClient: Total unique devices found: ${devices.length}`);

      if (devices.length === 0 && fallbackScan) {
        console.log('RokuClient: SSDP found no devices. Starting fallback subnet scan...');
        const fallbackResult = await this.scanLocalSubnetsForRoku({
          timeout: fallbackScanTimeout,
          concurrency: fallbackScanConcurrency
        });
        const fallbackDevices = Array.isArray(fallbackResult?.devices) ? fallbackResult.devices : [];
        if (fallbackResult?.permissionDenied) {
          permissionDenied = true;
        }
        for (const device of fallbackDevices) {
          if (!uniqueDevices.has(device.host)) {
            uniqueDevices.set(device.host, device);
          }
        }
        devices = Array.from(uniqueDevices.values());
        console.log(`RokuClient: Fallback scan found ${fallbackDevices.length} devices.`);
      }

      this.devices = devices;
      this.currentDevice = devices.length > 0 ? devices[0] : null;

      if (devices.length === 0 && permissionDenied && throwOnPermission) {
        const error = new Error('Local network access blocked');
        error.code = 'EACCES';
        throw error;
      }

      return devices;
    } catch (err) {
      console.error('RokuClient: Critical error during discovery:', err);
      if (throwOnPermission && (err?.code === 'EACCES' || err?.code === 'EPERM')) {
        throw err;
      }
      return [];
    }
  }

  // Add or update a device in the list and set it as current
  addDevice(device) {
    if (!device || !device.host) {
      return null;
    }

    const existingIndex = this.devices.findIndex(item => item.host === device.host);
    if (existingIndex >= 0) {
      this.devices[existingIndex] = {
        ...this.devices[existingIndex],
        ...device
      };
      this.currentDevice = this.devices[existingIndex];
    } else {
      this.devices.push(device);
      this.currentDevice = device;
    }

    return this.currentDevice;
  }

  async probeDeviceInfo(host, { timeout } = {}) {
    const effectiveTimeout = typeof timeout === 'number' ? timeout : RokuClient.API_TIMEOUT;
    const response = await this.httpClient.get(`${host}/query/device-info`, {
      timeout: effectiveTimeout
    });

    const parser = new XMLParser();
    const result = parser.parse(response.data);
    const deviceInfo = result['device-info'] || {};

    return {
      friendlyName: deviceInfo['friendly-device-name'] || deviceInfo['user-device-name'] || 'Roku Device',
      modelName: deviceInfo['model-name'] || 'Unknown',
      serialNumber: deviceInfo['serial-number'] || 'Unknown',
      supportsAudioVolumeControl: RokuClient.parseBoolean(deviceInfo['supports-audio-volume-control']),
      volume: RokuClient.parseNumber(
        deviceInfo.volume ??
        deviceInfo['audio-volume'] ??
        deviceInfo['volume-level']
      ),
      muted: RokuClient.parseBoolean(
        deviceInfo['is-muted'] ??
        deviceInfo['volume-muted'] ??
        deviceInfo.muted ??
        deviceInfo['audio-muted']
      )
    };
  }

  // Get device information (best-effort, returns defaults on failure)
  async getDeviceInfo(host, options = {}) {
    try {
      return await this.probeDeviceInfo(host, options);
    } catch (error) {
      return {
        friendlyName: 'Roku Device',
        modelName: 'Unknown',
        serialNumber: 'Unknown',
        supportsAudioVolumeControl: null,
        volume: null,
        muted: null
      };
    }
  }

  // Get installed apps
  async getApps() {
    if (!this.currentDevice) {
      throw new Error('No device selected');
    }

    try {
      const response = await this.httpClient.get(`${this.currentDevice.host}/query/apps`, {
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
        if (!app) {
          continue;
        }

        if (typeof app === 'string') {
          const appName = app.trim();
          if (!appName) {
            continue;
          }
          apps.push({
            id: undefined,
            name: appName,
            version: undefined
          });
          continue;
        }

        if (typeof app !== 'object') {
          continue;
        }

        const appId = app['@_id'];
        const appNameRaw = app['#text'];
        const appName = typeof appNameRaw === 'string' ? appNameRaw.trim() : '';

        if (!appId && !appName) {
          continue;
        }

        apps.push({
          id: appId,
          name: appName || 'Unknown App',
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

    return await this.postWithRetry(`/launch/${appId}`, `launching app ${appId}`);
  }

  // Send key press command
  async sendKey(key) {
    if (!this.currentDevice) {
      throw new Error('No device selected');
    }

    return await this.postWithRetry(`/keypress/${key}`, `sending key ${key}`);
  }

  async postWithRetry(endpoint, actionLabel) {
    let lastError = null;

    for (let attempt = 1; attempt <= RokuClient.CONTROL_RETRY_ATTEMPTS; attempt += 1) {
      try {
        await this.httpClient.post(`${this.currentDevice.host}${endpoint}`, null, {
          timeout: RokuClient.API_TIMEOUT
        });
        return true;
      } catch (error) {
        lastError = error;
        const retryable = RokuClient.isRetryableError(error);
        if (!retryable || attempt === RokuClient.CONTROL_RETRY_ATTEMPTS) {
          break;
        }
        await RokuClient.delay(RokuClient.CONTROL_RETRY_DELAY_MS * attempt);
      }
    }

    console.error(`Error ${actionLabel}:`, lastError?.message || 'Unknown error');
    return false;
  }

  static isRetryableError(error) {
    const code = error?.code;
    if (code && RokuClient.RETRYABLE_ERROR_CODES.has(code)) {
      return true;
    }

    const status = error?.response?.status;
    if (typeof status === 'number' && status >= 500) {
      return true;
    }

    const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
    return message.includes('timeout') ||
      message.includes('network') ||
      message.includes('socket hang up');
  }

  static delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    return firstOctet >= RokuClient.MULTICAST_RANGE_START &&
      firstOctet <= RokuClient.MULTICAST_RANGE_END;
  }

  static isIPv4Family(family) {
    return family === 'IPv4' || family === 4;
  }

  static parseSsdpResponse(message) {
    if (typeof message !== 'string') {
      return null;
    }

    const headers = {};
    for (const line of message.split(/\r?\n/)) {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim().toLowerCase();
      const value = line.slice(separatorIndex + 1).trim();
      headers[key] = value;
    }

    const stHeader = headers.st ? headers.st.toLowerCase() : '';
    const usnHeader = headers.usn ? headers.usn.toLowerCase() : '';
    if (!stHeader.includes('roku:ecp') && !usnHeader.includes('roku:ecp')) {
      return null;
    }

    if (!headers.location) {
      return null;
    }

    return {
      location: headers.location
    };
  }

  static parseBoolean(value) {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
    return null;
  }

  static parseNumber(value) {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  static isPrivateIPv4(address) {
    const value = RokuClient.ipToInt(address);
    if (value === null) {
      return false;
    }
    const first = (value >>> 24) & 0xff;
    const second = (value >>> 16) & 0xff;
    if (first === 10) {
      return true;
    }
    if (first === 172 && second >= 16 && second <= 31) {
      return true;
    }
    if (first === 192 && second === 168) {
      return true;
    }
    return false;
  }

  static ipToInt(address) {
    if (typeof address !== 'string') {
      return null;
    }
    const octets = address.split('.');
    if (octets.length !== 4) {
      return null;
    }
    let value = 0;
    for (const octet of octets) {
      if (!/^(0|[1-9]\d{0,2})$/.test(octet)) {
        return null;
      }
      const number = Number(octet);
      if (!Number.isInteger(number) || number < 0 || number > 255) {
        return null;
      }
      value = (value << 8) + number;
    }
    return value >>> 0;
  }

  static intToIp(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }
    return [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff
    ].join('.');
  }

  static netmaskToPrefix(netmask) {
    const maskValue = RokuClient.ipToInt(netmask);
    if (maskValue === null) {
      return null;
    }
    let prefix = 0;
    for (let bit = 31; bit >= 0; bit -= 1) {
      if ((maskValue >>> bit) & 1) {
        prefix += 1;
      } else {
        break;
      }
    }
    return prefix;
  }

  static prefixToMaskInt(prefix) {
    if (typeof prefix !== 'number' || prefix <= 0) {
      return 0;
    }
    if (prefix >= 32) {
      return 0xffffffff;
    }
    return (0xffffffff << (32 - prefix)) >>> 0;
  }

  static mapWithConcurrency(items, concurrency, worker) {
    if (!Array.isArray(items) || items.length === 0) {
      return Promise.resolve([]);
    }
    const limit = Math.max(1, Math.min(concurrency || 1, items.length));
    const results = [];
    let cursor = 0;

    const runWorker = async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        const item = items[index];
        try {
          const result = await worker(item, index);
          if (result) {
            results.push(result);
          }
        } catch (error) {
          // Ignore per-item errors
        }
      }
    };

    const workers = Array.from({ length: limit }, runWorker);
    return Promise.all(workers).then(() => results);
  }

  async scanLocalSubnetsForRoku({ timeout, concurrency } = {}) {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const subnets = [];
    const seen = new Set();
    const minPrefix = RokuClient.FALLBACK_SCAN_MIN_PREFIX;

    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name]) {
        if (!RokuClient.isIPv4Family(net.family) || net.internal) {
          continue;
        }

        let prefix = null;
        if (typeof net.cidr === 'string') {
          const parts = net.cidr.split('/');
          if (parts.length === 2) {
            const parsed = Number(parts[1]);
            if (Number.isFinite(parsed)) {
              prefix = parsed;
            }
          }
        }
        if (prefix === null && typeof net.netmask === 'string') {
          prefix = RokuClient.netmaskToPrefix(net.netmask);
        }
        if (prefix === null || !Number.isFinite(prefix)) {
          prefix = minPrefix;
        }

        const effectivePrefix = Math.max(prefix, minPrefix);
        const maskInt = RokuClient.prefixToMaskInt(effectivePrefix);
        const ipInt = RokuClient.ipToInt(net.address);
        if (ipInt === null) {
          continue;
        }
        const networkInt = ipInt & maskInt;
        const broadcastInt = networkInt | (~maskInt >>> 0);
        const key = `${networkInt}/${effectivePrefix}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        subnets.push({
          name,
          address: net.address,
          ipInt,
          networkInt,
          broadcastInt,
          prefix: effectivePrefix
        });
      }
    }

    if (subnets.length === 0) {
      console.log('RokuClient: No IPv4 subnets available for fallback scan.');
      return { devices: [], permissionDenied: false };
    }

    const targets = [];
    for (const subnet of subnets) {
      for (let current = subnet.networkInt + 1; current < subnet.broadcastInt; current += 1) {
        if (current === subnet.ipInt) {
          continue;
        }
        const ip = RokuClient.intToIp(current);
        if (ip) {
          targets.push(ip);
        }
      }
    }

    if (targets.length === 0) {
      return { devices: [], permissionDenied: false };
    }

    const scanTimeout = typeof timeout === 'number' ? timeout : RokuClient.FALLBACK_SCAN_TIMEOUT;
    const scanConcurrency = typeof concurrency === 'number' ? concurrency : RokuClient.FALLBACK_SCAN_CONCURRENCY;

    console.log(`RokuClient: Fallback scan probing ${targets.length} hosts...`);

    let permissionDenied = false;
    const found = await RokuClient.mapWithConcurrency(targets, scanConcurrency, async (ip) => {
      const host = `http://${ip}:8060`;
      try {
        const info = await this.probeDeviceInfo(host, { timeout: scanTimeout });
        return {
          host,
          ip,
          ...info
        };
      } catch (error) {
        if (error?.code === 'EACCES' || error?.code === 'EPERM') {
          permissionDenied = true;
        }
        return null;
      }
    });

    return { devices: found, permissionDenied };
  }
}

module.exports = RokuClient;

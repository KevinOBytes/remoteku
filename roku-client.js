const axios = require('axios');
const dgram = require('dgram');
const { XMLParser } = require('fast-xml-parser');

class RokuClient {
  constructor() {
    this.devices = [];
    this.currentDevice = null;
    this.httpClient = axios.create({ proxy: false });
    this.iconCache = new Map();
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
  static TEXT_CHAR_DELAY_MS = 35;
  static VIRTUAL_INTERFACE_PREFIXES = [
    'utun',
    'bridge',
    'awdl',
    'llw',
    'vmenet',
    'vmnet',
    'vboxnet',
    'docker',
    'veth',
    'lo',
    'gif',
    'stf',
    'ap',
    'tap',
    'tun',
    'wg',
    'tailscale'
  ];
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
    bindAddress = null,
    discoveryTimeout = RokuClient.DISCOVERY_TIMEOUT,
    fallbackScan = false,
    fallbackScanTimeout = RokuClient.FALLBACK_SCAN_TIMEOUT,
    fallbackScanConcurrency = RokuClient.FALLBACK_SCAN_CONCURRENCY,
    throwOnPermission = false,
    keepCurrentOnEmpty = false
  } = {}) {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const validInterfaces = [];
    let permissionDenied = false;

    console.log('RokuClient: Starting discovery...');

    if (bindAddress) {
      validInterfaces.push({ name: 'custom', address: bindAddress });
    } else {
      // Gather all valid IPv4 interfaces (non-internal)
      const interfaceNames = Object.keys(interfaces);
      const hasPhysicalInterface = interfaceNames.some((name) => {
        if (RokuClient.isVirtualInterfaceName(name)) {
          return false;
        }
        return (interfaces[name] || []).some(
          (net) => RokuClient.isIPv4Family(net.family) && !net.internal
        );
      });

      for (const name of interfaceNames) {
        if (hasPhysicalInterface && RokuClient.isVirtualInterfaceName(name)) {
          continue;
        }
        for (const net of interfaces[name]) {
          if (RokuClient.isIPv4Family(net.family) && !net.internal) {
            validInterfaces.push({ name, address: net.address });
            console.log(`RokuClient: Found interface ${name} (${net.address})`);
          }
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
          'MX: 1\r\n' +
          'ST: roku:ecp\r\n\r\n'
        );
        let retryTimer = null;

        const cleanup = () => {
          if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
          }
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
            if (RokuClient.isMulticastAddress(address) && interfaceIp !== '0.0.0.0') {
              if (typeof socket.setMulticastInterface === 'function') {
                socket.setMulticastInterface(interfaceIp);
              }
            }
          } catch (e) {
            console.warn(`RokuClient: Socket config failed on ${interfaceIp}:`, e.message);
          }

          console.log(`RokuClient: Sending M-SEARCH on ${interfaceIp}...`);
          socket.send(ssdpMessage, 0, ssdpMessage.length, port, address, (err) => {
            if (err) {
              // macOS Local Network Privacy surfaces blocked multicast sends as
              // EHOSTUNREACH/ENETUNREACH (multicast never needs ARP resolution).
              const blockedMulticast = RokuClient.isMulticastAddress(address) &&
                (err?.code === 'EHOSTUNREACH' || err?.code === 'ENETUNREACH');
              if (err?.code === 'EACCES' || err?.code === 'EPERM' || blockedMulticast) {
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
              if (discoveryTimeout >= 1000) {
                const retryDelay = Math.min(600, Math.floor(discoveryTimeout / 3));
                retryTimer = setTimeout(() => {
                  if (!isSettled && foundDevices.length === 0) {
                    try {
                      socket.send(ssdpMessage, 0, ssdpMessage.length, port, address);
                    } catch (_e) {
                      // Ignore retry send error
                    }
                  }
                }, retryDelay);
              }
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

      if (devices.length === 0 && keepCurrentOnEmpty && this.currentDevice) {
        if (!this.devices.some((d) => d.host === this.currentDevice.host)) {
          this.devices = [this.currentDevice, ...this.devices];
        }
      } else {
        this.devices = devices;
        this.currentDevice = devices.length > 0 ? devices[0] : null;
      }

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
      udn: deviceInfo.udn ? String(deviceInfo.udn) : null,
      isTv: RokuClient.parseBoolean(deviceInfo['is-tv']),
      powerMode: deviceInfo['power-mode'] ? String(deviceInfo['power-mode']) : null,
      supportsFindRemote: RokuClient.parseBoolean(deviceInfo['supports-find-remote']),
      softwareVersion:
        deviceInfo['software-version'] !== undefined && deviceInfo['software-version'] !== null
          ? String(deviceInfo['software-version'])
          : null,
      networkType: deviceInfo['network-type'] ? String(deviceInfo['network-type']) : null,
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
        udn: null,
        isTv: null,
        powerMode: null,
        supportsFindRemote: null,
        softwareVersion: null,
        networkType: null,
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

  // Send key down command (for hold-to-repeat / continuous press)
  async keyDown(key) {
    if (!this.currentDevice) {
      throw new Error('No device selected');
    }

    return await this.postWithRetry(`/keydown/${key}`, `sending keyDown ${key}`);
  }

  // Send key up command (releases held key)
  async keyUp(key) {
    if (!this.currentDevice) {
      throw new Error('No device selected');
    }

    return await this.postWithRetry(`/keyup/${key}`, `sending keyUp ${key}`);
  }

  // Encode a single character for Roku ECP /keypress/Lit_<char>
  static encodeLiteralKey(char) {
    const str = String(char ?? '');
    if (!str) {
      return 'Lit_';
    }
    if (/^[A-Za-z0-9]$/.test(str)) {
      return `Lit_${str}`;
    }
    const encoded = Array.from(Buffer.from(str, 'utf8'))
      .map((byte) => `%${byte.toString(16).padStart(2, '0').toUpperCase()}`)
      .join('');
    return `Lit_${encoded}`;
  }

  // Send a string of text character-by-character using Lit_ keypresses
  async sendText(text, { charDelayMs = RokuClient.TEXT_CHAR_DELAY_MS } = {}) {
    if (!this.currentDevice) {
      throw new Error('No device selected');
    }
    if (typeof text !== 'string' || text.length === 0) {
      return false;
    }

    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i += 1) {
      const litKey = RokuClient.encodeLiteralKey(chars[i]);
      const ok = await this.sendKey(litKey);
      if (!ok) {
        return false;
      }
      if (charDelayMs > 0 && i < chars.length - 1) {
        await RokuClient.delay(charDelayMs);
      }
    }
    return true;
  }

  // Fetch an app's icon as a cached base64 data URI
  async getAppIcon(appId) {
    if (!this.currentDevice || !appId) {
      return null;
    }

    const cacheKey = `${this.currentDevice.host}:${appId}`;
    if (this.iconCache.has(cacheKey)) {
      return this.iconCache.get(cacheKey);
    }

    try {
      const response = await this.httpClient.get(
        `${this.currentDevice.host}/query/icon/${encodeURIComponent(appId)}`,
        {
          timeout: RokuClient.API_TIMEOUT,
          responseType: 'arraybuffer'
        }
      );

      if (!response?.data) {
        return null;
      }

      const rawContentType = response.headers?.['content-type'] || 'image/png';
      const mimeType = String(rawContentType).split(';')[0].trim() || 'image/png';
      const base64 = Buffer.from(response.data).toString('base64');
      if (!base64) {
        return null;
      }

      const dataUri = `data:${mimeType};base64,${base64}`;
      this.iconCache.set(cacheKey, dataUri);
      return dataUri;
    } catch (error) {
      return null;
    }
  }

  // Query the currently active app / channel on the Roku
  async getActiveApp() {
    if (!this.currentDevice) {
      throw new Error('No device selected');
    }

    try {
      const response = await this.httpClient.get(`${this.currentDevice.host}/query/active-app`, {
        timeout: RokuClient.API_TIMEOUT
      });

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_'
      });
      const result = parser.parse(response.data);
      const root = result?.['active-app'] || {};

      const parseNode = (node) => {
        if (!node) return null;
        if (typeof node === 'string') {
          return { id: null, name: node.trim() || 'Roku' };
        }
        if (typeof node === 'object') {
          const name = typeof node['#text'] === 'string' ? node['#text'].trim() : '';
          return {
            id: node['@_id'] ? String(node['@_id']) : null,
            name: name || 'Roku',
            type: node['@_type'] ? String(node['@_type']) : undefined,
            version: node['@_version'] ? String(node['@_version']) : undefined
          };
        }
        return null;
      };

      const rawApp = parseNode(root.app);
      const rawScreensaver = parseNode(root.screensaver);

      return {
        app: rawApp,
        screensaver: rawScreensaver
          ? { id: rawScreensaver.id, name: rawScreensaver.name }
          : null
      };
    } catch (error) {
      return { app: null, screensaver: null };
    }
  }

  // Query live media player state (play/pause, position, duration)
  async getMediaPlayer() {
    if (!this.currentDevice) {
      throw new Error('No device selected');
    }

    try {
      const response = await this.httpClient.get(`${this.currentDevice.host}/query/media-player`, {
        timeout: RokuClient.API_TIMEOUT
      });

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_'
      });
      const result = parser.parse(response.data);
      const player = result?.player || {};
      const state = String(player['@_state'] || 'none').toLowerCase();

      return {
        state,
        isPaused: state === 'pause',
        positionMs: RokuClient.parseDurationMs(player.position),
        durationMs: RokuClient.parseDurationMs(player.duration),
        pluginName: player.plugin?.['@_name'] ? String(player.plugin['@_name']) : null
      };
    } catch (error) {
      return {
        state: 'none',
        isPaused: false,
        positionMs: null,
        durationMs: null,
        pluginName: null
      };
    }
  }

  // Combined Now Playing snapshot (active app + media player state)
  async getNowPlaying() {
    if (!this.currentDevice) {
      throw new Error('No device selected');
    }

    const [active, media] = await Promise.all([
      this.getActiveApp(),
      this.getMediaPlayer()
    ]);

    return {
      activeApp: active?.app || null,
      screensaver: active?.screensaver || null,
      media: media || null
    };
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

  static parseDurationMs(value) {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? Math.round(value) : null;
    }
    const raw = typeof value === 'object' && value['#text'] !== undefined
      ? String(value['#text'])
      : String(value);
    const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s)?$/i);
    if (!match) {
      return null;
    }
    const num = Number(match[1]);
    if (!Number.isFinite(num)) {
      return null;
    }
    const unit = (match[2] || 'ms').toLowerCase();
    return unit === 's' ? Math.round(num * 1000) : Math.round(num);
  }

  static isVirtualInterfaceName(name) {
    if (typeof name !== 'string' || !name.trim()) {
      return false;
    }
    const normalized = name.trim().toLowerCase();
    return RokuClient.VIRTUAL_INTERFACE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
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

    const interfaceNames = Object.keys(interfaces);
    const hasPhysicalInterface = interfaceNames.some((name) => {
      if (RokuClient.isVirtualInterfaceName(name)) {
        return false;
      }
      return (interfaces[name] || []).some(
        (net) => RokuClient.isIPv4Family(net.family) && !net.internal
      );
    });

    for (const name of interfaceNames) {
      if (hasPhysicalInterface && RokuClient.isVirtualInterfaceName(name)) {
        continue;
      }
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

    const arpIps = RokuClient.getArpTableIps();
    const priorityTargets = [];
    const remainingTargets = [];
    for (const ip of targets) {
      if (arpIps.has(ip)) {
        priorityTargets.push(ip);
      } else {
        remainingTargets.push(ip);
      }
    }

    let permissionDenied = false;
    const probeIp = async (ip) => {
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
    };

    if (priorityTargets.length > 0) {
      console.log(`RokuClient: Probing ${priorityTargets.length} ARP-cached hosts first...`);
      const priorityFound = await RokuClient.mapWithConcurrency(priorityTargets, scanConcurrency, probeIp);
      if (priorityFound.length > 0) {
        return { devices: priorityFound, permissionDenied };
      }
    }

    const found = await RokuClient.mapWithConcurrency(remainingTargets, scanConcurrency, probeIp);

    return { devices: found, permissionDenied };
  }

  static getArpTableIps() {
    try {
      const { execFileSync } = require('child_process');
      const arpCmd = process.platform === 'darwin' ? '/usr/sbin/arp' : 'arp';
      const output = execFileSync(arpCmd, ['-an'], {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const ips = new Set();
      const lines = output.split(/\r?\n/);
      for (const line of lines) {
        if (!line || line.includes('(incomplete)') || line.includes('permanent')) {
          continue;
        }
        const match = line.match(/\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([0-9a-fA-F:]+)/);
        if (match && match[1]) {
          ips.add(match[1]);
        }
      }
      return ips;
    } catch (_error) {
      return new Set();
    }
  }
}

module.exports = RokuClient;

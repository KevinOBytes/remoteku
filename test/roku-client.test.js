const assert = require('node:assert/strict');
const test = require('node:test');
const dgram = require('dgram');
const http = require('http');
const os = require('os');
const RokuClient = require('../roku-client');

test('discoverDevices finds Roku device and supports basic control', async (t) => {
  const udpServer = dgram.createSocket('udp4');
  const launches = [];
  const keypresses = [];

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/query/device-info') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end('<device-info><friendly-device-name>Mock Roku</friendly-device-name><model-name>MockModel</model-name><serial-number>12345</serial-number></device-info>');
      return;
    }

    if (req.url === '/query/apps') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end('<apps><app id="1" version="1.0">Netflix</app></apps>');
      return;
    }

    if (req.url.startsWith('/launch/')) {
      launches.push(req.url.replace('/launch/', ''));
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url.startsWith('/keypress/')) {
      keypresses.push(req.url.replace('/keypress/', ''));
      res.writeHead(200);
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => udpServer.bind(0, '127.0.0.1', resolve));

  const httpPort = httpServer.address().port;
  const httpHost = `http://127.0.0.1:${httpPort}`;

  udpServer.on('message', (msg, rinfo) => {
    const message = msg.toString();
    if (!message.includes('M-SEARCH') || !message.toLowerCase().includes('roku:ecp')) {
      return;
    }

    const response = Buffer.from(
      'HTTP/1.1 200 OK\r\n' +
      'CACHE-CONTROL: max-age=300\r\n' +
      'EXT: \r\n' +
      `LOCATION: ${httpHost}\r\n` +
      'ST: roku:ecp\r\n' +
      'USN: uuid:roku:ecp:mock\r\n\r\n'
    );

    udpServer.send(response, 0, response.length, rinfo.port, rinfo.address);
  });

  t.after(async () => {
    await Promise.all([
      new Promise((resolve) => udpServer.close(resolve)),
      new Promise((resolve) => httpServer.close(resolve))
    ]);
  });

  const client = new RokuClient();
  const devices = await client.discoverDevices({
    address: '127.0.0.1',
    port: udpServer.address().port,
    discoveryTimeout: 200
  });

  assert.equal(devices.length, 1);
  assert.equal(devices[0].friendlyName, 'Mock Roku');
  assert.equal(devices[0].host, httpHost);
  assert.equal(client.getCurrentDevice().host, httpHost);

  const apps = await client.getApps();
  assert.deepEqual(apps, [{ id: '1', name: 'Netflix', version: '1.0' }]);

  assert.ok(await client.launchApp('1'));
  assert.ok(await client.sendKey('Home'));

  assert.deepEqual(launches, ['1']);
  assert.deepEqual(keypresses, ['Home']);
});

test('discoverDevices returns empty when no devices respond', async () => {
  const client = new RokuClient();
  const devices = await client.discoverDevices({
    address: '127.0.0.1',
    port: 65530,
    discoveryTimeout: 100
  });

  assert.equal(devices.length, 0);
  assert.equal(client.getCurrentDevice(), null);
});

test('discoverDevices adds device even when device-info fails', async (t) => {
  const udpServer = dgram.createSocket('udp4');
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/query/device-info') {
      res.writeHead(500);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => udpServer.bind(0, '127.0.0.1', resolve));

  const httpPort = httpServer.address().port;
  const httpHost = `http://127.0.0.1:${httpPort}`;

  udpServer.on('message', (msg, rinfo) => {
    const message = msg.toString();
    if (!message.includes('M-SEARCH') || !message.toLowerCase().includes('roku:ecp')) {
      return;
    }

    const response = Buffer.from(
      'HTTP/1.1 200 OK\r\n' +
      'CACHE-CONTROL: max-age=300\r\n' +
      'EXT: \r\n' +
      `LOCATION: ${httpHost}\r\n` +
      'ST: roku:ecp\r\n' +
      'USN: uuid:roku:ecp:mock\r\n\r\n'
    );

    udpServer.send(response, 0, response.length, rinfo.port, rinfo.address);
  });

  t.after(async () => {
    await Promise.all([
      new Promise((resolve) => udpServer.close(resolve)),
      new Promise((resolve) => httpServer.close(resolve))
    ]);
  });

  const client = new RokuClient();
  const devices = await client.discoverDevices({
    address: '127.0.0.1',
    port: udpServer.address().port,
    discoveryTimeout: 200
  });

  assert.equal(devices.length, 1);
  assert.equal(devices[0].friendlyName, 'Roku Device');
  assert.equal(devices[0].host, httpHost);
});

test('discoverDevices handles SSDP responses using Unix newlines', async (t) => {
  const udpServer = dgram.createSocket('udp4');
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/query/device-info') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end('<device-info><friendly-device-name>Unix Roku</friendly-device-name><model-name>UnixModel</model-name><serial-number>unix-123</serial-number></device-info>');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => udpServer.bind(0, '127.0.0.1', resolve));

  const httpPort = httpServer.address().port;
  const httpHost = `http://127.0.0.1:${httpPort}`;

  udpServer.on('message', (msg, rinfo) => {
    const message = msg.toString();
    if (!message.includes('M-SEARCH') || !message.toLowerCase().includes('roku:ecp')) {
      return;
    }

    const response = [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=300',
      `LOCATION: ${httpHost}`,
      'ST: roku:ecp',
      'USN: uuid:roku:ecp:unix',
      ''
    ].join('\n');

    const buffer = Buffer.from(response);
    udpServer.send(buffer, 0, buffer.length, rinfo.port, rinfo.address);
  });

  t.after(async () => {
    await Promise.all([
      new Promise((resolve) => udpServer.close(resolve)),
      new Promise((resolve) => httpServer.close(resolve))
    ]);
  });

  const client = new RokuClient();
  const devices = await client.discoverDevices({
    address: '127.0.0.1',
    port: udpServer.address().port,
    discoveryTimeout: 200
  });

  assert.equal(devices.length, 1);
  assert.equal(devices[0].friendlyName, 'Unix Roku');
  assert.equal(devices[0].host, httpHost);
});

test('discoverDevices handles socket permission errors by resolving empty', async () => {
  const client = new RokuClient();
  // Bind to a privileged port to trigger EACCES on many systems without root
  const devices = await client.discoverDevices({
    address: '127.0.0.1',
    port: 1,
    discoveryTimeout: 100
  });
  assert.equal(devices.length, 0);
  assert.equal(client.getCurrentDevice(), null);
});

test('discoverDevices handles send permission errors gracefully', async (t) => {
  // Mock dgram to force a send error with EPERM
  const originalCreateSocket = dgram.createSocket;
  const fakeSocket = {
    on: () => {},
    once: (event, handler) => {
      if (event === 'listening') {
        handler();
      }
    },
    bind: (...args) => {
      const cb = typeof args[2] === 'function' ? args[2] : args[0];
      if (typeof cb === 'function') {
        cb();
      }
    },
    addMembership: () => {},
    setBroadcast: () => {},
    setMulticastLoopback: () => {},
    setMulticastTTL: () => {},
    removeListener: () => {},
    close: () => {},
    send: (_buf, _offset, _length, _port, _address, cb) => {
      const err = new Error('forced send failure');
      err.code = 'EPERM';
      cb(err);
    }
  };

  dgram.createSocket = () => fakeSocket;
  t.after(() => {
    dgram.createSocket = originalCreateSocket;
  });

  const client = new RokuClient();
  const devices = await client.discoverDevices({
    address: '127.0.0.1',
    port: 12345,
    discoveryTimeout: 100
  });

  assert.equal(devices.length, 0);
  assert.equal(client.getCurrentDevice(), null);
});

test('socket configuration errors do not fail discovery', async (t) => {
  // Mock socket methods to throw on config calls but still allow send to succeed
  const originalCreateSocket = dgram.createSocket;
  let sendCalled = false;

  const fakeSocket = {
    on: () => {},
    once: (event, handler) => {
      if (event === 'listening') {
        handler();
      }
    },
    bind: (...args) => {
      const cb = typeof args[2] === 'function' ? args[2] : args[0];
      if (typeof cb === 'function') {
        cb();
      }
    },
    addMembership: () => {},
    setBroadcast: () => {
      throw new Error('broadcast fail');
    },
    setMulticastLoopback: () => {
      throw new Error('loopback fail');
    },
    setMulticastTTL: () => {
      throw new Error('ttl fail');
    },
    removeListener: () => {},
    close: () => {},
    send: (_buf, _offset, _length, _port, _address, cb) => {
      sendCalled = true;
      cb();
    }
  };

  dgram.createSocket = () => fakeSocket;
  t.after(() => {
    dgram.createSocket = originalCreateSocket;
  });

  const client = new RokuClient();
  const devices = await client.discoverDevices({
    address: '127.0.0.1',
    port: 12346,
    discoveryTimeout: 50
  });

  assert.equal(sendCalled, true);
  assert.equal(devices.length, 0);
  assert.equal(client.getCurrentDevice(), null);
});

test('parseSsdpResponse handles edge cases directly', async (t) => {
  await t.test('returns null for empty or non-Roku responses', () => {
    assert.equal(RokuClient.parseSsdpResponse(''), null);
    const nonRoku = [
      'HTTP/1.1 200 OK',
      'ST: upnp:rootdevice',
      'USN: uuid:upnp:rootdevice',
      'LOCATION: http://192.168.1.10:8060',
      ''
    ].join('\r\n');
    assert.equal(RokuClient.parseSsdpResponse(nonRoku), null);
  });

  await t.test('parses Roku ST with location containing colons', () => {
    const response = [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=300',
      'ST: roku:ecp',
      'LOCATION: http://10.0.0.2:8060/query/device-info',
      ''
    ].join('\r\n');
    assert.deepEqual(RokuClient.parseSsdpResponse(response), {
      location: 'http://10.0.0.2:8060/query/device-info'
    });
  });

  await t.test('parses Roku USN even when ST is missing and ignores malformed lines', () => {
    const response = [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=300',
      'USN: uuid:roku:ecp:device',
      ': value without key',
      'LOCATION: http://10.0.0.3:8060',
      'EXTRA without colon',
      ''
    ].join('\n');
    assert.deepEqual(RokuClient.parseSsdpResponse(response), {
      location: 'http://10.0.0.3:8060'
    });
  });

  await t.test('handles headers with multiple colons in values', () => {
    const response = [
      'HTTP/1.1 200 OK',
      'ST: roku:ecp',
      'LOCATION: http://10.0.0.4:8060/path:with:colons',
      ''
    ].join('\r\n');
    assert.deepEqual(RokuClient.parseSsdpResponse(response), {
      location: 'http://10.0.0.4:8060/path:with:colons'
    });
  });

  await t.test('returns null for non-string input', () => {
    assert.equal(RokuClient.parseSsdpResponse(null), null);
    assert.equal(RokuClient.parseSsdpResponse(undefined), null);
    assert.equal(RokuClient.parseSsdpResponse({}), null);
  });
});

test('discoverDevices falls back to default binding when only internal interfaces exist', async (t) => {
  const originalNetworkInterfaces = os.networkInterfaces;
  const originalCreateSocket = dgram.createSocket;
  let boundAddress = null;
  let sendCalled = false;

  os.networkInterfaces = () => ({
    lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }]
  });

  const fakeSocket = {
    on: () => {},
    bind: (_port, address, cb) => {
      boundAddress = address;
      if (typeof cb === 'function') {
        cb();
      }
    },
    send: (_buf, _offset, _length, _port, _address, cb) => {
      sendCalled = true;
      if (typeof cb === 'function') {
        cb();
      }
    },
    close: () => {}
  };

  dgram.createSocket = () => fakeSocket;

  t.after(() => {
    os.networkInterfaces = originalNetworkInterfaces;
    dgram.createSocket = originalCreateSocket;
  });

  const client = new RokuClient();
  const devices = await client.discoverDevices({
    address: '127.0.0.1',
    port: 1900,
    discoveryTimeout: 25
  });

  assert.equal(boundAddress, '0.0.0.0');
  assert.equal(sendCalled, true);
  assert.equal(devices.length, 0);
  assert.equal(client.getCurrentDevice(), null);
});

test('discoverDevices deduplicates identical hosts across interfaces', async (t) => {
  const originalNetworkInterfaces = os.networkInterfaces;
  const originalCreateSocket = dgram.createSocket;
  let infoCalls = 0;

  os.networkInterfaces = () => ({
    eth0: [{ address: '192.168.1.10', family: 'IPv4', internal: false }],
    wlan0: [{ address: '192.168.1.11', family: 'IPv4', internal: false }]
  });

  const sockets = [];
  dgram.createSocket = () => {
    const handlers = {};
    const socket = {
      on: (event, handler) => {
        handlers[event] = handler;
      },
      bind: (_port, _address, cb) => {
        if (typeof cb === 'function') {
          cb();
        }
      },
      send: (_buf, _offset, _length, _port, _address, cb) => {
        if (typeof cb === 'function') {
          cb();
        }
        if (handlers.message) {
          const response = [
            'HTTP/1.1 200 OK',
            'CACHE-CONTROL: max-age=300',
            'ST: roku:ecp',
            'USN: uuid:roku:ecp:device',
            'LOCATION: http://192.168.1.50:8060',
            ''
          ].join('\r\n');
          setImmediate(() => {
            handlers.message(Buffer.from(response), { address: '192.168.1.50' });
          });
        }
      },
      close: () => {}
    };
    sockets.push(socket);
    return socket;
  };

  t.after(() => {
    os.networkInterfaces = originalNetworkInterfaces;
    dgram.createSocket = originalCreateSocket;
  });

  const client = new RokuClient();
  client.getDeviceInfo = async () => {
    infoCalls += 1;
    return {
      friendlyName: 'Mock Roku',
      modelName: 'MockModel',
      serialNumber: 'mock-serial'
    };
  };

  const devices = await client.discoverDevices({
    address: '127.0.0.1',
    port: 1900,
    discoveryTimeout: 50
  });

  assert.equal(sockets.length, 2);
  assert.equal(infoCalls, 2);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].host, 'http://192.168.1.50:8060');
  assert.equal(devices[0].friendlyName, 'Mock Roku');
  assert.equal(client.getCurrentDevice().host, 'http://192.168.1.50:8060');
});

test('discoverDevices ignores SSDP responses without LOCATION headers', async (t) => {
  const originalNetworkInterfaces = os.networkInterfaces;
  const originalCreateSocket = dgram.createSocket;
  let infoCalls = 0;

  os.networkInterfaces = () => ({
    eth0: [{ address: '192.168.1.10', family: 'IPv4', internal: false }]
  });

  dgram.createSocket = () => {
    const handlers = {};
    return {
      on: (event, handler) => {
        handlers[event] = handler;
      },
      bind: (_port, _address, cb) => {
        if (typeof cb === 'function') {
          cb();
        }
      },
      send: (_buf, _offset, _length, _port, _address, cb) => {
        if (typeof cb === 'function') {
          cb();
        }
        if (handlers.message) {
          const response = [
            'HTTP/1.1 200 OK',
            'ST: roku:ecp',
            'USN: uuid:roku:ecp:device',
            ''
          ].join('\r\n');
          setImmediate(() => {
            handlers.message(Buffer.from(response), { address: '192.168.1.50' });
          });
        }
      },
      close: () => {}
    };
  };

  t.after(() => {
    os.networkInterfaces = originalNetworkInterfaces;
    dgram.createSocket = originalCreateSocket;
  });

  const client = new RokuClient();
  client.getDeviceInfo = async () => {
    infoCalls += 1;
    return {
      friendlyName: 'Should Not Be Used',
      modelName: 'Ignored',
      serialNumber: 'ignored'
    };
  };

  const devices = await client.discoverDevices({
    address: '127.0.0.1',
    port: 1900,
    discoveryTimeout: 40
  });

  assert.equal(infoCalls, 0);
  assert.equal(devices.length, 0);
  assert.equal(client.getCurrentDevice(), null);
});

test('isMulticastAddress validates IPv4 multicast ranges', async (t) => {
  await t.test('returns true for multicast addresses', () => {
    assert.equal(RokuClient.isMulticastAddress('224.0.0.1'), true);
    assert.equal(RokuClient.isMulticastAddress('239.255.255.255'), true);
  });

  await t.test('returns false for non-multicast or invalid addresses', () => {
    assert.equal(RokuClient.isMulticastAddress('223.255.255.255'), false);
    assert.equal(RokuClient.isMulticastAddress('240.0.0.0'), false);
    assert.equal(RokuClient.isMulticastAddress('256.0.0.1'), false);
    assert.equal(RokuClient.isMulticastAddress('1.2.3'), false);
    assert.equal(RokuClient.isMulticastAddress('a.b.c.d'), false);
    assert.equal(RokuClient.isMulticastAddress(null), false);
  });
});

test('addDevice upserts and updates current device', () => {
  const client = new RokuClient();
  const first = {
    host: 'http://192.168.1.100:8060',
    ip: '192.168.1.100',
    friendlyName: 'Living Room',
    modelName: 'Roku Ultra',
    serialNumber: 'abc123'
  };

  const second = {
    host: 'http://192.168.1.100:8060',
    ip: '192.168.1.100',
    friendlyName: 'Living Room Updated',
    modelName: 'Roku Ultra',
    serialNumber: 'abc123'
  };

  client.addDevice(first);
  assert.equal(client.getDevices().length, 1);
  assert.equal(client.getCurrentDevice().friendlyName, 'Living Room');

  client.addDevice(second);
  assert.equal(client.getDevices().length, 1);
  assert.equal(client.getCurrentDevice().friendlyName, 'Living Room Updated');
});

test('probeDeviceInfo returns info and throws on failure', async (t) => {
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/query/device-info') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end('<device-info><friendly-device-name>Probe Roku</friendly-device-name><model-name>ProbeModel</model-name><serial-number>probe-123</serial-number><supports-audio-volume-control>true</supports-audio-volume-control><volume>14</volume><is-muted>false</is-muted></device-info>');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const host = `http://127.0.0.1:${httpServer.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
  });

  const client = new RokuClient();
  const info = await client.probeDeviceInfo(host);
  assert.equal(info.friendlyName, 'Probe Roku');
  assert.equal(info.modelName, 'ProbeModel');
  assert.equal(info.serialNumber, 'probe-123');
  assert.equal(info.supportsAudioVolumeControl, true);
  assert.equal(info.volume, 14);
  assert.equal(info.muted, false);

  await assert.rejects(async () => {
    await client.probeDeviceInfo('http://127.0.0.1:65529');
  });
});

test('discoverDevices ignores SSDP responses with invalid LOCATION URLs', async (t) => {
  const originalNetworkInterfaces = os.networkInterfaces;
  const originalCreateSocket = dgram.createSocket;
  let infoCalls = 0;

  os.networkInterfaces = () => ({
    eth0: [{ address: '192.168.1.10', family: 'IPv4', internal: false }]
  });

  dgram.createSocket = () => {
    const handlers = {};
    return {
      on: (event, handler) => {
        handlers[event] = handler;
      },
      bind: (_port, _address, cb) => {
        if (typeof cb === 'function') {
          cb();
        }
      },
      send: (_buf, _offset, _length, _port, _address, cb) => {
        if (typeof cb === 'function') {
          cb();
        }
        if (handlers.message) {
          const response = [
            'HTTP/1.1 200 OK',
            'ST: roku:ecp',
            'USN: uuid:roku:ecp:device',
            'LOCATION: this-is-not-a-valid-url',
            ''
          ].join('\r\n');
          setImmediate(() => {
            handlers.message(Buffer.from(response), { address: '192.168.1.50' });
          });
        }
      },
      close: () => {}
    };
  };

  t.after(() => {
    os.networkInterfaces = originalNetworkInterfaces;
    dgram.createSocket = originalCreateSocket;
  });

  const client = new RokuClient();
  client.getDeviceInfo = async () => {
    infoCalls += 1;
    return {
      friendlyName: 'Should Not Be Used',
      modelName: 'Ignored',
      serialNumber: 'ignored'
    };
  };

  const devices = await client.discoverDevices({
    address: '127.0.0.1',
    port: 1900,
    discoveryTimeout: 40
  });

  assert.equal(infoCalls, 0);
  assert.equal(devices.length, 0);
});

test('launchApp retries transient errors and succeeds', async (t) => {
  const originalRetryAttempts = RokuClient.CONTROL_RETRY_ATTEMPTS;
  const originalRetryDelay = RokuClient.CONTROL_RETRY_DELAY_MS;
  RokuClient.CONTROL_RETRY_ATTEMPTS = 2;
  RokuClient.CONTROL_RETRY_DELAY_MS = 0;

  const client = new RokuClient();
  client.setDevice({ host: 'http://192.168.1.50:8060' });

  let attempts = 0;
  client.httpClient = {
    post: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('timeout');
        error.code = 'ETIMEDOUT';
        throw error;
      }
    }
  };

  t.after(() => {
    RokuClient.CONTROL_RETRY_ATTEMPTS = originalRetryAttempts;
    RokuClient.CONTROL_RETRY_DELAY_MS = originalRetryDelay;
  });

  const launched = await client.launchApp('123');
  assert.equal(launched, true);
  assert.equal(attempts, 2);
});

test('sendKey does not retry non-retryable errors', async (t) => {
  const originalRetryAttempts = RokuClient.CONTROL_RETRY_ATTEMPTS;
  const originalRetryDelay = RokuClient.CONTROL_RETRY_DELAY_MS;
  RokuClient.CONTROL_RETRY_ATTEMPTS = 3;
  RokuClient.CONTROL_RETRY_DELAY_MS = 0;

  const client = new RokuClient();
  client.setDevice({ host: 'http://192.168.1.50:8060' });

  let attempts = 0;
  client.httpClient = {
    post: async () => {
      attempts += 1;
      const error = new Error('bad request');
      error.code = 'ERR_BAD_REQUEST';
      throw error;
    }
  };

  t.after(() => {
    RokuClient.CONTROL_RETRY_ATTEMPTS = originalRetryAttempts;
    RokuClient.CONTROL_RETRY_DELAY_MS = originalRetryDelay;
  });

  const sent = await client.sendKey('Home');
  assert.equal(sent, false);
  assert.equal(attempts, 1);
});

test('getApps skips malformed app entries', async () => {
  const client = new RokuClient();
  client.setDevice({ host: 'http://192.168.1.50:8060' });
  client.httpClient = {
    get: async () => ({
      data: '<apps><app id="1" version="1.0">Netflix</app><app/><app id="2"/></apps>'
    })
  };

  const apps = await client.getApps();
  assert.deepEqual(apps, [
    { id: '1', name: 'Netflix', version: '1.0' },
    { id: '2', name: 'Unknown App', version: undefined }
  ]);
});

test('parseBoolean and parseNumber normalize mixed values', () => {
  assert.equal(RokuClient.parseBoolean('yes'), true);
  assert.equal(RokuClient.parseBoolean('0'), false);
  assert.equal(RokuClient.parseBoolean('unknown'), null);

  assert.equal(RokuClient.parseNumber('12'), 12);
  assert.equal(RokuClient.parseNumber('12.5'), 12.5);
  assert.equal(RokuClient.parseNumber('NaN'), null);
  assert.equal(RokuClient.parseNumber(''), null);
});

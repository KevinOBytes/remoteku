const assert = require('node:assert/strict');
const test = require('node:test');
const dgram = require('dgram');
const http = require('http');
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

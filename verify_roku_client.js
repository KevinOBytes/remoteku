const RokuClient = require('./roku-client');

async function testRokuClient() {
  console.log('Testing RokuClient...');
  const client = new RokuClient();
  try {
    const devices = await client.discoverDevices({ discoveryTimeout: 5000 });
    console.log('Discovered devices:', JSON.stringify(devices, null, 2));
  } catch (err) {
    console.error('Discovery failed:', err);
  }
}

testRokuClient();

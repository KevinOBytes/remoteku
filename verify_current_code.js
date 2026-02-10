const RokuClient = require('./roku-client');

async function testCurrentCode() {
    console.log('Testing current RokuClient implementation...');
    const client = new RokuClient();
    try {
        const devices = await client.discoverDevices({ discoveryTimeout: 5000 });
        console.log('Final Devices Found:', JSON.stringify(devices, null, 2));
    } catch (err) {
        console.error('Discovery Fatal Error:', err);
    }
}

testCurrentCode();

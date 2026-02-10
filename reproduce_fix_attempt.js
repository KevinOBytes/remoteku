const dgram = require('dgram');

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;

function testDiscovery() {
    console.log('Starting discovery (no addMembership)...');
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const message = Buffer.from(
        'M-SEARCH * HTTP/1.1\r\n' +
        `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\n` +
        'MAN: "ssdp:discover"\r\n' +
        'MX: 3\r\n' +
        'ST: roku:ecp\r\n\r\n'
    );

    socket.on('message', (msg, rinfo) => {
        console.log(`Received response from ${rinfo.address}`);
        console.log(msg.toString());
    });

    socket.on('error', (err) => {
        console.error('Socket error:', err);
        socket.close();
    });

    socket.bind(() => {
        console.log('Socket bound');
        socket.send(message, 0, message.length, SSDP_PORT, SSDP_ADDRESS, (err) => {
            if (err) {
                console.error('Send error:', err);
            } else {
                console.log('M-SEARCH sent successfully');
            }
        });
    });

    setTimeout(() => {
        console.log('Timeout reached');
        socket.close();
    }, 5000);
}

testDiscovery();

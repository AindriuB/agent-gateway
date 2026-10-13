// Manual cross-user probe for task 69: node probe.mjs <relay socket path>
// Run it as another user (sudo -u nobody node probe.mjs <socket>); it must be refused with EACCES.
import { connect } from 'node:net';

const path = process.argv[2];
if (!path) {
  console.error('usage: node probe.mjs <relay socket path>');
  process.exit(2);
}
const socket = connect(path);
socket.on('connect', () => {
  console.log('CONNECTED: the relay socket accepted another user (this is a failure)');
  socket.destroy();
  process.exit(1);
});
socket.on('error', (err) => {
  console.log(`refused: ${err.code}`);
  process.exit(err.code === 'EACCES' ? 0 : 3);
});

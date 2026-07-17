/**
 * Pomocniczy serwer SSH w pamięci dla testu E2E (uruchamiany jako osobny proces).
 * Wypisuje na stdout „PORT <n>", akceptuje dowolne hasło, po shellu wysyła powitanie.
 */
import { generateKeyPairSync } from 'node:crypto';
import ssh2 from 'ssh2';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
});

const server = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
  client.on('error', () => {});
  client.on('authentication', (ctx) => ctx.accept());
  client.on('ready', () => {
    client.on('session', (acceptSession) => {
      const session = acceptSession();
      session.on('pty', (accept) => accept?.());
      session.on('shell', (acceptShell) => {
        const stream = acceptShell();
        stream.write('POLACZONO-Z-SERWEREM-TESTOWYM\r\n');
      });
    });
  });
});

server.listen(0, '127.0.0.1', () => {
  console.log(`PORT ${server.address().port}`);
});

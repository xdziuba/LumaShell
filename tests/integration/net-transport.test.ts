/**
 * Testy integracyjne transportów sieciowych (Etap 7).
 *
 * Każdy transport dostaje własny serwer in-memory (TCP/TLS/Telnet/UDP oraz minimalny serwer
 * WebSocket bez zależności) i sprawdzamy pełny obieg bajtów. Filozofia jak w teście SSH:
 * prawdziwy protokół, tylko po localhoście.
 *
 * Uruchomienie: node --experimental-transform-types tests/integration/net-transport.test.ts
 */

import { createServer as createTcpServer } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { createServer as createHttpServer } from 'node:http';
import { createSocket } from 'node:dgram';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { TcpTransport } from '../../src/services/net/tcp-transport.ts';
import { TelnetTransport } from '../../src/services/net/telnet-transport.ts';
import { WebSocketTransport } from '../../src/services/net/websocket-transport.ts';
import { UdpTransport } from '../../src/services/net/udp-transport.ts';
import type { NetworkOptions } from '../../src/core/transports/transport.ts';

// Cert self-signed wygenerowany na potrzeby testu (CN nieistotny — łączymy z insecureTls).
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDl8RkiAEcTWy0+
Am+zOhlqUuo8uDOj9e1m2LA4lPo1oWQphqIOW2JznIi4wm1gulNtTOgwSEpv6aRL
vXHhzUf7Vjbs9hef/uoj92mwiGbdEUOANWRset54ZiJIIguk02pHDzKi3MsJBwre
jcBbz8XqDdwTvcbsRle7HR8oBX4OgAuXbctJW+5VUC77Ne9OuqR2//MrZU9KDuic
QsNqU1ORQopn0qMMuti6hbJ8sicXTrtcFO+T5svrsfrOIPb871bKMekSJPF7CVrg
2DJVZ/GcLVCaToF86zW5u4FG5T7k8cERZTgOlpvzzyZW8I5Qon/PkOX+WOgPLaEG
Oy5bHDKhAgMBAAECggEADjR136N6AJR9P+ONZDpye76lzQy5lvdQPE5mW4Z7ixDe
c9DHBeFIHJmG2jgbovI7yWiq/uGWZKG/xjSMupzwhZK6x6p/xODt9L0Z9L+GcEF6
5KqXurpf8DrqAwAEbWEoo31pPMWsTtFWLu+9moZkRPxodDlA9tN1I8Btrm6hbhKF
uZ/SwpHbjvWU1rgGtXQPfgTzxv998QRndzJKoqQlACAcGflGYtrzX7QZryCDb7dr
8zs8oU6bM+ALio/U61bbSICV82pZQfSv0A/m6ArdBQIzX7vyLqkH3xNdAECIWs6x
2UT3MVzo9MDiA/43TLeSs/A4KTB5jMQcbmYxmA47IQKBgQD2vktNruNqP3JVQFRT
ETjpDP+oe+zDjD/HhGvmb/0bLE/PnnxjY8+7nKzeieXo6jbYFIdFtUIp6J1Hyyq/
hdafonTQY7VxgQgnIS7e2jf8dNuGLuRdb6OS6TiD6lgVecBgFPdKXkz8DPjfORAQ
HPA/Hi+VziURCEnKJQDSTEjnMQKBgQDukXFxOYeYr8tiSGbNxoEQThSBy3EOiO8J
2WfjE3gonemiOUWoyBgIdDLsg+a5kslD0PF5nxSlhcW0c4OCH2qv6IoQU638OQSr
uOnpN28G5+6Uiu5W0eZoa+ldQqfzBrMIYqma/iyY2Vbjn0Pl2am0qpZx64pdZOOW
+99AZvMGcQKBgQCrVdBsjPiVmqEF2bm0RM1D5ybQE92AnC7dmHJkfXdAGzEAdojh
azmgiVbw4MipR5n1yat1GDxtZX1xkP6KJ6G1D9YVrmcb/gFvSneFf/pIb8zQDFe/
Gfp31ULNNzkbEIQpM+XT2k+S5l8agkFJLw8UhR195LuQbDTxDWjYnugwwQKBgHlq
WDvxtYsF3RLWGkwb/M+ZjWJJce6dzlpK5U5yODMjuyYu078EpwaWbNxmfORxSjFT
g7IMPmvHW0ltiL6O0rNYO/v3OpMlSbVD1Pg2mDEBlTDQTGCvTv5R/WDTbbqH7FIW
NI+HUJcx9cC+68VtM6uZLhwobjD+Cb5rzcFvI7xhAoGBAOSd6/SRGbcBDnZtkVOZ
FyRfCIS62dgrGI0p1ps4rPRPTOHj8mH8aWiCPn0/dL/wnkXEBUog529s3y4ZPHeS
YzPix6mC1E5G6cw+A1vHscr0C7VPXmAIBwwGSO2BN9E/SsaBfksdJ1uFDud45Yd7
cxpK7+u+geqDvmfgt7v6xIL/
-----END PRIVATE KEY-----`;

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIC4TCCAcmgAwIBAgIUfU6pIu6vWLXzsOTHnYIiexne1CEwDQYJKoZIhvcNAQEL
BQAwADAeFw0yNjA3MTcyMDAwMzZaFw0zNjA3MTQyMDAwMzZaMAAwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQDl8RkiAEcTWy0+Am+zOhlqUuo8uDOj9e1m
2LA4lPo1oWQphqIOW2JznIi4wm1gulNtTOgwSEpv6aRLvXHhzUf7Vjbs9hef/uoj
92mwiGbdEUOANWRset54ZiJIIguk02pHDzKi3MsJBwrejcBbz8XqDdwTvcbsRle7
HR8oBX4OgAuXbctJW+5VUC77Ne9OuqR2//MrZU9KDuicQsNqU1ORQopn0qMMuti6
hbJ8sicXTrtcFO+T5svrsfrOIPb871bKMekSJPF7CVrg2DJVZ/GcLVCaToF86zW5
u4FG5T7k8cERZTgOlpvzzyZW8I5Qon/PkOX+WOgPLaEGOy5bHDKhAgMBAAGjUzBR
MB0GA1UdDgQWBBQ9yg+7RWyxUxBzi1r1Cd8/mmEEpzAfBgNVHSMEGDAWgBQ9yg+7
RWyxUxBzi1r1Cd8/mmEEpzAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUA
A4IBAQDj2nlo8PJ2s8kA7sXvCJ3Ja8mtW7SByaa53Bvy+L0tMUYdAindnbnukfRt
No9C8x09QGf3+xbhmow9ZTWqxlfA5o5P82RutXqYemRTKfVoC+Xnai8tDe5jtEfm
mg3J72WjLVo0s+2X7a10yMMoGAGNtNkMmLpn/GapbCYbh8cVzReKuMIIblkmT3Vl
U8F8yAju3X74bZU6y5+dgmDwsdJNboZnaEptAxi8FPoZ3wOhQuOgmoYn44pjHEOQ
LCSAGnRds8OaJhBjdxXtzh/2DMese4g9UmJUTW4TXS41dec8PRuYrSpvn3yk3gf3
mdb8teBZ/xSs6CqEDQ08ey8hYx8U
-----END CERTIFICATE-----`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const wyniki: Array<{ n: string; ok: boolean; d?: string }> = [];
const sprawdz = (n: string, ok: boolean, d?: string): void => {
  wyniki.push({ n, ok, d });
};

/** Zbiera bajty emitowane przez transport. */
function collector(): { onData: (d: Uint8Array) => void; bytes: () => Buffer; text: () => string } {
  const chunks: Buffer[] = [];
  return {
    onData: (d) => chunks.push(Buffer.from(d)),
    bytes: () => Buffer.concat(chunks),
    text: () => Buffer.concat(chunks).toString('utf8')
  };
}

const opts = (over: Partial<NetworkOptions>): NetworkOptions => ({
  protocol: 'tcp',
  host: '127.0.0.1',
  port: 0,
  ...over
});

async function main(): Promise<void> {
  // --- TCP: echo ---
  {
    const server = createTcpServer((socket) => socket.on('data', (d) => socket.write(d)));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    const t = new TcpTransport('tcp', opts({ protocol: 'tcp', port }));
    const c = collector();
    t.onData(c.onData);
    await t.connect();
    await t.write('ping-tcp');
    await sleep(150);
    sprawdz('TCP echo dociera', c.text().includes('ping-tcp'), c.text().replace(/\r?\n/g, '␤'));
    await t.disconnect();
    server.close();
  }

  // --- TLS: echo z insecureTls (cert self-signed) ---
  {
    const server = createTlsServer({ key: TEST_KEY, cert: TEST_CERT }, (socket) =>
      socket.on('data', (d) => socket.write(d))
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    const t = new TcpTransport('tls', opts({ protocol: 'tls', port, insecureTls: true }));
    const c = collector();
    t.onData(c.onData);
    await t.connect();
    await t.write('ping-tls');
    await sleep(200);
    sprawdz('TLS echo dociera (self-signed)', c.text().includes('ping-tls'));
    await t.disconnect();
    server.close();
  }

  // --- TLS: bez insecureTls self-signed MUSI zostać odrzucony ---
  {
    const server = createTlsServer({ key: TEST_KEY, cert: TEST_CERT }, (socket) => socket.resume());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    const t = new TcpTransport('tls-strict', opts({ protocol: 'tls', port }));
    let odrzucono = false;
    try {
      await t.connect();
    } catch {
      odrzucono = true;
    }
    sprawdz('TLS bez insecureTls odrzuca self-signed', odrzucono);
    await t.disconnect();
    server.close();
  }

  // --- Telnet: serwer negocjuje IAC, klient odsiewa i odpowiada ---
  {
    const serverGot: Buffer[] = [];
    const server = createTcpServer((socket) => {
      socket.on('data', (d) => serverGot.push(Buffer.from(d)));
      // IAC WILL ECHO, IAC DO SGA, potem czysty tekst.
      socket.write(Buffer.from([255, 251, 1, 255, 253, 3]));
      socket.write(Buffer.from('hello-telnet'));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    const t = new TelnetTransport('telnet', opts({ protocol: 'telnet', port }));
    const c = collector();
    t.onData(c.onData);
    await t.connect();
    await sleep(200);

    const bytes = c.bytes();
    sprawdz('Telnet: czysty tekst dociera', c.text().includes('hello-telnet'));
    // Po odsianiu IAC w strumieniu do terminala nie może być bajtu 0xFF.
    sprawdz('Telnet: brak bajtów IAC w strumieniu', !bytes.includes(0xff));

    const reply = Buffer.concat(serverGot);
    // Odpowiedzi: DO ECHO (255,253,1) oraz WILL SGA (255,251,3).
    const hasSeq = (seq: number[]): boolean => reply.includes(Buffer.from(seq));
    sprawdz('Telnet: odpowiedź DO ECHO', hasSeq([255, 253, 1]), [...reply].join(','));
    sprawdz('Telnet: odpowiedź WILL SGA', hasSeq([255, 251, 3]));
    await t.disconnect();
    server.close();
  }

  // --- UDP: echo datagramów ---
  {
    const server = createSocket('udp4');
    server.on('message', (msg, rinfo) => server.send(msg, rinfo.port, rinfo.address));
    await new Promise<void>((r) => server.bind(0, '127.0.0.1', r));
    const port = server.address().port;

    const t = new UdpTransport('udp', opts({ protocol: 'udp', port }));
    const c = collector();
    t.onData(c.onData);
    await t.connect();
    await t.write('ping-udp');
    await sleep(200);
    sprawdz('UDP echo dociera', c.text().includes('ping-udp'));
    await t.disconnect();
    server.close();
  }

  // --- WebSocket: minimalny serwer echo (handshake + ramki, bez zależności) ---
  {
    const server = createHttpServer();
    server.on('upgrade', (req, socket) => {
      const key = req.headers['sec-websocket-key'] ?? '';
      const accept = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );

      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        // Dekodujemy ramki (klient→serwer są maskowane) i odsyłamy echem bez maski.
        for (;;) {
          if (buf.length < 2) break;
          const opcode = buf[0]! & 0x0f;
          const masked = (buf[1]! & 0x80) !== 0;
          let len = buf[1]! & 0x7f;
          let offset = 2;
          if (len === 126) {
            if (buf.length < 4) break;
            len = buf.readUInt16BE(2);
            offset = 4;
          }
          const maskKey = masked ? buf.subarray(offset, offset + 4) : Buffer.alloc(0);
          if (masked) offset += 4;
          if (buf.length < offset + len) break;
          const payload = Buffer.from(buf.subarray(offset, offset + len));
          if (masked) for (let i = 0; i < payload.length; i += 1) payload[i]! ^= maskKey[i % 4]!;
          buf = buf.subarray(offset + len);

          if (opcode === 0x8) {
            socket.end();
            return;
          }
          const header =
            payload.length < 126
              ? Buffer.from([0x80 | opcode, payload.length])
              : (() => {
                  const h = Buffer.alloc(4);
                  h[0] = 0x80 | opcode;
                  h[1] = 126;
                  h.writeUInt16BE(payload.length, 2);
                  return h;
                })();
          socket.write(Buffer.concat([header, payload]));
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    const t = new WebSocketTransport('ws', opts({ protocol: 'ws', port, path: '/' }));
    const c = collector();
    t.onData(c.onData);
    await t.connect();
    await t.write('ping-ws');
    await sleep(250);
    sprawdz('WebSocket echo dociera', c.text().includes('ping-ws'), c.text().replace(/\r?\n/g, '␤'));
    await t.disconnect();
    server.close();
  }

  console.log('\nWYNIKI (transporty sieciowe)');
  console.log('─'.repeat(56));
  for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
  console.log('─'.repeat(56));
  const bledy = wyniki.filter((w) => !w.ok).length;
  console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
  process.exit(bledy === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error('Test wywrócił się:', error);
  process.exit(1);
});

/**
 * Test długiej sesji / wydajności transportu sieciowego (Etap 8).
 *
 * Pompuje dane przez TcpTransport do lokalnego serwera echo przez kilka sekund i sprawdza,
 * że: (1) połączenie przeżywa obciążenie i zostaje „connected", (2) dane wracają bez istotnej
 * straty, (3) zużycie pamięci nie eksploduje. Raportuje przepustowość. To dowód stabilności
 * przy intensywnym, długim strumieniu — nie mikrobenchmark.
 *
 * Uruchomienie: node --experimental-transform-types tests/performance/net-soak.test.ts
 */

import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { TcpTransport } from '../../src/services/net/tcp-transport.ts';

const DURATION_MS = 4000;
const CHUNK = Buffer.alloc(16 * 1024, 0x41); // 16 KiB
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const wyniki: Array<{ n: string; ok: boolean; d?: string }> = [];
const sprawdz = (n: string, ok: boolean, d?: string): void => {
  wyniki.push({ n, ok, d });
};

async function main(): Promise<void> {
  const server = createServer((socket) => socket.on('data', (d) => socket.write(d)));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;

  const transport = new TcpTransport('soak', { protocol: 'tcp', host: '127.0.0.1', port });
  let received = 0;
  transport.onData((chunk) => {
    received += chunk.length;
  });
  await transport.connect();

  const rss0 = process.memoryUsage().rss;
  let sent = 0;
  const start = Date.now();
  // Piszemy w pętli, ustępując pola pętli zdarzeń co porcję — to naturalny backpressure
  // (localhost echo nadąża), więc pamięć nie puchnie.
  while (Date.now() - start < DURATION_MS) {
    await transport.write(CHUNK);
    sent += CHUNK.length;
    await new Promise<void>((r) => setImmediate(r));
  }
  // Dajemy echu dogonić strumień.
  await sleep(700);

  const seconds = (Date.now() - start) / 1000;
  const rssGrowthMb = (process.memoryUsage().rss - rss0) / (1024 * 1024);
  const mbSent = sent / (1024 * 1024);
  const mbRecv = received / (1024 * 1024);
  const throughput = mbRecv / seconds;

  console.log(
    `wysłano ${mbSent.toFixed(1)} MiB, odebrano ${mbRecv.toFixed(1)} MiB w ${seconds.toFixed(1)} s ` +
      `→ ${throughput.toFixed(1)} MiB/s echo; wzrost RSS ${rssGrowthMb.toFixed(1)} MiB`
  );

  sprawdz('dane płynęły (odebrano > 5 MiB)', mbRecv > 5, `${mbRecv.toFixed(1)} MiB`);
  sprawdz('brak istotnej straty (odebrano ≥ 90% wysłanego)', received >= sent * 0.9, `${((received / sent) * 100).toFixed(1)}%`);
  sprawdz('połączenie przeżyło obciążenie (connected)', transport.state === 'connected', transport.state);
  sprawdz('pamięć nie eksplodowała (wzrost RSS < 150 MiB)', rssGrowthMb < 150, `${rssGrowthMb.toFixed(1)} MiB`);

  await transport.disconnect();
  server.close();

  console.log('\nWYNIKI (soak / wydajność sieci)');
  console.log('─'.repeat(56));
  for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
  console.log('─'.repeat(56));
  const bledy = wyniki.filter((w) => !w.ok).length;
  console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
  process.exit(bledy === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error('Soak wywrócił się:', error);
  process.exit(1);
});

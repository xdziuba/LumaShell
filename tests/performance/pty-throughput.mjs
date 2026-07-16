/**
 * Test intensywnego wyjścia terminala (Etap 0).
 *
 * Cel: sprawdzić, czy warstwa PTY wyrabia przy zalewie danych oraz ile realnie daje
 * grupowanie porcji przed wysłaniem przez IPC (docs/architecture/05-wydajnosc.md).
 *
 * Uruchomienie: node tests/performance/pty-throughput.mjs
 */

import { spawn } from 'node-pty';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Musi odpowiadać FLUSH_INTERVAL_MS z src/main/ipc/terminal-ipc.ts. */
const FLUSH_INTERVAL_MS = 16;
const LINES = 200_000;

const workDir = mkdtempSync(join(tmpdir(), 'luma-perf-'));
const dataFile = join(workDir, 'big.txt');

const line = 'LumaShell test intensywnego wyjscia terminala — linia wypelniajaca bufor';
writeFileSync(dataFile, Array.from({ length: LINES }, (_, i) => `${i} ${line}`).join('\r\n'), 'utf8');

console.log(`Plik testowy: ${LINES.toLocaleString('pl')} linii\n`);

let rawChunks = 0;
let bytes = 0;
let batches = 0;
let pending = 0;
let timer = null;

// Ta sama logika grupowania co w procesie głównym: porcje sklejane i wysyłane raz na klatkę.
function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (pending > 0) {
      batches += 1;
      pending = 0;
    }
  }, FLUSH_INTERVAL_MS);
}

const started = Date.now();

// Argumenty przekazywane osobno: node-pty na Windows psuje cudzysłowy przy
// składaniu linii poleceń, więc `type "ścieżka"` kończy się błędem składni.
const pty = spawn(process.env.ComSpec ?? 'cmd.exe', ['/c', 'type', dataFile], {
  name: 'xterm-256color',
  cols: 120,
  rows: 30,
  cwd: workDir,
  env: process.env,
  useConpty: true
});

pty.onData((data) => {
  rawChunks += 1;
  bytes += data.length;
  pending += 1;
  scheduleFlush();
});

pty.onExit(() => {
  if (timer) clearTimeout(timer);
  if (pending > 0) batches += 1;

  const seconds = (Date.now() - started) / 1000;
  const mib = bytes / 1024 / 1024;

  console.log('WYNIKI');
  console.log('─'.repeat(52));
  console.log(`Czas:                  ${seconds.toFixed(2)} s`);
  console.log(`Odebrano:              ${mib.toFixed(1)} MiB`);
  console.log(`Przepustowość:         ${(mib / seconds).toFixed(1)} MiB/s`);
  console.log('');
  console.log(`Porcji z PTY:          ${rawChunks.toLocaleString('pl')}`);
  console.log(`Komunikatów IPC:       ${batches.toLocaleString('pl')}  (po zgrupowaniu)`);
  console.log(`Redukcja:              ${(100 - (batches / rawChunks) * 100).toFixed(1)}%`);
  console.log(`Średnio na komunikat:  ${(rawChunks / batches).toFixed(1)} porcji`);
  console.log('─'.repeat(52));

  rmSync(workDir, { recursive: true, force: true });
});

/**
 * Testy bezpieczeństwa — inwarianty, które nie mogą się cofnąć (Etap 8).
 *
 * Dwie warstwy: (1) statyczne asercje na kodzie źródłowym (flagi izolacji, CSP) — łapią
 * regresję typu „ktoś włączył nodeIntegration"; (2) walidacja niezaufanych ładunków —
 * sekrety nie przechodzą przez snapshot, wstrzyknięcia i przerosty są odrzucane.
 *
 * Uruchomienie: node --experimental-transform-types tests/security/security.test.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseAiChat,
  parseAiLogAction,
  parseAiWriteFile,
  parseSshConnect,
  parseTerminalCreate,
  parseTerminalWrite,
  parseWorkspaceSnapshot,
  IpcValidationError
} from '../../src/shared/schemas/ipc-validation.ts';
import { parseManifest } from '../../src/shared/schemas/manifest-validation.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

const wyniki: Array<{ n: string; ok: boolean; d?: string }> = [];
const sprawdz = (n: string, ok: boolean, d?: string): void => {
  wyniki.push({ n, ok, d });
};
const rzuca = (fn: () => unknown): boolean => {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof IpcValidationError;
  }
};

// --- 1. Statyczne inwarianty izolacji procesów ---
{
  const wm = read('src/main/window-manager.ts');
  sprawdz('okno główne: contextIsolation true', /contextIsolation:\s*true/.test(wm));
  sprawdz('okno główne: nodeIntegration false', /nodeIntegration:\s*false/.test(wm));

  const host = read('src/main/plugins/plugin-host.ts');
  sprawdz('plugin host: sandbox true', /sandbox:\s*true/.test(host));
  sprawdz('plugin host: nodeIntegration false', /nodeIntegration:\s*false/.test(host));
  sprawdz('plugin host: contextIsolation true', /contextIsolation:\s*true/.test(host));

  const html = read('src/renderer/index.html');
  sprawdz("renderer CSP: default-src 'none'", html.includes("default-src 'none'"));
  sprawdz('renderer CSP: brak unsafe-eval w głównym oknie', !html.includes('unsafe-eval'));
}

// --- 2. Sekrety NIE przechodzą przez snapshot workspace'u ---
{
  // Spreparowany snapshot z liściem SSH niosącym „password" — parser bierze tylko
  // connectionId+label, a i tak SSH nie jest przywracany (przycinany do pty).
  const snapshot = parseWorkspaceSnapshot({
    tabs: [
      {
        root: {
          kind: 'leaf',
          label: 'ofiara',
          spec: { kind: 'ssh', connectionId: 'abc', label: 'x', password: 'SEKRET', privateKey: 'KLUCZ' }
        },
        activeLeafIndex: 0
      }
    ],
    activeIndex: 0
  });
  const json = JSON.stringify(snapshot);
  sprawdz('snapshot nie zawiera hasła', !json.includes('SEKRET'), json);
  sprawdz('snapshot nie zawiera klucza', !json.includes('KLUCZ'));
  // SSH (jak serial) nie jest przywracany — zakładka z samym SSH odpada.
  sprawdz('snapshot SSH przycięty (brak przywracania sesji zdalnych)', snapshot.tabs.length === 0, JSON.stringify(snapshot.tabs));
}

// --- 3. Walidacja odrzuca wstrzyknięcia i przerosty ---
{
  // Nadmiarowo długi zapis do terminala.
  sprawdz(
    'ogromny zapis do terminala odrzucony',
    rzuca(() => parseTerminalWrite({ sessionId: 'a', data: 'x'.repeat(2_000_000) }))
  );
  // Kontener: nazwa udająca flagę CLI.
  sprawdz(
    'nazwa kontenera „--privileged" odrzucona',
    rzuca(() => parseTerminalCreate({ spec: { kind: 'container', runtime: 'docker', target: '--privileged', label: 'x' }, columns: 80, rows: 24 }))
  );
  // Host sieciowy ze znakami powłoki.
  sprawdz(
    'host z „;" odrzucony',
    rzuca(() => parseTerminalCreate({ spec: { kind: 'network', protocol: 'tcp', host: 'a;rm -rf', port: 80, label: 'x' }, columns: 80, rows: 24 }))
  );
  // CLI AI: tylko zamknięty zbiór narzędzi — renderer nie podsunie dowolnej komendy.
  sprawdz(
    'ai-cli z obcym narzędziem odrzucone',
    rzuca(() => parseTerminalCreate({ spec: { kind: 'ai-cli', tool: 'rm -rf', label: 'x' }, columns: 80, rows: 24 }))
  );
  sprawdz('ai-cli „claude" przechodzi', !rzuca(() => parseTerminalCreate({ spec: { kind: 'ai-cli', tool: 'claude', label: 'Claude Code' }, columns: 80, rows: 24 })));
  // Czat AI: nieznana rola i pusta rozmowa odrzucone; poprawna przechodzi.
  sprawdz('czat z obcą rolą odrzucony', rzuca(() => parseAiChat({ requestId: 'r', messages: [{ role: 'root', content: 'x' }] })));
  sprawdz('czat bez wiadomości odrzucony', rzuca(() => parseAiChat({ requestId: 'r', messages: [] })));
  sprawdz('czat poprawny przechodzi', !rzuca(() => parseAiChat({ requestId: 'r', messages: [{ role: 'user', content: 'cześć' }] })));
  // Akcje AI-3: zapis pliku bez ścieżki i audyt ze złą decyzją odrzucone; poprawne przechodzą.
  sprawdz('zapis pliku bez ścieżki odrzucony', rzuca(() => parseAiWriteFile({ path: '   ', content: 'x' })));
  sprawdz('zapis pliku poprawny przechodzi', !rzuca(() => parseAiWriteFile({ path: 'C:/tmp/a.txt', content: 'x' })));
  sprawdz('audyt ze złą decyzją odrzucony', rzuca(() => parseAiLogAction({ tool: 'send_to_terminal', summary: 's', decision: 'maybe' })));
  sprawdz('audyt poprawny przechodzi', !rzuca(() => parseAiLogAction({ tool: 'write_file', summary: 's', decision: 'approved', outcome: 'ok' })));
  // SSH: port poza zakresem.
  sprawdz(
    'SSH port 0 odrzucony',
    rzuca(() => parseSshConnect({ host: 'a', port: 0, username: 'u', auth: 'password', password: 'p' }))
  );
  // Nieznana metoda uwierzytelniania.
  sprawdz(
    'SSH nieznana metoda auth odrzucona',
    rzuca(() => parseSshConnect({ host: 'a', port: 22, username: 'u', auth: 'magic' }))
  );
}

// --- 4. Manifest wtyczki: brak wyjścia z katalogu ---
{
  const base = { id: 'x', name: 'X', version: '1', apiVersion: '1', main: 'dist/index.js', permissions: [], contributes: { commands: [] } };
  for (const bad of ['../../secret.js', '/etc/passwd', 'C:\\Windows\\x.js']) {
    let ok = false;
    try {
      parseManifest({ ...base, main: bad });
    } catch {
      ok = true;
    }
    sprawdz(`manifest main „${bad}" odrzucony`, ok);
  }
  // Nieznane uprawnienie jest odsiewane, nie akceptowane.
  const m = parseManifest({ ...base, permissions: ['commands.register', 'filesystem.write'] });
  sprawdz('nieznane uprawnienie odsiane z manifestu', m.permissions.length === 1 && m.permissions[0] === 'commands.register');
}

console.log('WYNIKI (bezpieczeństwo)');
console.log('─'.repeat(60));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(60));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
process.exit(bledy === 0 ? 0 : 1);

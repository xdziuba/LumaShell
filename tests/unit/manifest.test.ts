/**
 * Testy jednostkowe walidacji manifestu wtyczki (Etap 6).
 *
 * Uruchomienie: node --experimental-transform-types tests/unit/manifest.test.ts
 */

import { parseManifest, ManifestValidationError } from '../../src/shared/schemas/manifest-validation.ts';
import { hasPermission } from '../../src/core/plugins/manifest.ts';

const wyniki = [];
const sprawdz = (n, ok, d) => wyniki.push({ n, ok, d });

const base = {
  id: 'com.example.test',
  name: 'Test',
  version: '1.0.0',
  apiVersion: '1',
  main: 'dist/index.js',
  permissions: ['commands.register', 'notifications.show'],
  contributes: { commands: [{ id: 'test.hello', title: 'Hello' }] }
};

// Poprawny manifest.
{
  const m = parseManifest(base);
  sprawdz('poprawny manifest waliduje', m.id === 'com.example.test' && m.commands?.length !== 0);
  sprawdz('uprawnienia zachowane', hasPermission(m, 'commands.register') && hasPermission(m, 'notifications.show'));
  sprawdz('komenda zachowana', m.contributes.commands[0].id === 'test.hello');
}

// Nieznane uprawnienie jest odrzucane (nie przechodzi dalej).
{
  const m = parseManifest({ ...base, permissions: ['commands.register', 'filesystem.write', 'evil'] });
  sprawdz('nieznane uprawnienie odsiane', m.permissions.length === 1 && m.permissions[0] === 'commands.register', JSON.stringify(m.permissions));
  sprawdz('brak nieuprawnionego dostępu', !hasPermission(m, 'terminal.write'));
}

// Ścieżka main wychodząca z katalogu → wyjątek (chroni przed czytaniem spoza wtyczki).
{
  for (const bad of ['../../secret.js', '/etc/passwd', 'C:\\Windows\\x.js', 'a\\..\\..\\b']) {
    let rzucil = false;
    try {
      parseManifest({ ...base, main: bad });
    } catch (e) {
      rzucil = e instanceof ManifestValidationError;
    }
    sprawdz(`main "${bad}" odrzucony`, rzucil);
  }
}

// Brak wymaganego pola → wyjątek.
{
  let rzucil = false;
  try {
    parseManifest({ name: 'x' });
  } catch (e) {
    rzucil = e instanceof ManifestValidationError;
  }
  sprawdz('brak id rzuca', rzucil);
}

// Narzędzia AI (AI-6): uprawnienie ai.tools i contributes.tools walidowane.
{
  const m = parseManifest({
    ...base,
    permissions: ['ai.tools'],
    contributes: {
      commands: [],
      tools: [
        { id: 'current_time', description: 'czas', parameters: { type: 'object', properties: {} } },
        { id: 'danger', description: 'akcja', parameters: {}, risky: true }
      ]
    }
  });
  sprawdz('uprawnienie ai.tools zachowane', hasPermission(m, 'ai.tools'));
  sprawdz('narzędzia zachowane', m.contributes.tools?.length === 2, String(m.contributes.tools?.length));
  sprawdz('flaga risky zachowana', m.contributes.tools?.[1]?.risky === true);
  sprawdz('read-only narzędzie bez risky', m.contributes.tools?.[0]?.risky === undefined);
}

// Narzędzie bez id → wyjątek (nie wolno wystawić modelowi bezimiennego narzędzia).
{
  let rzucil = false;
  try {
    parseManifest({ ...base, contributes: { commands: [], tools: [{ description: 'x', parameters: {} }] } });
  } catch (e) {
    rzucil = e instanceof ManifestValidationError;
  }
  sprawdz('narzędzie bez id rzuca', rzucil);
}

// --- Plugin API v2: środowisko wykonania i wersja API ---

// Brak pola `runtime` = piaskownica, czyli zachowanie sprzed v2 (zgodność wstecz).
{
  const m = parseManifest(base);
  sprawdz('brak runtime → sandbox', m.runtime === 'sandbox', m.runtime);
}

// `runtime: node` oznacza własny proces z pełnym dostępem — wymaga nowego API.
{
  const m = parseManifest({ ...base, apiVersion: '2', runtime: 'node' });
  sprawdz('runtime node przyjęty przy apiVersion 2', m.runtime === 'node', m.runtime);
}

{
  let rzucil = false;
  try {
    parseManifest({ ...base, apiVersion: '1', runtime: 'node' });
  } catch (e) {
    rzucil = e instanceof ManifestValidationError;
  }
  sprawdz('runtime node przy apiVersion 1 rzuca', rzucil);
}

{
  let rzucil = false;
  try {
    parseManifest({ ...base, runtime: 'wasm' });
  } catch (e) {
    rzucil = e instanceof ManifestValidationError;
  }
  sprawdz('nieznane środowisko wykonania rzuca', rzucil);
}

// Wersja API jest SPRAWDZANA — wcześniej pole było czytane i z niczym nieporównywane,
// więc wtyczka pisana pod nowsze API ładowała się w połowie.
{
  let rzucil = false;
  try {
    parseManifest({ ...base, apiVersion: '9' });
  } catch (e) {
    rzucil = e instanceof ManifestValidationError;
  }
  sprawdz('nieobsługiwana apiVersion rzuca', rzucil);
}

// Opis jest opcjonalny i przycinany — trafia do okna zgody, więc nie może być powieścią.
{
  const m = parseManifest({ ...base, description: 'x'.repeat(900) });
  sprawdz('opis przycięty do 500 znaków', m.description?.length === 500, String(m.description?.length));
}

console.log('WYNIKI (manifest wtyczki)');
console.log('─'.repeat(52));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(52));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
process.exit(bledy === 0 ? 0 : 1);

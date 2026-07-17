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

console.log('WYNIKI (manifest wtyczki)');
console.log('─'.repeat(52));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(52));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
process.exit(bledy === 0 ? 0 : 1);

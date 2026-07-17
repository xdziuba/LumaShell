/**
 * Testy jednostkowe walidacji sesji sieciowych i kontenerowych (Etap 7).
 *
 * Uruchomienie: node --experimental-transform-types tests/unit/network-validation.test.ts
 */

import { parseTerminalCreate, IpcValidationError } from '../../src/shared/schemas/ipc-validation.ts';
import { buildDockerExecArgs, buildKubectlExecArgs } from '../../src/services/container/exec-args.ts';

const wyniki: Array<{ n: string; ok: boolean; d?: string }> = [];
const sprawdz = (n: string, ok: boolean, d?: string): void => {
  wyniki.push({ n, ok, d });
};

const create = (spec: unknown) => parseTerminalCreate({ spec, columns: 80, rows: 24 });
const rzuca = (spec: unknown): boolean => {
  try {
    create(spec);
    return false;
  } catch (e) {
    return e instanceof IpcValidationError;
  }
};

// --- Sesje sieciowe ---
{
  const s = create({ kind: 'network', protocol: 'tcp', host: '192.168.1.10', port: 23, label: 'x' });
  sprawdz('TCP poprawny', s.spec.kind === 'network' && s.spec.protocol === 'tcp' && s.spec.port === 23);
}
{
  const s = create({ kind: 'network', protocol: 'wss', host: 'example.com', port: 443, path: '/socket', insecureTls: true, label: 'x' });
  sprawdz('WSS z path i insecureTls', s.spec.kind === 'network' && s.spec.path === '/socket' && s.spec.insecureTls === true);
}
{
  const s = create({ kind: 'network', protocol: 'udp', host: 'fe80::1', port: 9000, label: 'x' });
  sprawdz('IPv6 host przechodzi', s.spec.kind === 'network' && s.spec.host === 'fe80::1');
}

sprawdz('nieznany protokół rzuca', rzuca({ kind: 'network', protocol: 'ftp', host: 'a', port: 1, label: 'x' }));
sprawdz('host ze spacją rzuca', rzuca({ kind: 'network', protocol: 'tcp', host: 'a b', port: 1, label: 'x' }));
sprawdz('host z ; rzuca', rzuca({ kind: 'network', protocol: 'tcp', host: 'a;rm', port: 1, label: 'x' }));
sprawdz('port 0 rzuca', rzuca({ kind: 'network', protocol: 'tcp', host: 'a', port: 0, label: 'x' }));
sprawdz('port 70000 rzuca', rzuca({ kind: 'network', protocol: 'tcp', host: 'a', port: 70000, label: 'x' }));
sprawdz('path ze spacją rzuca', rzuca({ kind: 'network', protocol: 'ws', host: 'a', port: 80, path: '/a b', label: 'x' }));

// --- Sesje kontenerowe ---
{
  const s = create({ kind: 'container', runtime: 'docker', target: 'web-1', label: 'x' });
  sprawdz('Docker poprawny', s.spec.kind === 'container' && s.spec.runtime === 'docker' && s.spec.target === 'web-1');
}
{
  const s = create({ kind: 'container', runtime: 'kubernetes', target: 'api-pod', namespace: 'prod', shell: '/bin/bash', label: 'x' });
  sprawdz('K8s z namespace i shell', s.spec.kind === 'container' && s.spec.namespace === 'prod' && s.spec.shell === '/bin/bash');
}

sprawdz('nieznane środowisko rzuca', rzuca({ kind: 'container', runtime: 'podman', target: 'a', label: 'x' }));
// Cel zaczynający się od myślnika mógłby udawać flagę CLI — musi być odrzucony.
sprawdz('target „--privileged" rzuca', rzuca({ kind: 'container', runtime: 'docker', target: '--privileged', label: 'x' }));
sprawdz('target ze spacją rzuca', rzuca({ kind: 'container', runtime: 'docker', target: 'a b', label: 'x' }));
sprawdz('shell z myślnikiem rzuca', rzuca({ kind: 'container', runtime: 'docker', target: 'a', shell: '-rf', label: 'x' }));
sprawdz('namespace z wielką literą rzuca', rzuca({ kind: 'container', runtime: 'kubernetes', target: 'a', namespace: 'Prod', label: 'x' }));

// --- Budowanie argumentów exec (czyste, bez CLI) ---
{
  const a = buildDockerExecArgs('web-1', '/bin/sh');
  sprawdz('docker exec args', JSON.stringify(a) === JSON.stringify(['exec', '-it', 'web-1', '/bin/sh']), JSON.stringify(a));
}
{
  const a = buildKubectlExecArgs('api-pod', 'prod', '/bin/bash');
  const oczek = ['exec', '-it', 'api-pod', '-n', 'prod', '--', '/bin/bash'];
  sprawdz('kubectl exec args z namespace', JSON.stringify(a) === JSON.stringify(oczek), JSON.stringify(a));
}
{
  const a = buildKubectlExecArgs('api-pod');
  // Bez namespace: brak -n, ale „--" wciąż oddziela komendę.
  const oczek = ['exec', '-it', 'api-pod', '--', '/bin/sh'];
  sprawdz('kubectl exec args bez namespace', JSON.stringify(a) === JSON.stringify(oczek), JSON.stringify(a));
}

console.log('WYNIKI (walidacja sieci i kontenerów)');
console.log('─'.repeat(56));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(56));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
process.exit(bledy === 0 ? 0 : 1);

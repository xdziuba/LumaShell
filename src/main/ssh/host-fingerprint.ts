/**
 * Odcisk klucza hosta SSH w formacie OpenSSH.
 *
 * Wydzielone do procesu głównego, bo używa `node:crypto`. `core/ssh/known-hosts`
 * dostaje gotowy odcisk i nie zależy od crypto.
 */

import { createHash } from 'node:crypto';

/**
 * Zwraca `SHA256:<base64 bez dopełnienia>` — dokładnie tak, jak wypisuje OpenSSH,
 * więc odcisk da się porównać wzrokowo z `ssh-keygen -lf`.
 *
 * `key` to surowy klucz publiczny w formacie wire SSH, przekazany przez `hostVerifier`.
 */
export function fingerprint(key: Buffer): string {
  const digest = createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
  return `SHA256:${digest}`;
}

/**
 * Menedżer połączeń SSH w procesie głównym (Etap 3).
 *
 * Deskryptor połączenia (host, użytkownik, metoda i SEKRETY) żyje tu, ulotnie w pamięci
 * przez czas trwania sesji. Sekrety nigdy nie wracają do renderera ani nie są zapisywane
 * na dysk (docs/security/02-sekrety.md). Renderer dostaje wyłącznie `connectionId`.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { BrowserWindow } from 'electron';
import type { SshOptions } from '@core/transports/transport';
import type { SshConnectRequest } from '@shared/types/ipc';
import { fingerprint } from './host-fingerprint';
import { evaluate as evaluateHostKey, trust as trustHostKey } from './known-hosts-store';
import { requestHostVerification } from './host-verify';

interface Descriptor extends SshConnectRequest {
  id: string;
}

const descriptors = new Map<string, Descriptor>();

/** Rejestruje żądanie połączenia i zwraca identyfikator oraz etykietę do zakładki. */
export function registerConnection(request: SshConnectRequest): { connectionId: string; label: string } {
  const id = randomUUID();
  descriptors.set(id, { ...request, id });
  return { connectionId: id, label: `${request.username}@${request.host}` };
}

export function dropConnection(connectionId: string): void {
  descriptors.delete(connectionId);
}

/**
 * Buduje `SshOptions` dla transportu na podstawie deskryptora.
 *
 * `verifyHost` łączy magazyn known_hosts z pytaniem użytkownika: zaufany przechodzi
 * bez pytania, nieznany i zmieniony trafiają do dialogu w rendererze. Zaakceptowanie
 * zapamiętuje odcisk.
 */
/** Pola uwierzytelniania (wspólne dla hosta docelowego i jump hosta). */
interface AuthFields {
  auth: 'password' | 'key' | 'agent';
  password?: string;
  keyPath?: string;
  passphrase?: string;
}

/** Domyślny pipe agenta OpenSSH na Windows. */
const DEFAULT_AGENT = process.env.SSH_AUTH_SOCK ?? '\\\\.\\pipe\\openssh-ssh-agent';

/** Buduje część uwierzytelniającą opcji — klucz czytany z pliku dopiero tutaj. */
async function authOptions(a: AuthFields): Promise<Partial<SshOptions>> {
  if (a.auth === 'password') return { password: a.password };
  if (a.auth === 'key') {
    if (!a.keyPath) throw new Error('Brak ścieżki do klucza prywatnego');
    return { privateKey: await readFile(a.keyPath, 'utf8'), passphrase: a.passphrase };
  }
  return { agent: DEFAULT_AGENT };
}

/** Weryfikator klucza dla danego host:port — magazyn known_hosts + pytanie użytkownika. */
function hostVerifier(host: string, port: number, window: BrowserWindow) {
  return async (key: Uint8Array): Promise<boolean> => {
    const fp = fingerprint(Buffer.from(key));
    const trust = await evaluateHostKey(host, port, fp);
    if (trust === 'trusted') return true;
    const decision = await requestHostVerification(window, { host, port, fingerprint: fp, reason: trust });
    if (decision) await trustHostKey(host, port, fp);
    return decision;
  };
}

export async function resolveOptions(
  connectionId: string,
  window: BrowserWindow,
  columns: number,
  rows: number
): Promise<SshOptions> {
  const d = descriptors.get(connectionId);
  if (!d) throw new Error('Nieznane połączenie SSH');

  const options: SshOptions = {
    host: d.host,
    port: d.port,
    username: d.username,
    columns,
    rows,
    verifyHost: hostVerifier(d.host, d.port, window),
    ...(await authOptions(d))
  };

  if (d.jump) {
    const jump = d.jump;
    options.jump = {
      host: jump.host,
      port: jump.port,
      username: jump.username,
      // Jump host ma własny odcisk — osobna weryfikacja.
      verifyHost: hostVerifier(jump.host, jump.port, window),
      ...(await authOptions(jump))
    };
  }

  if (d.localForwards?.length) options.localForwards = d.localForwards;

  return options;
}

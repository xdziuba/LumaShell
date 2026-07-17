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
    verifyHost: async (key: Uint8Array): Promise<boolean> => {
      const fp = fingerprint(Buffer.from(key));
      const trust = await evaluateHostKey(d.host, d.port, fp);
      if (trust === 'trusted') return true;

      const decision = await requestHostVerification(window, {
        host: d.host,
        port: d.port,
        fingerprint: fp,
        reason: trust // 'unknown' | 'changed'
      });
      if (decision) await trustHostKey(d.host, d.port, fp);
      return decision;
    }
  };

  if (d.auth === 'password') {
    options.password = d.password;
  } else if (d.auth === 'key') {
    if (!d.keyPath) throw new Error('Brak ścieżki do klucza prywatnego');
    // Klucz czytany dopiero przy połączeniu — nie trzymamy jego treści w deskryptorze.
    options.privateKey = await readFile(d.keyPath, 'utf8');
    options.passphrase = d.passphrase;
  } else {
    // agent: ssh2 sam znajdzie pipe, gdy podamy zmienną SSH_AUTH_SOCK; na Windows to
    // nazwany pipe OpenSSH.
    options.agent = process.env.SSH_AUTH_SOCK ?? '\\\\.\\pipe\\openssh-ssh-agent';
  }

  return options;
}

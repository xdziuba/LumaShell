/**
 * Operacje plikowe SFTP — pełne zarządzanie zdalną zawartością.
 *
 * Wcześniej istniało tylko listowanie, pobranie jednego pliku i wysłanie jednego pliku.
 * Tutaj dochodzi reszta menedżera plików: tworzenie katalogów, zmiana nazwy, przenoszenie,
 * kopiowanie, usuwanie (rekurencyjne), uprawnienia i transfery wielu plików z postępem.
 *
 * Zasady:
 * - każdy ładunek z renderera jest walidowany (ścieżka to tekst o rozsądnej długości),
 * - transfery idą STRUMIENIAMI: `readFile`/`writeFile` trzymałyby cały plik w pamięci,
 * - operacje długie raportują postęp zdarzeniem `sftp:progress`, żeby UI nie zamarzał,
 * - kopiowanie po stronie serwera nie istnieje w protokole SFTP, więc dane przechodzą przez
 *   nas (odczyt + zapis) — przenoszenie w obrębie hosta to już zwykłe `rename`.
 */

import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import type { SshTransport } from '@services/ssh/ssh-transport';
import { IpcChannel, IpcEvent, type SftpProgressEvent } from '@shared/types/ipc';

/** Dostęp do transportu SSH danej sesji — dostarczany przez terminal-ipc. */
export type SshLookup = (sessionId: unknown) => SshTransport;

/** Ścieżka zdalna z renderera: tekst o rozsądnej długości, nic więcej nie zakładamy. */
function remotePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('Nieprawidłowa ścieżka zdalna');
  }
  return value;
}

function remotePaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Pusta lista ścieżek');
  if (value.length > 5000) throw new Error('Za dużo elementów w jednej operacji');
  return value.map(remotePath);
}

/** Złączenie ścieżki POSIX — zdalny host to niemal zawsze uniks. */
function joinRemote(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

export function registerSftpIpc(window: BrowserWindow, sshSession: SshLookup): void {
  /** Wysyła postęp do renderera; brak okna (zamknięte) jest cichy. */
  const raport = (event: SftpProgressEvent): void => {
    if (!window.isDestroyed()) window.webContents.send(IpcEvent.SftpProgress, event);
  };

  /**
   * Opakowanie zadania z postępem: nadaje id, raportuje start i zamknięcie, a błąd
   * przekazuje dalej (renderer pokazuje go przy liście) ORAZ zgłasza w zdarzeniu.
   */
  const zadanie = async <T>(
    label: string,
    run: (postep: (done: number, total: number) => void) => Promise<T>
  ): Promise<T> => {
    const taskId = randomUUID();
    raport({ taskId, label, done: 0, total: 0 });
    try {
      const result = await run((done, total) => raport({ taskId, label, done, total }));
      raport({ taskId, label, done: 1, total: 1, finished: true });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      raport({ taskId, label, done: 0, total: 0, finished: true, error: message });
      throw error;
    }
  };

  // --- podstawy ---

  ipcMain.handle(IpcChannel.SftpRealpath, (_e, sessionId, path) =>
    sshSession(sessionId).sftpRealpath(remotePath(path))
  );

  ipcMain.handle(IpcChannel.SftpList, (_e, sessionId, path) =>
    sshSession(sessionId).sftpList(remotePath(path))
  );

  ipcMain.handle(IpcChannel.SftpMkdir, (_e, sessionId, path) =>
    sshSession(sessionId).sftpMkdir(remotePath(path))
  );

  ipcMain.handle(IpcChannel.SftpRename, (_e, sessionId, from, to) =>
    sshSession(sessionId).sftpRename(remotePath(from), remotePath(to))
  );

  ipcMain.handle(IpcChannel.SftpChmod, (_e, sessionId, path, mode) => {
    if (typeof mode !== 'number' || !Number.isInteger(mode) || mode < 0 || mode > 0o7777) {
      throw new Error('Nieprawidłowe uprawnienia');
    }
    return sshSession(sessionId).sftpChmod(remotePath(path), mode);
  });

  // --- usuwanie (rekurencyjne) ---

  ipcMain.handle(IpcChannel.SftpDelete, async (_e, sessionId, paths) => {
    const transport = sshSession(sessionId);
    const lista = remotePaths(paths);

    const usun = async (path: string, postep: () => void): Promise<void> => {
      const info = await transport.sftpStat(path);
      if (info.type === 'dir') {
        // Katalog musi być pusty, więc schodzimy w głąb. Dowiązania traktujemy jak pliki —
        // `stat` podąża za dowiązaniem, ale unlink kasuje samo dowiązanie, nie cel.
        for (const entry of await transport.sftpList(path)) {
          await usun(joinRemote(path, entry.name), postep);
        }
        await transport.sftpRmdir(path);
      } else {
        await transport.sftpUnlink(path);
      }
      postep();
    };

    return zadanie(`Usuwanie (${lista.length})`, async (postep) => {
      let done = 0;
      for (const path of lista) {
        await usun(path, () => postep(++done, lista.length));
      }
    });
  });

  // --- przenoszenie i kopiowanie w obrębie hosta ---

  ipcMain.handle(IpcChannel.SftpMove, async (_e, sessionId, paths, targetDir) => {
    const transport = sshSession(sessionId);
    const lista = remotePaths(paths);
    const target = remotePath(targetDir);
    return zadanie(`Przenoszenie (${lista.length})`, async (postep) => {
      let done = 0;
      for (const path of lista) {
        await transport.sftpRename(path, joinRemote(target, basename(path)));
        postep(++done, lista.length);
      }
    });
  });

  ipcMain.handle(IpcChannel.SftpCopy, async (_e, sessionId, paths, targetDir) => {
    const transport = sshSession(sessionId);
    const lista = remotePaths(paths);
    const target = remotePath(targetDir);

    const kopiuj = async (from: string, to: string, postep: () => void): Promise<void> => {
      const info = await transport.sftpStat(from);
      if (info.type === 'dir') {
        await transport.sftpMkdir(to).catch(() => undefined); // może już istnieć
        for (const entry of await transport.sftpList(from)) {
          await kopiuj(joinRemote(from, entry.name), joinRemote(to, entry.name), postep);
        }
      } else {
        // Protokół SFTP nie zna kopiowania po stronie serwera — dane muszą przejść przez nas.
        await pipeline(await transport.sftpReadStream(from), await transport.sftpWriteStream(to));
      }
      postep();
    };

    return zadanie(`Kopiowanie (${lista.length})`, async (postep) => {
      let done = 0;
      for (const path of lista) {
        await kopiuj(path, joinRemote(target, basename(path)), () => postep(++done, lista.length));
      }
    });
  });

  // --- transfery ---

  /** Wysyła jeden lokalny plik albo katalog (rekurencyjnie) do katalogu zdalnego. */
  const wyslijSciezke = async (
    transport: SshTransport,
    local: string,
    remoteDir: string,
    postep: (bajty: number) => void
  ): Promise<void> => {
    const info = await stat(local);
    const remote = joinRemote(remoteDir, basename(local));
    if (info.isDirectory()) {
      await transport.sftpMkdir(remote).catch(() => undefined);
      for (const name of await readdir(local)) {
        await wyslijSciezke(transport, join(local, name), remote, postep);
      }
      return;
    }
    const read = createReadStream(local);
    read.on('data', (chunk: string | Buffer) => postep(chunk.length));
    await pipeline(read, await transport.sftpWriteStream(remote));
  };

  /** Sumaryczny rozmiar lokalnej ścieżki — potrzebny, żeby postęp miał mianownik. */
  const rozmiarLokalny = async (path: string): Promise<number> => {
    const info = await stat(path);
    if (!info.isDirectory()) return info.size;
    let sum = 0;
    for (const name of await readdir(path)) sum += await rozmiarLokalny(join(path, name));
    return sum;
  };

  const wyslijWiele = async (
    sessionId: unknown,
    targetDir: unknown,
    locals: string[]
  ): Promise<number> => {
    const transport = sshSession(sessionId);
    const target = remotePath(targetDir);
    return zadanie(`Wysyłanie (${locals.length})`, async (postep) => {
      let total = 0;
      for (const local of locals) total += await rozmiarLokalny(local);
      let done = 0;
      for (const local of locals) {
        await wyslijSciezke(transport, local, target, (bajty) => {
          done += bajty;
          postep(done, total);
        });
      }
      return locals.length;
    });
  };

  // Wysłanie z okna wyboru (wiele plików naraz).
  ipcMain.handle(IpcChannel.SftpUpload, async (_e, sessionId, targetDir): Promise<number> => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Wyślij na serwer',
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled || result.filePaths.length === 0) return 0;
    return wyslijWiele(sessionId, targetDir, result.filePaths);
  });

  // Wysłanie ścieżek przeciągniętych z pulpitu/eksploratora (renderer zna je z webUtils).
  ipcMain.handle(IpcChannel.SftpUploadPaths, async (_e, sessionId, targetDir, paths): Promise<number> => {
    if (!Array.isArray(paths) || paths.length === 0) return 0;
    const locals = paths.filter((p): p is string => typeof p === 'string' && p.length > 0).slice(0, 500);
    if (locals.length === 0) return 0;
    return wyslijWiele(sessionId, targetDir, locals);
  });

  // Pobranie: użytkownik wskazuje katalog docelowy, my odtwarzamy w nim strukturę.
  ipcMain.handle(IpcChannel.SftpDownload, async (_e, sessionId, paths): Promise<number> => {
    const transport = sshSession(sessionId);
    const lista = remotePaths(paths);
    const result = await dialog.showOpenDialog(window, {
      title: 'Pobierz do katalogu',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return 0;
    const targetDir = result.filePaths[0]!;

    const pobierz = async (
      remote: string,
      localDir: string,
      postep: (bajty: number) => void
    ): Promise<void> => {
      const info = await transport.sftpStat(remote);
      const local = join(localDir, basename(remote));
      if (info.type === 'dir') {
        await mkdir(local, { recursive: true });
        for (const entry of await transport.sftpList(remote)) {
          await pobierz(joinRemote(remote, entry.name), local, postep);
        }
        return;
      }
      const read = await transport.sftpReadStream(remote);
      read.on('data', (chunk: string | Buffer) => postep(chunk.length));
      await pipeline(read, createWriteStream(local));
    };

    /** Sumaryczny rozmiar zdalnej ścieżki — mianownik postępu. */
    const rozmiarZdalny = async (path: string): Promise<number> => {
      const info = await transport.sftpStat(path);
      if (info.type !== 'dir') return info.size;
      let sum = 0;
      for (const entry of await transport.sftpList(path)) {
        sum += await rozmiarZdalny(joinRemote(path, entry.name));
      }
      return sum;
    };

    return zadanie(`Pobieranie (${lista.length})`, async (postep) => {
      let total = 0;
      for (const path of lista) total += await rozmiarZdalny(path);
      let done = 0;
      for (const path of lista) {
        await pobierz(path, targetDir, (bajty) => {
          done += bajty;
          postep(done, total);
        });
      }
      return lista.length;
    });
  });
}

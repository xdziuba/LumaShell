/**
 * Wykrywanie powłok dostępnych w systemie (Etap 1).
 *
 * Wykrywanie jest leniwe — uruchamiane na żądanie, nie przy starcie aplikacji
 * (docs/architecture/05-wydajnosc.md).
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface ShellDefinition {
  /** Stabilny identyfikator, np. „powershell" albo „wsl:Ubuntu". */
  id: string;
  label: string;
  path: string;
  args: string[];
}

function findOnPath(executable: string): string | undefined {
  return findAllOnPath(executable)[0];
}

function findAllOnPath(executable: string): string[] {
  const paths = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const found = paths
    .map((directory) => join(directory, executable))
    .filter((candidate) => existsSync(candidate));
  return [...new Set(found)];
}

/**
 * Git Bash.
 *
 * Nie da się tego wyliczyć jedną sztywną ścieżką względem `git.exe`, bo Git instaluje
 * kilka jego kopii w różnych układach katalogów — na tej maszynie PATH zawiera zarówno
 * `Git\cmd\git.exe`, jak i `Git\mingw64\bin\git.exe`. Zamiast zgadywać poziom, idziemy
 * w górę od każdego znalezionego `git.exe` i szukamy katalogu z `bin\bash.exe`.
 */
function findGitBash(): string | undefined {
  const standardPaths = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe')
  ];
  for (const candidate of standardPaths) {
    if (existsSync(candidate)) return candidate;
  }

  for (const git of findAllOnPath('git.exe')) {
    let directory = join(git, '..');
    for (let level = 0; level < 3; level += 1) {
      const bash = join(directory, 'bin', 'bash.exe');
      if (existsSync(bash)) return bash;
      directory = join(directory, '..');
    }
  }
  return undefined;
}

/**
 * Dystrybucje WSL.
 *
 * Dwie pułapki, obie potwierdzone na żywym systemie:
 *
 * 1. `wsl.exe` wypisuje wynik w **UTF-16LE**, nie w UTF-8. Odczytany jako UTF-8 daje
 *    tekst przetykany zerowymi bajtami.
 * 2. Rejestr nie odróżnia dystrybucji systemowych od użytkownika — `docker-desktop`
 *    i `Ubuntu` mają identyczne `Flags`. Jedynym praktycznym sitem jest nazwa; tak samo
 *    robi Windows Terminal.
 */
async function detectWslDistros(): Promise<ShellDefinition[]> {
  const wsl = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe');
  if (!existsSync(wsl)) return [];

  try {
    const { stdout } = await run(wsl, ['-l', '-q'], { encoding: 'buffer', windowsHide: true });
    return (stdout as Buffer)
      .toString('utf16le')
      .split(/\r?\n/)
      .map((line) => line.replace(/\0/g, '').trim())
      .filter(Boolean)
      .filter((name) => !name.startsWith('docker-desktop'))
      .map((name) => ({
        id: `wsl:${name}`,
        label: `WSL · ${name}`,
        path: wsl,
        args: ['-d', name]
      }));
  } catch {
    // Brak zainstalowanych dystrybucji albo wyłączona funkcja WSL — to nie jest błąd.
    return [];
  }
}

/** Wszystkie powłoki wykryte w systemie, w kolejności prezentacji. */
export async function discoverShells(): Promise<ShellDefinition[]> {
  const shells: ShellDefinition[] = [];

  const pwsh = findOnPath('pwsh.exe');
  if (pwsh) {
    shells.push({ id: 'pwsh', label: 'PowerShell 7', path: pwsh, args: [] });
  }

  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const windowsPowerShell = join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  if (existsSync(windowsPowerShell)) {
    shells.push({
      id: 'powershell',
      label: 'Windows PowerShell',
      path: windowsPowerShell,
      args: []
    });
  }

  const cmd = process.env.ComSpec ?? join(systemRoot, 'System32', 'cmd.exe');
  if (existsSync(cmd)) {
    shells.push({ id: 'cmd', label: 'Wiersz polecenia', path: cmd, args: [] });
  }

  const gitBash = findGitBash();
  if (gitBash) {
    // `-i -l` daje powłokę interaktywną z wczytanym profilem — tak uruchamia ją
    // sam Git Bash.
    shells.push({ id: 'git-bash', label: 'Git Bash', path: gitBash, args: ['-i', '-l'] });
  }

  shells.push(...(await detectWslDistros()));

  return shells;
}

/** Powłoka domyślna: pierwsza z wykrytych, zgodnie z kolejnością preferencji. */
export async function detectDefaultShell(): Promise<ShellDefinition> {
  const shells = await discoverShells();
  const fallback: ShellDefinition = {
    id: 'cmd',
    label: 'Wiersz polecenia',
    path: process.env.ComSpec ?? 'cmd.exe',
    args: []
  };
  return shells[0] ?? fallback;
}

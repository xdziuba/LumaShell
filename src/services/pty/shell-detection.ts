/**
 * Wykrywanie domyślnej powłoki na Windows.
 *
 * Kolejność: PowerShell 7 → Windows PowerShell 5.1 → CMD. Etap 0 obsługuje tylko
 * powłokę domyślną; wybór powłoki i profile wchodzą w Etapie 1 i 2
 * (docs/architecture/08-roadmapa.md).
 */

import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

function findOnPath(executable: string): string | undefined {
  const paths = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const directory of paths) {
    const candidate = join(directory, executable);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export interface DetectedShell {
  path: string;
  label: string;
}

export function detectDefaultShell(): DetectedShell {
  if (process.platform !== 'win32') {
    return { path: process.env.SHELL ?? '/bin/bash', label: 'shell' };
  }

  const pwsh = findOnPath('pwsh.exe');
  if (pwsh) return { path: pwsh, label: 'PowerShell 7' };

  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const windowsPowerShell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (existsSync(windowsPowerShell)) {
    return { path: windowsPowerShell, label: 'Windows PowerShell' };
  }

  return { path: process.env.ComSpec ?? join(systemRoot, 'System32', 'cmd.exe'), label: 'CMD' };
}

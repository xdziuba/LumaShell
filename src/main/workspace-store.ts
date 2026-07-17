/**
 * Trwały zapis układu zakładek (przywracanie sesji).
 *
 * `workspace.json` w katalogu danych aplikacji. Walidacja i filtrowanie (tylko powłoki)
 * dzieją się w `parseWorkspaceSnapshot` — patrz docs/security/03-polityka-agenta.md.
 */

import { rename, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { parseWorkspaceSnapshot } from '@shared/schemas/ipc-validation';
import type { WorkspaceSnapshot } from '@shared/types/ipc';

function filePath(): string {
  return join(app.getPath('userData'), 'workspace.json');
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  try {
    return parseWorkspaceSnapshot(JSON.parse(await readFile(filePath(), 'utf8')));
  } catch {
    return { tabs: [], activeIndex: 0 };
  }
}

export async function saveWorkspace(payload: unknown): Promise<void> {
  // Przepuszczenie przez walidację odsiewa porty COM i uszkodzone zakładki, zanim
  // cokolwiek trafi na dysk.
  const snapshot = parseWorkspaceSnapshot(payload);
  const target = filePath();
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(snapshot, null, 2), 'utf8');
  await rename(temp, target);
}

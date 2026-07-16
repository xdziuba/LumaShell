/**
 * Ustalenie możliwości środowiska w procesie głównym.
 *
 * Renderer NIE wykrywa wersji systemu samodzielnie — dostaje gotową flagę przez preload
 * (docs/architecture/03-interfejs-i-motywy.md#degradacja-na-windows-10).
 */

import { release } from 'node:os';
import type { AppCapabilities } from '@shared/types/ipc';

/** Windows 11 22H2 — najniższy build z obsługą `backgroundMaterial`. */
const MIN_ACRYLIC_BUILD = 22621;

export function readOsBuild(): number {
  if (process.platform !== 'win32') return 0;
  // os.release() zwraca np. "10.0.26200". Electron ma poprawny manifest zgodności,
  // więc dostajemy prawdziwy build, a nie zaniżoną wersję.
  const build = Number.parseInt(release().split('.')[2] ?? '', 10);
  return Number.isNaN(build) ? 0 : build;
}

export function detectCapabilities(): AppCapabilities {
  const osBuild = readOsBuild();
  return {
    acrylic: process.platform === 'win32' && osBuild >= MIN_ACRYLIC_BUILD,
    platform: process.platform,
    osBuild
  };
}

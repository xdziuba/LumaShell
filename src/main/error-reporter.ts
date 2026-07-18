/**
 * Raportowanie błędów procesu głównego (Etap 8).
 *
 * Wyłapuje nieobsłużone wyjątki i odrzucone obietnice, zapisuje je z sygnaturą czasu i
 * stosem do pliku w userData/logs, i NIE pozwala im wywrócić aplikacji (obecność handlera
 * `uncaughtException` znosi domyślne wyjście Electrona). Log jest lokalny — żadnej telemetrii
 * bez zgody użytkownika (docs/security).
 */

import { app } from 'electron';
import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/** Ponad ten rozmiar log jest rotowany do errors.old.log, żeby nie rósł bez końca. */
const MAX_LOG_BYTES = 512 * 1024;

let dir: string | undefined;

/** Katalog logów; tworzony leniwie (po `ready`, gdy userData jest dostępne). */
export function logsDir(): string {
  if (!dir) {
    dir = join(app.getPath('userData'), 'logs');
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // brak katalogu logów to nie powód, żeby wywracać aplikację
    }
  }
  return dir;
}

function rotateIfBig(file: string): void {
  try {
    if (statSync(file).size > MAX_LOG_BYTES) renameSync(file, join(logsDir(), 'errors.old.log'));
  } catch {
    // plik może nie istnieć — nic nie rotujemy
  }
}

function write(kind: string, error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[error-reporter] ${kind}:`, message);
  // Przed `ready` nie ma userData — zostaje sam zapis w konsoli.
  if (!app.isReady()) return;
  const file = join(logsDir(), 'errors.log');
  rotateIfBig(file);
  try {
    appendFileSync(file, `[${new Date().toISOString()}] ${kind}\n${message}\n\n`, 'utf8');
  } catch {
    // zapis logu nie może rzucać dalej
  }
}

/** Zapisuje błąd zgłoszony przez renderer (przez ErrorBoundary → IPC). */
export function reportRendererError(message: string): void {
  write('rendererError', message);
}

/** Instaluje globalne handlery — wołane jak najwcześniej w starcie procesu głównego. */
export function initErrorReporter(): void {
  process.on('uncaughtException', (error) => write('uncaughtException', error));
  process.on('unhandledRejection', (reason) => write('unhandledRejection', reason));
}

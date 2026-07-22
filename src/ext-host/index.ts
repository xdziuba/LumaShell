/**
 * Extension Host — wnętrze procesu wtyczki (Plugin API v2, etap 1).
 *
 * Ten plik jest punktem wejścia `utilityProcess.fork`. Na jeden proces przypada JEDNA
 * wtyczka. To celowe: `kill()` daje realne wyłączenie (a nie `deactivate()`, na które
 * wtyczka może nie odpowiedzieć), awaria jednej wtyczki nie dotyka pozostałych, a
 * tożsamość wtyczki wynika z uchwytu procesu, a nie z pola w wiadomości — bez tego
 * przełącznik „udostępniaj narzędzia tej wtyczki agentowi AI" byłby fikcją.
 *
 * Co ten proces MA: pełny Node (`fs`, `net`, `child_process`, własne `node_modules`).
 * Czego NIE MA (zmierzone na Electronie 43.1.1): `require('electron')` zwraca wyłącznie
 * `{ net, systemPreferences }` — żadnego okna, IPC aplikacji ani sesji. Do zasobów
 * LumaShella (terminal, zakładki, sekrety) wtyczka wchodzi wyłącznie przez RPC do procesu
 * głównego, gdzie stoi bramka uprawnień.
 */

import { createRequire } from 'node:module';
import { DEACTIVATE_TIMEOUT_MS, type HostControl, type ParentMessage } from '@core/plugins/protocol';

/** Kształt modułu wtyczki. `deactivate` jest opcjonalne, ale jeśli jest — będzie wołane. */
interface PluginModule {
  activate?: (context: unknown) => unknown | Promise<unknown>;
  deactivate?: () => unknown | Promise<unknown>;
}

const port = process.parentPort;

let modul: PluginModule | undefined;
let pluginId = '';

function zglos(status: 'ready' | 'loaded' | 'unloaded' | 'error', message?: string): void {
  port.postMessage(message === undefined ? { kind: 'sts', status } : { kind: 'sts', status, message });
}

/**
 * Kontekst przekazywany do `activate()`.
 *
 * Etap 1 daje minimum, na którym da się zobaczyć, że proces żyje: tożsamość, logowanie
 * i uprawnienia do wglądu. Prawdziwe zdolności (komendy, terminal, zakładki, UI) dochodzą
 * w kolejnych etapach jako gałęzie proxy na RPC — dlatego kontekst od razu powstaje
 * w jednym miejscu.
 */
function zbudujKontekst(control: HostControl): unknown {
  return {
    pluginId: control.pluginId,
    permissions: [...(control.permissions ?? [])],
    /** Log wtyczki trafia na stdout procesu, a stamtąd do pliku w katalogu logów. */
    log: (...args: unknown[]): void => {
      console.log(...args);
    }
  };
}

async function zaladuj(control: HostControl): Promise<void> {
  if (!control.entry) {
    zglos('error', 'brak ścieżki modułu wtyczki');
    return;
  }
  pluginId = control.pluginId ?? '';

  try {
    // `createRequire` na ścieżce wtyczki: wtyczka rozwiązuje zależności ze SWOJEGO katalogu
    // (własne node_modules), a nie z aplikacji.
    const wymagaj = createRequire(control.entry);
    modul = wymagaj(control.entry) as PluginModule;

    if (typeof modul.activate !== 'function') {
      zglos('error', 'moduł nie eksportuje activate()');
      return;
    }
    await modul.activate(zbudujKontekst(control));
    zglos('loaded');
  } catch (error) {
    zglos('error', error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
  }
}

async function wyladuj(): Promise<void> {
  try {
    if (typeof modul?.deactivate === 'function') {
      // Wtyczka dostaje szansę na uprzątnięcie po sobie, ale nie może zablokować wyłączenia:
      // po upływie limitu proces i tak zostanie ubity przez nadzorcę.
      await Promise.race([
        Promise.resolve(modul.deactivate()),
        new Promise((resolve) => setTimeout(resolve, DEACTIVATE_TIMEOUT_MS))
      ]);
    }
    zglos('unloaded');
  } catch (error) {
    zglos('error', error instanceof Error ? error.message : String(error));
  }
}

port.on('message', (event) => {
  const message = event.data as ParentMessage;
  if (typeof message !== 'object' || message === null) return;

  if ((message as HostControl).kind === 'ctl') {
    const control = message as HostControl;
    if (control.action === 'load') void zaladuj(control);
    else if (control.action === 'unload') void wyladuj();
  }
});

// Wyjątek w kodzie wtyczki nie może zniknąć po cichu — trafia do logu wtyczki, a proces
// kończy się z niezerowym kodem, co nadzorca zobaczy jako awarię.
process.on('uncaughtException', (error) => {
  console.error(`[${pluginId}] nieobsłużony wyjątek:`, error);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[${pluginId}] nieobsłużone odrzucenie obietnicy:`, reason);
});

zglos('ready');

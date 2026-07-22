/**
 * Nadzorca procesów wtyczek (Plugin API v2, etap 1).
 *
 * Jeden `utilityProcess` na wtyczkę. Nadzorca odpowiada za cykl życia: start, zatrzymanie
 * (najpierw `deactivate()`, potem twarde `kill()`), przeładowanie bez restartu aplikacji,
 * przekierowanie logów wtyczki do pliku i kwarantannę po serii awarii.
 *
 * Dlaczego proces na wtyczkę, a nie jeden wspólny host: `kill()` to jedyne wyładowanie,
 * które naprawdę działa (w modelu v1 `deactivate()` nie było nawet wołane, a timery wtyczki
 * żyły do zamknięcia aplikacji), awaria jednej wtyczki nie zabiera pozostałych, a przy
 * ~30 MB prywatnej pamięci na proces (zmierzone) cena jest do przyjęcia.
 */

import { createWriteStream, type WriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { PluginManifest } from '@core/plugins/manifest';
import type { ChildMessage, HostControl, HostStatus } from '@core/plugins/protocol';
import { userDirs } from '../user-dirs';

/** Po tylu awariach w oknie czasu wtyczka trafia do kwarantanny i nie jest wznawiana. */
const MAX_AWARII = 3;
const OKNO_AWARII_MS = 60_000;

export type ExtHostStan = 'zatrzymana' | 'startuje' | 'dziala' | 'blad' | 'kwarantanna';

export interface ExtHostInfo {
  stan: ExtHostStan;
  pid?: number;
  /** Liczba awarii w bieżącym oknie czasu. */
  awarie: number;
  /** Ostatni komunikat błędu — pokazywany w menedżerze wtyczek. */
  blad?: string;
  logPath?: string;
}

interface Wpis {
  manifest: PluginManifest;
  /** Bezwzględna ścieżka do modułu wejściowego wtyczki. */
  entry: string;
  proces?: UtilityProcess;
  log?: WriteStream;
  info: ExtHostInfo;
  /** Znaczniki czasu ostatnich awarii — do liczenia serii. */
  awarieCzasy: number[];
  /** Ustawiane na czas zatrzymywania, żeby wyjście procesu nie wyglądało na awarię. */
  zatrzymywana: boolean;
}

const wpisy = new Map<string, Wpis>();

/** Wywoływane przy każdej zmianie stanu — menedżer wtyczek odświeża widok. */
let onZmiana: () => void = () => {};

export function ustawObserwatora(callback: () => void): void {
  onZmiana = callback;
}

/** Ścieżka pliku wykonawczego hosta wtyczek (bundlowany razem z procesem głównym). */
function extHostEntry(): string {
  return join(__dirname, 'ext-host.js');
}

function logFile(pluginId: string): string {
  // Identyfikator jest walidowany w manifeście, ale nazwa pliku i tak przechodzi przez
  // filtr — nie chcemy, żeby wtyczka decydowała, gdzie powstaje plik.
  const bezpieczny = pluginId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return join(userDirs().logs, 'plugins', `${bezpieczny}.log`);
}

export function infoWtyczki(pluginId: string): ExtHostInfo | undefined {
  return wpisy.get(pluginId)?.info;
}

/** Rejestruje wtyczkę bez uruchamiania — stan startowy dla menedżera. */
export function zarejestruj(manifest: PluginManifest, entry: string): void {
  const istniejacy = wpisy.get(manifest.id);
  if (istniejacy) {
    istniejacy.manifest = manifest;
    istniejacy.entry = entry;
    return;
  }
  wpisy.set(manifest.id, {
    manifest,
    entry,
    info: { stan: 'zatrzymana', awarie: 0, logPath: logFile(manifest.id) },
    awarieCzasy: [],
    zatrzymywana: false
  });
}

export function wyrejestruj(pluginId: string): void {
  void zatrzymaj(pluginId);
  wpisy.delete(pluginId);
}

/**
 * Uruchamia proces wtyczki i ładuje jej moduł.
 *
 * `serviceName` widać w metrykach Electrona i w narzędziach diagnostycznych — dzięki temu
 * wiadomo, który proces należy do której wtyczki.
 */
export async function uruchom(pluginId: string): Promise<ExtHostInfo | undefined> {
  const wpis = wpisy.get(pluginId);
  if (!wpis) return undefined;
  if (wpis.proces) return wpis.info;
  if (wpis.info.stan === 'kwarantanna') return wpis.info;

  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(userDirs().logs, 'plugins'), { recursive: true }).catch(() => undefined);

  wpis.info.stan = 'startuje';
  wpis.info.blad = undefined;
  wpis.zatrzymywana = false;
  onZmiana();

  const proces = utilityProcess.fork(extHostEntry(), [], {
    serviceName: `LumaShell Plugin: ${wpis.manifest.name}`,
    stdio: 'pipe',
    // Katalog wtyczki jako cwd: ścieżki względne w kodzie wtyczki znaczą to, czego autor
    // się spodziewa, a nie „katalog, z którego uruchomiono aplikację".
    cwd: dirname(wpis.entry)
  });
  wpis.proces = proces;

  // Log wtyczki do pliku — dziś błędy wtyczek ginęły w konsoli procesu głównego, której
  // na Windowsie i tak nie widać.
  const strumien = createWriteStream(logFile(pluginId), { flags: 'a' });
  wpis.log = strumien;
  strumien.write(`\n--- start ${new Date().toISOString()} (pid ${proces.pid ?? '?'}) ---\n`);
  proces.stdout?.on('data', (chunk: Buffer) => strumien.write(chunk));
  proces.stderr?.on('data', (chunk: Buffer) => strumien.write(chunk));

  proces.on('message', (raw: ChildMessage) => {
    if (typeof raw !== 'object' || raw === null) return;
    if ((raw as HostStatus).kind === 'sts') {
      const status = raw as HostStatus;
      if (status.status === 'ready') {
        const control: HostControl = {
          kind: 'ctl',
          action: 'load',
          entry: wpis.entry,
          pluginId,
          permissions: wpis.manifest.permissions
        };
        proces.postMessage(control);
      } else if (status.status === 'loaded') {
        wpis.info.stan = 'dziala';
        wpis.info.pid = proces.pid;
        onZmiana();
      } else if (status.status === 'unloaded') {
        // Wtyczka posprzątała po sobie. Proces i tak nie zakończy się sam (kanał do rodzica
        // trzyma pętlę zdarzeń), więc kończymy go OD RAZU zamiast czekać na twardy limit.
        proces.kill();
      } else if (status.status === 'error') {
        wpis.info.stan = 'blad';
        wpis.info.blad = status.message?.slice(0, 500);
        strumien.write(`[host] błąd wtyczki: ${status.message ?? ''}\n`);
        onZmiana();
      }
    }
  });

  proces.on('exit', (code) => {
    strumien.write(`--- koniec (kod ${code}) ---\n`);
    strumien.end();
    wpis.proces = undefined;
    wpis.log = undefined;
    wpis.info.pid = undefined;

    if (wpis.zatrzymywana) {
      wpis.info.stan = 'zatrzymana';
      onZmiana();
      return;
    }

    // Wyjście, o które nikt nie prosił, to awaria. Seria awarii w krótkim czasie oznacza,
    // że wznawianie nic nie da — wtedy kwarantanna zamiast pętli restartów.
    const teraz = Date.now();
    wpis.awarieCzasy = wpis.awarieCzasy.filter((t) => teraz - t < OKNO_AWARII_MS);
    wpis.awarieCzasy.push(teraz);
    wpis.info.awarie = wpis.awarieCzasy.length;

    if (wpis.awarieCzasy.length >= MAX_AWARII) {
      wpis.info.stan = 'kwarantanna';
      wpis.info.blad = `Wtyczka padła ${wpis.awarieCzasy.length} razy w minutę — zatrzymana. Sprawdź log.`;
    } else {
      wpis.info.stan = 'blad';
      wpis.info.blad = `Proces wtyczki zakończył się (kod ${code}).`;
    }
    onZmiana();
  });

  return wpis.info;
}

/** Zatrzymuje wtyczkę: najpierw `deactivate()`, potem twardo. */
export async function zatrzymaj(pluginId: string): Promise<ExtHostInfo | undefined> {
  const wpis = wpisy.get(pluginId);
  if (!wpis) return undefined;
  const proces = wpis.proces;
  if (!proces) {
    wpis.info.stan = 'zatrzymana';
    onZmiana();
    return wpis.info;
  }

  wpis.zatrzymywana = true;
  const control: HostControl = { kind: 'ctl', action: 'unload' };
  proces.postMessage(control);

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2500);
    proces.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  // Jeśli wtyczka nie wyszła sama — kończymy proces. To jedyne wyłączenie, które NAPRAWDĘ
  // działa; „deactivate" jest uprzejmością, nie gwarancją.
  if (wpis.proces) proces.kill();
  wpis.info.stan = 'zatrzymana';
  wpis.info.pid = undefined;
  onZmiana();
  return wpis.info;
}

/** Przeładowanie: zatrzymanie + start z bieżącym kodem z dysku. Bez restartu aplikacji. */
export async function przeladuj(pluginId: string): Promise<ExtHostInfo | undefined> {
  const wpis = wpisy.get(pluginId);
  if (!wpis) return undefined;
  await zatrzymaj(pluginId);
  // Kwarantanna po ręcznym przeładowaniu jest zdejmowana — to świadoma decyzja użytkownika.
  wpis.awarieCzasy = [];
  wpis.info.awarie = 0;
  wpis.info.stan = 'zatrzymana';
  return uruchom(pluginId);
}

/** Zamknięcie aplikacji — kończy wszystkie procesy wtyczek. */
export function zatrzymajWszystkie(): void {
  for (const wpis of wpisy.values()) {
    wpis.zatrzymywana = true;
    wpis.proces?.kill();
  }
}

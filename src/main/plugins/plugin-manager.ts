/**
 * Menedżer wtyczek (Etap 6).
 *
 * Wykrywa wtyczki, waliduje manifesty, ładuje ich kod do izolowanego hosta i EGZEKWUJE
 * uprawnienia na granicy RPC — to jest miejsce, w którym deklaracja z manifestu staje się
 * realną gwarancją (docs/architecture/10-decyzje.md#d2--izolacja-wtyczek-rpc-bez-node).
 */

import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app, ipcMain, shell, type BrowserWindow } from 'electron';
import { hasPermission, type PluginManifest } from '@core/plugins/manifest';
import { parseManifest } from '@shared/schemas/manifest-validation';
import {
  IpcChannel,
  IpcEvent,
  type InstalledPlugin,
  type PluginStatusItem,
  type PluginView,
  type PluginToolInfo
} from '@shared/types/ipc';
import { createPluginHost, sendToHost } from './plugin-host';
import { aiToolsAllowed, isDisabled, isTrusted, setAiToolsAllowed, setDisabled, setTrusted } from './plugin-state-store';
import { userDirs } from '../user-dirs';
import { cofnijUdostepnienie, hostWtyczki, SCHEMAT, udostepnijKatalog } from './plugin-webview';
import {
  dzialajaceWtyczki,
  infoWtyczki,
  przeladuj,
  ustawObserwatora,
  ustawOdbiorRpc,
  uruchom,
  wyrejestruj,
  wyslij,
  zarejestruj,
  zatrzymaj
} from './ext-host-supervisor';
import {
  obsluzOdpowiedz,
  obsluzZadanie,
  ustawAktywnaZakladke,
  ustawWysylke,
  zadaj,
  type KontekstWtyczki
} from './plugin-rpc';

interface LoadedPlugin {
  manifest: PluginManifest;
  /** Komendy zgłoszone przez wtyczkę przez RPC (tylko te z prawem commands.register). */
  commands: Array<{ id: string; title: string }>;
  /** Narzędzia AI zgłoszone przez RPC (tylko z prawem ai.tools i zadeklarowane w manifeście). */
  tools: string[];
}

/** Limit czasu na odpowiedź narzędzia wtyczki — model nie może wisieć w nieskończoność. */
const TOOL_TIMEOUT_MS = 30_000;

/** Trwające wywołania narzędzi wtyczek — rozwiązywane po callId odpowiedzią z hosta. */
const pendingTools = new Map<string, { resolve: (result: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

/** Wszystkie wykryte wtyczki (włączone i wyłączone) — źródło dla menedżera. */
const discovered = new Map<string, { manifest: PluginManifest; code: string; entry: string }>();
/** Aktualnie AKTYWNE wtyczki (włączone i załadowane do hosta). */
const plugins = new Map<string, LoadedPlugin>();
/** Elementy paska statusu dodane przez wtyczki: klucz `pluginId::itemId`. */
const elementyPaska = new Map<string, PluginStatusItem>();
/** Widoki zgłoszone przez wtyczki (gotowe do otwarcia jako zakładka): klucz `pluginId::viewId`. */
const widoki = new Map<string, PluginView>();
let mainWindow: BrowserWindow | undefined;

/**
 * Katalogi, w których szukamy wtyczek: wbudowane w zasobach + własne w userData.
 *
 * Ten pierwszy w wersji zainstalowanej leży wewnątrz app.asar (tylko do odczytu), więc
 * katalog użytkownika jest JEDYNYM miejscem, gdzie da się dorzucić własną wtyczkę. Zakłada
 * go `ensureUserDirs()` na starcie — wcześniej nie istniał i skan go po cichu pomijał.
 */
function pluginDirs(): string[] {
  return [join(app.getAppPath(), 'resources', 'plugins'), userDirs().plugins];
}

/** Skanuje katalogi wtyczek i zwraca to, co udało się wczytać (manifest + kod). */
async function scanPlugins(): Promise<Array<{ manifest: PluginManifest; code: string; entry: string }>> {
  const found: Array<{ manifest: PluginManifest; code: string; entry: string }> = [];
  for (const dir of pluginDirs()) {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue; // katalog może nie istnieć
    }
    for (const name of entries) {
      const loaded = await readPlugin(join(dir, name));
      if (loaded) found.push(loaded);
    }
  }
  return found;
}

/**
 * Wczytuje manifest jednej wtyczki z katalogu.
 *
 * Wtyczka w piaskownicy jest wysyłana do hosta jako TEKST (host nie ma modułów), więc jej
 * kod czytamy od razu. Wtyczka `runtime: "node"` jest ładowana przez `require` we własnym
 * procesie — tu wystarczy ścieżka; czytanie jej treści byłoby bez sensu, bo może mieć
 * własne `node_modules`.
 */
async function readPlugin(
  dir: string
): Promise<{ manifest: PluginManifest; code: string; entry: string } | null> {
  try {
    const manifest = parseManifest(JSON.parse(await readFile(join(dir, 'plugin.json'), 'utf8')));
    // `main` jest walidowany jako ścieżka względna bez wyjścia z katalogu.
    const entry = join(dir, manifest.main);
    const code = manifest.runtime === 'node' ? '' : await readFile(entry, 'utf8');
    return { manifest, code, entry };
  } catch (error) {
    console.warn(`[plugins] pominięto ${dir}:`, (error as Error).message);
    return null;
  }
}

/** Obsługa wiadomości od hosta — tu egzekwujemy uprawnienia. */
function handleHostMessage(raw: unknown): void {
  const msg = raw as {
    type?: string;
    pluginId?: string;
    commandId?: string;
    toolId?: string;
    callId?: string;
    result?: string;
    level?: string;
    message?: string;
  };
  const plugin = msg.pluginId ? plugins.get(msg.pluginId) : undefined;

  // Odpowiedzi narzędzi (request/response po callId) — bez zależności od pluginId.
  if (msg.type === 'tool-result' && msg.callId) {
    const pending = pendingTools.get(msg.callId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingTools.delete(msg.callId);
      pending.resolve(String(msg.result ?? ''));
    }
    return;
  }
  if (msg.type === 'tool-error' && msg.callId) {
    const pending = pendingTools.get(msg.callId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingTools.delete(msg.callId);
      pending.reject(new Error(String(msg.message ?? 'błąd narzędzia')));
    }
    return;
  }

  if (msg.type === 'register-tool' && plugin && msg.toolId) {
    if (!hasPermission(plugin.manifest, 'ai.tools')) {
      console.warn(`[plugins] ${plugin.manifest.id}: brak uprawnienia ai.tools`);
      return;
    }
    // Narzędzie musi być zadeklarowane w manifeście — nie wolno zgłosić dowolnego.
    const declared = plugin.manifest.contributes.tools?.some((t) => t.id === msg.toolId);
    if (!declared) {
      console.warn(`[plugins] ${plugin.manifest.id}: narzędzie ${msg.toolId} nie zadeklarowane`);
      return;
    }
    if (!plugin.tools.includes(msg.toolId)) plugin.tools.push(msg.toolId);
    notifyToolsChanged();
    return;
  }

  if (msg.type === 'register-command' && plugin && msg.commandId) {
    if (!hasPermission(plugin.manifest, 'commands.register')) {
      console.warn(`[plugins] ${plugin.manifest.id}: brak uprawnienia commands.register`);
      return;
    }
    // Komenda musi być zadeklarowana w contributes — nie wolno rejestrować dowolnej.
    const declared = plugin.manifest.contributes.commands.find((c) => c.id === msg.commandId);
    if (!declared) {
      console.warn(`[plugins] ${plugin.manifest.id}: komenda ${msg.commandId} nie zadeklarowana`);
      return;
    }
    plugin.commands.push({ id: declared.id, title: declared.title });
    notifyRenderer();
    return;
  }

  if (msg.type === 'notify' && plugin) {
    if (!hasPermission(plugin.manifest, 'notifications.show')) {
      console.warn(`[plugins] ${plugin.manifest.id}: brak uprawnienia notifications.show`);
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcEvent.PluginNotification, {
        pluginName: plugin.manifest.name,
        level: msg.level ?? 'info',
        message: String(msg.message ?? '')
      });
    }
    return;
  }

  if (msg.type === 'error' && msg.pluginId) {
    console.warn(`[plugins] ${msg.pluginId} błąd:`, msg.message);
  }
}

/**
 * Włączenie wtyczki z własnym procesem.
 *
 * Wpis w `plugins` znaczy „aktywna": stąd biorą się jej komendy w palecie i stąd bramka RPC
 * wie, że wolno ją obsłużyć. Komendy są puste — zgłoszą się same przez RPC w `activate()`.
 */
async function uruchomNode(manifest: PluginManifest, entry: string): Promise<void> {
  zarejestruj(manifest, entry);
  plugins.set(manifest.id, { manifest, commands: [], tools: [] });
  // Widoki-strony nie mają dostawcy danych — są dostępne od chwili, gdy wtyczka działa.
  for (const view of manifest.contributes.views ?? []) {
    if (view.type === 'webview') dodajWidok(manifest, view, dirname(dirname(entry)));
  }
  await uruchom(manifest.id);
}

/** Katalog wtyczki (rodzic katalogu z modułem wejściowym). */
function katalogWtyczki(pluginId: string): string {
  return dirname(dirname(discovered.get(pluginId)?.entry ?? ''));
}

/** Wyłączenie: proces ginie, a wtyczka przestaje istnieć dla palety i bramki RPC. */
async function zatrzymajNode(pluginId: string): Promise<void> {
  await zatrzymaj(pluginId);
  plugins.delete(pluginId);
  usunElementyPaska(pluginId);
  usunWidoki(pluginId);
  notifyRenderer();
  notifyToolsChanged();
}

/**
 * Kontekst wtyczki dla bramki RPC.
 *
 * Bramka nie zna map menedżera — dostaje wąski obiekt: manifest do sprawdzenia uprawnień
 * i dwie operacje, które wolno jej wykonać. `undefined` znaczy „wtyczka nieaktywna" i jest
 * jedyną odpowiedzią dla wtyczki, która zdążyła zostać wyłączona.
 */
function kontekstWtyczki(pluginId: string): KontekstWtyczki | undefined {
  const plugin = plugins.get(pluginId);
  if (!plugin) return undefined;
  return {
    manifest: plugin.manifest,
    zarejestrujKomende: (commandId) => {
      const declared = plugin.manifest.contributes.commands.find((c) => c.id === commandId);
      if (!declared) return false;
      if (!plugin.commands.some((c) => c.id === commandId)) {
        plugin.commands.push({ id: declared.id, title: declared.title });
        notifyRenderer();
      }
      return true;
    },
    zarejestrujWidok: (viewId) => {
      const declared = plugin.manifest.contributes.views?.find((v) => v.id === viewId);
      if (!declared) return false;
      dodajWidok(plugin.manifest, declared, katalogWtyczki(pluginId));
      return true;
    },
    wyslijDoWidoku: (viewId, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcEvent.PluginToView, { pluginId, viewId, payload });
      }
    },
    odswiezWidok: (viewId) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcEvent.PluginViewRefresh, { pluginId, viewId });
      }
    },
    otworzTerminal: (cwd, label) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcEvent.PluginOpenTerminal, { cwd, label });
      }
    },
    ustawElementPaska: (item) => {
      const klucz = `${pluginId}::${item.id}`;
      if ('usun' in item) elementyPaska.delete(klucz);
      else {
        elementyPaska.set(klucz, {
          pluginId,
          pluginName: plugin.manifest.name,
          id: item.id,
          text: item.text,
          ...(item.tooltip === undefined ? {} : { tooltip: item.tooltip }),
          ...(item.command === undefined ? {} : { command: item.command })
        });
      }
      notifyStatusBar();
    },
    pokazPowiadomienie: (message, level) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcEvent.PluginNotification, {
          pluginName: plugin.manifest.name,
          level,
          message
        });
      }
    }
  };
}

/** Lista komend wszystkich wtyczek do palety w rendererze. */
function allCommands(): Array<{ pluginId: string; id: string; title: string }> {
  const out: Array<{ pluginId: string; id: string; title: string }> = [];
  for (const plugin of plugins.values()) {
    for (const c of plugin.commands) out.push({ pluginId: plugin.manifest.id, id: c.id, title: c.title });
  }
  return out;
}

/** Elementy paska statusu ze wszystkich wtyczek — kolejność stabilna (po kluczu). */
function statusItems(): PluginStatusItem[] {
  return [...elementyPaska.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item);
}

/**
 * Dopisuje widok wtyczki do listy dostępnych.
 *
 * Drzewo trafia tu dopiero, gdy wtyczka zgłosi dostawcę danych (bez niego nie ma czego
 * pokazać). Widok-strona (`webview`) nie ma dostawcy — istnieje od chwili, gdy wtyczka
 * działa, bo cała jego treść jest jej plikiem.
 */
function dodajWidok(manifest: PluginManifest, declared: NonNullable<PluginManifest['contributes']['views']>[number], katalogWtyczki: string): void {
  const wpis: PluginView = {
    pluginId: manifest.id,
    pluginName: manifest.name,
    id: declared.id,
    title: declared.title,
    type: declared.type === 'webview' ? 'webview' : 'tree'
  };
  if (wpis.type === 'webview' && declared.entry) {
    udostepnijKatalog(manifest.id, katalogWtyczki);
    // W adresie separatorem jest zawsze ukośnik, także gdy manifest podał backslash.
    wpis.url = `${SCHEMAT}://${hostWtyczki(manifest.id)}/${declared.entry.replace(/\\/g, '/')}`;
  }
  widoki.set(`${manifest.id}::${declared.id}`, wpis);
  notifyViews();
}

/** Widoki wszystkich wtyczek — kolejność stabilna. */
function viewList(): PluginView[] {
  return [...widoki.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
}

function notifyViews(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcEvent.PluginViewsChanged, viewList());
  }
}

/** Zdejmuje widoki wyłączanej wtyczki — jej zakładki nie mają skąd brać danych. */
function usunWidoki(pluginId: string): void {
  cofnijUdostepnienie(pluginId);
  let zmiana = false;
  for (const klucz of [...widoki.keys()]) {
    if (klucz.startsWith(`${pluginId}::`)) {
      widoki.delete(klucz);
      zmiana = true;
    }
  }
  if (zmiana) notifyViews();
}

function notifyStatusBar(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcEvent.PluginStatusBarChanged, statusItems());
  }
}

/** Zdejmuje z paska wszystko, co należało do wyłączanej wtyczki. */
function usunElementyPaska(pluginId: string): void {
  let zmiana = false;
  for (const klucz of [...elementyPaska.keys()]) {
    if (klucz.startsWith(`${pluginId}::`)) {
      elementyPaska.delete(klucz);
      zmiana = true;
    }
  }
  if (zmiana) notifyStatusBar();
}

function notifyRenderer(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcEvent.PluginCommandsChanged, allCommands());
  }
}

/** Narzędzia AI ze wszystkich aktywnych wtyczek — spec z manifestu dla zarejestrowanych narzędzi. */
function pluginTools(): PluginToolInfo[] {
  const out: PluginToolInfo[] = [];
  for (const plugin of plugins.values()) {
    if (!hasPermission(plugin.manifest, 'ai.tools')) continue;
    // Osobna zgoda: narzędzia wtyczki są niewidoczne dla modelu, dopóki użytkownik ich
    // świadomie nie udostępni. Zaufanie do wtyczki tego NIE obejmuje.
    if (!aiToolsAllowed(plugin.manifest.id)) continue;
    for (const toolId of plugin.tools) {
      const spec = plugin.manifest.contributes.tools?.find((t) => t.id === toolId);
      if (!spec) continue;
      out.push({
        pluginId: plugin.manifest.id,
        id: spec.id,
        description: spec.description,
        parameters: spec.parameters,
        risky: spec.risky === true
      });
    }
  }
  return out;
}

function notifyToolsChanged(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcEvent.PluginToolsChanged, pluginTools());
  }
}

/**
 * Wywołuje narzędzie wtyczki i czeka na wynik (request/response po callId).
 *
 * Bramka bezpieczeństwa: wtyczka musi być aktywna, mieć uprawnienie ai.tools, a narzędzie —
 * być zadeklarowane w manifeście i zarejestrowane w runtime. Inaczej odrzucamy, zanim
 * cokolwiek trafi do hosta.
 */
function runPluginTool(pluginId: string, toolId: string, args: Record<string, unknown>): Promise<string> {
  const plugin = plugins.get(pluginId);
  if (!plugin) return Promise.reject(new Error('Wtyczka nieaktywna'));
  if (!hasPermission(plugin.manifest, 'ai.tools')) return Promise.reject(new Error('Brak uprawnienia ai.tools'));
  const declared = plugin.manifest.contributes.tools?.some((t) => t.id === toolId);
  if (!declared || !plugin.tools.includes(toolId)) return Promise.reject(new Error('Narzędzie niedostępne'));

  const callId = randomUUID();
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingTools.delete(callId);
      reject(new Error('Przekroczono czas oczekiwania na wynik narzędzia'));
    }, TOOL_TIMEOUT_MS);
    pendingTools.set(callId, { resolve, reject, timer });
    sendToHost({ type: 'invoke-tool', callId, pluginId, toolId, args });
  });
}

/** Lista zainstalowanych wtyczek dla menedżera (włączone + wyłączone). */
function installedList(): InstalledPlugin[] {
  return [...discovered.values()].map(({ manifest }) => {
    const wpis: InstalledPlugin = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      permissions: manifest.permissions,
      commands: manifest.contributes.commands,
      // Wtyczka z własnym procesem jest „włączona" dopiero po świadomej zgodzie —
      // brak zgody znaczy, że jej proces nigdy nie wstał.
      enabled: manifest.runtime === 'node' ? isTrusted(manifest.id) : !isDisabled(manifest.id),
      runtime: manifest.runtime,
      apiVersion: manifest.apiVersion,
      aiTools: aiToolsAllowed(manifest.id)
    };
    if (manifest.description) wpis.description = manifest.description;
    const info = manifest.runtime === 'node' ? infoWtyczki(manifest.id) : undefined;
    if (info) {
      wpis.proces = {
        stan: info.stan,
        awarie: info.awarie,
        ...(info.pid === undefined ? {} : { pid: info.pid }),
        ...(info.blad === undefined ? {} : { blad: info.blad }),
        ...(info.logPath === undefined ? {} : { logPath: info.logPath })
      };
    }
    return wpis;
  });
}

function notifyPluginsChanged(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcEvent.PluginsChanged, installedList());
  }
}

/**
 * Włącza/wyłącza wtyczkę.
 *
 * Wyłączenie usuwa ją z aktywnych (komendy znikają z palety, invoke jest blokowany) i
 * zapamiętuje stan. Włączenie ładuje jej kod do hosta na nowo. Stan przeżywa restart.
 */
async function setPluginEnabled(id: string, enabled: boolean): Promise<InstalledPlugin[]> {
  const entry = discovered.get(id);
  if (!entry) return installedList();
  setDisabled(id, !enabled);

  // Wtyczka z własnym procesem: włączenie jest ŚWIADOMĄ zgodą na pełny dostęp do komputera
  // (patrz manifest.ts). Zapisujemy ją osobno, żeby po restarcie proces wstał tylko wtedy,
  // gdy użytkownik naprawdę o to poprosił. Czekamy na skutek, żeby lista wróciła prawdziwa.
  if (entry.manifest.runtime === 'node') {
    setTrusted(id, enabled);
    if (enabled) await uruchomNode(entry.manifest, entry.entry);
    else await zatrzymajNode(id);
    notifyPluginsChanged();
    return installedList();
  }

  if (enabled) {
    if (!plugins.has(id)) {
      plugins.set(id, { manifest: entry.manifest, commands: [], tools: [] });
      sendToHost({ type: 'load', pluginId: id, code: entry.code });
    }
  } else {
    // Blokuje invoke (PluginRunCommand sprawdza plugins.has) i usuwa komendy/narzędzia.
    plugins.delete(id);
  }

  notifyRenderer();
  notifyToolsChanged();
  notifyPluginsChanged();
  return installedList();
}

/**
 * Ponowny skan katalogów — wtyczkę wrzuconą do `userData/plugins` widać bez restartu.
 *
 * Kod wtyczki jest wykonywany w JEDNYM realmie hosta i nie ma czegoś takiego jak wyładowanie
 * modułu, więc odświeżenie oznacza: wyzerować zebrane wkłady (komendy, narzędzia) i wykonać
 * kod jeszcze raz. Wtyczka usunięta z dysku znika z listy i przestaje przyjmować wywołania,
 * ale jej ewentualne timery dożywają do zamknięcia aplikacji — to ograniczenie obecnego
 * modelu izolacji, nie przeoczenie.
 */
async function rescanPlugins(): Promise<InstalledPlugin[]> {
  const found = await scanPlugins();
  const seen = new Set(found.map((entry) => entry.manifest.id));

  // Wtyczki skasowane z dysku: przestają istnieć dla palety, narzędzi i invoke.
  for (const id of [...discovered.keys()]) {
    if (!seen.has(id)) {
      const stara = discovered.get(id);
      if (stara?.manifest.runtime === 'node') wyrejestruj(id);
      discovered.delete(id);
      plugins.delete(id);
    }
  }

  for (const entry of found) {
    const id = entry.manifest.id;
    discovered.set(id, entry);

    if (entry.manifest.runtime === 'node') {
      // Proces wtyczki: przeładowanie ma sens tylko wtedy, gdy już jej ufamy — inaczej
      // rejestrujemy ją i czekamy na decyzję użytkownika.
      zarejestruj(entry.manifest, entry.entry);
      if (!isDisabled(id) && isTrusted(id)) {
        plugins.set(id, { manifest: entry.manifest, commands: [], tools: [] });
        void przeladuj(id);
      }
      continue;
    }

    if (isDisabled(id)) {
      plugins.delete(id);
      continue;
    }
    // Świeży wpis: komendy i narzędzia zgłoszą się na nowo przy activate().
    plugins.set(id, { manifest: entry.manifest, commands: [], tools: [] });
    sendToHost({ type: 'load', pluginId: id, code: entry.code });
  }

  notifyRenderer();
  notifyToolsChanged();
  notifyPluginsChanged();
  return installedList();
}

/** Inicjalizacja: host, IPC i załadowanie wykrytych wtyczek. */
export async function initPlugins(window: BrowserWindow): Promise<void> {
  mainWindow = window;

  // Gotowość hosta: runtime po załadowaniu wysyła { type: 'ready' }. Dopiero wtedy
  // wolno wysyłać wtyczki. Resztę wiadomości kieruje handleHostMessage (egzekucja uprawnień).
  const ready = new Promise<void>((resolve) => {
    createPluginHost((raw) => {
      if ((raw as { type?: string })?.type === 'ready') resolve();
      else handleHostMessage(raw);
    });
  });

  ipcMain.handle(IpcChannel.PluginCommands, () => allCommands());
  ipcMain.handle(IpcChannel.PluginRunCommand, async (_event, pluginId: unknown, commandId: unknown) => {
    if (typeof pluginId !== 'string' || typeof commandId !== 'string') return;
    const plugin = plugins.get(pluginId);
    if (!plugin) return;
    if (plugin.manifest.runtime === 'node') {
      // Komenda wtyczki z własnym procesem to żądanie RPC — a nie strzał w ciemno jak w v1.
      await zadaj(pluginId, 'command.invoke', { commandId }).catch((error: unknown) => {
        console.warn(`[plugins] ${pluginId}: komenda ${commandId} nie wykonana:`, (error as Error).message);
      });
      return;
    }
    sendToHost({ type: 'invoke', pluginId, commandId });
  });

  // Renderer zgłasza, która zakładka jest aktywna — main do tej pory w ogóle tego nie wiedział.
  ipcMain.handle(IpcChannel.WorkspaceActiveTab, (_event, payload: unknown) => {
    const src = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : null;
    const tab =
      src && typeof src['title'] === 'string' && typeof src['kind'] === 'string'
        ? { title: src['title'].slice(0, 200), kind: src['kind'].slice(0, 40) }
        : null;
    ustawAktywnaZakladke(tab, dzialajaceWtyczki);
  });
  ipcMain.handle(IpcChannel.PluginInstalled, () => installedList());
  ipcMain.handle(IpcChannel.PluginSetEnabled, (_event, id: unknown, enabled: unknown) => {
    if (typeof id !== 'string' || typeof enabled !== 'boolean') return installedList();
    return setPluginEnabled(id, enabled);
  });

  // Narzędzia AI z wtyczek (AI-6).
  ipcMain.handle(IpcChannel.PluginSetAiTools, (_event, id: unknown, allowed: unknown) => {
    if (typeof id !== 'string' || typeof allowed !== 'boolean') return installedList();
    setAiToolsAllowed(id, allowed);
    notifyToolsChanged();
    notifyPluginsChanged();
    return installedList();
  });
  ipcMain.handle(IpcChannel.PluginStatusBar, () => statusItems());
  ipcMain.handle(IpcChannel.PluginViews, () => viewList());

  // Wiadomość z ramki widoku do procesu wtyczki. Bramka jest ta sama: widok musi być
  // zgłoszony przez żywą wtyczkę, inaczej wiadomość nigdzie nie trafia.
  ipcMain.handle(IpcChannel.PluginViewMessage, async (_event, pluginId: unknown, viewId: unknown, payload: unknown) => {
    if (typeof pluginId !== 'string' || typeof viewId !== 'string') return;
    if (!widoki.has(`${pluginId}::${viewId}`)) return;
    await zadaj(pluginId, 'view.message', { viewId, payload }).catch((error: unknown) => {
      console.warn(`[plugins] ${pluginId}: widok ${viewId} nie przyjął wiadomości:`, (error as Error).message);
    });
  });

  // Zawartość drzewa: renderer pyta o dzieci węzła, my pytamy wtyczkę. Bramka jest ta sama
  // co wszędzie — widok musi być zgłoszony przez ŻYWĄ wtyczkę.
  ipcMain.handle(IpcChannel.PluginViewChildren, async (_event, pluginId: unknown, viewId: unknown, nodeId: unknown) => {
    if (typeof pluginId !== 'string' || typeof viewId !== 'string') return [];
    if (!widoki.has(`${pluginId}::${viewId}`)) return [];
    const wynik = await zadaj(pluginId, 'view.getChildren', {
      viewId,
      nodeId: typeof nodeId === 'string' ? nodeId : null
    }).catch((error: unknown) => {
      console.warn(`[plugins] ${pluginId}: widok ${viewId} nie oddał dzieci:`, (error as Error).message);
      return [];
    });
    return Array.isArray(wynik) ? wynik.slice(0, 2000) : [];
  });

  // Komenda przypisana do węzła drzewa — wołana z identyfikatorem węzła.
  ipcMain.handle(IpcChannel.PluginRunNodeCommand, async (_event, pluginId: unknown, commandId: unknown, nodeId: unknown) => {
    if (typeof pluginId !== 'string' || typeof commandId !== 'string') return;
    const plugin = plugins.get(pluginId);
    if (!plugin || !plugin.manifest.contributes.commands.some((c) => c.id === commandId)) return;
    await zadaj(pluginId, 'command.invoke', {
      commandId,
      nodeId: typeof nodeId === 'string' ? nodeId : undefined
    }).catch((error: unknown) => {
      console.warn(`[plugins] ${pluginId}: komenda ${commandId} nie wykonana:`, (error as Error).message);
    });
  });
  ipcMain.handle(IpcChannel.PluginListTools, () => pluginTools());
  ipcMain.handle(IpcChannel.PluginRunTool, (_event, pluginId: unknown, toolId: unknown, args: unknown) => {
    if (typeof pluginId !== 'string' || typeof toolId !== 'string') {
      return Promise.reject(new Error('Nieprawidłowe wywołanie narzędzia'));
    }
    const safeArgs = typeof args === 'object' && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
    return runPluginTool(pluginId, toolId, safeArgs);
  });

  ipcMain.handle(IpcChannel.PluginRescan, () => rescanPlugins());

  // Sterowanie procesem wtyczki (tylko runtime: 'node').
  ipcMain.handle(IpcChannel.PluginStop, async (_event, id: unknown) => {
    if (typeof id === 'string') await zatrzymajNode(id);
    return installedList();
  });
  ipcMain.handle(IpcChannel.PluginReload, async (_event, id: unknown) => {
    if (typeof id !== 'string') return installedList();
    const entry = discovered.get(id);
    // Przeładowanie nie może być tylnymi drzwiami do uruchomienia wtyczki bez zgody.
    if (entry?.manifest.runtime === 'node' && !isTrusted(id)) return installedList();
    // Przeładowanie zaczyna od czystej listy komend — poprzedni proces mógł zgłosić inne.
    if (entry) plugins.set(id, { manifest: entry.manifest, commands: [], tools: [] });
    notifyRenderer();
    await przeladuj(id);
    return installedList();
  });
  ipcMain.handle(IpcChannel.PluginOpenLog, (_event, id: unknown) => {
    if (typeof id !== 'string') return;
    const log = infoWtyczki(id)?.logPath;
    if (log) return shell.openPath(log);
    return undefined;
  });

  // Każda zmiana stanu procesu (start, awaria, kwarantanna) odświeża menedżera.
  ustawObserwatora(() => notifyPluginsChanged());

  // Spięcie bramki RPC z procesami wtyczek. Wysyłka i odbiór są wstrzykiwane, żeby bramka
  // nie musiała nic wiedzieć o nadzorcy (i żeby nie powstał cykl importów).
  ustawWysylke(wyslij);
  ustawOdbiorRpc((pluginId, message) => {
    if (message.kind === 'req') {
      obsluzZadanie(pluginId, message, kontekstWtyczki(pluginId));
      return;
    }
    // Odpowiedzi na żądania aplikacji (np. wywołanie komendy).
    obsluzOdpowiedz(message);
  });

  await ready;

  for (const loaded of await scanPlugins()) {
    const id = loaded.manifest.id;
    discovered.set(id, loaded);

    if (loaded.manifest.runtime === 'node') {
      // Wtyczka z pełnym dostępem NIE startuje sama. Jest zarejestrowana i widoczna
      // w menedżerze, ale jej proces wstaje dopiero po świadomym włączeniu.
      zarejestruj(loaded.manifest, loaded.entry);
      if (!isDisabled(id) && isTrusted(id)) void uruchomNode(loaded.manifest, loaded.entry);
      continue;
    }

    // Wyłączone wtyczki są znane menedżerowi, ale nie trafiają do hosta.
    if (isDisabled(id)) continue;
    plugins.set(id, { manifest: loaded.manifest, commands: [], tools: [] });
    sendToHost({ type: 'load', pluginId: id, code: loaded.code });
  }
}

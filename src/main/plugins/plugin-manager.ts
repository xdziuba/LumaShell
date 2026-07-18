/**
 * Menedżer wtyczek (Etap 6).
 *
 * Wykrywa wtyczki, waliduje manifesty, ładuje ich kod do izolowanego hosta i EGZEKWUJE
 * uprawnienia na granicy RPC — to jest miejsce, w którym deklaracja z manifestu staje się
 * realną gwarancją (docs/architecture/10-decyzje.md#d2--izolacja-wtyczek-rpc-bez-node).
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, ipcMain, type BrowserWindow } from 'electron';
import { hasPermission, type PluginManifest } from '@core/plugins/manifest';
import { parseManifest } from '@shared/schemas/manifest-validation';
import { IpcChannel, IpcEvent, type InstalledPlugin } from '@shared/types/ipc';
import { createPluginHost, sendToHost } from './plugin-host';
import { isDisabled, setDisabled } from './plugin-state-store';

interface LoadedPlugin {
  manifest: PluginManifest;
  /** Komendy zgłoszone przez wtyczkę przez RPC (tylko te z prawem commands.register). */
  commands: Array<{ id: string; title: string }>;
}

/** Wszystkie wykryte wtyczki (włączone i wyłączone) — źródło dla menedżera. */
const discovered = new Map<string, { manifest: PluginManifest; code: string }>();
/** Aktualnie AKTYWNE wtyczki (włączone i załadowane do hosta). */
const plugins = new Map<string, LoadedPlugin>();
let mainWindow: BrowserWindow | undefined;

/** Katalogi, w których szukamy wtyczek: wbudowane w zasobach + własne w userData. */
function pluginDirs(): string[] {
  return [
    join(app.getAppPath(), 'resources', 'plugins'),
    join(app.getPath('userData'), 'plugins')
  ];
}

/** Wczytuje manifest i kod jednej wtyczki z katalogu. */
async function readPlugin(dir: string): Promise<{ manifest: PluginManifest; code: string } | null> {
  try {
    const manifest = parseManifest(JSON.parse(await readFile(join(dir, 'plugin.json'), 'utf8')));
    // `main` jest walidowany jako ścieżka względna bez wyjścia z katalogu.
    const code = await readFile(join(dir, manifest.main), 'utf8');
    return { manifest, code };
  } catch (error) {
    console.warn(`[plugins] pominięto ${dir}:`, (error as Error).message);
    return null;
  }
}

/** Obsługa wiadomości od hosta — tu egzekwujemy uprawnienia. */
function handleHostMessage(raw: unknown): void {
  const msg = raw as { type?: string; pluginId?: string; commandId?: string; level?: string; message?: string };
  const plugin = msg.pluginId ? plugins.get(msg.pluginId) : undefined;

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

/** Lista komend wszystkich wtyczek do palety w rendererze. */
function allCommands(): Array<{ pluginId: string; id: string; title: string }> {
  const out: Array<{ pluginId: string; id: string; title: string }> = [];
  for (const plugin of plugins.values()) {
    for (const c of plugin.commands) out.push({ pluginId: plugin.manifest.id, id: c.id, title: c.title });
  }
  return out;
}

function notifyRenderer(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcEvent.PluginCommandsChanged, allCommands());
  }
}

/** Lista zainstalowanych wtyczek dla menedżera (włączone + wyłączone). */
function installedList(): InstalledPlugin[] {
  return [...discovered.values()].map(({ manifest }) => ({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    permissions: manifest.permissions,
    commands: manifest.contributes.commands,
    enabled: !isDisabled(manifest.id)
  }));
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
function setPluginEnabled(id: string, enabled: boolean): InstalledPlugin[] {
  const entry = discovered.get(id);
  if (!entry) return installedList();
  setDisabled(id, !enabled);

  if (enabled) {
    if (!plugins.has(id)) {
      plugins.set(id, { manifest: entry.manifest, commands: [] });
      sendToHost({ type: 'load', pluginId: id, code: entry.code });
    }
  } else {
    // Blokuje invoke (PluginRunCommand sprawdza plugins.has) i usuwa komendy z palety.
    plugins.delete(id);
  }

  notifyRenderer();
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
  ipcMain.handle(IpcChannel.PluginRunCommand, (_event, pluginId: unknown, commandId: unknown) => {
    if (typeof pluginId !== 'string' || typeof commandId !== 'string') return;
    if (!plugins.has(pluginId)) return;
    sendToHost({ type: 'invoke', pluginId, commandId });
  });
  ipcMain.handle(IpcChannel.PluginInstalled, () => installedList());
  ipcMain.handle(IpcChannel.PluginSetEnabled, (_event, id: unknown, enabled: unknown) => {
    if (typeof id !== 'string' || typeof enabled !== 'boolean') return installedList();
    return setPluginEnabled(id, enabled);
  });

  await ready;

  for (const dir of pluginDirs()) {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue; // katalog może nie istnieć
    }
    for (const name of entries) {
      const loaded = await readPlugin(join(dir, name));
      if (!loaded) continue;
      const id = loaded.manifest.id;
      discovered.set(id, { manifest: loaded.manifest, code: loaded.code });
      // Wyłączone wtyczki są znane menedżerowi, ale nie trafiają do hosta.
      if (isDisabled(id)) continue;
      plugins.set(id, { manifest: loaded.manifest, commands: [] });
      sendToHost({ type: 'load', pluginId: id, code: loaded.code });
    }
  }
}

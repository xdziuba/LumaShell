/**
 * IPC dostawcy AI (AI-0).
 *
 * Renderer konfiguruje AI i pyta o modele, ale sam NIE woła modelu ani nie widzi klucza —
 * wszystko idzie tędy do procesu głównego, który trzyma klucz w safeStorage i wykonuje
 * połączenie sieciowe (docs/security/01-model-procesow.md).
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/types/ipc';
import { getAiConfig, getAiProvider, saveAiConfig } from '../ai/ai-config-store';

export function registerAiIpc(): void {
  ipcMain.handle(IpcChannel.AiGetConfig, () => getAiConfig());

  ipcMain.handle(IpcChannel.AiSaveConfig, (_event, payload: unknown) => {
    const p = (typeof payload === 'object' && payload !== null ? payload : {}) as {
      config?: unknown;
      apiKey?: unknown;
    };
    const apiKey = typeof p.apiKey === 'string' ? p.apiKey : undefined;
    return saveAiConfig(p.config, apiKey);
  });

  ipcMain.handle(IpcChannel.AiListModels, async () => (await getAiProvider()).listModels());

  // Test połączenia = udana lista modeli. Zwraca liczbę modeli albo rzuca czytelnym błędem.
  ipcMain.handle(IpcChannel.AiTestConnection, async (): Promise<{ ok: true; models: number }> => {
    const models = await (await getAiProvider()).listModels();
    return { ok: true, models: models.length };
  });
}

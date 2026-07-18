/**
 * IPC dostawcy AI (AI-0).
 *
 * Renderer konfiguruje AI i pyta o modele, ale sam NIE woła modelu ani nie widzi klucza —
 * wszystko idzie tędy do procesu głównego, który trzyma klucz w safeStorage i wykonuje
 * połączenie sieciowe (docs/security/01-model-procesow.md).
 */

import { ipcMain, type BrowserWindow } from 'electron';
import { IpcChannel, IpcEvent } from '@shared/types/ipc';
import { parseAiChat, parseAiChatCancel } from '@shared/schemas/ipc-validation';
import { getAiConfig, getAiProvider, saveAiConfig } from '../ai/ai-config-store';

/** Trwające żądania czatu — do anulowania (przycisk „stop"). Klucz = requestId. */
const inflight = new Map<string, AbortController>();

export function registerAiIpc(window: BrowserWindow): void {
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

  // Czat strumieniowy: delty lecą zdarzeniami AiChatDelta, a invoke rozwiązuje się pełnym
  // tekstem (albo rzuca czytelnym błędem). Model bierzemy z zapisanej konfiguracji — renderer
  // nie decyduje, którym modelem wołać, i nie widzi klucza.
  ipcMain.handle(IpcChannel.AiChat, async (_event, payload): Promise<{ full: string }> => {
    const { requestId, messages } = parseAiChat(payload);
    const [provider, config] = await Promise.all([getAiProvider(), getAiConfig()]);

    const controller = new AbortController();
    inflight.set(requestId, controller);
    try {
      const full = await provider.chat(
        { model: config.model, messages },
        (delta) => {
          if (!window.isDestroyed()) {
            window.webContents.send(IpcEvent.AiChatDelta, { requestId, delta });
          }
        },
        controller.signal
      );
      return { full };
    } finally {
      inflight.delete(requestId);
    }
  });

  // Anulowanie: przerywa fetch danego żądania. chat() odrzuci się AbortError, a invoke rzuci.
  ipcMain.handle(IpcChannel.AiChatCancel, (_event, payload) => {
    const { requestId } = parseAiChatCancel(payload);
    inflight.get(requestId)?.abort();
  });
}

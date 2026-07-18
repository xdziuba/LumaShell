/**
 * IPC dostawcy AI (AI-0).
 *
 * Renderer konfiguruje AI i pyta o modele, ale sam NIE woła modelu ani nie widzi klucza —
 * wszystko idzie tędy do procesu głównego, który trzyma klucz w safeStorage i wykonuje
 * połączenie sieciowe (docs/security/01-model-procesow.md).
 */

import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import { IpcChannel, IpcEvent, type AiChatResult } from '@shared/types/ipc';
import { parseAiChat, parseAiChatCancel } from '@shared/schemas/ipc-validation';
import { getAiConfig, getAiProvider, saveAiConfig } from '../ai/ai-config-store';

/** Górny limit dołączanego pliku — kontekst modelu i tak jest skończony. */
const MAX_ATTACH_BYTES = 256 * 1024;

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

  // Jedna tura czatu: delty tekstu lecą zdarzeniami AiChatDelta, a invoke zwraca tekst oraz
  // wywołania narzędzi, o które poprosił model (pętlę narzędzi prowadzi renderer). Model
  // bierzemy z zapisanej konfiguracji — renderer nie decyduje modelem i nie widzi klucza.
  ipcMain.handle(IpcChannel.AiChat, async (_event, payload): Promise<AiChatResult> => {
    const { requestId, messages, tools } = parseAiChat(payload);
    const [provider, config] = await Promise.all([getAiProvider(), getAiConfig()]);

    const controller = new AbortController();
    inflight.set(requestId, controller);
    try {
      return await provider.chat(
        { model: config.model, messages, tools },
        (delta) => {
          if (!window.isDestroyed()) {
            window.webContents.send(IpcEvent.AiChatDelta, { requestId, delta });
          }
        },
        controller.signal
      );
    } finally {
      inflight.delete(requestId);
    }
  });

  // Anulowanie: przerywa fetch danego żądania. chat() odrzuci się AbortError, a invoke rzuci.
  ipcMain.handle(IpcChannel.AiChatCancel, (_event, payload) => {
    const { requestId } = parseAiChatCancel(payload);
    inflight.get(requestId)?.abort();
  });

  // Dołączenie pliku do czatu: użytkownik SAM wybiera plik (dialog), więc to świadomy odczyt,
  // a nie autonomiczne czytanie dowolnych ścieżek przez model. Ucinamy do limitu rozmiaru.
  ipcMain.handle(
    IpcChannel.AiPickTextFile,
    async (): Promise<{ name: string; content: string } | null> => {
      const result = await dialog.showOpenDialog(window, { properties: ['openFile'] });
      if (result.canceled || result.filePaths.length === 0) return null;
      const path = result.filePaths[0]!;
      const buffer = await readFile(path);
      const clipped = buffer.subarray(0, MAX_ATTACH_BYTES).toString('utf8');
      const content = buffer.length > MAX_ATTACH_BYTES ? `${clipped}\n…(przycięto)` : clipped;
      return { name: basename(path), content };
    }
  );
}

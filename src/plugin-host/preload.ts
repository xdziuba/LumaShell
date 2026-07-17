/**
 * Preload Plugin Hosta.
 *
 * Wystawia JEDYNY most między sandboxowanym runtime hosta a procesem głównym — wąskie
 * RPC po ipcRenderer. Host nie ma Node, więc to całe jego okno na świat
 * (docs/architecture/10-decyzje.md#d2--izolacja-wtyczek-rpc-bez-node).
 */

import { contextBridge, ipcRenderer } from 'electron';

const TO_MAIN = 'plugin-host:to-main';
const TO_HOST = 'plugin-host:to-host';

contextBridge.exposeInMainWorld('pluginHost', {
  send: (message: unknown): void => {
    ipcRenderer.send(TO_MAIN, message);
  },
  onMessage: (callback: (message: unknown) => void): void => {
    ipcRenderer.on(TO_HOST, (_event, message: unknown) => callback(message));
  }
});

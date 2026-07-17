import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const alias = {
  '@core': resolve('src/core'),
  '@shared': resolve('src/shared'),
  '@services': resolve('src/services')
};

export default defineConfig({
  main: {
    // node-pty jest modułem natywnym — musi zostać zewnętrzny, nie wolno go bundlować.
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: { input: { index: resolve('src/main/main.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          // Osobny preload dla Plugin Hosta — wystawia wąski most RPC, bez Node
          // (docs/architecture/10-decyzje.md#d2--izolacja-wtyczek-rpc-bez-node).
          'plugin-host': resolve('src/plugin-host/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: {
      alias: { ...alias, '@renderer': resolve('src/renderer') }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          // Strona Plugin Hosta — ładowana w ukrytym, sandboxowanym oknie. Musi leżeć
          // wewnątrz roota renderera (src/renderer), stąd podkatalog.
          'plugin-host': resolve('src/renderer/plugin-host/index.html')
        }
      }
    }
  }
});

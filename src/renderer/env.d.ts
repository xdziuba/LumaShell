/// <reference types="vite/client" />

import type { LumaApi } from '@shared/types/api';

declare global {
  interface Window {
    /** Jedyne API dostępne w rendererze — implementacja w src/preload/api.ts. */
    readonly luma: LumaApi;
  }
}

/**
 * Webview wtyczek (Plugin API v2): dowolny HTML/JS wtyczki w zakładce LumaShella.
 *
 * Drzewa (`ui.registerTreeDataProvider`) załatwiają listy i hierarchie, ale nie każdy widok
 * jest listą — edytor, wykres czy podgląd potrzebują własnego rysowania. Tu wtyczka dostaje
 * własną stronę, a granice stawia APLIKACJA, nie ona:
 *
 * * strona jest serwowana ze schematu `luma-view://<pluginId>` — osobne pochodzenie na
 *   wtyczkę, więc Chromium daje jej osobny proces renderera i osobny magazyn,
 * * CSP ustawiamy w NAGŁÓWKU odpowiedzi, a nie w HTML-u wtyczki — wtyczka nie może jej
 *   sobie poluzować,
 * * `connect-src 'none'` i brak `script-src` spoza `'self'`: z webview nie wychodzi sieć,
 * * brak preloadu, brak Node, brak IPC — jedyne wyjście to `postMessage` do gospodarza,
 * * pliki serwujemy WYŁĄCZNIE z podkatalogu `media/` wtyczki, po kanonizacji ścieżki.
 *
 * To jest ta sama zasada, co przy drzewach: wtyczka dostaje dużo swobody w środku ramki,
 * ale nie dostaje wpływu na aplikację poza nią.
 */

import { readFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { protocol } from 'electron';

export const SCHEMAT = 'luma-view';

/** Katalogi `media` zarejestrowanych wtyczek: host → ścieżka na dysku. */
const katalogi = new Map<string, string>();

/**
 * Nagłówek CSP dla stron wtyczek.
 *
 * `unsafe-inline` dla stylów jest świadomym ustępstwem (wtyczki piszą style w HTML-u),
 * ale skrypty muszą być plikami z tego samego pochodzenia, a sieci nie ma wcale.
 */
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

const TYPY: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
};

/**
 * Most między ramką a wtyczką, wstrzykiwany jako `/__luma/api.js`.
 *
 * Dostarcza go APLIKACJA, nie wtyczka — dzięki temu kształt komunikacji jest jeden dla
 * wszystkich webview i nie zależy od tego, co wtyczka sobie zbunduje.
 */
const SHIM = `// Most LumaShella dla webview wtyczki (dostarczany przez aplikację).
(() => {
  const nasluchy = [];
  window.addEventListener('message', (event) => {
    // Wiadomości przychodzą wyłącznie od gospodarza ramki.
    if (event.source !== window.parent) return;
    const dane = event.data;
    if (!dane || dane.__luma !== 'do-widoku') return;
    for (const cb of nasluchy) {
      try { cb(dane.payload); } catch (e) { console.error('[luma] błąd nasłuchu:', e); }
    }
  });
  window.acquireLumaApi = () => ({
    /** Wysyła wiadomość do procesu wtyczki. */
    post: (payload) => window.parent.postMessage({ __luma: 'z-widoku', payload }, '*'),
    /** Nasłuch wiadomości od procesu wtyczki. */
    onMessage: (callback) => { nasluchy.push(callback); },
    /** Zmienne motywu aplikacji — żeby widok wtyczki nie odstawał wyglądem. */
    theme: JSON.parse(document.documentElement.dataset.lumaTheme || '{}')
  });
})();
`;

/** Rejestruje schemat jako uprzywilejowany. MUSI być wołane PRZED `app.whenReady()`. */
export function zarejestrujSchemat(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEMAT,
      privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false }
    }
  ]);
}

/** Host w URL-u: `luma-view://<id-wtyczki-bez-kropek>`. Kropki dzieliłyby domenę. */
export function hostWtyczki(pluginId: string): string {
  return pluginId.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
}

/** Dopisuje katalog `media` wtyczki do mapy serwowanych zasobów. */
export function udostepnijKatalog(pluginId: string, katalogWtyczki: string): void {
  katalogi.set(hostWtyczki(pluginId), join(katalogWtyczki, 'media'));
}

export function cofnijUdostepnienie(pluginId: string): void {
  katalogi.delete(hostWtyczki(pluginId));
}

/** Podpina obsługę schematu. Wołane po `app.whenReady()`. */
export function obsluzSchemat(): void {
  protocol.handle(SCHEMAT, async (request) => {
    const url = new URL(request.url);
    const katalog = katalogi.get(url.hostname);
    if (!katalog) return new Response('Nieznana wtyczka', { status: 404 });

    // Most jest generowany, a nie czytany z dysku — wtyczka nie może go podmienić.
    if (url.pathname === '/__luma/api.js') {
      return new Response(SHIM, {
        headers: { 'content-type': TYPY['.js']!, 'content-security-policy': CSP }
      });
    }

    const zadany = url.pathname === '/' ? '/index.html' : url.pathname;
    // Kanonizacja: po `resolve` sprawdzamy, że ścieżka NADAL leży w katalogu media.
    // Inaczej `..%2f..` wyprowadziłoby czytanie poza wtyczkę.
    const pelna = resolve(join(katalog, decodeURIComponent(zadany)));
    const wzgledna = relative(resolve(katalog), pelna);
    if (wzgledna.startsWith('..') || wzgledna.startsWith(sep) || wzgledna.includes(`..${sep}`)) {
      return new Response('Poza katalogiem wtyczki', { status: 403 });
    }

    try {
      const tresc = await readFile(pelna);
      const typ = TYPY[extname(pelna).toLowerCase()] ?? 'application/octet-stream';
      return new Response(new Uint8Array(tresc), {
        headers: {
          'content-type': typ,
          'content-security-policy': CSP,
          // Widok wtyczki nie ma powodu być osadzany gdzie indziej ani zgadywać typu.
          'x-content-type-options': 'nosniff'
        }
      });
    } catch {
      return new Response('Nie znaleziono', { status: 404 });
    }
  });
}

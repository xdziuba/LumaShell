/**
 * Strona widoku wtyczki (Plugin API v2) osadzona w zakładce.
 *
 * Ramka żyje pod własnym pochodzeniem `luma-view://<wtyczka>`, więc Chromium daje jej
 * osobny proces i osobny magazyn. CSP ustawia aplikacja w nagłówku odpowiedzi (patrz
 * `plugin-webview.ts`) — wtyczka nie może jej sobie poluzować, nie ma preloadu, Node ani
 * sieci. Jedyne wyjście z ramki to `postMessage` do tego komponentu, który przekazuje
 * wiadomość dalej do PROCESU wtyczki (przez bramkę uprawnień w mainie).
 *
 * Komponent świadomie nie interpretuje treści wiadomości — to prywatny protokół między
 * wtyczką a jej własną stroną.
 */

import { useEffect, useRef } from 'react';
import type { PluginView } from '@shared/types/ipc';

export default function PluginWebview({ view, onClose }: { view: PluginView; onClose: () => void }): React.JSX.Element {
  const ramkaRef = useRef<HTMLIFrameElement>(null);

  // Wiadomości OD ramki → do procesu wtyczki.
  useEffect(() => {
    const naWiadomosc = (event: MessageEvent): void => {
      // Przyjmujemy wyłącznie wiadomości z NASZEJ ramki. Bez tego dowolna strona otwarta
      // w aplikacji mogłaby udawać widok wtyczki.
      if (!ramkaRef.current || event.source !== ramkaRef.current.contentWindow) return;
      const dane = event.data as { __luma?: string; payload?: unknown } | null;
      if (!dane || dane.__luma !== 'z-widoku') return;
      window.luma.plugins.postToView(view.pluginId, view.id, dane.payload);
    };
    window.addEventListener('message', naWiadomosc);
    return () => window.removeEventListener('message', naWiadomosc);
  }, [view.pluginId, view.id]);

  // Wiadomości OD wtyczki → do ramki.
  useEffect(() => {
    return window.luma.plugins.onViewMessage((event) => {
      if (event.pluginId !== view.pluginId || event.viewId !== view.id) return;
      ramkaRef.current?.contentWindow?.postMessage({ __luma: 'do-widoku', payload: event.payload }, '*');
    });
  }, [view.pluginId, view.id]);

  return (
    <div className="panel">
      <header className="panel__header">
        <span className="panel__title">{view.title.toUpperCase()}</span>
        <div className="panel__header-actions">
          <span className="plugins__badge" title={`Widok wtyczki ${view.pluginName}`}>
            {view.pluginName}
          </span>
          <button
            className="panel__link"
            onClick={() => {
              // Przeładowanie ramki: najprostsza droga, gdy wtyczka zmieniła swoje pliki.
              const ramka = ramkaRef.current;
              if (ramka) ramka.src = `${view.url ?? ''}${view.url?.includes('?') ? '&' : '?'}t=${Date.now()}`;
            }}
          >
            Odśwież
          </button>
        </div>
        <button className="panel__close" onClick={onClose} aria-label="Zamknij">
          ✕
        </button>
      </header>

      <div className="panel__body pview">
        {/* Bez atrybutu `sandbox`: izolację daje osobne pochodzenie i CSP z nagłówka.
            `allow` puste — widok wtyczki nie dostaje kamery, mikrofonu ani geolokalizacji. */}
        <iframe
          ref={ramkaRef}
          className="pview__frame"
          src={view.url}
          title={`${view.pluginName} — ${view.title}`}
          allow=""
        />
      </div>
    </div>
  );
}

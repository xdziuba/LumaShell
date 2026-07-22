/**
 * Menedżer zainstalowanych wtyczek (Etap UI) — otwierany jako zakładka.
 *
 * Po lewej lista wtyczek z przełącznikiem włącz/wyłącz, po prawej szczegóły wybranej:
 * wersja, uprawnienia, komendy i sekcja konfiguracji. Wyłączenie znosi komendy z palety i
 * blokuje wywołania; stan przeżywa restart (plugin-state-store w procesie głównym).
 *
 * Konfiguracja: wtyczki nie deklarują jeszcze opcji — sekcja pokazuje to wprost. Gdy pojawi
 * się schemat konfiguracji w manifeście, tu wyrenderuje się formularz.
 */

import { useEffect, useState } from 'react';
import type { InstalledPlugin } from '@shared/types/ipc';

/** Stan procesu wtyczki po ludzku — użytkownik nie ma znać nazw wewnętrznych. */
const STAN_OPIS: Record<string, string> = {
  zatrzymana: 'proces zatrzymany',
  startuje: 'uruchamianie…',
  dziala: 'proces działa',
  blad: 'błąd',
  kwarantanna: 'kwarantanna (za dużo awarii)'
};

export default function PluginManager({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [plugins, setPlugins] = useState<InstalledPlugin[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [katalog, setKatalog] = useState('');

  useEffect(() => {
    void window.luma.plugins.installed().then(setPlugins);
    void window.luma.paths.get().then((paths) => setKatalog(paths.plugins));
    return window.luma.plugins.onPluginsChanged(setPlugins);
  }, []);

  const odswiez = (): void => {
    setPlugins(null);
    void window.luma.plugins.rescan().then(setPlugins);
  };

  const toggle = (id: string, enabled: boolean): void => {
    void window.luma.plugins.setEnabled(id, enabled).then(setPlugins);
  };

  const selected = plugins?.find((p) => p.id === selectedId) ?? plugins?.[0] ?? null;

  return (
    <div className="panel">
      <header className="panel__header">
        <span className="panel__title">WTYCZKI</span>
        <div className="panel__header-actions">
          <button className="panel__link" onClick={odswiez} title="Przeskanuj katalogi wtyczek">
            Odśwież
          </button>
          <button
            className="panel__link"
            onClick={() => window.luma.paths.open('plugins')}
            title={katalog}
          >
            Otwórz katalog
          </button>
        </div>
        <button className="panel__close" onClick={onClose} aria-label="Zamknij">
          ✕
        </button>
      </header>

      <div className="panel__body plugins">
        <div className="plugins__list">
          {plugins === null && <div className="panel__hint">ładowanie…</div>}
          {plugins?.length === 0 && (
            <div className="panel__hint">
              Brak zainstalowanych wtyczek. Wrzuć katalog wtyczki (z plikiem plugin.json) do
              katalogu wtyczek i kliknij „Odśwież".
            </div>
          )}
          {plugins?.map((p) => (
            <button
              key={p.id}
              className={`plugins__item${selected?.id === p.id ? ' is-active' : ''}`}
              onClick={() => setSelectedId(p.id)}
            >
              <span className={`plugins__dot${p.enabled ? ' is-on' : ''}`} />
              <span className="plugins__name">{p.name}</span>
              {p.runtime === 'node' && (
                <span className="plugins__badge" title="Własny proces z pełnym dostępem">
                  node
                </span>
              )}
              <span className="plugins__ver">v{p.version}</span>
            </button>
          ))}
        </div>

        {selected && (
          <div className="plugins__detail">
            <div className="plugins__detail-head">
              <div>
                <div className="plugins__detail-name">{selected.name}</div>
                <div className="plugins__detail-id">{selected.id}</div>
              </div>
              <label
                className="plugins__toggle"
                title={
                  selected.runtime === 'node'
                    ? 'Włączenie oznacza zgodę na uruchomienie programu z pełnym dostępem do komputera'
                    : selected.enabled
                      ? 'Wyłącz'
                      : 'Włącz'
                }
              >
                <input
                  type="checkbox"
                  checked={selected.enabled}
                  onChange={(e) => toggle(selected.id, e.target.checked)}
                />
                <span className="plugins__toggle-track" />
                <span className="plugins__toggle-label">
                  {selected.enabled
                    ? 'Włączona'
                    : selected.runtime === 'node'
                      ? 'Wyłączona (wymaga zgody)'
                      : 'Wyłączona'}
                </span>
              </label>
            </div>

            {selected.runtime === 'node' && (
              <section className="plugins__section plugins__section--warn">
                <h4 className="plugins__section-title">Pełny dostęp do komputera</h4>
                <div className="panel__hint">
                  Ta wtyczka działa we własnym procesie z pełnym Node.js. Znaczy to dokładnie tyle:
                  jest programem uruchomionym na Twoim koncie i może czytać oraz zmieniać Twoje
                  pliki, łączyć się z siecią i uruchamiać inne programy. LumaShell tego{' '}
                  <b>nie ogranicza</b> — ogranicza tylko dostęp do własnych zasobów (terminal,
                  zakładki, sekrety, narzędzia AI). Dlatego jej proces nie startuje, dopóki jej nie
                  włączysz.
                </div>
                <div className="plugins__proc">
                  <span className={`plugins__proc-stan is-${selected.proces?.stan ?? 'zatrzymana'}`}>
                    {STAN_OPIS[selected.proces?.stan ?? 'zatrzymana']}
                  </span>
                  {selected.proces?.pid !== undefined && (
                    <span className="plugins__proc-pid">PID {selected.proces.pid}</span>
                  )}
                  {(selected.proces?.awarie ?? 0) > 0 && (
                    <span className="plugins__proc-pid">awarie: {selected.proces?.awarie}</span>
                  )}
                </div>
                {selected.proces?.blad && <div className="plugins__proc-blad">{selected.proces.blad}</div>}
                <div className="plugins__proc-akcje">
                  <button
                    className="panel__link"
                    onClick={() => void window.luma.plugins.reload(selected.id).then(setPlugins)}
                    disabled={!selected.enabled}
                    title="Zatrzymaj i uruchom z bieżącym kodem z dysku"
                  >
                    Przeładuj
                  </button>
                  <button
                    className="panel__link"
                    onClick={() => void window.luma.plugins.stop(selected.id).then(setPlugins)}
                    disabled={selected.proces?.stan !== 'dziala' && selected.proces?.stan !== 'startuje'}
                  >
                    Zatrzymaj proces
                  </button>
                  <button className="panel__link" onClick={() => window.luma.plugins.openLog(selected.id)}>
                    Log wtyczki
                  </button>
                </div>
              </section>
            )}

            <section className="plugins__section">
              <h4 className="plugins__section-title">Uprawnienia</h4>
              {selected.permissions.length === 0 ? (
                <div className="panel__hint">Brak wymaganych uprawnień.</div>
              ) : (
                <div className="plugins__chips">
                  {selected.permissions.map((perm) => (
                    <span key={perm} className="plugins__chip">
                      {perm}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {selected.permissions.includes('ai.tools') && (
              <section className="plugins__section plugins__section--warn">
                <h4 className="plugins__section-title">Narzędzia dla agenta AI</h4>
                <div className="panel__hint">
                  Agent działa sam, w pętli, i wywoła narzędzie wtyczki <b>bez pytania</b> — to
                  inne ryzyko niż komenda uruchomiona ręcznie. Dlatego zgoda jest osobna od
                  włączenia wtyczki i domyślnie wyłączona.
                </div>
                <label className="plugins__toggle" title="Udostępnij narzędzia tej wtyczki modelowi">
                  <input
                    type="checkbox"
                    checked={selected.aiTools}
                    onChange={(e) => void window.luma.plugins.setAiTools(selected.id, e.target.checked).then(setPlugins)}
                  />
                  <span className="plugins__toggle-track" />
                  <span className="plugins__toggle-label">
                    {selected.aiTools ? 'Widoczne dla modelu' : 'Ukryte przed modelem'}
                  </span>
                </label>
              </section>
            )}

            <section className="plugins__section">
              <h4 className="plugins__section-title">Komendy</h4>
              {selected.commands.length === 0 ? (
                <div className="panel__hint">Wtyczka nie wystawia komend.</div>
              ) : (
                <ul className="plugins__cmds">
                  {selected.commands.map((cmd) => (
                    <li key={cmd.id}>
                      <span className="plugins__cmd-title">{cmd.title}</span>
                      <span className="plugins__cmd-id">{cmd.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="plugins__section">
              <h4 className="plugins__section-title">Konfiguracja</h4>
              <div className="panel__hint">Ta wtyczka nie ma opcji do skonfigurowania.</div>
            </section>

            <section className="plugins__section">
              <h4 className="plugins__section-title">Katalog wtyczek</h4>
              <div className="panel__hint">
                Własne wtyczki wrzucasz tutaj — wbudowane siedzą w archiwum aplikacji i są tylko
                do odczytu.
              </div>
              <code className="plugins__path">{katalog || '…'}</code>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

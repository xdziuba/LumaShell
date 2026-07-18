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

export default function PluginManager({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [plugins, setPlugins] = useState<InstalledPlugin[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void window.luma.plugins.installed().then(setPlugins);
    return window.luma.plugins.onPluginsChanged(setPlugins);
  }, []);

  const toggle = (id: string, enabled: boolean): void => {
    void window.luma.plugins.setEnabled(id, enabled).then(setPlugins);
  };

  const selected = plugins?.find((p) => p.id === selectedId) ?? plugins?.[0] ?? null;

  return (
    <div className="panel">
      <header className="panel__header">
        <span className="panel__title">WTYCZKI</span>
        <button className="panel__close" onClick={onClose} aria-label="Zamknij">
          ✕
        </button>
      </header>

      <div className="panel__body plugins">
        <div className="plugins__list">
          {plugins === null && <div className="panel__hint">ładowanie…</div>}
          {plugins?.length === 0 && <div className="panel__hint">Brak zainstalowanych wtyczek.</div>}
          {plugins?.map((p) => (
            <button
              key={p.id}
              className={`plugins__item${selected?.id === p.id ? ' is-active' : ''}`}
              onClick={() => setSelectedId(p.id)}
            >
              <span className={`plugins__dot${p.enabled ? ' is-on' : ''}`} />
              <span className="plugins__name">{p.name}</span>
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
              <label className="plugins__toggle" title={selected.enabled ? 'Wyłącz' : 'Włącz'}>
                <input
                  type="checkbox"
                  checked={selected.enabled}
                  onChange={(e) => toggle(selected.id, e.target.checked)}
                />
                <span className="plugins__toggle-track" />
                <span className="plugins__toggle-label">{selected.enabled ? 'Włączona' : 'Wyłączona'}</span>
              </label>
            </div>

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
          </div>
        )}
      </div>
    </div>
  );
}

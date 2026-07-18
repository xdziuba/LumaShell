/**
 * Panel „Nowości" (What's New) — otwierany jako zakładka (Etap UI).
 *
 * Wpisy pobiera proces główny z pliku na GitHubie (renderer nie ma dostępu do sieci przez
 * CSP), z lokalnym fallbackiem dołączonym do aplikacji.
 */

import { useEffect, useState } from 'react';
import type { WhatsNewEntry } from '@shared/types/ipc';

export default function WhatsNewPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [entries, setEntries] = useState<WhatsNewEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    window.luma
      .whatsNew()
      .then((list) => {
        if (alive) setEntries(list);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="panel">
      <header className="panel__header">
        <span className="panel__title">NOWOŚCI</span>
        <button className="panel__close" onClick={onClose} aria-label="Zamknij">
          ✕
        </button>
      </header>

      <div className="panel__body">
        {error && <div className="panel__hint">Nie udało się pobrać listy nowości.</div>}
        {!error && entries === null && <div className="panel__hint">ładowanie…</div>}
        {entries?.map((entry) => (
          <section key={entry.version} className="whatsnew__entry">
            <div className="whatsnew__head">
              <span className="whatsnew__version">v{entry.version}</span>
              <span className="whatsnew__title">{entry.title}</span>
              <span className="whatsnew__date">{entry.date}</span>
            </div>
            <ul className="whatsnew__list">
              {entry.changes.map((change, i) => (
                <li key={i}>{change}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * Przeglądarka plików SFTP (Etap 3).
 *
 * Działa na istniejącej sesji SSH (po jej `sessionId`). Listuje katalog zdalny, pozwala
 * wejść w podkatalog, cofnąć się, pobrać plik i wysłać plik do bieżącego katalogu.
 * Ładowana leniwie (docs/architecture/05-wydajnosc.md).
 */

import { useCallback, useEffect, useState } from 'react';
import type { SftpEntry } from '@shared/types/ipc';

interface SftpPanelProps {
  sessionId: string;
  onClose: () => void;
}

/** POSIX-owe złączenie ścieżek — zdalny host to niemal zawsze uniks. */
function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/$/, '')}/${name}`;
}
function parentPath(dir: string): string {
  const trimmed = dir.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx <= 0 ? '/' : trimmed.slice(0, idx);
}

export default function SftpPanel({ sessionId, onClose }: SftpPanelProps): React.JSX.Element {
  const [path, setPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wczytaj = useCallback(
    async (target: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const list = await window.luma.sftp.list(sessionId, target);
        // Katalogi najpierw, potem alfabetycznie.
        list.sort((a, b) =>
          a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
        );
        setEntries(list);
        setPath(target);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [sessionId]
  );

  // Start w katalogu domowym (realpath z '.').
  useEffect(() => {
    void window.luma.sftp
      .realpath(sessionId, '.')
      .then((home) => wczytaj(home))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [sessionId, wczytaj]);

  const otworz = (entry: SftpEntry): void => {
    if (!path) return;
    if (entry.type === 'dir') void wczytaj(joinPath(path, entry.name));
    else void window.luma.sftp.download(sessionId, joinPath(path, entry.name));
  };

  const wyslij = async (): Promise<void> => {
    if (!path) return;
    const name = await window.luma.sftp.upload(sessionId, path);
    if (name) void wczytaj(path); // odśwież, żeby zobaczyć wysłany plik
  };

  return (
    <aside className="sftp">
      <div className="sftp__header">
        <span className="sftp__title">SFTP</span>
        <button className="sftp__close" onClick={onClose} aria-label="Zamknij SFTP">
          ✕
        </button>
      </div>

      <div className="sftp__toolbar">
        <button
          className="sftp__btn"
          onClick={() => path && wczytaj(parentPath(path))}
          disabled={!path || path === '/'}
          title="Katalog wyżej"
        >
          ↑
        </button>
        <button className="sftp__btn" onClick={() => void wyslij()} disabled={!path} title="Wyślij plik">
          ⬆ plik
        </button>
        <span className="sftp__path" title={path ?? ''}>
          {path ?? '…'}
        </span>
      </div>

      {error && <div className="sftp__error">{error}</div>}

      <ul className="sftp__list">
        {busy && entries.length === 0 && <li className="sftp__empty">wczytywanie…</li>}
        {entries.map((entry) => (
          <li
            key={entry.name}
            className={`sftp__entry sftp__entry--${entry.type}`}
            onDoubleClick={() => otworz(entry)}
            title={entry.type === 'dir' ? 'Wejdź (podwójne kliknięcie)' : 'Pobierz (podwójne kliknięcie)'}
          >
            <span className="sftp__icon">{entry.type === 'dir' ? '📁' : '📄'}</span>
            <span className="sftp__name">{entry.name}</span>
            {entry.type === 'file' && <span className="sftp__size">{entry.size} B</span>}
          </li>
        ))}
      </ul>
    </aside>
  );
}

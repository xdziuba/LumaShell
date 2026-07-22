/**
 * Menedżer plików zdalnych (SFTP) na istniejącej sesji SSH.
 *
 * Wcześniej była tu wyłącznie lista z pobieraniem po dwukliku. Teraz to pełne zarządzanie
 * zawartością: zaznaczanie wielu pozycji, tworzenie katalogów, zmiana nazwy, kopiowanie,
 * przenoszenie, usuwanie, uprawnienia, transfery w obie strony (także całych katalogów)
 * i przeciąganie plików wprost z pulpitu. Ładowana leniwie.
 *
 * Operacje wykonuje proces główny (sftp-ipc) — tutaj jest tylko widok, zaznaczenie i
 * schowek na wytnij/kopiuj.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SftpEntry, SftpProgressEvent } from '@shared/types/ipc';

interface SftpPanelProps {
  sessionId: string;
  onClose: () => void;
}

/** POSIX-owe złączenie ścieżek — zdalny host to niemal zawsze uniks. */
function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

function parentPath(dir: string): string {
  const trimmed = dir.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx <= 0 ? '/' : trimmed.slice(0, idx);
}

/** Rozmiar po ludzku — kolumna ma być czytelna, nie dokładna co do bajta. */
function rozmiar(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const jednostki = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < jednostki.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${jednostki[i]}`;
}

/** Uprawnienia w zapisie „rwxr-xr-x" — tak jak pokazuje je `ls -l`. */
function uprawnienia(mode: number): string {
  const bity = 'rwxrwxrwx';
  let out = '';
  for (let i = 0; i < 9; i += 1) {
    out += mode & (1 << (8 - i)) ? bity[i] : '-';
  }
  return out;
}

function dataPliku(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** Schowek panelu: co i w jakim trybie czeka na wklejenie. */
interface Schowek {
  tryb: 'kopiuj' | 'wytnij';
  paths: string[];
}

/** Pytanie do użytkownika obsługiwane wewnątrz panelu (Electron nie ma window.prompt). */
type Pytanie =
  | { rodzaj: 'mkdir' }
  | { rodzaj: 'rename'; entry: SftpEntry }
  | { rodzaj: 'chmod'; entry: SftpEntry }
  | { rodzaj: 'usun'; nazwy: string[] };

export default function SftpPanel({ sessionId, onClose }: SftpPanelProps): React.JSX.Element {
  const [path, setPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [zaznaczone, setZaznaczone] = useState<Set<string>>(new Set());
  const [ostatniIndeks, setOstatniIndeks] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [schowek, setSchowek] = useState<Schowek | null>(null);
  const [pytanie, setPytanie] = useState<Pytanie | null>(null);
  const [odpowiedz, setOdpowiedz] = useState('');
  const [postep, setPostep] = useState<SftpProgressEvent | null>(null);
  const [nadPanelem, setNadPanelem] = useState(false);
  const [edytujSciezke, setEdytujSciezke] = useState(false);
  const [sciezkaDraft, setSciezkaDraft] = useState('');
  const listaRef = useRef<HTMLDivElement>(null);

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
        setZaznaczone(new Set());
        setOstatniIndeks(null);
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

  // Postęp transferów; zakończone zadanie znika po chwili, żeby pasek nie wisiał na stałe.
  useEffect(() => {
    return window.luma.sftp.onProgress((event) => {
      setPostep(event);
      if (event.error) setError(event.error);
      if (event.finished) setTimeout(() => setPostep((p) => (p?.taskId === event.taskId ? null : p)), 1200);
    });
  }, []);

  const wybrane = useMemo(
    () => entries.filter((e) => zaznaczone.has(e.name)),
    [entries, zaznaczone]
  );
  const sciezkiWybranych = useMemo(
    () => (path ? wybrane.map((e) => joinPath(path, e.name)) : []),
    [wybrane, path]
  );

  /** Opakowanie operacji: błąd ląduje na pasku, a lista zawsze się odświeża. */
  const operacja = async (run: () => Promise<unknown>): Promise<void> => {
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      void wczytaj(path);
    }
  };

  const klik = (entry: SftpEntry, index: number, event: React.MouseEvent): void => {
    setZaznaczone((prev) => {
      const next = new Set(prev);
      if (event.shiftKey && ostatniIndeks !== null) {
        // Zakres od ostatnio klikniętej pozycji — odruch z każdego menedżera plików.
        const [od, do_] = ostatniIndeks < index ? [ostatniIndeks, index] : [index, ostatniIndeks];
        for (let i = od; i <= do_; i += 1) next.add(entries[i]!.name);
      } else if (event.ctrlKey) {
        if (next.has(entry.name)) next.delete(entry.name);
        else next.add(entry.name);
      } else {
        next.clear();
        next.add(entry.name);
      }
      return next;
    });
    setOstatniIndeks(index);
  };

  const otworz = (entry: SftpEntry): void => {
    if (!path) return;
    if (entry.type === 'dir') void wczytaj(joinPath(path, entry.name));
    else void window.luma.sftp.download(sessionId, [joinPath(path, entry.name)]);
  };

  const wklej = (): void => {
    if (!schowek || !path) return;
    const { tryb, paths } = schowek;
    void operacja(async () => {
      if (tryb === 'kopiuj') await window.luma.sftp.copy(sessionId, paths, path);
      else await window.luma.sftp.move(sessionId, paths, path);
      setSchowek(null);
    });
  };

  const potwierdzPytanie = (): void => {
    const p = pytanie;
    if (!p || !path) return;
    const wartosc = odpowiedz.trim();
    setPytanie(null);
    setOdpowiedz('');

    if (p.rodzaj === 'mkdir') {
      if (!wartosc) return;
      void operacja(() => window.luma.sftp.mkdir(sessionId, joinPath(path, wartosc)));
    } else if (p.rodzaj === 'rename') {
      if (!wartosc || wartosc === p.entry.name) return;
      void operacja(() =>
        window.luma.sftp.rename(sessionId, joinPath(path, p.entry.name), joinPath(path, wartosc))
      );
    } else if (p.rodzaj === 'chmod') {
      const mode = Number.parseInt(wartosc, 8);
      if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) {
        setError('Uprawnienia podaj ósemkowo, np. 644 albo 755');
        return;
      }
      void operacja(() => window.luma.sftp.chmod(sessionId, joinPath(path, p.entry.name), mode));
    } else {
      void operacja(() => window.luma.sftp.delete(sessionId, sciezkiWybranych));
    }
  };

  const naKlawisz = (event: React.KeyboardEvent): void => {
    if (!path) return;
    if (event.key === 'F5') {
      event.preventDefault();
      void wczytaj(path);
    } else if (event.key === 'Delete' && wybrane.length > 0) {
      event.preventDefault();
      setPytanie({ rodzaj: 'usun', nazwy: wybrane.map((e) => e.name) });
    } else if (event.key === 'F2' && wybrane.length === 1) {
      event.preventDefault();
      setOdpowiedz(wybrane[0]!.name);
      setPytanie({ rodzaj: 'rename', entry: wybrane[0]! });
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      void wczytaj(parentPath(path));
    } else if (event.key === 'Enter' && wybrane.length === 1) {
      event.preventDefault();
      otworz(wybrane[0]!);
    } else if (event.ctrlKey && event.code === 'KeyA') {
      event.preventDefault();
      setZaznaczone(new Set(entries.map((e) => e.name)));
    }
  };

  // Przeciąganie z pulpitu: ścieżki lokalne dostajemy z preloadu (webUtils), bo File.path
  // nie istnieje od Electrona 32.
  const upuszczono = (event: React.DragEvent): void => {
    event.preventDefault();
    setNadPanelem(false);
    if (!path) return;
    const paths = [...event.dataTransfer.files]
      .map((file) => window.luma.sftp.pathForFile(file))
      .filter(Boolean);
    if (paths.length === 0) return;
    void operacja(() => window.luma.sftp.uploadPaths(sessionId, path, paths));
  };

  const tytulPytania =
    pytanie?.rodzaj === 'mkdir'
      ? 'Nowy katalog'
      : pytanie?.rodzaj === 'rename'
        ? 'Zmień nazwę'
        : pytanie?.rodzaj === 'chmod'
          ? 'Uprawnienia (ósemkowo)'
          : 'Usunąć zaznaczone?';

  return (
    <section
      className={`sftp${nadPanelem ? ' sftp--drop' : ''}`}
      onKeyDown={naKlawisz}
      tabIndex={0}
      ref={listaRef}
      onDragOver={(e) => {
        e.preventDefault();
        setNadPanelem(true);
      }}
      onDragLeave={() => setNadPanelem(false)}
      onDrop={upuszczono}
    >
      <div className="sftp__header">
        <span className="sftp__title">PLIKI (SFTP)</span>
        <span className="sftp__count">
          {entries.length} elem.{wybrane.length > 0 ? ` · zaznaczone: ${wybrane.length}` : ''}
        </span>
        <button className="sftp__close" onClick={onClose} aria-label="Zamknij SFTP">
          ✕
        </button>
      </div>

      <div className="sftp__toolbar">
        <button className="sftp__btn" onClick={() => path && wczytaj(parentPath(path))} disabled={!path || path === '/'} title="Katalog wyżej (Backspace)">
          ↑
        </button>
        <button className="sftp__btn" onClick={() => path && wczytaj(path)} disabled={!path} title="Odśwież (F5)">
          ⟳
        </button>
        <span className="sftp__sep" />
        <button className="sftp__btn" onClick={() => { setOdpowiedz(''); setPytanie({ rodzaj: 'mkdir' }); }} disabled={!path} title="Nowy katalog">
          + katalog
        </button>
        <button className="sftp__btn" onClick={() => path && void operacja(() => window.luma.sftp.upload(sessionId, path))} disabled={!path} title="Wyślij pliki z komputera">
          ⬆ wyślij
        </button>
        <button className="sftp__btn" onClick={() => void window.luma.sftp.download(sessionId, sciezkiWybranych)} disabled={wybrane.length === 0} title="Pobierz zaznaczone">
          ⬇ pobierz
        </button>
        <span className="sftp__sep" />
        <button className="sftp__btn" onClick={() => setSchowek({ tryb: 'kopiuj', paths: sciezkiWybranych })} disabled={wybrane.length === 0} title="Kopiuj">
          Kopiuj
        </button>
        <button className="sftp__btn" onClick={() => setSchowek({ tryb: 'wytnij', paths: sciezkiWybranych })} disabled={wybrane.length === 0} title="Wytnij">
          Wytnij
        </button>
        <button className="sftp__btn" onClick={wklej} disabled={!schowek} title={schowek ? `Wklej (${schowek.paths.length})` : 'Schowek pusty'}>
          Wklej{schowek ? ` (${schowek.paths.length})` : ''}
        </button>
        <span className="sftp__sep" />
        <button
          className="sftp__btn"
          onClick={() => {
            if (wybrane.length !== 1) return;
            setOdpowiedz(wybrane[0]!.name);
            setPytanie({ rodzaj: 'rename', entry: wybrane[0]! });
          }}
          disabled={wybrane.length !== 1}
          title="Zmień nazwę (F2)"
        >
          Nazwa
        </button>
        <button
          className="sftp__btn"
          onClick={() => {
            if (wybrane.length !== 1) return;
            setOdpowiedz(wybrane[0]!.mode.toString(8).padStart(3, '0'));
            setPytanie({ rodzaj: 'chmod', entry: wybrane[0]! });
          }}
          disabled={wybrane.length !== 1}
          title="Uprawnienia"
        >
          Prawa
        </button>
        <button
          className="sftp__btn sftp__btn--danger"
          onClick={() => setPytanie({ rodzaj: 'usun', nazwy: wybrane.map((e) => e.name) })}
          disabled={wybrane.length === 0}
          title="Usuń (Delete)"
        >
          Usuń
        </button>
      </div>

      <div className="sftp__pathbar">
        {edytujSciezke ? (
          <input
            className="sftp__path-input"
            autoFocus
            value={sciezkaDraft}
            onChange={(e) => setSciezkaDraft(e.target.value)}
            onBlur={() => setEdytujSciezke(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setEdytujSciezke(false);
                void wczytaj(sciezkaDraft.trim() || '/');
              } else if (e.key === 'Escape') {
                setEdytujSciezke(false);
              }
              e.stopPropagation();
            }}
          />
        ) : (
          <button
            className="sftp__path"
            title="Kliknij, żeby wpisać ścieżkę"
            onClick={() => {
              setSciezkaDraft(path ?? '/');
              setEdytujSciezke(true);
            }}
          >
            {path ?? '…'}
          </button>
        )}
      </div>

      {error && (
        <div className="sftp__error" onClick={() => setError(null)} title="Kliknij, żeby ukryć">
          {error}
        </div>
      )}

      <div className="sftp__grid-head">
        <span>Nazwa</span>
        <span className="sftp__col-size">Rozmiar</span>
        <span className="sftp__col-date">Zmodyfikowano</span>
        <span className="sftp__col-mode">Prawa</span>
      </div>

      <ul className="sftp__list">
        {busy && entries.length === 0 && <li className="sftp__empty">wczytywanie…</li>}
        {!busy && entries.length === 0 && <li className="sftp__empty">Katalog jest pusty</li>}
        {entries.map((entry, index) => (
          <li
            key={entry.name}
            className={
              `sftp__entry sftp__entry--${entry.type}` +
              `${zaznaczone.has(entry.name) ? ' is-selected' : ''}` +
              `${schowek?.tryb === 'wytnij' && path && schowek.paths.includes(joinPath(path, entry.name)) ? ' is-cut' : ''}`
            }
            onClick={(event) => klik(entry, index, event)}
            onDoubleClick={() => otworz(entry)}
            title={entry.type === 'dir' ? 'Wejdź (dwuklik)' : 'Pobierz (dwuklik)'}
          >
            <span className="sftp__icon">{entry.type === 'dir' ? '📁' : entry.type === 'file' ? '📄' : '🔗'}</span>
            <span className="sftp__name">{entry.name}</span>
            <span className="sftp__col-size">{entry.type === 'file' ? rozmiar(entry.size) : ''}</span>
            <span className="sftp__col-date">{dataPliku(entry.mtime)}</span>
            <span className="sftp__col-mode">{uprawnienia(entry.mode)}</span>
          </li>
        ))}
      </ul>

      {postep && (
        <div className="sftp__progress">
          <span className="sftp__progress-label">
            {postep.label}
            {postep.total > 0 && !postep.finished ? ` — ${rozmiar(postep.done)} / ${rozmiar(postep.total)}` : ''}
            {postep.finished && !postep.error ? ' — gotowe' : ''}
          </span>
          <span className="sftp__progress-track">
            <span
              className="sftp__progress-fill"
              style={{ width: `${postep.total > 0 ? Math.min(100, (postep.done / postep.total) * 100) : 0}%` }}
            />
          </span>
        </div>
      )}

      {pytanie && (
        <div className="sftp__ask" onKeyDown={(e) => e.stopPropagation()}>
          <div className="sftp__ask-title">{tytulPytania}</div>
          {pytanie.rodzaj === 'usun' ? (
            <div className="sftp__ask-text">
              {pytanie.nazwy.length === 1
                ? `„${pytanie.nazwy[0]}" zostanie usunięte bezpowrotnie.`
                : `${pytanie.nazwy.length} elementów zostanie usuniętych bezpowrotnie. Katalogi razem z zawartością.`}
            </div>
          ) : (
            <input
              className="sftp__ask-input"
              autoFocus
              value={odpowiedz}
              onChange={(e) => setOdpowiedz(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') potwierdzPytanie();
                else if (e.key === 'Escape') setPytanie(null);
              }}
            />
          )}
          <div className="sftp__ask-actions">
            <button className="sftp__btn" onClick={() => setPytanie(null)}>
              Anuluj
            </button>
            <button
              className={`sftp__btn${pytanie.rodzaj === 'usun' ? ' sftp__btn--danger' : ' sftp__btn--primary'}`}
              onClick={potwierdzPytanie}
            >
              {pytanie.rodzaj === 'usun' ? 'Usuń' : 'OK'}
            </button>
          </div>
        </div>
      )}

      {nadPanelem && <div className="sftp__dropzone">Upuść, żeby wysłać do {path}</div>}
    </section>
  );
}

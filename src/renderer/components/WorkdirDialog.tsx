/**
 * Wybór katalogu roboczego dla nowej sesji (powłoka albo CLI AI).
 *
 * Powód istnienia: powłoka startowała zawsze w katalogu domowym, a Codex/Claude Code
 * pracują na projekcie z katalogu, w którym wstały — bez tego okna nie dało się otworzyć
 * ich tam, gdzie trzeba. Pole jest wypełnione ostatnio używanym katalogiem i ma fokus,
 * więc typowy przebieg to jeden Enter; natywne okno wyboru jest pod przyciskiem.
 *
 * Ładowany leniwie — otwierany rzadko.
 */

import { useEffect, useRef, useState } from 'react';

interface WorkdirDialogProps {
  /** Nagłówek, np. „Codex CLI w folderze". */
  title: string;
  /** Ostatnio używane katalogi (od najnowszego) — szybki wybór jednym kliknięciem. */
  recent: string[];
  /** Pusta ścieżka = katalog domyślny (domowy) — celowo dozwolona. */
  onConfirm: (cwd: string) => void;
  onClose: () => void;
}

export default function WorkdirDialog({
  title,
  recent,
  onConfirm,
  onClose
}: WorkdirDialogProps): React.JSX.Element {
  const [path, setPath] = useState(recent[0] ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const wybierz = async (): Promise<void> => {
    const picked = await window.luma.dialogs.pickDirectory(path || undefined);
    if (picked) setPath(picked);
    inputRef.current?.focus();
  };

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    onConfirm(path.trim());
  };

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <form className="dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="dialog__title">{title}</div>

        {recent.length > 0 && (
          <div className="dialog__discovered">
            {recent.map((dir) => (
              <button
                key={dir}
                type="button"
                className={`dialog__pick${dir === path ? ' is-active' : ''}`}
                onClick={() => setPath(dir)}
                title={dir}
              >
                <span className="dialog__pick-name">{dir.split(/[\\/]/).filter(Boolean).at(-1) ?? dir}</span>
                <span className="dialog__pick-detail">{dir}</span>
              </button>
            ))}
          </div>
        )}

        <label className="dialog__row">
          <span>Katalog</span>
          <input
            ref={inputRef}
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="(katalog domowy)"
            spellCheck={false}
          />
        </label>

        <div className="dialog__actions">
          <button type="button" className="dialog__button" onClick={() => void wybierz()}>
            Wybierz…
          </button>
          <span className="dialog__spacer" />
          <button type="button" className="dialog__button" onClick={onClose}>
            Anuluj
          </button>
          <button type="submit" className="dialog__button dialog__button--primary">
            Otwórz
          </button>
        </div>
      </form>
    </div>
  );
}

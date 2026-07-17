/**
 * Paleta poleceń (Ctrl+Shift+P).
 *
 * Ładowana leniwie — otwierana rzadko, nie ma powodu trzymać jej w bundle'u startowym
 * (docs/architecture/05-wydajnosc.md).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Command } from '../commands/types';

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

/** Proste dopasowanie po podciągu — kolejność liter zachowana, ale luki dozwolone. */
function pasuje(tekst: string, zapytanie: string): boolean {
  if (!zapytanie) return true;
  const t = tekst.toLowerCase();
  let i = 0;
  for (const znak of zapytanie.toLowerCase()) {
    i = t.indexOf(znak, i);
    if (i === -1) return false;
    i += 1;
  }
  return true;
}

export default function CommandPalette({ commands, onClose }: CommandPaletteProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () => commands.filter((cmd) => pasuje(`${cmd.title} ${cmd.keywords ?? ''}`, query)),
    [commands, query]
  );

  // Fokus na polu od razu po otwarciu; zawężenie listy resetuje zaznaczenie na górę.
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setIndex(0), [query]);

  const wykonaj = (cmd: Command | undefined): void => {
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      wykonaj(filtered[index]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      {/* Zatrzymanie propagacji: klik w samą paletę nie może jej zamknąć. */}
      <div className="palette" onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Wpisz polecenie…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="palette__list">
          {filtered.length === 0 && <li className="palette__empty">Brak pasujących poleceń</li>}
          {filtered.map((cmd, i) => (
            <li
              key={cmd.id}
              className={`palette__item${i === index ? ' is-active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => wykonaj(cmd)}
            >
              <span className="palette__title">{cmd.title}</span>
              {cmd.hint && <span className="palette__hint">{cmd.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Pasek makr portu szeregowego (Etap 4).
 *
 * Szybkie wysyłanie gotowych komend z wybranym zakończeniem linii. Makra są trzymane w
 * ustawieniach (trwałe). Wpisanie własnej komendy + Enter wysyła ją i dodaje do listy.
 */

import { useState } from 'react';

export type LineEnding = 'none' | 'cr' | 'lf' | 'crlf';

const ENDINGS: Record<LineEnding, string> = { none: '', cr: '\r', lf: '\n', crlf: '\r\n' };

interface SerialMacrosProps {
  macros: string[];
  onSend: (text: string) => void;
  onAddMacro: (text: string) => void;
  onRemoveMacro: (text: string) => void;
}

export function SerialMacros({ macros, onSend, onAddMacro, onRemoveMacro }: SerialMacrosProps): React.JSX.Element {
  const [text, setText] = useState('');
  const [ending, setEnding] = useState<LineEnding>('crlf');

  const send = (value: string): void => {
    if (!value) return;
    onSend(value + ENDINGS[ending]);
  };

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    send(value);
    if (!macros.includes(value)) onAddMacro(value);
    setText('');
  };

  return (
    <div className="macros">
      <div className="macros__list">
        {macros.map((m) => (
          <div key={m} className="macros__item">
            <button className="macros__send" onClick={() => send(m)} title={`Wyślij: ${m}`}>
              {m}
            </button>
            <button
              className="macros__del"
              onClick={() => onRemoveMacro(m)}
              aria-label={`Usuń makro ${m}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <form className="macros__form" onSubmit={submit}>
        <input
          className="macros__input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Komenda do wysłania…"
        />
        <select
          className="macros__ending"
          value={ending}
          onChange={(e) => setEnding(e.target.value as LineEnding)}
          title="Zakończenie linii"
        >
          <option value="crlf">CR+LF</option>
          <option value="lf">LF</option>
          <option value="cr">CR</option>
          <option value="none">brak</option>
        </select>
        <button className="macros__submit" type="submit">
          Wyślij
        </button>
      </form>
    </div>
  );
}

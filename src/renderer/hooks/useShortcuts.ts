/**
 * Globalne skróty klawiaturowe.
 *
 * Nasłuch działa w **fazie przechwytywania** na `document`, żeby wyprzedzić xterm.
 * Terminal ma własny handler na ukrytym textarea (potomku), więc bez przechwytywania
 * skróty aplikacji ginęłyby w terminalu, gdy ma on fokus.
 */

import { useEffect } from 'react';

/** Znormalizowany opis wciśnięcia, np. „ctrl+shift+p" albo „ctrl+1". */
export type Chord = string;

export type ShortcutMap = Record<Chord, (event: KeyboardEvent) => void>;

function chordOf(event: KeyboardEvent): Chord {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');

  // event.code jest niezależne od układu klawiatury i stanu Shift: „KeyP" zawsze,
  // niezależnie czy to „p" czy „P". Cyfry z górnego rzędu to „Digit1".
  const code = event.code;
  if (code.startsWith('Key')) parts.push(code.slice(3).toLowerCase());
  else if (code.startsWith('Digit')) parts.push(code.slice(5));
  else if (code === 'Tab') parts.push('tab');
  else if (code === 'Comma') parts.push('comma');
  else return '';

  return parts.join('+');
}

export function useShortcuts(map: ShortcutMap): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const handler = map[chordOf(event)];
      if (!handler) return;
      // Przejmujemy zdarzenie zanim dosięgnie terminala.
      event.preventDefault();
      event.stopPropagation();
      handler(event);
    };

    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [map]);
}

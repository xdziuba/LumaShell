/**
 * Formatowanie strumienia bajtów do zrzutu szesnastkowego i znaczników czasu (Etap 4).
 *
 * Widok hex serialu pokazuje bajty jako `hexdump -C`: offset, 16 bajtów hex, kolumna
 * ASCII. Wyrównanie do 16 bajtów wymaga buforowania między porcjami, więc formatter jest
 * stanowy. Czysta logika (bez DOM) — testowalna jednostkowo.
 */

const BYTES_PER_LINE = 16;

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

function offset8(n: number): string {
  return n.toString(16).padStart(8, '0');
}

/** Jedna linia zrzutu: offset, bajty hex (z przerwą po 8) i kolumna ASCII. */
function formatLine(offset: number, bytes: number[]): string {
  const hexParts: string[] = [];
  for (let i = 0; i < BYTES_PER_LINE; i += 1) {
    if (i === 8) hexParts.push(''); // dodatkowa spacja w połowie
    hexParts.push(i < bytes.length ? hex2(bytes[i]!) : '  ');
  }
  const ascii = bytes
    .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
    .join('');
  return `${offset8(offset)}  ${hexParts.join(' ')}  |${ascii}|`;
}

export class HexFormatter {
  #offset = 0;
  #buffer: number[] = [];

  /** Dokłada bajty i zwraca gotowe pełne linie (16-bajtowe). Reszta czeka w buforze. */
  push(bytes: Uint8Array): string {
    for (const b of bytes) this.#buffer.push(b);
    const lines: string[] = [];
    while (this.#buffer.length >= BYTES_PER_LINE) {
      const chunk = this.#buffer.splice(0, BYTES_PER_LINE);
      lines.push(formatLine(this.#offset, chunk));
      this.#offset += BYTES_PER_LINE;
    }
    return lines.length ? lines.join('\r\n') + '\r\n' : '';
  }

  /** Domyka niepełną ostatnią linię (przy zamknięciu albo zmianie trybu). */
  flush(): string {
    if (this.#buffer.length === 0) return '';
    const line = formatLine(this.#offset, this.#buffer);
    this.#offset += this.#buffer.length;
    this.#buffer = [];
    return line + '\r\n';
  }
}

/** Znacznik czasu HH:MM:SS.mmm w nawiasach — do prefiksowania porcji w trybie tekstowym. */
export function timestamp(date = new Date()): string {
  const p = (n: number, w = 2): string => n.toString().padStart(w, '0');
  return `[${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(date.getMilliseconds(), 3)}] `;
}

/**
 * Dialog konfiguracji i otwarcia portu szeregowego (Etap 4).
 *
 * Wcześniej port otwierał się na sztywno 115200 8N1. Tu użytkownik wybiera prędkość i
 * parametry ramki. Ładowany leniwie (docs/architecture/05-wydajnosc.md).
 */

import { useState } from 'react';
import type { SessionSpec } from '@shared/types/ipc';

interface SerialConnectDialogProps {
  path: string;
  onOpen: (spec: Extract<SessionSpec, { kind: 'serial' }>) => void;
  onClose: () => void;
}

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

export default function SerialConnectDialog({ path, onOpen, onClose }: SerialConnectDialogProps): React.JSX.Element {
  const [baudRate, setBaudRate] = useState(115200);
  const [dataBits, setDataBits] = useState<5 | 6 | 7 | 8>(8);
  const [stopBits, setStopBits] = useState<1 | 1.5 | 2>(1);
  const [parity, setParity] = useState<'none' | 'even' | 'odd' | 'mark' | 'space'>('none');
  const [rtscts, setRtscts] = useState(false);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    onOpen({ kind: 'serial', path, baudRate, dataBits, stopBits, parity, rtscts });
  };

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <form className="dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="dialog__title">Port {path}</div>

        <label className="dialog__row">
          <span>Prędkość</span>
          <select value={baudRate} onChange={(e) => setBaudRate(Number(e.target.value))}>
            {BAUD_RATES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="dialog__row">
          <span>Bity danych</span>
          <select value={dataBits} onChange={(e) => setDataBits(Number(e.target.value) as 5 | 6 | 7 | 8)}>
            {[8, 7, 6, 5].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="dialog__row">
          <span>Bity stopu</span>
          <select value={stopBits} onChange={(e) => setStopBits(Number(e.target.value) as 1 | 1.5 | 2)}>
            <option value={1}>1</option>
            <option value={1.5}>1.5</option>
            <option value={2}>2</option>
          </select>
        </label>
        <label className="dialog__row">
          <span>Parzystość</span>
          <select value={parity} onChange={(e) => setParity(e.target.value as typeof parity)}>
            <option value="none">brak</option>
            <option value="even">parzysta</option>
            <option value="odd">nieparzysta</option>
            <option value="mark">mark</option>
            <option value="space">space</option>
          </select>
        </label>
        <label className="dialog__row dialog__row--inline">
          <input type="checkbox" checked={rtscts} onChange={(e) => setRtscts(e.target.checked)} />
          <span>Sprzętowa kontrola przepływu (RTS/CTS)</span>
        </label>

        <div className="dialog__actions">
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

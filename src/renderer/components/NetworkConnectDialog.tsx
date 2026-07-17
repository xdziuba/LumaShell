/**
 * Dialog połączenia sieciowego (Etap 7): TCP, TLS, Telnet, WebSocket, UDP.
 *
 * Jeden formularz dla całej rodziny protokołów — pola zależne (ścieżka WebSocketu, flaga
 * niezaufanego TLS) pojawiają się tylko tam, gdzie mają sens. Ładowany leniwie.
 */

import { useState } from 'react';
import type { NetworkProtocol, SessionSpec } from '@shared/types/ipc';

interface NetworkConnectDialogProps {
  onOpen: (spec: Extract<SessionSpec, { kind: 'network' }>) => void;
  onClose: () => void;
}

const PROTOCOLS: Array<{ value: NetworkProtocol; label: string; port: number }> = [
  { value: 'tcp', label: 'TCP (surowy)', port: 23 },
  { value: 'tls', label: 'TLS (TCP szyfrowany)', port: 443 },
  { value: 'telnet', label: 'Telnet', port: 23 },
  { value: 'ws', label: 'WebSocket (ws)', port: 80 },
  { value: 'wss', label: 'WebSocket bezpieczny (wss)', port: 443 },
  { value: 'udp', label: 'UDP (datagramy)', port: 9000 }
];

export default function NetworkConnectDialog({ onOpen, onClose }: NetworkConnectDialogProps): React.JSX.Element {
  const [protocol, setProtocol] = useState<NetworkProtocol>('tcp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(23);
  const [path, setPath] = useState('/');
  const [insecureTls, setInsecureTls] = useState(false);

  const isWebSocket = protocol === 'ws' || protocol === 'wss';
  const isSecure = protocol === 'tls' || protocol === 'wss';

  // Zmiana protokołu podpowiada typowy port, o ile użytkownik go nie zmieniał ręcznie.
  const changeProtocol = (value: NetworkProtocol): void => {
    setProtocol(value);
    const preset = PROTOCOLS.find((p) => p.value === value);
    if (preset) setPort(preset.port);
  };

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const trimmed = host.trim();
    if (!trimmed) return;
    const spec: Extract<SessionSpec, { kind: 'network' }> = {
      kind: 'network',
      protocol,
      host: trimmed,
      port,
      label: `${protocol.toUpperCase()} ${trimmed}:${port}`
    };
    if (isWebSocket) spec.path = path || '/';
    if (isSecure && insecureTls) spec.insecureTls = true;
    onOpen(spec);
  };

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <form className="dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="dialog__title">Połączenie sieciowe</div>

        <label className="dialog__row">
          <span>Protokół</span>
          <select value={protocol} onChange={(e) => changeProtocol(e.target.value as NetworkProtocol)}>
            {PROTOCOLS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="dialog__row">
          <span>Host</span>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="np. 192.168.1.10 lub example.com"
            autoFocus
          />
        </label>

        <label className="dialog__row">
          <span>Port</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
          />
        </label>

        {isWebSocket && (
          <label className="dialog__row">
            <span>Ścieżka</span>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/"
            />
          </label>
        )}

        {isSecure && (
          <label className="dialog__row dialog__row--inline">
            <input
              type="checkbox"
              checked={insecureTls}
              onChange={(e) => setInsecureTls(e.target.checked)}
            />
            <span>Nie weryfikuj certyfikatu (self-signed)</span>
          </label>
        )}

        <div className="dialog__actions">
          <button type="button" className="dialog__button" onClick={onClose}>
            Anuluj
          </button>
          <button type="submit" className="dialog__button dialog__button--primary" disabled={!host.trim()}>
            Połącz
          </button>
        </div>
      </form>
    </div>
  );
}

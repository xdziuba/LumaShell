/**
 * Dialog nawiązania połączenia SSH (Etap 3).
 *
 * Zbiera host, użytkownika i metodę uwierzytelniania. Hasło/hasło klucza trafiają stąd
 * raz do procesu głównego — dialog ich nie zapamiętuje i nie loguje.
 * Ładowany leniwie (docs/architecture/05-wydajnosc.md).
 */

import { useState } from 'react';
import type { SshAuthMethod, SshConnectRequest } from '@shared/types/ipc';

interface SshConnectDialogProps {
  onConnect: (request: SshConnectRequest) => void;
  onClose: () => void;
}

export default function SshConnectDialog({ onConnect, onClose }: SshConnectDialogProps): React.JSX.Element {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('');
  const [auth, setAuth] = useState<SshAuthMethod>('password');
  const [password, setPassword] = useState('');
  const [keyPath, setKeyPath] = useState('');
  const [passphrase, setPassphrase] = useState('');

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!host || !username) return;
    const request: SshConnectRequest = { host: host.trim(), port, username: username.trim(), auth };
    if (auth === 'password') request.password = password;
    if (auth === 'key') {
      request.keyPath = keyPath.trim();
      if (passphrase) request.passphrase = passphrase;
    }
    onConnect(request);
  };

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <form className="dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="dialog__title">Połączenie SSH</div>

        <label className="dialog__row">
          <span>Host</span>
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="np. 192.168.0.10" autoFocus />
        </label>
        <label className="dialog__row">
          <span>Port</span>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            min={1}
            max={65535}
          />
        </label>
        <label className="dialog__row">
          <span>Użytkownik</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="dialog__row">
          <span>Uwierzytelnianie</span>
          <select value={auth} onChange={(e) => setAuth(e.target.value as SshAuthMethod)}>
            <option value="password">Hasło</option>
            <option value="key">Klucz prywatny</option>
            <option value="agent">Agent SSH</option>
          </select>
        </label>

        {auth === 'password' && (
          <label className="dialog__row">
            <span>Hasło</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        {auth === 'key' && (
          <>
            <label className="dialog__row">
              <span>Plik klucza</span>
              <input
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
                placeholder="C:\Users\...\.ssh\id_ed25519"
              />
            </label>
            <label className="dialog__row">
              <span>Hasło klucza</span>
              <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
            </label>
          </>
        )}

        <div className="dialog__actions">
          <button type="button" className="dialog__button" onClick={onClose}>
            Anuluj
          </button>
          <button type="submit" className="dialog__button dialog__button--primary" disabled={!host || !username}>
            Połącz
          </button>
        </div>
      </form>
    </div>
  );
}

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

  const [advanced, setAdvanced] = useState(false);
  // Jump host (bastion) — na razie tylko uwierzytelnianie hasłem, żeby dialog nie urósł.
  const [jumpOn, setJumpOn] = useState(false);
  const [jumpHost, setJumpHost] = useState('');
  const [jumpPort, setJumpPort] = useState(22);
  const [jumpUser, setJumpUser] = useState('');
  const [jumpPass, setJumpPass] = useState('');
  // Jedno lokalne przekierowanie portu (-L).
  const [fwdOn, setFwdOn] = useState(false);
  const [fwdLocal, setFwdLocal] = useState(8080);
  const [fwdHost, setFwdHost] = useState('127.0.0.1');
  const [fwdPort, setFwdPort] = useState(80);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!host || !username) return;
    const request: SshConnectRequest = { host: host.trim(), port, username: username.trim(), auth };
    if (auth === 'password') request.password = password;
    if (auth === 'key') {
      request.keyPath = keyPath.trim();
      if (passphrase) request.passphrase = passphrase;
    }
    if (jumpOn && jumpHost && jumpUser) {
      request.jump = {
        host: jumpHost.trim(),
        port: jumpPort,
        username: jumpUser.trim(),
        auth: 'password',
        password: jumpPass
      };
    }
    if (fwdOn && fwdHost) {
      request.localForwards = [{ localPort: fwdLocal, destHost: fwdHost.trim(), destPort: fwdPort }];
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

        <button
          type="button"
          className="dialog__toggle"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? '▾' : '▸'} Zaawansowane (jump host, przekierowanie)
        </button>

        {advanced && (
          <div className="dialog__advanced">
            <label className="dialog__row dialog__row--inline">
              <input type="checkbox" checked={jumpOn} onChange={(e) => setJumpOn(e.target.checked)} />
              <span>Przez host pośredniczący (jump)</span>
            </label>
            {jumpOn && (
              <>
                <label className="dialog__row">
                  <span>Jump host</span>
                  <input value={jumpHost} onChange={(e) => setJumpHost(e.target.value)} />
                </label>
                <label className="dialog__row">
                  <span>Jump port</span>
                  <input type="number" value={jumpPort} onChange={(e) => setJumpPort(Number(e.target.value))} />
                </label>
                <label className="dialog__row">
                  <span>Jump użytkownik</span>
                  <input value={jumpUser} onChange={(e) => setJumpUser(e.target.value)} />
                </label>
                <label className="dialog__row">
                  <span>Jump hasło</span>
                  <input type="password" value={jumpPass} onChange={(e) => setJumpPass(e.target.value)} />
                </label>
              </>
            )}

            <label className="dialog__row dialog__row--inline">
              <input type="checkbox" checked={fwdOn} onChange={(e) => setFwdOn(e.target.checked)} />
              <span>Przekierowanie portu (-L)</span>
            </label>
            {fwdOn && (
              <>
                <label className="dialog__row">
                  <span>Lokalny port</span>
                  <input type="number" value={fwdLocal} onChange={(e) => setFwdLocal(Number(e.target.value))} />
                </label>
                <label className="dialog__row">
                  <span>Cel host</span>
                  <input value={fwdHost} onChange={(e) => setFwdHost(e.target.value)} />
                </label>
                <label className="dialog__row">
                  <span>Cel port</span>
                  <input type="number" value={fwdPort} onChange={(e) => setFwdPort(Number(e.target.value))} />
                </label>
              </>
            )}
          </div>
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

/**
 * Dialog dołączenia do kontenera/poda (Etap 7).
 *
 * Przy otwarciu odpytuje `containers.list()` (docker ps / kubectl get pods) i pozwala wybrać
 * cel jednym kliknięciem albo wpisać ręcznie. Sesja to `docker exec -it` / `kubectl exec -it`
 * owinięte w PTY. Ładowany leniwie.
 */

import { useEffect, useState } from 'react';
import type { ContainerInfo, ContainerRuntime, SessionSpec } from '@shared/types/ipc';

interface ContainerConnectDialogProps {
  onOpen: (spec: Extract<SessionSpec, { kind: 'container' }>) => void;
  onClose: () => void;
}

export default function ContainerConnectDialog({ onOpen, onClose }: ContainerConnectDialogProps): React.JSX.Element {
  const [runtime, setRuntime] = useState<ContainerRuntime>('docker');
  const [target, setTarget] = useState('');
  const [shell, setShell] = useState('/bin/sh');
  const [namespace, setNamespace] = useState('');
  const [discovered, setDiscovered] = useState<ContainerInfo[] | null>(null);

  useEffect(() => {
    // Wykrywanie jest odporne — pusta lista, gdy brak docker/kubectl. `null` = jeszcze trwa.
    void window.luma.containers.list().then(setDiscovered);
  }, []);

  const pick = (c: ContainerInfo): void => {
    setRuntime(c.runtime);
    setTarget(c.target);
  };

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const trimmed = target.trim();
    if (!trimmed) return;
    const spec: Extract<SessionSpec, { kind: 'container' }> = {
      kind: 'container',
      runtime,
      target: trimmed,
      label: `${runtime === 'docker' ? 'docker' : 'k8s'}:${trimmed}`
    };
    if (shell.trim()) spec.shell = shell.trim();
    if (runtime === 'kubernetes' && namespace.trim()) spec.namespace = namespace.trim();
    onOpen(spec);
  };

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <form className="dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="dialog__title">Dołącz do kontenera</div>

        <div className="dialog__discovered">
          {discovered === null && <div className="dialog__hint">wykrywanie…</div>}
          {discovered?.length === 0 && (
            <div className="dialog__hint">
              Nie wykryto kontenerów. Upewnij się, że docker/kubectl są w PATH, lub wpisz cel ręcznie.
            </div>
          )}
          {discovered?.map((c) => (
            <button
              key={`${c.runtime}:${c.target}`}
              type="button"
              className={`dialog__pick${runtime === c.runtime && target === c.target ? ' is-active' : ''}`}
              onClick={() => pick(c)}
              title={c.detail}
            >
              <span className="dialog__pick-tag">{c.runtime === 'docker' ? 'docker' : 'k8s'}</span>
              <span className="dialog__pick-name">{c.target}</span>
              {c.detail && <span className="dialog__pick-detail">{c.detail}</span>}
            </button>
          ))}
        </div>

        <label className="dialog__row">
          <span>Środowisko</span>
          <select value={runtime} onChange={(e) => setRuntime(e.target.value as ContainerRuntime)}>
            <option value="docker">Docker</option>
            <option value="kubernetes">Kubernetes</option>
          </select>
        </label>

        <label className="dialog__row">
          <span>{runtime === 'docker' ? 'Kontener' : 'Pod'}</span>
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={runtime === 'docker' ? 'nazwa lub ID kontenera' : 'nazwa poda'}
          />
        </label>

        {runtime === 'kubernetes' && (
          <label className="dialog__row">
            <span>Namespace</span>
            <input
              type="text"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="(domyślny)"
            />
          </label>
        )}

        <label className="dialog__row">
          <span>Powłoka</span>
          <input type="text" value={shell} onChange={(e) => setShell(e.target.value)} placeholder="/bin/sh" />
        </label>

        <div className="dialog__actions">
          <button type="button" className="dialog__button" onClick={onClose}>
            Anuluj
          </button>
          <button type="submit" className="dialog__button dialog__button--primary" disabled={!target.trim()}>
            Dołącz
          </button>
        </div>
      </form>
    </div>
  );
}

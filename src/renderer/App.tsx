import { useEffect, useMemo, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { TerminalView, type RendererKind } from './terminal/TerminalView';
import type { SerialPortInfo } from '@core/transports/transport';
import type { AppCapabilities, SessionSpec } from '@shared/types/ipc';

/** Etap 0 nie ma jeszcze ustawień portu — prędkość na sztywno. */
const PROTOTYPE_BAUD_RATE = 115200;

export function App(): React.JSX.Element {
  const [capabilities, setCapabilities] = useState<AppCapabilities | null>(null);
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [label, setLabel] = useState('uruchamianie…');
  const [renderer, setRenderer] = useState<RendererKind | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [spec, setSpec] = useState<SessionSpec>({ kind: 'pty' });

  useEffect(() => {
    void window.luma.getCapabilities().then((value) => {
      setCapabilities(value);
      // Renderer nie wykrywa systemu sam — dostaje gotową flagę i tylko przełącza styl
      // (docs/architecture/03-interfejs-i-motywy.md#degradacja-na-windows-10).
      document.documentElement.dataset.acrylic = String(value.acrylic);
    });
    // Listowanie portów niczego nie otwiera, więc jest bezpieczne przy starcie.
    void window.luma.serial.listPorts().then(setPorts);
  }, []);

  const isSerial = spec.kind === 'serial';
  const activePath = isSerial ? spec.path : null;

  const openPty = (): void => {
    setStatus(null);
    setLabel('uruchamianie…');
    setSpec({ kind: 'pty' });
  };

  const openSerial = (path: string): void => {
    setStatus(null);
    setLabel('otwieranie…');
    setSpec({ kind: 'serial', path, baudRate: PROTOTYPE_BAUD_RATE });
  };

  // Nowy obiekt spec przy każdym renderze restartowałby sesję w kółko.
  const stableSpec = useMemo(
    () => spec,
    [spec.kind, isSerial ? spec.path : '', isSerial ? spec.baudRate : 0]
  );

  return (
    <div className="app">
      <TitleBar subtitle={label} />

      <div className="body">
        <aside className="sidebar">
          <div className="sidebar__heading">SESJE</div>
          <button
            className={`sidebar__item sidebar__item--action${spec.kind === 'pty' ? ' is-active' : ''}`}
            onClick={openPty}
          >
            {spec.kind === 'pty' ? '●' : '○'} Powłoka lokalna
          </button>

          <div className="sidebar__heading sidebar__heading--spaced">PORTY COM</div>
          {ports.length === 0 && <div className="sidebar__item">brak portów</div>}
          {ports.map((port) => (
            <button
              key={port.path}
              className={`sidebar__item sidebar__item--action${activePath === port.path ? ' is-active' : ''}`}
              onClick={() => openSerial(port.path)}
              title={port.friendlyName ?? port.path}
            >
              {activePath === port.path ? '●' : '○'} {port.path}
            </button>
          ))}
        </aside>

        <TerminalView
          spec={stableSpec}
          onReady={(info) => setLabel(info.label)}
          onExit={(code) => setStatus(code === undefined ? 'Sesja zamknięta' : `Powłoka zakończona (kod ${code})`)}
          onRenderer={setRenderer}
          onError={(message) => {
            setLabel('błąd');
            setStatus(message);
          }}
        />
      </div>

      <footer className="statusbar">
        <span>
          Szkło: <span className="statusbar__accent">{capabilities?.acrylic ? 'acrylic' : 'wyłączone'}</span>
        </span>
        <span>
          Renderer: <span className="statusbar__accent">{renderer ?? '—'}</span>
        </span>
        <span>Build systemu: {capabilities?.osBuild || '—'}</span>
        {status && <span className="statusbar__status">{status}</span>}
      </footer>
    </div>
  );
}

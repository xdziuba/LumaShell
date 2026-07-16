import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { TerminalView, type RendererKind } from './terminal/TerminalView';
import type { SerialPortInfo } from '@core/transports/transport';
import type { AppCapabilities, SessionSpec, ShellInfo } from '@shared/types/ipc';
import { DEFAULT_SETTINGS, type TerminalSettings } from '@shared/types/settings';

// Panel ustawień ładowany dopiero przy otwarciu — nie wchodzi do bundle'a startowego
// (docs/architecture/05-wydajnosc.md).
const SettingsPanel = lazy(() => import('./settings/SettingsPanel'));

/** Etap 1 nie ma jeszcze ustawień portu — prędkość na sztywno. */
const PROTOTYPE_BAUD_RATE = 115200;

export function App(): React.JSX.Element {
  const [capabilities, setCapabilities] = useState<AppCapabilities | null>(null);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [label, setLabel] = useState('uruchamianie…');
  const [renderer, setRenderer] = useState<RendererKind | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [spec, setSpec] = useState<SessionSpec>({ kind: 'pty' });
  const [settings, setSettings] = useState<TerminalSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void window.luma.getCapabilities().then((value) => {
      setCapabilities(value);
      // Renderer nie wykrywa systemu sam — dostaje gotową flagę i tylko przełącza styl
      // (docs/architecture/03-interfejs-i-motywy.md#degradacja-na-windows-10).
      document.documentElement.dataset.acrylic = String(value.acrylic);
    });
    void window.luma.settings.get().then(setSettings);
    void window.luma.listShells().then(setShells);
    // Listowanie portów niczego nie otwiera, więc jest bezpieczne przy starcie.
    void window.luma.serial.listPorts().then(setPorts);
  }, []);

  const zmienUstawienia = (next: TerminalSettings): void => {
    // Podgląd natychmiast, zapis w tle. Proces główny zwraca wartości po walidacji,
    // więc to one są ostatecznie prawdą.
    setSettings(next);
    void window.luma.settings.save(next).then(setSettings);
  };

  const isSerial = spec.kind === 'serial';
  const activePath = isSerial ? spec.path : null;
  const activeShell = spec.kind === 'pty' ? spec.shellId : undefined;

  const openShell = (shellId: string): void => {
    setStatus(null);
    setLabel('uruchamianie…');
    setSpec({ kind: 'pty', shellId });
  };

  const openSerial = (path: string): void => {
    setStatus(null);
    setLabel('otwieranie…');
    setSpec({ kind: 'serial', path, baudRate: PROTOTYPE_BAUD_RATE });
  };

  // Nowy obiekt spec przy każdym renderze restartowałby sesję w kółko.
  const stableSpec = useMemo(
    () => spec,
    [spec.kind, activeShell ?? '', isSerial ? spec.path : '', isSerial ? spec.baudRate : 0]
  );

  return (
    <div className="app">
      <TitleBar subtitle={label} />

      <div className="body">
        <aside className="sidebar">
          <div className="sidebar__heading">POWŁOKI</div>
          {shells.length === 0 && <div className="sidebar__item">wykrywanie…</div>}
          {shells.map((shell, index) => {
            // Sesja startowa idzie bez shellId, więc pierwsza powłoka jest wtedy aktywna.
            const active =
              spec.kind === 'pty' && (activeShell === shell.id || (!activeShell && index === 0));
            return (
              <button
                key={shell.id}
                className={`sidebar__item sidebar__item--action${active ? ' is-active' : ''}`}
                onClick={() => openShell(shell.id)}
              >
                {active ? '●' : '○'} {shell.label}
              </button>
            );
          })}

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
          settings={settings}
          onReady={(info) => setLabel(info.label)}
          onExit={(code) => setStatus(code === undefined ? 'Sesja zamknięta' : `Powłoka zakończona (kod ${code})`)}
          onRenderer={setRenderer}
          onError={(message) => {
            setLabel('błąd');
            setStatus(message);
          }}
        />

        {settingsOpen && (
          <Suspense fallback={<aside className="settings settings--loading">ładowanie…</aside>}>
            <SettingsPanel
              settings={settings}
              onChange={zmienUstawienia}
              onClose={() => setSettingsOpen(false)}
            />
          </Suspense>
        )}
      </div>

      <footer className="statusbar">
        <span>
          Szkło: <span className="statusbar__accent">{capabilities?.acrylic ? 'acrylic' : 'wyłączone'}</span>
        </span>
        <span>
          Renderer: <span className="statusbar__accent">{renderer ?? '—'}</span>
        </span>
        <span>Build systemu: {capabilities?.osBuild || '—'}</span>
        <button
          className={`statusbar__button${settingsOpen ? ' is-active' : ''}`}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          Ustawienia
        </button>
        {status && <span className="statusbar__status">{status}</span>}
      </footer>
    </div>
  );
}

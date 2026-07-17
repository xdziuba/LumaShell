import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { TabBar } from './components/TabBar';
import { TitleBar } from './components/TitleBar';
import { TerminalView, type RendererKind } from './terminal/TerminalView';
import { useWorkspace } from './store/workspace';
import type { SerialPortInfo } from '@core/transports/transport';
import type { AppCapabilities, ShellInfo } from '@shared/types/ipc';
import { DEFAULT_SETTINGS, type TerminalSettings } from '@shared/types/settings';

// Panel ustawień ładowany dopiero przy otwarciu — nie wchodzi do bundle'a startowego
// (docs/architecture/05-wydajnosc.md).
const SettingsPanel = lazy(() => import('./settings/SettingsPanel'));

/** Etap 2 nie ma jeszcze ustawień portu — prędkość na sztywno. */
const PROTOTYPE_BAUD_RATE = 115200;

export function App(): React.JSX.Element {
  const [capabilities, setCapabilities] = useState<AppCapabilities | null>(null);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [renderer, setRenderer] = useState<RendererKind | null>(null);
  const [settings, setSettings] = useState<TerminalSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { tabs, activeId, open, close, activate, update } = useWorkspace();
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;

  // `StrictMode` uruchamia efekty dwukrotnie w trybie deweloperskim. Bez tego strażnika
  // `npm run dev` otwierałby dwie zakładki startowe zamiast jednej.
  const wystartowano = useRef(false);

  useEffect(() => {
    if (wystartowano.current) return;
    wystartowano.current = true;

    void window.luma.getCapabilities().then((value) => {
      setCapabilities(value);
      // Renderer nie wykrywa systemu sam — dostaje gotową flagę i tylko przełącza styl
      // (docs/architecture/03-interfejs-i-motywy.md#degradacja-na-windows-10).
      document.documentElement.dataset.acrylic = String(value.acrylic);
    });
    void window.luma.settings.get().then(setSettings);
    // Listowanie portów niczego nie otwiera, więc jest bezpieczne przy starcie.
    void window.luma.serial.listPorts().then(setPorts);

    void window.luma.listShells().then((found) => {
      setShells(found);
      // Pierwsza zakładka dopiero po wykryciu powłok — inaczej etykieta byłaby zgadywana.
      const first = found[0];
      if (first) open({ kind: 'pty', shellId: first.id }, first.label);
    });
    // Pusta lista zależności jest celowa: to zadania startowe, mają wykonać się raz.
    // `open` pochodzi ze store'u Zustanda i jest stabilne między renderami.
  }, [open]);

  const zmienUstawienia = (next: TerminalSettings): void => {
    // Podgląd natychmiast, zapis w tle. Proces główny zwraca wartości po walidacji,
    // więc to one są ostatecznie prawdą.
    setSettings(next);
    void window.luma.settings.save(next).then(setSettings);
  };

  const otworzPowloke = (shell: ShellInfo): void =>
    void open({ kind: 'pty', shellId: shell.id }, shell.label);

  const otworzPort = (port: SerialPortInfo): void =>
    void open({ kind: 'serial', path: port.path, baudRate: PROTOTYPE_BAUD_RATE }, port.path);

  const nowaZakladka = (): void => {
    const first = shells[0];
    if (first) otworzPowloke(first);
  };

  return (
    <div className="app">
      <TitleBar subtitle={activeTab?.label ?? 'brak sesji'} />

      <TabBar
        tabs={tabs}
        activeId={activeId}
        onSelect={activate}
        onClose={close}
        onNew={nowaZakladka}
      />

      <div className="body">
        <aside className="sidebar">
          <div className="sidebar__heading">POWŁOKI</div>
          {shells.length === 0 && <div className="sidebar__item">wykrywanie…</div>}
          {shells.map((shell) => (
            <button
              key={shell.id}
              className="sidebar__item sidebar__item--action"
              onClick={() => otworzPowloke(shell)}
            >
              + {shell.label}
            </button>
          ))}

          <div className="sidebar__heading sidebar__heading--spaced">PORTY COM</div>
          {ports.length === 0 && <div className="sidebar__item">brak portów</div>}
          {ports.map((port) => (
            <button
              key={port.path}
              className="sidebar__item sidebar__item--action"
              onClick={() => otworzPort(port)}
              title={port.friendlyName ?? port.path}
            >
              + {port.path}
            </button>
          ))}
        </aside>

        <div className="stack">
          {tabs.length === 0 && <div className="stack__empty">Brak otwartych sesji</div>}

          {/*
            Wszystkie zakładki zostają zamontowane — ich powłoki mają działać w tle.
            Widoczna jest tylko aktywna. `key` trzyma instancję przy życiu, więc
            przełączanie zakładek nie dotyka sesji.
          */}
          {tabs.map((tab) => (
            <TerminalView
              key={tab.id}
              spec={tab.spec}
              settings={settings}
              active={tab.id === activeId}
              onReady={(info) => update(tab.id, { label: info.label, status: 'running' })}
              onExit={(code) =>
                update(tab.id, {
                  status: 'closed',
                  detail: code === undefined ? 'Sesja zamknięta' : `Zakończona (kod ${code})`
                })
              }
              onRenderer={setRenderer}
              onError={(message) => update(tab.id, { status: 'error', detail: message })}
            />
          ))}
        </div>

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
        <span>
          Sesje: <span className="statusbar__accent">{tabs.length}</span>
        </span>
        <button
          className={`statusbar__button${settingsOpen ? ' is-active' : ''}`}
          onClick={() => setSettingsOpen((isOpen) => !isOpen)}
        >
          Ustawienia
        </button>
        {activeTab?.detail && <span className="statusbar__status">{activeTab.detail}</span>}
      </footer>
    </div>
  );
}

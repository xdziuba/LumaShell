import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { TabBar } from './components/TabBar';
import { TitleBar } from './components/TitleBar';
import { TerminalView, type RendererKind } from './terminal/TerminalView';
import { useShortcuts, type ShortcutMap } from './hooks/useShortcuts';
import { useWorkspace } from './store/workspace';
import type { Command } from './commands/types';
import type { SerialPortInfo } from '@core/transports/transport';
import type { Profile } from '@core/profiles/profile';
import type { AppCapabilities, SessionSpec, ShellInfo } from '@shared/types/ipc';
import { DEFAULT_SETTINGS, type TerminalSettings } from '@shared/types/settings';

/** Losowy identyfikator profilu — crypto.randomUUID jest dostępne w rendererze. */
const newId = (): string => crypto.randomUUID();

/** Cel profilu → specyfikacja sesji. Ten sam kształt, inny kontekst użycia. */
function specFromProfile(profile: Profile): SessionSpec {
  return profile.target.kind === 'serial'
    ? { kind: 'serial', path: profile.target.path, baudRate: profile.target.baudRate }
    : { kind: 'pty', shellId: profile.target.shellId, cwd: profile.target.cwd };
}

// Panele otwierane rzadko ładowane leniwie — poza bundlem startowym
// (docs/architecture/05-wydajnosc.md).
const SettingsPanel = lazy(() => import('./settings/SettingsPanel'));
const CommandPalette = lazy(() => import('./components/CommandPalette'));

/** Etap 2 nie ma jeszcze ustawień portu — prędkość na sztywno. */
const PROTOTYPE_BAUD_RATE = 115200;

export function App(): React.JSX.Element {
  const [capabilities, setCapabilities] = useState<AppCapabilities | null>(null);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [renderer, setRenderer] = useState<RendererKind | null>(null);
  const [settings, setSettings] = useState<TerminalSettings>(DEFAULT_SETTINGS);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

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
    void window.luma.profiles.list().then(setProfiles);
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

  const otworzProfil = (profile: Profile): void =>
    void open(specFromProfile(profile), profile.name);

  const zapiszAktywnyJakoProfil = (): void => {
    if (!activeTab) return;
    // Profil dostaje nazwę aktywnej zakładki. Electron nie ma window.prompt, a edytor
    // profili z nazywaniem wchodzi w Etapie 5 — tu liczy się sam zapis i odtwarzanie.
    const spec = activeTab.spec;
    const target: Profile['target'] =
      spec.kind === 'serial'
        ? { kind: 'serial', path: spec.path, baudRate: spec.baudRate }
        : { kind: 'pty', shellId: spec.shellId, cwd: spec.cwd };

    void window.luma.profiles.save({ id: newId(), name: activeTab.label, target }).then(setProfiles);
  };

  const usunProfil = (id: string): void => void window.luma.profiles.delete(id).then(setProfiles);

  const przesunZakladke = (delta: number): void => {
    if (tabs.length === 0) return;
    const i = tabs.findIndex((tab) => tab.id === activeId);
    const next = tabs[(i + delta + tabs.length) % tabs.length];
    if (next) activate(next.id);
  };

  const zakladkaNr = (n: number): void => {
    // Ctrl+9 skacze na ostatnią zakładkę — odruch znany z przeglądarek.
    const tab = n === 9 ? tabs.at(-1) : tabs[n - 1];
    if (tab) activate(tab.id);
  };

  const zamknijAktywna = (): void => {
    if (activeId) close(activeId);
  };

  // Komendy zależą od bieżącego stanu, więc paleta i skróty korzystają z tej samej listy.
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    for (const shell of shells) {
      list.push({
        id: `new:${shell.id}`,
        title: `Nowa zakładka: ${shell.label}`,
        keywords: 'nowa terminal powłoka shell',
        run: () => otworzPowloke(shell)
      });
    }
    for (const port of ports) {
      list.push({
        id: `serial:${port.path}`,
        title: `Otwórz port: ${port.path}`,
        keywords: `serial com uart ${port.friendlyName ?? ''}`,
        run: () => otworzPort(port)
      });
    }
    for (const profile of profiles) {
      list.push({
        id: `profile:${profile.id}`,
        title: `Profil: ${profile.name}`,
        keywords: 'profil profile zapisany',
        run: () => otworzProfil(profile)
      });
    }
    if (activeTab) {
      list.push({
        id: 'profile.save',
        title: 'Zapisz aktywną sesję jako profil',
        keywords: 'profil zapisz save',
        run: zapiszAktywnyJakoProfil
      });
    }
    list.push(
      {
        id: 'tab.close',
        title: 'Zamknij aktywną zakładkę',
        keywords: 'zamknij close',
        hint: 'Ctrl+W',
        run: zamknijAktywna
      },
      {
        id: 'tab.next',
        title: 'Następna zakładka',
        keywords: 'przełącz',
        hint: 'Ctrl+Tab',
        run: () => przesunZakladke(1)
      },
      {
        id: 'tab.prev',
        title: 'Poprzednia zakładka',
        keywords: 'przełącz',
        hint: 'Ctrl+Shift+Tab',
        run: () => przesunZakladke(-1)
      },
      {
        id: 'settings',
        title: 'Ustawienia',
        keywords: 'czcionka rozmiar',
        hint: 'Ctrl+,',
        run: () => setSettingsOpen((isOpen) => !isOpen)
      }
    );
    return list;
    // Zależymy od danych (shells, ports, profiles, tabs, activeId). Funkcje-akcje domykają
    // się nad tym samym stanem, więc lista zależności obejmuje faktyczne wejścia.
  }, [shells, ports, profiles, tabs, activeId]);

  const shortcuts = useMemo<ShortcutMap>(() => {
    const map: ShortcutMap = {
      'ctrl+shift+p': () => setPaletteOpen((open) => !open),
      'ctrl+t': nowaZakladka,
      'ctrl+w': zamknijAktywna,
      'ctrl+comma': () => setSettingsOpen((open) => !open),
      'ctrl+tab': () => przesunZakladke(1),
      'ctrl+shift+tab': () => przesunZakladke(-1)
    };
    for (let n = 1; n <= 9; n += 1) map[`ctrl+${n}`] = () => zakladkaNr(n);
    return map;
  }, [shells, tabs, activeId]);

  useShortcuts(shortcuts);

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

          <div className="sidebar__heading sidebar__heading--spaced">
            PROFILE
            <button
              className="sidebar__heading-action"
              onClick={zapiszAktywnyJakoProfil}
              disabled={!activeTab}
              title="Zapisz aktywną sesję jako profil"
            >
              +
            </button>
          </div>
          {profiles.length === 0 && <div className="sidebar__item">brak profili</div>}
          {profiles.map((profile) => (
            <div key={profile.id} className="sidebar__profile">
              <button
                className="sidebar__item sidebar__item--action sidebar__profile-open"
                onClick={() => otworzProfil(profile)}
                title={
                  profile.target.kind === 'serial'
                    ? `${profile.target.path} @ ${profile.target.baudRate}`
                    : 'powłoka lokalna'
                }
              >
                ▸ {profile.name}
              </button>
              <button
                className="sidebar__profile-del"
                onClick={() => usunProfil(profile.id)}
                aria-label={`Usuń profil ${profile.name}`}
              >
                ✕
              </button>
            </div>
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

      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
        </Suspense>
      )}

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

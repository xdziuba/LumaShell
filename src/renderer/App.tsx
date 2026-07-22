import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { TabBar, type TabView } from './components/TabBar';
import { TitleBar } from './components/TitleBar';
import { PaneView, type PaneCallbacks } from './components/PaneView';
import { SerialMacros } from './components/SerialMacros';
import { Dropup } from './components/Dropup';
import { useShortcuts, type ShortcutMap } from './hooks/useShortcuts';
import { serializeTab, useWorkspace, type SessionTab } from './store/workspace';
import { disposeTerminalsExcept } from './terminal/terminal-instance';
import { PANEL_TITLES } from './panels/kinds';
import { GITHUB_URL } from './panels/app-meta';
import { applyTheme } from './theme/apply-theme';
import {
  IconAi,
  IconContainer,
  IconFolder,
  IconNetwork,
  IconPlus,
  IconProfile,
  IconSerial,
  IconSsh,
  IconTerminal
} from './components/icons';
import { findLeaf, leaves } from '@core/workspace/pane-tree';
import { BUILT_IN_THEMES, type Theme } from '@core/theme/theme';
import type { Command } from './commands/types';
import type { SerialPortInfo } from '@core/transports/transport';
import type { Profile } from '@core/profiles/profile';
import type {
  AiCliAvailability,
  AiCliTool,
  HostVerifyRequest,
  PluginCommand,
  PluginNotification,
  SessionSpec,
  ShellInfo,
  SshConnectRequest
} from '@shared/types/ipc';
import { DEFAULT_SETTINGS, SETTINGS_LIMITS, type TerminalSettings } from '@shared/types/settings';

/** Losowy identyfikator profilu — crypto.randomUUID jest dostępne w rendererze. */
const newId = (): string => crypto.randomUUID();

/** Cel profilu → specyfikacja sesji. Ten sam kształt, inny kontekst użycia. */
function specFromProfile(profile: Profile): SessionSpec {
  return profile.target.kind === 'serial'
    ? { kind: 'serial', path: profile.target.path, baudRate: profile.target.baudRate }
    : { kind: 'pty', shellId: profile.target.shellId, cwd: profile.target.cwd };
}

/** Oficjalne CLI AI logujące się kontem (subskrypcja) — do szybkiego startu w terminalu. */
const AI_CLIS: Array<{ tool: AiCliTool; label: string; account: string; install: string }> = [
  { tool: 'codex', label: 'Codex CLI', account: 'konto ChatGPT', install: 'npm i -g @openai/codex' },
  { tool: 'claude', label: 'Claude Code', account: 'konto Claude', install: 'npm i -g @anthropic-ai/claude-code' }
];

// Panele otwierane rzadko ładowane leniwie — poza bundlem startowym
// (docs/architecture/05-wydajnosc.md).
/** Ostatni segment ścieżki — krótka etykieta zakładki dla sesji otwartej w katalogu. */
function nazwaKatalogu(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Czego dotyczy otwarte okno wyboru katalogu roboczego. */
type ZadanieKatalogu =
  | { kind: 'shell'; shell: ShellInfo }
  | { kind: 'ai'; tool: AiCliTool; label: string };

const SettingsPanel = lazy(() => import('./settings/SettingsPanel'));
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const SshConnectDialog = lazy(() => import('./components/SshConnectDialog'));
const HostVerifyDialog = lazy(() => import('./components/HostVerifyDialog'));
const SftpPanel = lazy(() => import('./components/SftpPanel'));
const SerialConnectDialog = lazy(() => import('./components/SerialConnectDialog'));
const NetworkConnectDialog = lazy(() => import('./components/NetworkConnectDialog'));
const ContainerConnectDialog = lazy(() => import('./components/ContainerConnectDialog'));
const ThemeEditor = lazy(() => import('./components/ThemeEditor'));
const AboutPanel = lazy(() => import('./panels/AboutPanel'));
const ShortcutsPanel = lazy(() => import('./panels/ShortcutsPanel'));
const WhatsNewPanel = lazy(() => import('./panels/WhatsNewPanel'));
const PluginManager = lazy(() => import('./panels/PluginManager'));
const WorkdirDialog = lazy(() => import('./components/WorkdirDialog'));
const AiPanel = lazy(() => import('./panels/AiPanel'));
const AiChatPanel = lazy(() => import('./panels/AiChatPanel'));

export function App(): React.JSX.Element {
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [settings, setSettings] = useState<TerminalSettings>(DEFAULT_SETTINGS);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [themes, setThemes] = useState<Theme[]>(BUILT_IN_THEMES);
  const [themeId, setThemeId] = useState<string>(BUILT_IN_THEMES[0]!.id);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sshOpen, setSshOpen] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [containerOpen, setContainerOpen] = useState(false);
  const [hostVerify, setHostVerify] = useState<HostVerifyRequest | null>(null);
  const [sftpOpen, setSftpOpen] = useState(false);
  // Ścieżka portu, dla którego otwarty jest dialog konfiguracji (null = zamknięty).
  const [serialDialogPath, setSerialDialogPath] = useState<string | null>(null);
  // Otwarte okno wyboru katalogu roboczego (null = zamknięte).
  const [workdir, setWorkdir] = useState<ZadanieKatalogu | null>(null);
  // Identyfikatory sesji z aktywnym zapisem do pliku.
  const [loggingSessions, setLoggingSessions] = useState<Set<string>>(new Set());
  const [pluginCommands, setPluginCommands] = useState<PluginCommand[]>([]);
  const [notification, setNotification] = useState<PluginNotification | null>(null);
  // Które CLI AI są w PATH — decyduje, czy szybki start jest aktywny czy z podpowiedzią instalacji.
  const [aiClis, setAiClis] = useState<AiCliAvailability>({ codex: false, claude: false });

  const {
    tabs,
    activeId,
    open,
    openPanel,
    closeTab,
    activate,
    restore,
    updatePane,
    splitActivePane,
    closePane,
    focusPane,
    resizeSplit,
    setTabOrder
  } = useWorkspace();

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
  // Etykieta i status paska/zakładki pochodzą z aktywnego panelu — tylko dla zakładek-sesji.
  const activeLeaf =
    activeTab?.kind === 'session' ? findLeaf(activeTab.root, activeTab.activePaneId) : undefined;

  // Pasek tytułu opisuje AKTYWNĄ ZAKŁADKĘ — także tę bez sesji. Zakładka-panel pokazuje
  // swoją nazwę (Ustawienia/Motywy/…), nie mylące „brak sesji", które należy się dopiero
  // pustemu workspace'owi.
  const titleSubtitle =
    activeTab?.kind === 'panel' ? PANEL_TITLES[activeTab.panel] : activeLeaf?.label ?? 'brak sesji';

  const tabViews: TabView[] = tabs.map((tab) => {
    if (tab.kind === 'panel') {
      return { id: tab.id, label: PANEL_TITLES[tab.panel], status: 'running', kind: 'pty', panel: tab.panel, paneCount: 1 };
    }
    const leaf = findLeaf(tab.root, tab.activePaneId) ?? leaves(tab.root)[0];
    return {
      id: tab.id,
      label: leaf?.label ?? 'sesja',
      status: leaf?.status ?? 'starting',
      kind: leaf?.spec.kind ?? 'pty',
      paneCount: leaves(tab.root).length
    };
  });

  // `StrictMode` uruchamia efekty dwukrotnie w trybie deweloperskim. Bez tego strażnika
  // `npm run dev` odtwarzałby układ dwa razy.
  const wystartowano = useRef(false);
  // Zapis workspace'u jest wstrzymany, dopóki nie skończy się odtwarzanie — inaczej
  // pusty stan startowy nadpisałby zapamiętany układ.
  const odtworzono = useRef(false);

  useEffect(() => {
    if (wystartowano.current) return;
    wystartowano.current = true;

    void window.luma.getCapabilities().then((value) => {
      // Renderer nie wykrywa systemu sam — dostaje gotową flagę i tylko przełącza styl
      // (docs/architecture/03-interfejs-i-motywy.md#degradacja-na-windows-10).
      document.documentElement.dataset.acrylic = String(value.acrylic);
    });
    void window.luma.settings.get().then(setSettings);
    void window.luma.profiles.list().then(setProfiles);
    void window.luma.themes.get().then(({ themes: list, selectedId }) => {
      setThemes(list);
      setThemeId(selectedId);
      const active = list.find((t) => t.id === selectedId);
      if (active) applyTheme(active);
    });
    // Listowanie portów niczego nie otwiera, więc jest bezpieczne przy starcie.
    void window.luma.serial.listPorts().then(setPorts);
    // Wykrycie CLI AI też tylko sprawdza PATH — nic nie uruchamia.
    void window.luma.ai.detectClis().then(setAiClis);

    // Powłoki i zapamiętany układ ładowane razem: odtwarzamy tylko sesje powłok
    // (workspace-store odsiał już porty COM), a gdy nic nie zapisano — pierwsza powłoka.
    void Promise.all([window.luma.listShells(), window.luma.workspace.get()]).then(
      ([found, snapshot]) => {
        setShells(found);
        if (snapshot.tabs.length > 0) {
          restore(snapshot.tabs, snapshot.activeIndex);
        } else {
          const first = found[0];
          if (first) open({ kind: 'pty', shellId: first.id }, first.label);
        }
        odtworzono.current = true;
      }
    );
    // Zadania startowe — mają wykonać się raz. `open`/`restore` są stabilne (Zustand).
  }, [open, restore]);

  // Zapamiętywanie układu przy każdej zmianie zakładek, z opóźnieniem, żeby nie zapisywać
  // przy każdym drgnięciu. Serializujemy całe drzewa — proces główny przytnie porty COM.
  useEffect(() => {
    if (!odtworzono.current) return;
    const timer = setTimeout(() => {
      // Zapisujemy wyłącznie zakładki-sesje; panele (Ustawienia/About/…) nie są trwałe.
      const sessionTabs = tabs.filter((tab): tab is SessionTab => tab.kind === 'session');
      const activeIndex = Math.max(
        0,
        sessionTabs.findIndex((tab) => tab.id === activeId)
      );
      void window.luma.workspace.save({ tabs: sessionTabs.map(serializeTab), activeIndex });
    }, 500);
    return () => clearTimeout(timer);
  }, [tabs, activeId]);

  // Sprzątanie terminali: instancje xterm i sesje żyją poza Reactem (patrz
  // terminal-instance.ts), więc ich koniec musi wynikać ze STANU workspace'u, a nie z
  // odmontowania komponentu — to ostatnie zdarza się także przy podziale panelu, gdzie
  // sesja ma przeżyć. Wszystko, czego nie ma już w drzewie zakładek, jest zamykane.
  useEffect(() => {
    const alive = new Set<string>();
    for (const tab of tabs) {
      if (tab.kind !== 'session') continue;
      for (const leaf of leaves(tab.root)) alive.add(leaf.id);
    }
    disposeTerminalsExcept(alive);
  }, [tabs]);

  // Nasłuch próśb o weryfikację klucza hosta — niezależny od cyklu startowego.
  useEffect(() => window.luma.ssh.onHostVerify(setHostVerify), []);

  // Komendy wtyczek i ich powiadomienia. Wtyczki ładują się po starcie, więc lista
  // przychodzi zdarzeniem; toast znika po chwili.
  useEffect(() => {
    void window.luma.plugins.commands().then(setPluginCommands);
    const offCommands = window.luma.plugins.onCommandsChanged(setPluginCommands);
    const offNotify = window.luma.plugins.onNotification((n) => {
      setNotification(n);
      setTimeout(() => setNotification(null), 4000);
    });
    return () => {
      offCommands();
      offNotify();
    };
  }, []);

  const polaczSsh = (request: SshConnectRequest): void => {
    setSshOpen(false);
    void window.luma.ssh.connect(request).then(({ connectionId, label }) => {
      open({ kind: 'ssh', connectionId, label }, label);
    });
  };

  // Sesje sieciowe i kontenerowe nie mają sekretów — spec idzie wprost do workspace'u.
  const polaczSiec = (spec: Extract<SessionSpec, { kind: 'network' }>): void => {
    setNetworkOpen(false);
    void open(spec, spec.label);
  };
  const polaczKontener = (spec: Extract<SessionSpec, { kind: 'container' }>): void => {
    setContainerOpen(false);
    void open(spec, spec.label);
  };

  const zmienUstawienia = (next: TerminalSettings): void => {
    // Podgląd natychmiast, zapis w tle. Proces główny zwraca wartości po walidacji,
    // więc to one są ostatecznie prawdą.
    setSettings(next);
    void window.luma.settings.save(next).then(setSettings);
  };

  const activeTheme = themes.find((t) => t.id === themeId) ?? BUILT_IN_THEMES[0]!;
  const terminalTheme = {
    background: activeTheme.terminal.background,
    foreground: activeTheme.terminal.foreground,
    cursor: activeTheme.terminal.cursor,
    selection: activeTheme.terminal.selection
  };

  const wybierzMotyw = (id: string): void => {
    setThemeId(id);
    const t = themes.find((x) => x.id === id);
    if (t) applyTheme(t);
    void window.luma.themes.select(id);
  };

  // Podgląd motywu na żywo w edytorze — stosuje bez zapisu.
  const podgladMotywu = (t: Theme): void => applyTheme(t);

  const zapiszMotyw = (t: Theme): void => {
    void window.luma.themes.save(t).then((list) => {
      setThemes(list);
      wybierzMotyw(t.id);
    });
  };

  const importujMotyw = (): void => {
    void window.luma.themes.import().then((list) => {
      if (!list) return;
      setThemes(list);
      // Zaimportowany motyw to ostatni na liście własnych — wybierz go.
      const last = list.at(-1);
      if (last) wybierzMotyw(last.id);
    });
  };

  const usunMotyw = (id: string): void => {
    void window.luma.themes.delete(id).then((list) => {
      setThemes(list);
      // Po usunięciu wróć do domyślnego i zastosuj go (zakładka edytora zostaje otwarta).
      wybierzMotyw(BUILT_IN_THEMES[0]!.id);
    });
  };

  const otworzPowloke = (shell: ShellInfo): void =>
    void open({ kind: 'pty', shellId: shell.id }, shell.label);

  /**
   * Uruchomienie oficjalnego CLI AI zawsze przechodzi przez wybór katalogu roboczego:
   * Codex i Claude Code pracują na projekcie z katalogu startowego, więc domyślny katalog
   * domowy był dla nich bezużyteczny. Pole jest wypełnione ostatnim katalogiem, więc
   * zwykle wystarczy Enter. Logowanie kontem robi samo narzędzie — my nie dotykamy tokenów.
   */
  const otworzAiCli = (tool: AiCliTool, label: string): void => setWorkdir({ kind: 'ai', tool, label });

  /** Dopisuje katalog na początek listy ostatnich (bez duplikatów) i zapisuje ustawienia. */
  const zapamietajKatalog = (cwd: string): void => {
    const recentDirs = [cwd, ...settings.recentDirs.filter((d) => d !== cwd)].slice(
      0,
      SETTINGS_LIMITS.recentDirsMaxCount
    );
    zmienUstawienia({ ...settings, recentDirs });
  };

  /** Otwiera sesję zamówioną w oknie katalogu roboczego. Pusta ścieżka = katalog domyślny. */
  const otworzWKatalogu = (cwd: string): void => {
    const zadanie = workdir;
    setWorkdir(null);
    if (!zadanie) return;

    const sufiks = cwd ? ` — ${nazwaKatalogu(cwd)}` : '';
    if (zadanie.kind === 'shell') {
      const spec: Extract<SessionSpec, { kind: 'pty' }> = { kind: 'pty', shellId: zadanie.shell.id };
      if (cwd) spec.cwd = cwd;
      open(spec, `${zadanie.shell.label}${sufiks}`);
    } else {
      const spec: Extract<SessionSpec, { kind: 'ai-cli' }> = {
        kind: 'ai-cli',
        tool: zadanie.tool,
        label: zadanie.label
      };
      if (cwd) spec.cwd = cwd;
      open(spec, `${zadanie.label}${sufiks}`);
    }
    if (cwd) zapamietajKatalog(cwd);
  };

  // Klik portu otwiera dialog konfiguracji; właściwe otwarcie po zatwierdzeniu.
  const otworzPort = (port: SerialPortInfo): void => setSerialDialogPath(port.path);

  const nowaZakladka = (): void => {
    const first = shells[0];
    if (first) otworzPowloke(first);
  };

  const otworzProfil = (profile: Profile): void =>
    void open(specFromProfile(profile), profile.name);

  // Zapis profilu obsługuje pty i serial. Profile SSH (z poświadczeniami w safeStorage)
  // to osobny kawałek Etapu 3 — sesji SSH na razie nie da się zapisać jako profil.
  const canSaveProfile = activeLeaf?.spec.kind === 'pty' || activeLeaf?.spec.kind === 'serial';

  // SFTP dostępny tylko dla aktywnego panelu SSH z zestawioną sesją.
  const sshSessionId =
    activeLeaf?.spec.kind === 'ssh' && activeLeaf.status === 'running' ? activeLeaf.sessionId : undefined;

  // Sesja aktywnego panelu (dowolny typ) do zapisu do pliku.
  const activeSessionId = activeLeaf?.status === 'running' ? activeLeaf.sessionId : undefined;
  const isLogging = activeSessionId ? loggingSessions.has(activeSessionId) : false;

  // Tryb monitora (hex / znaczniki czasu) — tylko dla aktywnego panelu szeregowego.
  const isSerial = activeLeaf?.spec.kind === 'serial';
  const monitor = activeLeaf?.monitor ?? { hex: false, timestamps: false };
  const setMonitor = (patch: Partial<typeof monitor>): void => {
    if (!activeTab || !activeLeaf) return;
    updatePane(activeTab.id, activeLeaf.id, { monitor: { ...monitor, ...patch } });
  };

  const wyslijDoPortu = (text: string): void => {
    if (activeSessionId) void window.luma.terminal.write(activeSessionId, text);
  };
  const dodajMakro = (m: string): void =>
    zmienUstawienia({ ...settings, serialMacros: [...settings.serialMacros, m] });
  const usunMakro = (m: string): void =>
    zmienUstawienia({ ...settings, serialMacros: settings.serialMacros.filter((x) => x !== m) });

  const przelaczZapis = (): void => {
    if (!activeSessionId) return;
    const id = activeSessionId;
    if (isLogging) {
      void window.luma.sessionLog.stop(id);
      setLoggingSessions((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } else {
      void window.luma.sessionLog.start(id).then((started) => {
        if (started) setLoggingSessions((prev) => new Set(prev).add(id));
      });
    }
  };

  const zapiszAktywnyJakoProfil = (): void => {
    const spec = activeLeaf?.spec;
    if (!spec) return;
    // Electron nie ma window.prompt; profil dostaje nazwę aktywnego panelu.
    let target: Profile['target'];
    if (spec.kind === 'serial') {
      target = { kind: 'serial', path: spec.path, baudRate: spec.baudRate };
    } else if (spec.kind === 'pty') {
      target = { kind: 'pty', shellId: spec.shellId, cwd: spec.cwd };
    } else {
      return; // SSH — patrz wyżej
    }
    void window.luma.profiles.save({ id: newId(), name: activeLeaf!.label, target }).then(setProfiles);
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

  // Ctrl+W: dla sesji zamyka aktywny panel (ostatni → całą zakładkę); dla panelu zamyka zakładkę.
  const zamknijAktywny = (): void => {
    if (!activeTab) return;
    if (activeTab.kind === 'session') closePane(activeTab.id, activeTab.activePaneId);
    else closeTab(activeTab.id);
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
      list.push({
        id: `new-cwd:${shell.id}`,
        title: `Nowa zakładka w folderze…: ${shell.label}`,
        keywords: 'katalog folder cwd ścieżka terminal tutaj',
        run: () => setWorkdir({ kind: 'shell', shell })
      });
    }
    // CLI AI w palecie — do tej pory dało się je uruchomić tylko z paska bocznego i menu.
    for (const cli of AI_CLIS) {
      if (!aiClis[cli.tool]) continue;
      list.push({
        id: `ai-cli:${cli.tool}`,
        title: `${cli.label} w folderze…`,
        keywords: `ai codex claude cli ${cli.account}`,
        run: () => otworzAiCli(cli.tool, cli.label)
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
    list.push({
      id: 'ssh.connect',
      title: 'Połącz przez SSH…',
      keywords: 'ssh zdalny remote połączenie',
      run: () => setSshOpen(true)
    });
    list.push({
      id: 'network.connect',
      title: 'Połącz przez sieć…',
      keywords: 'tcp tls telnet websocket ws udp sieć network połączenie',
      run: () => setNetworkOpen(true)
    });
    list.push({
      id: 'container.connect',
      title: 'Dołącz do kontenera…',
      keywords: 'docker kubernetes k8s kontener pod exec',
      run: () => setContainerOpen(true)
    });
    for (const profile of profiles) {
      list.push({
        id: `profile:${profile.id}`,
        title: `Profil: ${profile.name}`,
        keywords: 'profil profile zapisany',
        run: () => otworzProfil(profile)
      });
    }
    if (canSaveProfile) {
      list.push({
        id: 'profile.save',
        title: 'Zapisz aktywną sesję jako profil',
        keywords: 'profil zapisz save',
        run: zapiszAktywnyJakoProfil
      });
    }
    if (activeTab) {
      list.push(
        {
          id: 'pane.split.row',
          title: 'Podziel panel w pionie',
          keywords: 'split podziel panel prawo pion',
          hint: 'Ctrl+Shift+E',
          run: () => splitActivePane('row')
        },
        {
          id: 'pane.split.column',
          title: 'Podziel panel w poziomie',
          keywords: 'split podziel panel dół poziom',
          hint: 'Ctrl+Shift+O',
          run: () => splitActivePane('column')
        }
      );
    }
    list.push(
      {
        id: 'tab.close',
        title: 'Zamknij aktywny panel',
        keywords: 'zamknij close panel',
        hint: 'Ctrl+W',
        run: zamknijAktywny
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
        keywords: 'czcionka rozmiar ustawienia',
        hint: 'Ctrl+,',
        run: () => openPanel('settings')
      },
      { id: 'panel.themes', title: 'Motywy', keywords: 'motyw theme kolor', run: () => openPanel('themes') },
      { id: 'panel.plugins', title: 'Wtyczki', keywords: 'wtyczki plugins menedżer', run: () => openPanel('plugins') },
      { id: 'panel.ai', title: 'Agent AI', keywords: 'ai agent openai model konfiguracja', run: () => openPanel('ai') },
      { id: 'panel.shortcuts', title: 'Skróty klawiszowe', keywords: 'skróty shortcuts klawisze', run: () => openPanel('shortcuts') },
      { id: 'panel.whatsnew', title: 'Nowości', keywords: "co nowego what's new zmiany", run: () => openPanel('whatsnew') },
      { id: 'panel.about', title: 'O aplikacji', keywords: 'about o aplikacji wersja', run: () => openPanel('about') }
    );
    // Komendy wtyczek — uruchamiane przez RPC do izolowanego hosta.
    for (const cmd of pluginCommands) {
      list.push({
        id: `plugin:${cmd.pluginId}:${cmd.id}`,
        title: cmd.title,
        keywords: 'wtyczka plugin',
        run: () => window.luma.plugins.runCommand(cmd.pluginId, cmd.id)
      });
    }
    return list;
    // Zależymy od danych (shells, ports, profiles, tabs, activeId, komendy wtyczek).
  }, [shells, ports, profiles, tabs, activeId, pluginCommands]);

  const shortcuts = useMemo<ShortcutMap>(() => {
    const map: ShortcutMap = {
      'ctrl+shift+p': () => setPaletteOpen((open) => !open),
      'ctrl+t': nowaZakladka,
      'ctrl+w': zamknijAktywny,
      'ctrl+comma': () => openPanel('settings'),
      'ctrl+tab': () => przesunZakladke(1),
      'ctrl+shift+tab': () => przesunZakladke(-1),
      'ctrl+shift+e': () => splitActivePane('row'),
      'ctrl+shift+o': () => splitActivePane('column')
    };
    for (let n = 1; n <= 9; n += 1) map[`ctrl+${n}`] = () => zakladkaNr(n);
    return map;
  }, [shells, tabs, activeId]);

  useShortcuts(shortcuts);

  return (
    <div className="app">
      <TitleBar subtitle={titleSubtitle} />

      <TabBar
        tabs={tabViews}
        activeId={activeId}
        onSelect={activate}
        onClose={closeTab}
        onNew={nowaZakladka}
        onReorder={setTabOrder}
      />

      <div className="body">
        <aside className="sidebar">
          <div className="sidebar__heading">POWŁOKI</div>
          {shells.length === 0 && <div className="sidebar__item">wykrywanie…</div>}
          {shells.map((shell) => (
            <div key={shell.id} className="sidebar__row">
              <button
                className="sidebar__item sidebar__item--action sidebar__row-main"
                onClick={() => otworzPowloke(shell)}
              >
                <IconTerminal className="sidebar__ico" />
                <span className="sidebar__item-label">{shell.label}</span>
              </button>
              <button
                className="sidebar__row-action"
                onClick={() => setWorkdir({ kind: 'shell', shell })}
                title={`Otwórz ${shell.label} w wybranym folderze`}
                aria-label={`Otwórz ${shell.label} w wybranym folderze`}
              >
                <IconFolder className="sidebar__ico-sm" />
              </button>
            </div>
          ))}

          <div className="sidebar__heading sidebar__heading--spaced">ZDALNE</div>
          <button className="sidebar__item sidebar__item--action" onClick={() => setSshOpen(true)}>
            <IconSsh className="sidebar__ico" />
            <span className="sidebar__item-label">Połączenie SSH…</span>
          </button>
          <button className="sidebar__item sidebar__item--action" onClick={() => setNetworkOpen(true)}>
            <IconNetwork className="sidebar__ico" />
            <span className="sidebar__item-label">Połączenie sieciowe…</span>
          </button>
          <button className="sidebar__item sidebar__item--action" onClick={() => setContainerOpen(true)}>
            <IconContainer className="sidebar__ico" />
            <span className="sidebar__item-label">Kontener (Docker/K8s)…</span>
          </button>

          <div className="sidebar__heading sidebar__heading--spaced">AGENT AI</div>
          <button
            className="sidebar__item sidebar__item--action"
            onClick={() => openPanel('aiChat')}
            title="Czat z modelem AI (bez wykonywania akcji)"
          >
            <IconAi className="sidebar__ico" />
            <span className="sidebar__item-label">Czat AI</span>
          </button>
          {AI_CLIS.map((cli) => (
            <button
              key={cli.tool}
              className="sidebar__item sidebar__item--action"
              onClick={() => otworzAiCli(cli.tool, cli.label)}
              disabled={!aiClis[cli.tool]}
              title={
                aiClis[cli.tool]
                  ? `Uruchom ${cli.label} w wybranym katalogu — logowanie ${cli.account}`
                  : `Nie znaleziono w PATH — zainstaluj: ${cli.install}`
              }
            >
              <IconAi className="sidebar__ico" />
              <span className="sidebar__item-label">{cli.label}</span>
            </button>
          ))}
          <button
            className="sidebar__item sidebar__item--action"
            onClick={() => openPanel('ai')}
            title="Konfiguracja dostawcy AI (klucz API)"
          >
            <IconAi className="sidebar__ico" />
            <span className="sidebar__item-label">Konfiguracja…</span>
          </button>

          <div className="sidebar__heading sidebar__heading--spaced">PORTY COM</div>
          {ports.length === 0 && <div className="sidebar__item">brak portów</div>}
          {ports.map((port) => (
            <button
              key={port.path}
              className="sidebar__item sidebar__item--action"
              onClick={() => otworzPort(port)}
              title={port.friendlyName ?? port.path}
            >
              <IconSerial className="sidebar__ico" />
              <span className="sidebar__item-label">{port.path}</span>
            </button>
          ))}

          <div className="sidebar__heading sidebar__heading--spaced">
            PROFILE
            <button
              className="sidebar__heading-action"
              onClick={zapiszAktywnyJakoProfil}
              disabled={!canSaveProfile}
              title="Zapisz aktywną sesję jako profil"
              aria-label="Zapisz aktywną sesję jako profil"
            >
              <IconPlus className="sidebar__ico-sm" />
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
                <IconProfile className="sidebar__ico" />
                <span className="sidebar__item-label">{profile.name}</span>
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
            Każda zakładka to drzewo paneli. Wszystkie zostają zamontowane — powłoki
            działają w tle; widoczna jest tylko aktywna. `key` na zakładce trzyma jej
            sesje przy życiu przy przełączaniu.
          */}
          {tabs.map((tab) => {
            const cls = `pane-root${tab.id === activeId ? '' : ' pane-root--hidden'}`;

            // Zakładka-panel: zastępuje terminal swoją treścią (Ustawienia/Motywy/About/…).
            if (tab.kind === 'panel') {
              const close = (): void => closeTab(tab.id);
              return (
                <div key={tab.id} className={cls}>
                  <div className="panel-view">
                    <Suspense fallback={<div className="panel-card__loading">ładowanie…</div>}>
                      {tab.panel === 'settings' && (
                        <SettingsPanel settings={settings} onChange={zmienUstawienia} onClose={close} />
                      )}
                      {tab.panel === 'themes' && (
                        <ThemeEditor
                          base={activeTheme}
                          onPreview={podgladMotywu}
                          onSave={zapiszMotyw}
                          onImport={importujMotyw}
                          onExport={(t) => void window.luma.themes.export(t)}
                          onDelete={usunMotyw}
                          onClose={() => {
                            applyTheme(activeTheme); // cofnij ewentualny podgląd
                            close();
                          }}
                        />
                      )}
                      {tab.panel === 'plugins' && <PluginManager onClose={close} />}
                      {tab.panel === 'ai' && <AiPanel onClose={close} />}
                      {tab.panel === 'aiChat' && (
                        <AiChatPanel onClose={close} onOpenConfig={() => openPanel('ai')} />
                      )}
                      {tab.panel === 'about' && <AboutPanel onClose={close} />}
                      {tab.panel === 'shortcuts' && <ShortcutsPanel onClose={close} />}
                      {tab.panel === 'whatsnew' && <WhatsNewPanel onClose={close} />}
                    </Suspense>
                  </div>
                </div>
              );
            }

            const cb: PaneCallbacks = {
              settings,
              terminalTheme,
              tabActive: tab.id === activeId,
              activePaneId: tab.activePaneId,
              onReady: (paneId, label, sessionId) =>
                updatePane(tab.id, paneId, { label, status: 'running', sessionId }),
              onExit: (paneId, code) =>
                updatePane(tab.id, paneId, {
                  status: 'closed',
                  detail: code === undefined ? 'Sesja zamknięta' : `Zakończona (kod ${code})`
                }),
              onError: (paneId, message) => updatePane(tab.id, paneId, { status: 'error', detail: message }),
              // Renderer (webgl/canvas) nie jest już pokazywany w UI; PaneView i tak go wymaga.
              onRenderer: () => {},
              onFocus: (paneId) => focusPane(tab.id, paneId),
              onResize: (splitId, ratio) => resizeSplit(tab.id, splitId, ratio)
            };
            return (
              <div key={tab.id} className={cls}>
                <PaneView node={tab.root} cb={cb} />
              </div>
            );
          })}

          {/* SFTP to narzędzie SESJI (nie globalny panel) — nakładka nad aktywną zakładką SSH. */}
          {sftpOpen && sshSessionId && (
            <div className="panel-card">
              <Suspense fallback={<div className="panel-card__loading">ładowanie…</div>}>
                <SftpPanel sessionId={sshSessionId} onClose={() => setSftpOpen(false)} />
              </Suspense>
            </div>
          )}
        </div>
      </div>

      {isSerial && activeSessionId && (
        <SerialMacros
          macros={settings.serialMacros}
          onSend={wyslijDoPortu}
          onAddMacro={dodajMakro}
          onRemoveMacro={usunMakro}
        />
      )}

      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
        </Suspense>
      )}

      {sshOpen && (
        <Suspense fallback={null}>
          <SshConnectDialog onConnect={polaczSsh} onClose={() => setSshOpen(false)} />
        </Suspense>
      )}

      {workdir && (
        <Suspense fallback={null}>
          <WorkdirDialog
            title={
              workdir.kind === 'shell'
                ? `${workdir.shell.label} w folderze`
                : `${workdir.label} w folderze`
            }
            recent={settings.recentDirs}
            onConfirm={otworzWKatalogu}
            onClose={() => setWorkdir(null)}
          />
        </Suspense>
      )}

      {serialDialogPath && (
        <Suspense fallback={null}>
          <SerialConnectDialog
            path={serialDialogPath}
            onOpen={(spec) => {
              setSerialDialogPath(null);
              void open(spec, `${spec.path} @ ${spec.baudRate}`);
            }}
            onClose={() => setSerialDialogPath(null)}
          />
        </Suspense>
      )}

      {networkOpen && (
        <Suspense fallback={null}>
          <NetworkConnectDialog onOpen={polaczSiec} onClose={() => setNetworkOpen(false)} />
        </Suspense>
      )}

      {containerOpen && (
        <Suspense fallback={null}>
          <ContainerConnectDialog onOpen={polaczKontener} onClose={() => setContainerOpen(false)} />
        </Suspense>
      )}

      {hostVerify && (
        <Suspense fallback={null}>
          <HostVerifyDialog
            request={hostVerify}
            onDecision={(accepted) => {
              window.luma.ssh.respondHostVerify(hostVerify.requestId, accepted);
              setHostVerify(null);
            }}
          />
        </Suspense>
      )}

      {notification && (
        <div className={`toast toast--${notification.level}`}>
          <span className="toast__source">{notification.pluginName}</span>
          <span className="toast__message">{notification.message}</span>
        </div>
      )}

      {/* Dolny pasek jako pasek menu: po lewej kategorie (Plik/Widok/…), po prawej akcje sesji. */}
      <footer className="statusbar">
        <div className="statusbar__group statusbar__menus">
          <Dropup label="Plik" align="left" variant="category">
            {(close) => (
              <>
                <button className="dropup__item" onClick={() => { nowaZakladka(); close(); }}>
                  <span>Nowa zakładka</span>
                  <span className="dropup__hint">Ctrl+T</span>
                </button>
                <button
                  className="dropup__item"
                  disabled={shells.length === 0}
                  onClick={() => {
                    const first = shells[0];
                    if (first) setWorkdir({ kind: 'shell', shell: first });
                    close();
                  }}
                >
                  <span>Nowa zakładka w folderze…</span>
                </button>
                <div className="dropup__sep" />
                <button className="dropup__item" onClick={() => { setSshOpen(true); close(); }}>
                  <span>Połączenie SSH…</span>
                </button>
                <button className="dropup__item" onClick={() => { setNetworkOpen(true); close(); }}>
                  <span>Połączenie sieciowe…</span>
                </button>
                <button className="dropup__item" onClick={() => { setContainerOpen(true); close(); }}>
                  <span>Kontener (Docker/K8s)…</span>
                </button>
                <div className="dropup__sep" />
                <button className="dropup__item" onClick={() => { zamknijAktywny(); close(); }}>
                  <span>Zamknij zakładkę</span>
                  <span className="dropup__hint">Ctrl+W</span>
                </button>
              </>
            )}
          </Dropup>

          <Dropup label="Widok" align="left" variant="category">
            {(close) => (
              <>
                <button className="dropup__item" onClick={() => { openPanel('settings'); close(); }}>
                  <span>Ustawienia</span>
                  <span className="dropup__hint">Ctrl+,</span>
                </button>
                <button className="dropup__item" onClick={() => { openPanel('themes'); close(); }}>
                  <span>Motywy</span>
                </button>
                <div className="dropup__sep" />
                <button className="dropup__item" onClick={() => { splitActivePane('row'); close(); }}>
                  <span>Podziel w pionie</span>
                  <span className="dropup__hint">Ctrl+Shift+E</span>
                </button>
                <button className="dropup__item" onClick={() => { splitActivePane('column'); close(); }}>
                  <span>Podziel w poziomie</span>
                  <span className="dropup__hint">Ctrl+Shift+O</span>
                </button>
              </>
            )}
          </Dropup>

          <Dropup label="Narzędzia" align="left" variant="category">
            {(close) => (
              <>
                <button className="dropup__item" onClick={() => { openPanel('aiChat'); close(); }}>
                  <span>Czat AI</span>
                </button>
                <button className="dropup__item" onClick={() => { openPanel('ai'); close(); }}>
                  <span>Agent AI (konfiguracja)</span>
                </button>
                <div className="dropup__sep" />
                {AI_CLIS.map((cli) =>
                  aiClis[cli.tool] ? (
                    <button
                      key={cli.tool}
                      className="dropup__item"
                      onClick={() => { otworzAiCli(cli.tool, cli.label); close(); }}
                      title={`Uruchom ${cli.label} w wybranym katalogu — logowanie ${cli.account}`}
                    >
                      <span>{cli.label} w folderze…</span>
                      <span className="dropup__hint">{cli.account}</span>
                    </button>
                  ) : (
                    <button
                      key={cli.tool}
                      className="dropup__item"
                      disabled
                      title={`Nie znaleziono w PATH — zainstaluj: ${cli.install}`}
                    >
                      <span>{cli.label}</span>
                      <span className="dropup__hint">brak w PATH</span>
                    </button>
                  )
                )}
                <div className="dropup__sep" />
                <button className="dropup__item" onClick={() => { openPanel('plugins'); close(); }}>
                  <span>Wtyczki</span>
                </button>
                <button className="dropup__item" onClick={() => { setPaletteOpen(true); close(); }}>
                  <span>Paleta komend</span>
                  <span className="dropup__hint">Ctrl+Shift+P</span>
                </button>
              </>
            )}
          </Dropup>

          <Dropup label="Pomoc" align="left" variant="category">
            {(close) => (
              <>
                <button className="dropup__item" onClick={() => { openPanel('shortcuts'); close(); }}>
                  <span>Skróty klawiszowe</span>
                </button>
                <button className="dropup__item" onClick={() => { openPanel('whatsnew'); close(); }}>
                  <span>Nowości</span>
                </button>
                <button className="dropup__item" onClick={() => { openPanel('about'); close(); }}>
                  <span>O aplikacji</span>
                </button>
                <div className="dropup__sep" />
                <button className="dropup__item" onClick={() => { window.luma.diagnostics.reportProblem(); close(); }}>
                  <span>Zgłoś problem</span>
                </button>
                <button className="dropup__item" onClick={() => { window.luma.diagnostics.openLogs(); close(); }}>
                  <span>Otwórz logi</span>
                </button>
                <button className="dropup__item" onClick={() => { window.open(GITHUB_URL, '_blank'); close(); }}>
                  <span>GitHub ↗</span>
                </button>
              </>
            )}
          </Dropup>
        </div>

        <div className="statusbar__group statusbar__group--end">
          {activeLeaf?.detail && <span className="statusbar__status">{activeLeaf.detail}</span>}
          {sshSessionId && (
            <button
              className={`statusbar__button${sftpOpen ? ' is-active' : ''}`}
              onClick={() => setSftpOpen((isOpen) => !isOpen)}
            >
              Pliki (SFTP)
            </button>
          )}
          {isSerial && (
            <>
              <button
                className={`statusbar__button${monitor.hex ? ' is-active' : ''}`}
                onClick={() => setMonitor({ hex: !monitor.hex })}
                title="Widok szesnastkowy"
              >
                HEX
              </button>
              <button
                className={`statusbar__button${monitor.timestamps ? ' is-active' : ''}`}
                onClick={() => setMonitor({ timestamps: !monitor.timestamps })}
                title="Znaczniki czasu"
              >
                Czas
              </button>
            </>
          )}
          {activeSessionId && (
            <button
              className={`statusbar__button${isLogging ? ' is-active' : ''}`}
              onClick={przelaczZapis}
              title="Zapis surowych danych sesji do pliku"
            >
              {isLogging ? '● Zapis' : 'Zapis do pliku'}
            </button>
          )}

          <Dropup label={`Motyw: ${activeTheme.name}`} title="Wybór i edycja motywu">
            {(close) => (
              <>
                {themes.map((t) => (
                  <button
                    key={t.id}
                    className={`dropup__item${t.id === themeId ? ' is-active' : ''}`}
                    onClick={() => {
                      wybierzMotyw(t.id);
                      close();
                    }}
                  >
                    {t.name}
                  </button>
                ))}
                <div className="dropup__sep" />
                <button
                  className="dropup__item"
                  onClick={() => {
                    openPanel('themes');
                    close();
                  }}
                >
                  Edytuj motyw…
                </button>
              </>
            )}
          </Dropup>
        </div>
      </footer>
    </div>
  );
}

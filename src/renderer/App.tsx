import { useEffect, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { TerminalView, type RendererKind } from './terminal/TerminalView';
import type { AppCapabilities } from '@shared/types/ipc';

export function App(): React.JSX.Element {
  const [capabilities, setCapabilities] = useState<AppCapabilities | null>(null);
  const [shell, setShell] = useState('uruchamianie…');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [renderer, setRenderer] = useState<RendererKind | null>(null);

  useEffect(() => {
    void window.luma.getCapabilities().then((value) => {
      setCapabilities(value);
      // Renderer nie wykrywa systemu sam — dostaje gotową flagę i tylko przełącza styl
      // (docs/architecture/03-interfejs-i-motywy.md#degradacja-na-windows-10).
      document.documentElement.dataset.acrylic = String(value.acrylic);
    });
  }, []);

  return (
    <div className="app">
      <TitleBar subtitle={shell} />

      <div className="body">
        <aside className="sidebar">
          <div className="sidebar__heading">SESJE</div>
          <div className="sidebar__item">● {shell}</div>
        </aside>

        <TerminalView
          onReady={(info) => setShell(info.shell)}
          onExit={setExitCode}
          onRenderer={setRenderer}
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
        {exitCode !== null && <span>Powłoka zakończona (kod {exitCode})</span>}
      </footer>
    </div>
  );
}

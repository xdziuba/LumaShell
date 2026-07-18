/**
 * Panel „O aplikacji" (Etap UI) — otwierany jako zakładka.
 *
 * Krótka wizytówka: logo, nazwa, wersja, opis i linki. Linki zewnętrzne otwiera proces
 * główny w przeglądarce (setWindowOpenHandler), więc zwykłe <a target="_blank"> jest bezpieczne.
 */

import logoUrl from '../assets/logo-256.png';
import { APP_NAME, APP_VERSION, GITHUB_URL } from './app-meta';

export default function AboutPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div className="panel">
      <header className="panel__header">
        <span className="panel__title">O APLIKACJI</span>
        <button className="panel__close" onClick={onClose} aria-label="Zamknij">
          ✕
        </button>
      </header>

      <div className="panel__body panel__body--center">
        <img className="about__logo" src={logoUrl} alt={APP_NAME} draggable={false} />
        <div className="about__name">{APP_NAME}</div>
        <div className="about__version">wersja {APP_VERSION}</div>
        <p className="about__desc">
          Szybki, konfigurowalny terminal dla Windows: powłoki lokalne, SSH, port szeregowy,
          TCP/TLS/Telnet/WebSocket/UDP, Docker i Kubernetes, wtyczki oraz agent AI.
        </p>
        <div className="about__links">
          <a className="about__link" href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <p className="about__note">Zbudowane na Electron + React + xterm.js.</p>
      </div>
    </div>
  );
}

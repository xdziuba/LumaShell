/**
 * Dialog weryfikacji klucza hosta SSH (Etap 3).
 *
 * Pokazuje odcisk i powód: pierwszy kontakt (TOFU) albo — groźniejsze — zmianę klucza,
 * która może oznaczać atak MITM. Decyzja użytkownika wraca do procesu głównego.
 */

import type { HostVerifyRequest } from '@shared/types/ipc';

interface HostVerifyDialogProps {
  request: HostVerifyRequest;
  onDecision: (accepted: boolean) => void;
}

export default function HostVerifyDialog({ request, onDecision }: HostVerifyDialogProps): React.JSX.Element {
  const changed = request.reason === 'changed';
  return (
    <div className="palette-overlay">
      <div className={`dialog dialog--verify${changed ? ' dialog--danger' : ''}`}>
        <div className="dialog__title">
          {changed ? '⚠ Klucz hosta się ZMIENIŁ' : 'Nieznany host'}
        </div>

        <p className="dialog__text">
          {changed ? (
            <>
              Klucz hosta <b>{request.host}:{request.port}</b> jest inny niż zapamiętany. To może
              oznaczać atak typu man-in-the-middle — albo że serwer został przeinstalowany.
              Kontynuuj tylko, jeśli wiesz, dlaczego klucz się zmienił.
            </>
          ) : (
            <>
              Łączysz się z <b>{request.host}:{request.port}</b> po raz pierwszy. Sprawdź, czy odcisk
              zgadza się z tym, co podał administrator serwera.
            </>
          )}
        </p>

        <code className="dialog__fingerprint">{request.fingerprint}</code>

        <div className="dialog__actions">
          <button className="dialog__button" onClick={() => onDecision(false)}>
            Odrzuć
          </button>
          <button
            className={`dialog__button ${changed ? 'dialog__button--danger' : 'dialog__button--primary'}`}
            onClick={() => onDecision(true)}
          >
            {changed ? 'Ufam mimo to' : 'Ufaj i połącz'}
          </button>
        </div>
      </div>
    </div>
  );
}

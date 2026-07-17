/**
 * Profil połączenia (Etap 2).
 *
 * Profil to nazwany, zapamiętany przepis na sesję. Należy do `core` — sam model bez
 * zależności od procesu (docs/architecture/06-struktura-projektu.md).
 *
 * Profile SSH i pełny zestaw pól (zmienne środowiskowe, motyw, tagi) wchodzą w Etapie 3
 * i dalej. Tu jest podzbiór, który da się w pełni obsłużyć bieżącymi transportami.
 *
 * Uwaga bezpieczeństwa: profil NIE przechowuje haseł ani kluczy — te należą do magazynu
 * poświadczeń systemu (docs/security/02-sekrety.md).
 */

export interface PtyProfile {
  kind: 'pty';
  /** Identyfikator wykrytej powłoki; brak = powłoka domyślna. */
  shellId?: string;
  cwd?: string;
}

export interface SerialProfile {
  kind: 'serial';
  path: string;
  baudRate: number;
}

export interface Profile {
  id: string;
  name: string;
  target: PtyProfile | SerialProfile;
}

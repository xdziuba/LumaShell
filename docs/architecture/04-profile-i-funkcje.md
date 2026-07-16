# Profile połączeń i funkcje terminala

## 1. Profile połączeń

Każdy profil zawiera:

* nazwę,
* ikonę,
* typ połączenia,
* host,
* port,
* nazwę użytkownika,
* domyślny katalog,
* komendę startową,
* zmienne środowiskowe,
* motyw,
* czcionkę,
* ustawienia terminala,
* ustawienia ponownego połączenia,
* kodowanie,
* tagi,
* grupę,
* skrót klawiaturowy.

Profile obsługują:

* import,
* eksport,
* duplikowanie,
* grupowanie,
* przypinanie,
* wyszukiwanie,
* filtrowanie,
* wersjonowanie,
* synchronizację jako opcjonalną funkcję.

### Dane uwierzytelniające

> **Hasła i dane uwierzytelniające nie mogą być zapisywane bezpośrednio w pliku
> konfiguracyjnym.**

Należy wykorzystać:

* Windows Credential Manager,
* Electron `safeStorage`,
* systemowy magazyn kluczy.

Szczegóły: [security/02 — Sekrety](../security/02-sekrety.md).

## 2. Standardowe funkcje terminala

Aplikacja zawiera:

* zakładki,
* podziały pionowe i poziome,
* zmianę wielkości paneli,
* wyszukiwanie w terminalu,
* kopiowanie i wklejanie,
* zaznaczanie blokowe,
* obsługę linków,
* historię przewijania,
* command palette,
* konfigurowalne skróty,
* przywracanie sesji,
* zapisywanie workspace’u,
* tryb pełnoekranowy,
* tryb focus,
* quake mode,
* powiadomienia o zakończeniu komendy,
* nagrywanie sesji,
* eksport terminala do tekstu i HTML,
* logowanie danych do pliku,
* broadcast input,
* synchronizowanie przewijania,
* snippet manager,
* makra,
* wykrywanie ścieżek i adresów URL,
* przeciąganie plików do terminala,
* szybkie akcje dla zaznaczonego tekstu.

# Sekrety

## 1. Zasada podstawowa

> **Hasła, klucze i tokeny nie mogą być zapisywane bezpośrednio w plikach
> konfiguracyjnych.**

Nie wolno przechowywać klucza API ani haseł w zwykłym pliku JSON.

## 2. Magazyny poświadczeń

Należy wykorzystać:

* Windows Credential Manager,
* Electron `safeStorage`,
* systemowy magazyn kluczy.

## 3. Zakres

| Sekret | Miejsce przechowywania |
| --- | --- |
| Hasła SSH | Systemowy magazyn poświadczeń |
| Hasła kluczy prywatnych | Systemowy magazyn poświadczeń |
| Klucze API dostawców AI | `safeStorage` / Credential Manager |
| Dane profili połączeń (bez sekretów) | Plik konfiguracyjny |

Profile połączeń przechowują wszystko **poza** danymi uwierzytelniającymi — patrz
[architecture/04 — Profile i funkcje](../architecture/04-profile-i-funkcje.md).

## 4. Agent a sekrety

Agent AI **nie otrzymuje** klucza prywatnego ani hasła. Agent prosi usługę SSH o wykonanie
operacji w istniejącej, uwierzytelnionej sesji — patrz
[03 — Polityka agenta](03-polityka-agenta.md).

## 5. Filtr sekretów

Przed wysłaniem kontekstu do modelu działa filtr sekretów wykrywający między innymi:

* klucze API,
* tokeny dostępu,
* hasła,
* prywatne klucze SSH,
* ciągi połączeń do baz danych,
* pliki `.env`.

### Czego nie wysyłać do modelu

* całej historii terminala,
* wszystkich plików użytkownika,
* zawartości schowka,
* haseł,
* kluczy prywatnych,
* tokenów,
* zmiennych środowiskowych zawierających sekrety,
* danych z innych sesji.

### Czego nie zapisywać w pamięci agenta

* haseł,
* tokenów,
* pełnych logów zawierających dane wrażliwe,
* prywatnych kluczy,
* przypadkowo wykrytych sekretów.

## 6. Zakazane praktyki integracji z ChatGPT

Nie należy budować integracji polegającej na:

* kopiowaniu ciasteczek z ChatGPT,
* przechwytywaniu tokenów przeglądarki,
* wywoływaniu prywatnych endpointów ChatGPT,
* podszywaniu się pod Codex CLI,
* obchodzeniu rozliczeń OpenAI.

Przy integracji z Codex CLI aplikacja **nie odczytuje ani nie kopiuje tokenów logowania**.

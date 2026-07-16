# Model procesów

## 1. Zasady Electrona

Konfiguracja okien:

* `contextIsolation: true`,
* `nodeIntegration: false`,
* ograniczone preload API,
* **walidacja wszystkich komunikatów IPC**.

## 2. Ograniczenia renderera

Renderer **nie ma** bezpośredniego dostępu do:

* systemu plików,
* Node.js,
* procesów systemowych,
* portów COM,
* kluczy SSH,
* dowolnego wykonywania kodu.

Cały dostęp do zasobów systemowych przechodzi przez ograniczone API preload i jest
obsługiwany w procesie głównym.

## 3. Podział odpowiedzialności

| Proces | Odpowiedzialność |
| --- | --- |
| **Renderer** | UI, terminal xterm.js, zakładki, ustawienia, motywy, panele |
| **Preload** | Wąskie, jawnie zdefiniowane API wystawiane przez context bridge |
| **Main** | Okna, PTY, SSH, porty COM, pliki, aktualizacje, sekrety, IPC |
| **Plugin Host** | Wtyczki **bez integracji Node.js**, wyłącznie RPC ([plugin-api/02](../plugin-api/02-uprawnienia-i-izolacja.md)) |
| **Agent Runtime** | Agent AI w osobnym procesie lub `UtilityProcess` |

## 4. Izolacja agenta

Agent AI **nie działa**:

* w rendererze,
* w głównym procesie Electron,
* w procesie odpowiedzialnym za interfejs,
* z pełnym dostępem do modułów Node.js.

Agent działa w osobnym procesie lub w Electron `UtilityProcess` i komunikuje się z
aplikacją wyłącznie przez Tool Router — patrz
[security/03 — Polityka agenta](03-polityka-agenta.md).

## 5. Izolacja wtyczek

Wtyczki działają w procesie **bez integracji Node.js** — bez dostępu do `fs`, `net`
i `child_process`. Jedynym kanałem jest **RPC** do procesu głównego, który waliduje każde
wywołanie i sprawdza uprawnienia z manifestu.

Dzięki temu lista uprawnień pokazywana użytkownikowi przy instalacji jest **rzeczywistą
gwarancją**, a nie deklaracją. Model i jego koszty:
[plugin-api/02 — Uprawnienia i izolacja](../plugin-api/02-uprawnienia-i-izolacja.md),
uzasadnienie: [architecture/10 — Decyzje](../architecture/10-decyzje.md#d2--izolacja-wtyczek-rpc-bez-node).

> **Uwaga na różnicę.** Agent (sekcja 4) i wtyczki (sekcja 5) wyglądają podobnie, ale mają
> inny model zaufania. Agenta pisze zespół aplikacji, więc `UtilityProcess` z Node jest tam
> wystarczający. Kod wtyczki jest cudzy, więc izolacja musi być wymuszona architektonicznie.

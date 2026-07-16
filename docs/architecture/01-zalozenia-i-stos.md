# Założenia i stos technologiczny

## 1. Główne założenia

Aplikacja jest nowoczesnym terminalem dla systemu Windows, napisanym w technologiach
webowych i uruchamianym jako klasyczna aplikacja desktopowa.

Program będzie:

* zbudowany przy użyciu Electron,
* eksportowany jako plik `.exe`,
* instalowany za pomocą instalatora `.exe` lub `.msi`,
* dostępny opcjonalnie jako wersja portable,
* zoptymalizowany pod kątem szybkiego uruchamiania i niskiego zużycia pamięci,
* rozszerzalny przez wtyczki napisane w JavaScript lub TypeScript,
* mocno konfigurowalny wizualnie i funkcjonalnie,
* przeznaczony głównie dla Windows 10 i Windows 11.

Aplikacja łączy funkcje klasycznego terminala, klienta SSH, narzędzia do obsługi portów
szeregowych oraz środowiska z rozszerzeniami podobnego do VS Code.

## 2. Stos technologiczny

### Warstwa aplikacji

Rozważane opcje:

* Electron,
* TypeScript,
* Node.js,
* React lub SolidJS,
* Vite,
* CSS Modules, SCSS lub Tailwind CSS,
* Zustand, Redux Toolkit albo Jotai do zarządzania stanem.

**Rekomendowany zestaw:**

> Electron, TypeScript, React, Vite, Zustand, SCSS.

React ułatwi budowanie rozbudowanego interfejsu, paneli, zakładek, ustawień i systemu
rozszerzeń. Zustand zapewni prostsze i lżejsze zarządzanie stanem niż pełny Redux.

### Silnik terminala

Do wyświetlania terminala wykorzystana zostanie biblioteka **xterm.js**.

> **Nazwy paczek.** Paczka `xterm` jest **wycofana** (ostatnia wersja 5.3.0, oznaczona jako
> deprecated). Aktualne, utrzymywane paczki mają przestrzeń nazw `@xterm/`:
>
> ```text
> @xterm/xterm            → rdzeń terminala
> @xterm/addon-webgl      → renderer WebGL
> ```

Biblioteka powinna zostać rozszerzona o:

* własny system buforowania,
* wirtualizację historii,
* wyszukiwanie,
* zaznaczanie,
* obsługę linków,
* obsługę własnych motywów,
* renderowanie przez WebGL.

Do lokalnych terminali:

* node-pty,
* Windows ConPTY.

Dzięki temu aplikacja będzie mogła uruchamiać PowerShell, PowerShell 7, CMD, Git Bash,
WSL, własne powłoki oraz dowolne programy konsolowe.

### Moduły natywne — stan faktyczny

`node-pty` (1.1.0) i `serialport` (13.x) są zbudowane na **N-API** (`node-addon-api`)
i dostarczają gotowe prebuildy dla `win32-x64`. Konsekwencje:

* instalacja **nie uruchamia kompilacji** — node-gyp, Python ani Visual Studio nie są
  potrzebne na ścieżce standardowej,
* N-API jest **stabilne między ABI**, więc ta sama binarka działa w Node i w Electronie
  **bez `electron-rebuild`**.

Zweryfikowane empirycznie: Node 24 (ABI 137) i Electron 43 (ABI 148) ładują ten sam moduł;
`node-pty` uruchomił PowerShell przez ConPTY, `serialport` wylistował porty COM.

> **Pakowanie (Etap 8).** Binaria natywne muszą zostać wyłączone z archiwum asar przez
> `asarUnpack` w electron-builderze — inaczej nie załadują się w zainstalowanej aplikacji,
> mimo że działają w trybie deweloperskim. Dotyczy to `pty.node`, `conpty.dll`,
> `OpenConsole.exe` i `winpty-agent.exe`.

Kompilacja pozostaje **ścieżką awaryjną** (np. wersja bez prebuildów). Wymaga wtedy Visual
Studio Build Tools z narzędziami C++ oraz Node w wersji zgodnej z bieżącym node-gyp
(linia 24.x: `>= 24.15`).

### Komunikacja

| Protokół | Biblioteka |
| --- | --- |
| SSH | `ssh2` |
| Port szeregowy COM | `serialport` |
| TCP i UDP | natywne moduły Node.js |
| WebSocket | `ws` |
| Telnet | osobny moduł lub oficjalna wtyczka |
| SFTP | `ssh2-sftp-client` lub moduł oparty na `ssh2` |

### Dystrybucja

* electron-builder,
* instalator NSIS,
* opcjonalny MSI,
* wersja portable,
* automatyczne aktualizacje przez electron-updater.

## Rekomendacja końcowa

> Electron, TypeScript, React, Vite, `@xterm/xterm`, node-pty, ssh2, serialport oraz
> izolowany system wtyczek JavaScript działający **bez integracji Node.js**, komunikujący
> się wyłącznie przez RPC ([10 — Decyzje](10-decyzje.md#d2--izolacja-wtyczek-rpc-bez-node)).

Aplikacja powinna być webowa technologicznie, ale zachowywać się jak klasyczny program
desktopowy.

Rozwój należy rozpocząć od jednego pionowego prototypu:

```text
Electron
→ React
→ xterm.js
→ node-pty
→ PowerShell
→ motyw dark green glass
```

Po uzyskaniu płynnego terminala można kolejno dodać zakładki, profile, SSH, COM, motywy
i system wtyczek.

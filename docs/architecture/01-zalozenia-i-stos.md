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

> Electron, TypeScript, React, Vite, xterm.js, node-pty, ssh2, serialport oraz izolowany
> system wtyczek JavaScript oparty na osobnych procesach lub UtilityProcess.

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

# Warstwy i transporty

## 1. Podział na warstwy

Aplikacja jest podzielona na kilka wyraźnie oddzielonych warstw.

```text
┌──────────────────────────────────────────────┐
│                Renderer Process              │
│ React, interfejs, terminal, panele, motywy   │
├──────────────────────────────────────────────┤
│                  IPC Bridge                  │
│ bezpieczna komunikacja renderer ↔ main       │
├──────────────────────────────────────────────┤
│                 Main Process                 │
│ okna, sesje, pliki, procesy, aktualizacje    │
├──────────────────────────────────────────────┤
│               Terminal Services              │
│ PTY, SSH, COM, TCP, SFTP, Telnet             │
├──────────────────────────────────────────────┤
│                  Plugin Host                 │
│ wtyczki JS/TS, API, izolacja, uprawnienia    │
├──────────────────────────────────────────────┤
│ konfiguracja, sekrety, logi, cache, profile  │
└──────────────────────────────────────────────┘
```

### Renderer Process

Odpowiada za:

* interfejs użytkownika,
* terminal xterm.js,
* zakładki,
* podziały ekranów,
* ustawienia,
* motywy,
* command palette,
* zarządzanie układami,
* wyświetlanie paneli wtyczek.

Renderer **nie ma** bezpośredniego dostępu do systemu plików, Node.js, procesów
systemowych, portów COM, kluczy SSH ani dowolnego wykonywania kodu.

### Main Process

Odpowiada za:

* tworzenie okien,
* zarządzanie procesami PTY,
* SSH,
* porty COM,
* operacje na plikach,
* system aktualizacji,
* system wtyczek,
* bezpieczne przechowywanie danych,
* komunikację IPC.

Zasady bezpieczeństwa procesów opisuje [security/01 — Model procesów](../security/01-model-procesow.md).

## 2. Abstrakcja połączeń

Każdy rodzaj połączenia implementuje wspólny interfejs.

```ts
export interface TerminalTransport {
  id: string;
  type: string;
  state: ConnectionState;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(data: string | Uint8Array): Promise<void>;
  resize?(columns: number, rows: number): Promise<void>;

  onData(callback: (data: Uint8Array) => void): void;
  onStateChange(callback: (state: ConnectionState) => void): void;
  onError(callback: (error: Error) => void): void;
}
```

Implementacje:

```text
LocalPtyTransport
SshTransport
SerialTransport
TcpTransport
UdpTransport
TelnetTransport
WebSocketTransport
```

Dzięki temu interfejs terminala nie zależy od konkretnego rodzaju połączenia.

## 3. Obsługiwane rodzaje komunikacji

### MVP

#### Terminal lokalny

* PowerShell,
* CMD,
* Git Bash,
* WSL,
* niestandardowa powłoka,
* niestandardowa komenda startowa,
* zmienne środowiskowe,
* wybór katalogu roboczego.

#### SSH

* uwierzytelnianie hasłem,
* uwierzytelnianie kluczem,
* klucz zabezpieczony hasłem,
* known hosts,
* keep-alive,
* automatyczne ponowne łączenie,
* SSH agent,
* port forwarding,
* jump host,
* proxy.

#### Port szeregowy COM

* wybór portu,
* baud rate,
* data bits,
* stop bits,
* parity,
* flow control,
* RTS, CTS, DTR,
* tryb tekstowy,
* tryb szesnastkowy,
* timestampy,
* automatyczne ponowne połączenie,
* logowanie danych do pliku,
* wysyłanie gotowych komend i makr.

### Kolejne wersje

* SFTP,
* SCP,
* TCP,
* TCP z TLS,
* UDP,
* Telnet,
* WebSocket,
* named pipes,
* Docker exec,
* Kubernetes exec,
* połączenia przez bastion SSH,
* integracje chmurowe.

Rzadziej używane protokoły mogą być dostarczane jako oficjalne wtyczki.

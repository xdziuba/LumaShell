# Polityka agenta

## 1. Zasada podstawowa

> Agent **nie otrzymuje „dostępu do terminala”** jako jednego nieograniczonego mechanizmu.
> Zamiast tego otrzymuje zestaw jawnie zdefiniowanych narzędzi.

## 2. Narzędzia agenta

### Narzędzia terminalowe

```text
terminal.listSessions
terminal.readOutput
terminal.writeInput
terminal.createSession
terminal.resizeSession
terminal.interruptProcess
terminal.closeSession
terminal.getWorkingDirectory
```

```ts
interface TerminalWriteInput {
  sessionId: string;
  data: string;
  appendNewLine?: boolean;
}
```

### Narzędzia procesów

```text
process.run
process.getStatus
process.stop
process.list
```

Wywołanie określa:

* program,
* argumenty,
* katalog roboczy,
* limit czasu,
* dozwolone zmienne środowiskowe,
* maksymalny rozmiar odpowiedzi.

### Narzędzia plikowe

```text
filesystem.readFile
filesystem.writeFile
filesystem.patchFile
filesystem.listDirectory
filesystem.search
filesystem.createDirectory
filesystem.delete
```

Dostęp należy ograniczać do katalogów zaakceptowanych przez użytkownika.
**Agent nie widzi automatycznie całego dysku.**

### Narzędzia SSH

```text
ssh.listSessions
ssh.connect
ssh.execute
ssh.uploadFile
ssh.downloadFile
ssh.disconnect
```

Agent **nie otrzymuje klucza prywatnego ani hasła**. Prosi jedynie usługę SSH o wykonanie
operacji w istniejącej, uwierzytelnionej sesji.

### Narzędzia portu szeregowego

```text
serial.listPorts
serial.getPortInfo
serial.open
serial.configure
serial.writeText
serial.writeBytes
serial.read
serial.startCapture
serial.stopCapture
serial.close
```

```ts
interface SerialWriteRequest {
  sessionId: string;
  mode: "text" | "hex" | "binary";
  data: string;
  lineEnding?: "none" | "lf" | "cr" | "crlf";
}
```

## 3. Tryby autonomii

### Tryb tylko do odczytu

Agent może czytać wyjście terminala, analizować logi, wyjaśniać błędy i przygotowywać
polecenia. **Nie może niczego wykonywać.**

### Tryb proponowania — *domyślny*

Agent przygotowuje komendę, wyświetla ją użytkownikowi, czeka na akceptację i wykonuje
dopiero po zatwierdzeniu.

### Tryb automatyczny w workspace

Agent może samodzielnie wykonywać operacje, ale tylko:

* w wybranym workspace,
* na określonych terminalach,
* w określonych katalogach,
* z zatwierdzonymi narzędziami,
* do czasu zakończenia zadania.

### Tryb zaufanej sesji

Agent może wykonywać operacje bez każdorazowego potwierdzenia w ramach konkretnej sesji.
Wymaga wyraźnej zgody użytkownika i **widocznego oznaczenia**:

```text
AUTONOMICZNY DOSTĘP AKTYWNY
COM4 · SSH: test-server · C:\Projects\Firmware
```

## 4. Operacje zawsze wymagające potwierdzenia

Niezależnie od trybu potwierdzenia wymagają:

* formatowanie dysku,
* kasowanie dużej liczby plików,
* zmiany rejestru systemowego,
* instalowanie sterowników,
* uruchamianie programów jako administrator,
* flashowanie firmware,
* wysyłanie nieznanych danych do urządzenia,
* modyfikowanie bootloadera,
* zmiana konfiguracji bezpieczeństwa,
* wysyłanie prywatnych danych do sieci,
* odczytywanie danych uwierzytelniających.

## 5. Zabezpieczenia UART

Komunikacja z urządzeniem fizycznym może mieć skutki inne niż zwykłe uruchomienie komendy.

Agent może na przykład:

* zresetować urządzenie,
* usunąć konfigurację,
* uruchomić bootloader,
* zmienić stan przekaźnika,
* sterować silnikiem,
* zmienić ustawienia zasilania,
* rozpocząć aktualizację firmware.

Dlatego każda sesja UART posiada **profil ryzyka**:

```ts
type DeviceRiskLevel =
  | "read-only"
  | "development"
  | "hardware-control"
  | "critical";
```

| Profil | Uprawnienia agenta |
| --- | --- |
| `read-only` | Wyłącznie odczyt danych, analiza logów, wykrywanie protokołu |
| `development` | Komendy diagnostyczne, zmiany ustawień tymczasowych, reset urządzenia po zatwierdzeniu |
| `hardware-control` | Każda komenda zmieniająca stan urządzenia wymaga potwierdzenia |
| `critical` | Tylko analiza danych — **wysyłanie danych całkowicie zablokowane** |

### Przykład zgody

```text
Agent chce wysłać do COM4:

status\r\n

[Zezwól raz] [Zezwalaj w tej sesji] [Odrzuć]
```

### Przykładowy plan agenta

Zadanie: *„Połącz się z COM4 z prędkością 115200, wyślij komendę status i przeanalizuj
odpowiedź.”*

```text
1. Otwórz COM4.
2. Ustaw 115200, 8N1.
3. Wyślij „status\r\n”.
4. Poczekaj maksymalnie 5 sekund.
5. Przeanalizuj odpowiedź.
```

## 6. Powiązane dokumenty

* [security/01 — Model procesów](01-model-procesow.md) — izolacja Agent Runtime
* [security/02 — Sekrety](02-sekrety.md) — filtr sekretów, dostęp do poświadczeń
* [security/04 — Audyt](04-audyt.md) — rejestr działań
* [plugin-api/03 — Narzędzia agenta](../plugin-api/03-narzedzia-agenta.md) — schematy i ryzyko

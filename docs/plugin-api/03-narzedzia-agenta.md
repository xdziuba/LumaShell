# Plugin API — narzędzia agenta

Wtyczki JavaScript mogą udostępniać agentowi AI dodatkowe narzędzia.

## 1. Protokół narzędzi

Narzędzia mają **wersjonowane schematy JSON**.

```json
{
  "name": "serial.writeText",
  "version": "1",
  "description": "Writes text to an open serial session.",
  "risk": "hardware-write",
  "inputSchema": {
    "type": "object",
    "properties": {
      "sessionId": {
        "type": "string"
      },
      "text": {
        "type": "string"
      },
      "lineEnding": {
        "enum": ["none", "lf", "cr", "crlf"]
      }
    },
    "required": ["sessionId", "text"]
  }
}
```

### Rejestr wykonania

Każde wykonanie narzędzia zawiera:

* identyfikator zadania,
* identyfikator sesji agenta,
* identyfikator użytkownika,
* nazwę narzędzia,
* argumenty,
* poziom ryzyka,
* wynik,
* czas rozpoczęcia i zakończenia,
* informację o zgodzie użytkownika.

Szczegóły: [security/04 — Audyt](../security/04-audyt.md).

## 2. Manifest z narzędziami agenta

```json
{
  "id": "com.example.stm32-tools",
  "name": "STM32 Tools",
  "version": "1.0.0",
  "apiVersion": "1",
  "permissions": [
    "agent.registerTools",
    "serial.read",
    "serial.write"
  ],
  "contributes": {
    "agentTools": [
      {
        "name": "stm32.readDeviceInfo",
        "risk": "read-only"
      },
      {
        "name": "stm32.flashFirmware",
        "risk": "critical"
      }
    ]
  }
}
```

## 3. Rejestracja narzędzia

```ts
export function activate(context: PluginContext) {
  context.agent.registerTool({
    name: "stm32.readDeviceInfo",
    description: "Reads information from a connected STM32 device",
    risk: "read-only",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string"
        }
      },
      required: ["sessionId"]
    },
    execute: async ({ sessionId }) => {
      return context.serial.request(sessionId, "device-info\r\n");
    }
  });
}
```

## 4. Zasady

* Wtyczka **nie otrzymuje automatycznie** wszystkich uprawnień agenta.
* Uprawnienia wtyczki i uprawnienia agenta są sprawdzane **niezależnie**.
* Rejestracja narzędzi wymaga uprawnienia `agent.registerTools`.
* Każde narzędzie deklaruje **poziom ryzyka**, który steruje wymaganiem potwierdzenia —
  patrz [security/03 — Polityka agenta](../security/03-polityka-agenta.md).

/**
 * Runtime Plugin Hosta (Etap 6).
 *
 * Działa w ukrytym oknie z sandbox:true i BEZ Node.js. Ładuje kod wtyczek, daje im
 * `context` (Plugin API), a każdą realną zdolność deleguje przez most RPC do procesu
 * głównego, który sprawdza uprawnienia (docs/architecture/10-decyzje.md).
 *
 * Wtyczka NIE ma tu dostępu do `require`, `fs`, `net` ani `process` — to jest istota
 * izolacji D2. Podstawiony `require` rzuca, żeby próba sięgnięcia po moduł była jawnym
 * błędem, a nie cichym undefined.
 */

// Plik jest modułem (patrz `export {}` na końcu), więc `declare global` poprawnie
// rozszerza typ Window o most wstrzyknięty przez preload.
export {};

interface HostBridge {
  send: (message: unknown) => void;
  onMessage: (callback: (message: unknown) => void) => void;
}

declare global {
  interface Window {
    readonly pluginHost: HostBridge;
  }
}

const bridge = window.pluginHost;

/** Zarejestrowane handlery komend: klucz `pluginId::commandId`. */
const commandHandlers = new Map<string, () => void>();

/** Handlery narzędzi AI (AI-6): klucz `pluginId::toolId`; mogą być async i ZWRACAĆ wynik. */
type ToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;
const toolHandlers = new Map<string, ToolHandler>();

/** Buduje `context` przekazywany do activate() danej wtyczki. */
function makeContext(pluginId: string): unknown {
  return {
    commands: {
      registerCommand(commandId: string, handler: () => void): void {
        commandHandlers.set(`${pluginId}::${commandId}`, handler);
        bridge.send({ type: 'register-command', pluginId, commandId });
      }
    },
    notifications: {
      showInfo(message: string): void {
        bridge.send({ type: 'notify', pluginId, level: 'info', message: String(message) });
      }
    },
    // Narzędzia AI (AI-6): model może je wywołać w pętli agenta. Handler zwraca tekst dla
    // modelu; narzędzie musi być też zadeklarowane w manifeście (contributes.tools) i wtyczka
    // musi mieć uprawnienie ai.tools — inaczej main odrzuci wywołanie.
    tools: {
      registerTool(toolId: string, handler: ToolHandler): void {
        toolHandlers.set(`${pluginId}::${toolId}`, handler);
        bridge.send({ type: 'register-tool', pluginId, toolId });
      }
    }
  };
}

/** Uruchamia kod wtyczki w kontrolowanym zakresie i woła activate(context). */
function loadPlugin(pluginId: string, code: string): void {
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  const forbiddenRequire = (name: string): never => {
    throw new Error(`Wtyczka nie ma dostępu do modułów (require "${name}") — izolacja D2`);
  };

  try {
    // Kod wtyczki jest zbundlowany do jednego pliku CommonJS (bez zależności zewnętrznych).
    const factory = new Function('module', 'exports', 'require', code);
    factory(mod, mod.exports, forbiddenRequire);

    const activate = mod.exports['activate'];
    if (typeof activate === 'function') {
      (activate as (ctx: unknown) => void)(makeContext(pluginId));
      bridge.send({ type: 'loaded', pluginId });
    } else {
      bridge.send({ type: 'error', pluginId, message: 'brak eksportu activate()' });
    }
  } catch (error) {
    bridge.send({
      type: 'error',
      pluginId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

bridge.onMessage((raw) => {
  const message = raw as {
    type?: string;
    pluginId?: string;
    commandId?: string;
    toolId?: string;
    callId?: string;
    args?: Record<string, unknown>;
    code?: string;
  };
  if (message.type === 'load' && message.pluginId && typeof message.code === 'string') {
    loadPlugin(message.pluginId, message.code);
  } else if (message.type === 'invoke' && message.pluginId && message.commandId) {
    const handler = commandHandlers.get(`${message.pluginId}::${message.commandId}`);
    // Handler może rzucić — łapiemy, żeby błąd wtyczki nie wywrócił hosta.
    try {
      handler?.();
    } catch (error) {
      bridge.send({
        type: 'error',
        pluginId: message.pluginId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  } else if (message.type === 'invoke-tool' && message.pluginId && message.toolId && message.callId) {
    // Wywołanie narzędzia AI — request/response po callId (handler może być async).
    const callId = message.callId;
    const handler = toolHandlers.get(`${message.pluginId}::${message.toolId}`);
    if (!handler) {
      bridge.send({ type: 'tool-error', callId, message: 'narzędzie nie zarejestrowane' });
      return;
    }
    Promise.resolve()
      .then(() => handler(message.args ?? {}))
      .then((result) => bridge.send({ type: 'tool-result', callId, result: String(result) }))
      .catch((error: unknown) =>
        bridge.send({ type: 'tool-error', callId, message: error instanceof Error ? error.message : String(error) })
      );
  }
});

// Sygnał gotowości — main może zacząć wysyłać wtyczki.
bridge.send({ type: 'ready' });

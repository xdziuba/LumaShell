/**
 * Fabryka transportu sieciowego (Etap 7).
 *
 * Wybiera konkretną implementację po protokole. Dzięki temu warstwa IPC prosi o „sieć",
 * a nie o konkretną klasę — spójnie z resztą transportów.
 */

import type { NetworkOptions, TerminalTransport } from '@core/transports/transport';
import { TcpTransport } from './tcp-transport.ts';
import { TelnetTransport } from './telnet-transport.ts';
import { WebSocketTransport } from './websocket-transport.ts';
import { UdpTransport } from './udp-transport.ts';

export function createNetworkTransport(id: string, options: NetworkOptions): TerminalTransport {
  switch (options.protocol) {
    case 'telnet':
      return new TelnetTransport(id, options);
    case 'ws':
    case 'wss':
      return new WebSocketTransport(id, options);
    case 'udp':
      return new UdpTransport(id, options);
    case 'tcp':
    case 'tls':
      return new TcpTransport(id, options);
    default:
      // Wyczerpujące dopasowanie — nowy protokół wymusi tu uzupełnienie.
      throw new Error(`Nieobsługiwany protokół sieciowy: ${String(options.protocol)}`);
  }
}

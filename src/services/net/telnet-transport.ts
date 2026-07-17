/**
 * Implementacja `TerminalTransport` dla Telnetu (Etap 7).
 *
 * Telnet to TCP z wtrąconą negocjacją opcji (sekwencje IAC, RFC 854). Gdyby przepuścić je
 * surowo do terminala, użytkownik zobaczyłby śmieci (bajty 0xFF…). Ta klasa dziedziczy po
 * TcpTransport i wpina stanowy filtr IAC: odpowiada na negocjacje, a do xterm oddaje już
 * czysty strumień.
 *
 * Polityka negocjacji jest celowo minimalna, ale wystarczająca dla typowych serwerów
 * (routery, sprzęt sieciowy): zgadzamy się na echo i „suppress go-ahead" od serwera, resztę
 * grzecznie odrzucamy. Odpowiadamy tylko na WILL/DO (oferty i prośby), nie na potwierdzenia
 * WONT/DONT — to zamyka drogę do pętli negocjacyjnych.
 */

import { TcpTransport } from './tcp-transport.ts';

// Bajty sterujące Telnetu.
const IAC = 255;
const SE = 240;
const SB = 250;
const WILL = 251;
const WONT = 252;
const DO = 253;
const DONT = 254;

// Opcje, na które reagujemy przychylnie — dają sensowną sesję interaktywną.
const OPT_BINARY = 0;
const OPT_ECHO = 1;
const OPT_SGA = 3; // suppress go-ahead

type Mode = 'data' | 'iac' | 'option' | 'sb' | 'sb-iac';

export class TelnetTransport extends TcpTransport {
  #mode: Mode = 'data';
  #command = 0;

  /** Nadpisuje przetwarzanie strumienia: odsiewa IAC, resztę oddaje terminalowi. */
  protected override onChunk(chunk: Buffer): void {
    const clean: number[] = [];
    const reply: number[] = [];

    for (const byte of chunk) {
      switch (this.#mode) {
        case 'data':
          if (byte === IAC) this.#mode = 'iac';
          else clean.push(byte);
          break;

        case 'iac':
          if (byte === IAC) {
            // IAC IAC to dosłowny bajt 0xFF w danych.
            clean.push(IAC);
            this.#mode = 'data';
          } else if (byte === WILL || byte === WONT || byte === DO || byte === DONT) {
            this.#command = byte;
            this.#mode = 'option';
          } else if (byte === SB) {
            this.#mode = 'sb';
          } else {
            // Jednobajtowe komendy (GA, NOP, DM…) pomijamy.
            this.#mode = 'data';
          }
          break;

        case 'option':
          this.#negotiate(this.#command, byte, reply);
          this.#mode = 'data';
          break;

        case 'sb':
          // Zawartość subnegocjacji nas nie interesuje — czekamy na IAC SE.
          if (byte === IAC) this.#mode = 'sb-iac';
          break;

        case 'sb-iac':
          this.#mode = byte === SE ? 'data' : 'sb';
          break;
      }
    }

    if (reply.length > 0) this.socket?.write(Buffer.from(reply));
    if (clean.length > 0) this.emit(Uint8Array.from(clean));
  }

  /** Buduje odpowiedź na ofertę (WILL) lub prośbę (DO) serwera. */
  #negotiate(command: number, option: number, reply: number[]): void {
    if (command === WILL) {
      // Serwer oferuje, że będzie robił X. Akceptujemy echo/SGA/binary, resztę odrzucamy.
      const accept = option === OPT_ECHO || option === OPT_SGA || option === OPT_BINARY;
      reply.push(IAC, accept ? DO : DONT, option);
    } else if (command === DO) {
      // Serwer prosi, żebyśmy robili X. Zgadzamy się tylko na SGA/binary.
      const accept = option === OPT_SGA || option === OPT_BINARY;
      reply.push(IAC, accept ? WILL : WONT, option);
    }
    // WONT/DONT to potwierdzenia — bez odpowiedzi, żeby nie kręcić pętli.
  }
}

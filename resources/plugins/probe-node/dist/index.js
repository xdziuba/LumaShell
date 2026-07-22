'use strict';

/**
 * Sonda Node — wtyczka diagnostyczna Plugin API v2.
 *
 * Odpowiada na jedno pytanie: co naprawdę widzi kod wtyczki uruchomionej we własnym
 * procesie. Wynik ląduje w logu wtyczki (menedżer wtyczek → „Log wtyczki"), więc da się go
 * pokazać bez zgadywania. Sonda niczego nie zmienia i nigdzie nic nie wysyła.
 */

let interwal;

exports.activate = function activate(context) {
  const fs = require('node:fs');
  const net = require('node:net');
  const os = require('node:os');

  let electronKlucze;
  try {
    electronKlucze = Object.keys(require('electron'));
  } catch (error) {
    electronKlucze = 'brak modułu electron: ' + error.message;
  }

  console.log('--- sonda wtyczki -------------------------------------------');
  console.log('pluginId          :', context.pluginId);
  console.log('uprawnienia       :', JSON.stringify(context.permissions));
  console.log('node              :', process.versions.node);
  console.log('electron          :', process.versions.electron || 'brak');
  console.log('pid               :', process.pid);
  console.log('katalog roboczy   :', process.cwd());
  console.log('fs.readFileSync   :', typeof fs.readFileSync);
  console.log('net.connect       :', typeof net.connect);
  console.log('require(electron) :', JSON.stringify(electronKlucze));
  console.log('process.permission:', typeof process.permission);
  console.log('system            :', os.platform(), os.release());
  console.log('-------------------------------------------------------------');

  // Uprawnienia terminal.read i terminal.write przestały być deklaracją bez pokrycia —
  // te komendy są dowodem, że stoi za nimi realne API.
  context.commands.registerCommand('probe.terminals', async () => {
    const sesje = await context.terminal.list();
    console.log('sesje terminala:', JSON.stringify(sesje));
    await context.notifications.show(
      sesje.length === 0 ? 'Brak otwartych sesji' : `Sesje: ${sesje.map((s) => s.label).join(', ')}`
    );
  });

  context.commands.registerCommand('probe.read', async () => {
    const sesje = await context.terminal.list();
    if (sesje.length === 0) {
      await context.notifications.show('Brak sesji do odczytu', 'warn');
      return;
    }
    const tekst = await context.terminal.readRecent(sesje[0].sessionId, 10);
    console.log('ostatnie wiersze sesji ' + sesje[0].label + ':');
    console.log(tekst);
    const ile = tekst.split(String.fromCharCode(10)).length;
    await context.notifications.show('Odczytano ' + ile + ' wierszy z: ' + sesje[0].label);
  });

  // Dowód, że proces ŻYJE dalej, a nie tylko wykonał activate i skończył.
  let tick = 0;
  interwal = setInterval(() => {
    tick += 1;
    console.log(`sonda żyje, tick ${tick}`);
  }, 5000);
};

exports.deactivate = function deactivate() {
  // Sprzątanie po sobie: bez tego proces nie zakończyłby się po „Zatrzymaj".
  if (interwal) clearInterval(interwal);
  console.log('sonda: deactivate() wywołane — sprzątam timer');
};

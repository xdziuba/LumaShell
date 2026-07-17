// Przykładowa wtyczka LumaShell (Etap 6).
// CommonJS, bez zależności zewnętrznych — zgodnie z izolacją D2 wtyczka nie ma dostępu
// do modułów Node (require rzuca). Cała moc idzie przez context (Plugin API).

function activate(context) {
  context.commands.registerCommand('hello.sayHello', function () {
    context.notifications.showInfo('Witaj ze wtyczki! Izolacja D2 działa — kod bez Node.');
  });
}

function deactivate() {
  // Czyszczenie zasobów (brak w tym przykładzie).
}

module.exports = { activate: activate, deactivate: deactivate };

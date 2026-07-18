// Przykładowa wtyczka AI-6: rejestruje narzędzie AI tylko-do-odczytu, które model może
// wywołać w pętli agenta. Zbundlowany CommonJS, bez zależności zewnętrznych (izolacja D2).
function activate(context) {
  context.tools.registerTool('current_time', function () {
    return 'Aktualny czas lokalny: ' + new Date().toString();
  });
}

function deactivate() {}

module.exports = { activate, deactivate };

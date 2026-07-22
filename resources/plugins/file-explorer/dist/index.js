// LumaShell File Explorer — bundle CommonJS bez zależności i dostępu do Node.js.
//
// Plugin API v1 udostępnia obecnie wyłącznie komendy, powiadomienia i narzędzia AI.
// Eksplorator plików wymaga dodatkowo kontrolowanego RPC do systemu plików oraz API
// tworzenia zakładek/paneli. Ten plugin wykrywa te zdolności zamiast obchodzić sandbox D2.

var REQUIRED_CAPABILITIES = [
  {
    key: 'filesystem.listDirectory',
    available: function (context) {
      return Boolean(context.filesystem && typeof context.filesystem.listDirectory === 'function');
    }
  },
  {
    key: 'filesystem.readFile',
    available: function (context) {
      return Boolean(context.filesystem && typeof context.filesystem.readFile === 'function');
    }
  },
  {
    key: 'filesystem.writeFile',
    available: function (context) {
      return Boolean(context.filesystem && typeof context.filesystem.writeFile === 'function');
    }
  },
  {
    key: 'ui.createPanel',
    available: function (context) {
      return Boolean(context.ui && typeof context.ui.createPanel === 'function');
    }
  },
  {
    key: 'workspace.openTab',
    available: function (context) {
      return Boolean(context.workspace && typeof context.workspace.openTab === 'function');
    }
  }
];

function missingCapabilities(context) {
  return REQUIRED_CAPABILITIES.filter(function (capability) {
    return !capability.available(context);
  }).map(function (capability) {
    return capability.key;
  });
}

function capabilityMessage(context) {
  var missing = missingCapabilities(context);
  if (missing.length === 0) {
    return 'Wymagane API jest dostępne, ale jego kontrakt nie jest jeszcze opisany w SDK LumaShell.';
  }
  return 'Plugin API v1 nie udostępnia jeszcze: ' + missing.join(', ') + '.';
}

function activate(context) {
  context.commands.registerCommand('fileExplorer.open', function () {
    var missing = missingCapabilities(context);
    if (missing.length > 0) {
      context.notifications.showInfo(
        'Nie można otworzyć eksploratora bez dostępu do plików i zakładek przez RPC. ' +
          'Użyj komendy „Pliki: Sprawdź wymagania API”, aby zobaczyć brakujące elementy.'
      );
      return;
    }

    context.notifications.showInfo(
      'LumaShell udostępnia wymagane obiekty, ale SDK nie definiuje jeszcze ich kontraktu. ' +
        'Plugin nie wykonuje niezweryfikowanych wywołań.'
    );
  });

  context.commands.registerCommand('fileExplorer.showRequirements', function () {
    context.notifications.showInfo(capabilityMessage(context));
  });
}

function deactivate() {}

module.exports = { activate: activate, deactivate: deactivate };

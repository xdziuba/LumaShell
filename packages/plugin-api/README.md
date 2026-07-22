# @lumashell/plugin-api

Typy Plugin API LumaShella (v2). Sama paczka nic nie robi w czasie działania — opisuje
kształt obiektu `context`, który wtyczka dostaje od aplikacji.

## Po co

Żeby dało się napisać wtyczkę **bez czytania kodu LumaShella**: podpowiadanie w edytorze,
opisy uprawnień przy metodach i jasne kody błędów.

## Użycie bez kroku budowania

Wtyczka może być zwykłym plikiem CommonJS — typy wchodzą przez JSDoc:

```js
/** @type {import('@lumashell/plugin-api').Activate} */
exports.activate = async (ctx) => {
  const info = await ctx.app.getInfo();
  ctx.log('start w', info.name, info.version);
};
```

## Użycie z TypeScriptem

```ts
import type { Activate, LumaContext } from '@lumashell/plugin-api';

export const activate: Activate = async (ctx: LumaContext) => { ... };
```

Wtyczkę zbunduj do jednego pliku CommonJS (esbuild, rollup — cokolwiek) i wskaż go
w `plugin.json` w polu `main`.

## Uprawnienia

Każda metoda wymagająca uprawnienia ma to napisane w komentarzu. Uprawnienie deklaruje się
w `plugin.json`; wywołanie bez niego kończy się odrzuconą obietnicą z `code: 'EPERM'`.

Uwaga, która musi paść: wtyczka `runtime: "node"` ma pełny dostęp do plików, sieci
i uruchamiania procesów — tego LumaShell NIE ogranicza i dlatego takich uprawnień nie ma
w katalogu. Bramka chroni zasoby APLIKACJI (terminal, zakładki, widoki, magazyn), a nie
system operacyjny. Szczegóły: decyzja D7 w `docs/architecture/10-decyzje.md`.

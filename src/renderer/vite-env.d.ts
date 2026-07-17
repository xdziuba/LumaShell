/**
 * Deklaracje importów zasobów obsługiwanych przez Vite.
 *
 * tsconfig.web ma `types: []` (celowo, bez typów Node), więc nie wciągamy `vite/client`.
 * Te deklaracje wystarczają, by importy obrazów miały typ `string` (URL zasobu po zbudowaniu).
 */

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

// The globe is WebGL-only and reads its data at runtime, so there is nothing
// meaningful to render on the server. This replaces the thirteen identical
// per-route +page.js files that each carried this one line.
export const ssr = false;

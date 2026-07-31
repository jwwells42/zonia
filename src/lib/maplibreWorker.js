/**
 * Entry point for MapLibre's map worker.
 *
 * A worker has its own global scope, so polyfills applied on the main thread do
 * not reach it. This module pulls them in first, then loads MapLibre's real
 * worker. ES module imports evaluate in order, so the polyfills are installed
 * before any MapLibre code runs.
 *
 * `MapGlobe.svelte` points `setWorkerUrl` at this file rather than at MapLibre's
 * own worker, and Vite bundles the pair into one self-contained script.
 */

import './polyfills.js';

import MapLibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs';

/**
 * That assignment is load-bearing. Do not remove it.
 *
 * `maplibre-gl` declares `"sideEffects": ["*.css", "src/**\/*.ts"]`, marking
 * everything in `dist` side-effect free. Rollup therefore drops a bare
 * `import` of the worker, and re-exporting it does not help either, because an
 * entry chunk has no consumer for its exports. Either way the bundle comes out
 * as a few hundred bytes of polyfill with no MapLibre in it, and the map spins
 * forever without an error.
 *
 * The declaration is wrong for this file. Its last statement is
 * `isWorker(self) && (self.worker = new Worker(self))`, which is the whole
 * point of the module. Writing the import to the worker's global is an
 * observable effect, so tree shaking has to keep it.
 *
 * The build asserts the worker chunk is large enough to contain MapLibre, so a
 * regression here fails the build rather than shipping.
 */
globalThis.__maplibreWorker = MapLibreWorker;

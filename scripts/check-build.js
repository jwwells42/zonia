#!/usr/bin/env node
/**
 * Post-build assertions for failures that are silent at runtime.
 *
 * The MapLibre worker is the reason this exists. If it is missing or broken the
 * map never fires 'load' and never fires 'error'. It just spins, and the build
 * reports success. That has now happened twice: once when Vite could not see
 * MapLibre's runtime-built worker path, and once when Rollup tree-shook the
 * worker away because the package marks `dist` as side-effect free.
 *
 * Runs from `npm run build`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = join(root, '.svelte-kit', 'output', 'client');

/** Smallest plausible size for a bundle that actually contains MapLibre. */
const MIN_WORKER_BYTES = 100_000;

const walk = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? walk(path) : [path];
	});

const failures = [];

const files = walk(clientDir);
const worker = files.find(
	(f) => /workers?\/.*maplibre.*\.js$/i.test(f) || /maplibreWorker.*\.js$/.test(f)
);

if (!worker) {
	failures.push('No MapLibre worker chunk was emitted. MapGlobe would spin forever.');
} else {
	const bytes = statSync(worker).size;
	const source = readFileSync(worker, 'utf8');

	if (bytes < MIN_WORKER_BYTES) {
		failures.push(
			`MapLibre worker chunk is only ${bytes} bytes, under the ${MIN_WORKER_BYTES} byte floor. ` +
				`It has almost certainly been tree-shaken away. See src/lib/maplibreWorker.js.`
		);
	}

	// The worker must install its handler on `self`; that statement is the module's
	// entire purpose.
	const init = source.indexOf('self.worker=');
	if (init < 0) {
		failures.push('MapLibre worker chunk never assigns `self.worker`, so it will do nothing.');
	}

	// Polyfills must be installed before any MapLibre code runs, since the worker
	// is a separate global scope from the page.
	const polyfill = source.indexOf('hasOwnProperty.call');
	if (polyfill < 0) {
		failures.push('MapLibre worker chunk is missing the polyfills from src/lib/polyfills.js.');
	} else if (init >= 0 && polyfill > init) {
		failures.push('Polyfills appear after MapLibre code in the worker chunk. Check import order.');
	}
}

if (failures.length) {
	console.error('\nBuild checks failed:\n');
	for (const f of failures) console.error(`  - ${f}`);
	console.error('');
	process.exit(1);
}

console.log('Build checks passed.');

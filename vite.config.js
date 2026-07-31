import { sveltekit } from '@sveltejs/kit/vite';
// From vitest/config, not vite — this config carries a `test` block, which the
// plain Vite type does not know about.
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	build: {
		/**
		 * Set explicitly so the syntax floor is a decision rather than whatever
		 * Vite defaults to this release. Zonia runs on Android smart panels and
		 * older Chromebooks, which lag current Chromium by years.
		 *
		 * esbuild downlevels syntax for bundled dependencies too, so this covers
		 * MapLibre's logical assignment operators as well as our own code. It
		 * cannot supply missing runtime methods; see `src/lib/polyfills.js`.
		 */
		target: ['chrome87', 'edge88', 'firefox78', 'safari14']
	},
	// MapLibre's worker is an ES module and is loaded with `{ type: 'module' }`,
	// so the bundled worker has to be one too.
	worker: { format: 'es' },
	test: {
		// The quiz logic and the geodata assertions are both plain Node work; the
		// globe itself needs a real browser and is checked by running the app.
		include: ['src/**/*.test.js'],
		environment: 'node'
	}
});

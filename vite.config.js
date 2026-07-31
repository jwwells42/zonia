import { sveltekit } from '@sveltejs/kit/vite';
// From vitest/config, not vite — this config carries a `test` block, which the
// plain Vite type does not know about.
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
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

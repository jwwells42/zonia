import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default [
	js.configs.recommended,
	...svelte.configs['flat/recommended'],
	{
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: 'module',
			globals: { ...globals.browser, ...globals.node }
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: { parserOptions: { parser: null } },
		rules: {
			// Every href is a literal path from src/lib/regions.js and the app is
			// deployed at the domain root, so there is no base path for resolve()
			// to prepend. Revisit if Zonia is ever hosted under a subpath.
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		ignores: [
			'.svelte-kit/',
			'build/',
			'node_modules/',
			'scripts/.cache/',
			'static/geo/',
			'.vercel/'
		]
	}
];

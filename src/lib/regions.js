/**
 * Every quiz in one place, keyed by URL path.
 *
 * This replaces 26 near-identical route files. `src/routes/[...region]/+page.svelte`
 * resolves the current path against this map, and `Header.svelte` builds the nav
 * from `NAV` below, so a new quiz means one entry here and nothing else.
 *
 * `dataset` names a file in static/geo/ built by `npm run geodata`; the roster of
 * regions inside each one is fixed by scripts/rosters.json.
 *
 * `pov` is the opening camera: [latitude, longitude, altitude].
 */

/** @typedef {{ label: string, dataset: string, pov: [number, number, number] }} Region */

/** @type {Record<string, Region>} */
export const REGIONS = {
	'/': { label: 'United States', dataset: 'us', pov: [34, -97, 1] },
	'/us': { label: 'United States', dataset: 'us', pov: [34, -97, 1] },
	'/us/northeast': { label: 'Northeast', dataset: 'us-ne', pov: [43, -74, 0.5] },
	'/us/south': { label: 'South', dataset: 'us-s', pov: [33, -91, 0.75] },
	// Was [43, -74] — the same point as the Northeast, which put the Midwest
	// quiz's opening view over New York.
	'/us/midwest': { label: 'Midwest', dataset: 'us-mw', pov: [43, -92, 0.7] },
	// Was [37, -95] (Kansas). The West reaches Alaska and Hawaii, so it needs to
	// sit further out and further west than the contiguous states suggest.
	'/us/west': { label: 'West', dataset: 'us-w', pov: [45, -125, 1.0] },
	'/africa': { label: 'Africa', dataset: 'africa', pov: [4, 21, 1.4] },
	'/europe': { label: 'Europe', dataset: 'eu', pov: [43, 15.2, 1.4] },
	'/asia': { label: 'Asia', dataset: 'asia', pov: [28, 84, 1.2] },
	'/middle-east': { label: 'Middle East', dataset: 'me', pov: [29, 47, 1.4] },
	'/north-america': { label: 'North America', dataset: 'na', pov: [39, -95, 1.4] },
	'/south-america': { label: 'South America', dataset: 'sa', pov: [-25, -55, 1.4] },
	// Built by the pipeline and playable, but deliberately absent from NAV — the
	// original site had the data without ever linking to it.
	'/oceania': { label: 'Oceania', dataset: 'oceania', pov: [-25, 140, 1.4] },
	'/world': { label: 'World', dataset: 'world', pov: [0, 0, 1.4] }
};

/** Header navigation. Top-level entries may carry a submenu of related quizzes. */
export const NAV = [
	{
		label: 'United States',
		href: '/',
		children: [
			{ label: 'Northeast', href: '/us/northeast' },
			{ label: 'South', href: '/us/south' },
			{ label: 'Midwest', href: '/us/midwest' },
			{ label: 'West', href: '/us/west' }
		]
	},
	{ label: 'Africa', href: '/africa' },
	{ label: 'Europe', href: '/europe' },
	{ label: 'Asia', href: '/asia' },
	{ label: 'Middle East', href: '/middle-east' },
	{ label: 'North America', href: '/north-america' },
	{ label: 'South America', href: '/south-america' },
	{ label: 'World', href: '/world' }
];

/** Resolves a URL pathname to a region, tolerating a trailing slash. */
export function regionFor(pathname) {
	const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
	return REGIONS[path] ?? null;
}

export const datasetUrl = (dataset) => `/geo/${dataset}.topo.json`;

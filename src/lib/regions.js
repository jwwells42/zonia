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
	// Was [43, -74], the same point as the Northeast. That put the Midwest
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

	// Continent subregions follow the UN's M49 scheme, names and membership:
	// https://unstats.un.org/unsd/methodology/m49/overview/
	// Four quiz regions are not in M49. Each goes where the country around or
	// beside it is: Somaliland with Somalia, Kosovo with Serbia, Taiwan with
	// China, Northern Cyprus with Cyprus. Natural Earth places them the same way.
	//
	// M49's Northern America is only Canada, the US and Greenland. Too few for a
	// quiz, so they stay in the North America quiz only.
	//
	// Each camera is on the subregion's mainland, not its overseas territories.
	// Eastern Europe frames the European part of Russia.
	'/africa/northern': { label: 'Northern Africa', dataset: 'af-n', pov: [23, 10, 1.05] },
	'/africa/western': { label: 'Western Africa', dataset: 'af-w', pov: [16, -1, 0.8] },
	'/africa/middle': { label: 'Middle Africa', dataset: 'af-m', pov: [2, 20, 1.2] },
	'/africa/eastern': { label: 'Eastern Africa', dataset: 'af-e', pov: [-4, 36, 1.25] },
	'/africa/southern': { label: 'Southern Africa', dataset: 'af-s', pov: [-26, 22, 0.65] },
	'/europe/northern': { label: 'Northern Europe', dataset: 'eu-n', pov: [60, 4, 0.75] },
	'/europe/western': { label: 'Western Europe', dataset: 'eu-w', pov: [48, 6, 0.5] },
	'/europe/southern': { label: 'Southern Europe', dataset: 'eu-s', pov: [42, 9, 0.65] },
	'/europe/eastern': { label: 'Eastern Europe', dataset: 'eu-e', pov: [50, 28, 0.65] },
	'/asia/western': { label: 'Western Asia', dataset: 'as-w', pov: [28, 43, 1.0] },
	'/asia/central': { label: 'Central Asia', dataset: 'as-c', pov: [45, 67, 0.7] },
	'/asia/southern': { label: 'Southern Asia', dataset: 'as-s', pov: [22, 71, 1.0] },
	'/asia/eastern': { label: 'Eastern Asia', dataset: 'as-e', pov: [36, 110, 1.15] },
	'/asia/south-eastern': { label: 'South-eastern Asia', dataset: 'as-se', pov: [9, 116, 1.15] },
	'/north-america/central': { label: 'Central America', dataset: 'na-c', pov: [20, -98, 0.85] },
	'/north-america/caribbean': { label: 'Caribbean', dataset: 'na-car', pov: [18, -73, 0.6] },

	'/south-america': { label: 'South America', dataset: 'sa', pov: [-25, -55, 1.4] },
	// Built by the pipeline and playable, but deliberately absent from NAV. The
	// original site had the data without ever linking to it.
	'/oceania': { label: 'Oceania', dataset: 'oceania', pov: [-25, 140, 1.4] },
	'/world': { label: 'World', dataset: 'world', pov: [0, 0, 1.4] }
};

/**
 * A nav entry for a quiz, named as its `REGIONS` entry names it. `parts` are
 * the paths of its submenu, if it has one.
 */
const link = (href, parts) => ({
	label: REGIONS[href].label,
	href,
	children: parts?.map((part) => link(part))
});

/**
 * Header navigation, as paths. Labels come from `REGIONS`, so a quiz is named
 * in one place.
 */
export const NAV = [
	link('/', ['/us/northeast', '/us/south', '/us/midwest', '/us/west']),
	link('/africa', [
		'/africa/northern',
		'/africa/western',
		'/africa/middle',
		'/africa/eastern',
		'/africa/southern'
	]),
	link('/europe', ['/europe/northern', '/europe/western', '/europe/southern', '/europe/eastern']),
	link('/asia', [
		'/asia/western',
		'/asia/central',
		'/asia/southern',
		'/asia/eastern',
		'/asia/south-eastern'
	]),
	link('/middle-east'),
	link('/north-america', ['/north-america/central', '/north-america/caribbean']),
	link('/south-america'),
	link('/world')
];

/** Resolves a URL pathname to a region, tolerating a trailing slash. */
export function regionFor(pathname) {
	const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
	return REGIONS[path] ?? null;
}

export const datasetUrl = (dataset) => `/geo/${dataset}.topo.json`;

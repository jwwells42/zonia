#!/usr/bin/env node
/**
 * Builds the quiz geometry in static/geo/ from upstream sources.
 *
 * Both sources are deliberately richer than the output needs: simplifying down
 * from dense geometry produces better shapes at a given vertex count than
 * shipping a coarse source as-is. Countries come from Natural Earth 1:50m
 * (replacing 1:110m, which was too coarse to look like anything at ~52 vertices
 * per European country); states come from Census cartographic boundaries at
 * 1:500k. Both are then cut to a budget, because 51k vertices of state outline
 * is detail no one can see on a sphere and every one costs tessellation time.
 *
 * Natural Earth draws a few places M49 lists on their own inside another
 * country: French Guiana inside France, Svalbard inside Norway. Its map-units
 * file has them separately, and `MAP_UNITS` says which to take from there.
 *
 * scripts/rosters.json is the contract: it names exactly which regions each
 * quiz contains and what each one is called. Sources may change; the roster
 * may not, except deliberately. A source that cannot supply a roster member
 * fails the build.
 *
 * Outputs are committed, so deploys never run this. Re-run with `npm run geodata`.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';
import { feature } from 'topojson-client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, 'scripts', '.cache');
const outDir = join(root, 'static', 'geo');

const NE_URL =
	'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const NE_FILE = join(cacheDir, 'ne_50m_admin_0_countries.geojson');

const NE_UNITS_URL =
	'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_map_units.geojson';
const NE_UNITS_FILE = join(cacheDir, 'ne_50m_admin_0_map_units.geojson');

/**
 * Roster codes drawn from Natural Earth's map units, and which units make each.
 *
 * The countries file draws French Guiana as part of France, so a tap on it
 * answered France. M49 lists it on its own, like the other places here. Each
 * parent is listed too, so it is drawn without the parts that now stand alone.
 * Otherwise France and French Guiana would both cover the same land.
 *
 * The map units share every point with the countries file, so borders still
 * line up. Nothing else comes from it: it also splits the UK into four and
 * Belgium into three, which no quiz asks about.
 */
const MAP_UNITS = {
	FRA: ['FXX'], // without its five overseas regions
	GUF: ['GUF'],
	GLP: ['GLP'],
	MTQ: ['MTQ'],
	MYT: ['MYT'],
	REU: ['REU'],
	NOR: ['NOR'], // without Svalbard and Jan Mayen
	SJM: ['NSV', 'NJM'],
	NLD: ['NLD'], // without the Caribbean Netherlands
	BES: ['NLY'],
	NZL: ['NZL'], // without Tokelau
	TKL: ['TKL'],
	// The countries file draws these two as one "Indian Ocean Territories".
	CXR: ['CXR'],
	CCK: ['CCK']
};

const US_URL = 'https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip';
const US_ZIP = join(cacheDir, 'cb_2023_us_state_500k.zip');
const US_FILE = join(cacheDir, 'us_states_500k.geojson');

/**
 * Target vertex count for the decoded geometry of each dataset. That is what the
 * land mesh tessellates. Budgets are tuned to the zoom each quiz is viewed at:
 * the world sits far enough out that ~20k reads as smooth, while a single US
 * region fills the screen and needs proportionally more per feature.
 */
const BUDGETS = {
	// Every vertex is tessellated once, at load. Nothing is paid per frame: the
	// land is one mesh whatever its size, and picking only tests the shapes near
	// the pointer.
	//
	// `world` was pinned at 11,500 when three-globe drew every region itself and
	// raycast them all on every pointer move. That cut Greece to 59 points and
	// three pieces, and it looked it. 22,000 is where Greece, Japan and Denmark
	// hold their shape at three times the opening zoom. About 7,500 of that is
	// the minimum outline of every island. Building the land went from 91 ms to
	// about 200 ms on a desktop CPU.
	world: 22000,
	africa: 8000,
	asia: 8000,
	eu: 7000,
	na: 6000,
	sa: 5000,
	me: 5000,
	oceania: 3500,
	us: 12000,
	'us-w': 7000,
	'us-s': 6000,
	'us-mw': 4500,
	'us-ne': 4000,

	// Continent subregions. A subregion is viewed closer than its continent, so
	// each country gets about 1.8 times the vertices it has in the continent
	// quiz, the same step up the US regions take. Never under 3,000: at that
	// zoom even a handful of countries fills the screen.
	//
	// Most of these ask for more than Natural Earth 1:50m holds for the area,
	// and so get the source at full detail. The limit is the source, not this.
	'af-n': 3000,
	'af-w': 4000,
	'af-m': 3000,
	'af-e': 4500,
	'af-s': 3000,
	'eu-n': 3500,
	'eu-w': 3000,
	'eu-s': 4000,
	'eu-e': 3500,
	'as-w': 5500,
	'as-c': 3000,
	'as-s': 3000,
	'as-e': 3000,
	'as-se': 3500,
	'na-c': 4000,
	'na-car': 4000
};

/**
 * Largest a dataset may be once compressed, which is how it travels. Vercel
 * sends it with brotli. gzip is measured here: it comes out about a fifth
 * larger, so the limit errs safe. The world quiz is the largest, at about 90 KB.
 */
const MAX_DATASET_BYTES = 150 * 1024;

const countVertices = (coords) =>
	typeof coords[0] === 'number' ? 1 : coords.reduce((sum, c) => sum + countVertices(c), 0);

const geojsonVertices = (fc) =>
	fc.features.reduce((sum, f) => sum + countVertices(f.geometry.coordinates), 0);

const rel = (p) => p.replace(root + '/', '');

async function download(url, dest, label) {
	if (existsSync(dest)) {
		console.log(`  cached  ${rel(dest)}`);
		return;
	}
	console.log(`  fetch   ${url}`);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${label} download failed: ${res.status} ${res.statusText}`);
	writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/** Census ships shapefiles; unpack the zip to GeoJSON once and cache that. */
async function fetchSources() {
	mkdirSync(cacheDir, { recursive: true });
	await download(NE_URL, NE_FILE, 'Natural Earth');
	await download(NE_UNITS_URL, NE_UNITS_FILE, 'Natural Earth map units');
	await download(US_URL, US_ZIP, 'Census state boundaries');
	if (!existsSync(US_FILE)) {
		await mapshaper.runCommands(`-i ${US_ZIP} -o ${US_FILE} format=geojson`);
	}
	console.log(`  ok      ${rel(US_FILE)}`);
}

/** Builds a FeatureCollection holding exactly the roster's members, named exactly as the roster names them. */
function collect(key, roster, sources) {
	const features = [];
	const unmatched = [];

	for (const [code, name] of Object.entries(roster.members)) {
		const matches =
			roster.source === 'us-states'
				? sources.us.filter((f) => f.properties.NAME === name)
				: MAP_UNITS[code]
					? sources.units.filter((f) => MAP_UNITS[code].includes(f.properties.GU_A3))
					: sources.ne.filter((f) => f.properties.ADM0_A3 === code);

		if (!matches.length) {
			unmatched.push(`${code} (${name})`);
			continue;
		}
		// `name` is the only property that survives; the quiz reads nothing else.
		// Natural Earth ships 169 fields per feature and they were ~90% of the old payload.
		for (const f of matches) {
			features.push({ type: 'Feature', properties: { name }, geometry: f.geometry });
		}
	}

	if (unmatched.length) {
		throw new Error(
			`${key}: source is missing ${unmatched.length} roster member(s): ${unmatched.join(', ')}\n` +
				`The roster is the contract. Fix the source join rather than editing the roster, ` +
				`unless the quiz content is meant to change.`
		);
	}
	return { type: 'FeatureCollection', features };
}

/**
 * Runs the mapshaper chain at a given simplification percentage.
 *
 * keep-shapes stops simplification deleting a shape outright, but it guards
 * whole features, not their parts. Run on a country, it kept the largest piece
 * and let the islands go: `world` kept 233 of its 1,462 pieces, and Greece lost
 * 37 of 40. So every piece is made its own feature first, and simplified as one.
 *
 * -dissolve then puts each region back together as one MultiPolygon. It also
 * repairs us-w, where Alaska, California, Hawaii, Oregon and Washington were
 * each stored as two separate features and the quiz silently deduped them.
 */
async function simplifyTo(fc, percentage) {
	const cmd = [
		'-i in.json',
		'-explode',
		`-simplify visvalingam weighted keep-shapes ${percentage}%`,
		// `fields=` is required. A bare `name` collides with mapshaper's own `name=` layer option.
		'-dissolve fields=name',
		'-clean',
		'-o out.json format=topojson precision=0.001'
	].join(' ');

	const out = await mapshaper.applyCommands(cmd, { 'in.json': JSON.stringify(fc) });
	const topo = JSON.parse(out['out.json']);
	const decoded = feature(topo, topo.objects[Object.keys(topo.objects)[0]]);
	return { topo, decoded, vertices: geojsonVertices(decoded) };
}

/** Bisects the simplification percentage until decoded vertex count lands near the budget. */
async function buildDataset(key, fc, budget) {
	const input = geojsonVertices(fc);

	// mapshaper's percentage is roughly "fraction of vertices retained", so the
	// ratio is a good opening guess; bisection cleans up the nonlinearity.
	let lo = 0;
	let hi = 100;
	let guess = Math.min(100, Math.max(0.5, (budget / input) * 100));
	let best = null;

	for (let i = 0; i < 8; i++) {
		const result = await simplifyTo(fc, guess);
		if (!best || Math.abs(result.vertices - budget) < Math.abs(best.vertices - budget)) {
			best = { ...result, percentage: guess };
		}
		if (Math.abs(result.vertices - budget) / budget < 0.05) break;
		if (result.vertices > budget) hi = guess;
		else lo = guess;
		guess = (lo + hi) / 2;
	}

	// keep-shapes sets a floor: every island keeps its minimum ring regardless
	// of budget, so a dataset full of small islands can overshoot. That is the
	// correct trade. Dropping them would remove land, and sometimes answers.
	const names = new Set(best.decoded.features.map((f) => f.properties.name));
	const expected = Object.keys(fc.features.reduce((m, f) => ((m[f.properties.name] = 1), m), {}));
	const lost = expected.filter((n) => !names.has(n));
	if (lost.length) throw new Error(`${key}: simplification dropped ${lost.join(', ')}`);

	const json = JSON.stringify(best.topo);
	writeFileSync(join(outDir, `${key}.topo.json`), json);

	return {
		key,
		features: best.decoded.features.length,
		input,
		vertices: best.vertices,
		percentage: best.percentage,
		bytes: gzipSync(json).length
	};
}

async function main() {
	console.log('sources');
	await fetchSources();

	const rosters = JSON.parse(readFileSync(join(root, 'scripts', 'rosters.json'), 'utf8'));
	const ne = JSON.parse(readFileSync(NE_FILE, 'utf8')).features;
	const units = JSON.parse(readFileSync(NE_UNITS_FILE, 'utf8')).features;
	const us = JSON.parse(readFileSync(US_FILE, 'utf8')).features;

	mkdirSync(outDir, { recursive: true });

	console.log('\ndatasets');
	const rows = [];
	for (const [key, roster] of Object.entries(rosters)) {
		const budget = BUDGETS[key];
		if (!budget) throw new Error(`No vertex budget defined for "${key}"`);
		const fc = collect(key, roster, { ne, units, us });
		rows.push(await buildDataset(key, fc, budget));
	}

	const pad = (v, n) => String(v).padEnd(n);
	console.log(
		`\n  ${pad('dataset', 10)}${pad('features', 10)}${pad('src verts', 11)}${pad('verts', 8)}${pad('simplify', 10)}gzipped`
	);
	for (const r of rows) {
		console.log(
			`  ${pad(r.key, 10)}${pad(r.features, 10)}${pad(r.input, 11)}${pad(r.vertices, 8)}` +
				`${pad(r.percentage.toFixed(1) + '%', 10)}${(r.bytes / 1024).toFixed(0)} KB`
		);
	}

	const total = rows.reduce((s, r) => s + r.bytes, 0);
	console.log(`\n  total ${(total / 1024).toFixed(0)} KB across ${rows.length} datasets`);
	// A player downloads one dataset, the quiz they opened, so the limit is per
	// file. It used to be 1 MB across all of them, which only counted how many
	// quizzes there were.
	const heavy = rows.filter((r) => r.bytes > MAX_DATASET_BYTES);
	if (heavy.length) {
		const list = heavy.map((r) => `${r.key} ${(r.bytes / 1024).toFixed(0)} KB`).join(', ');
		throw new Error(`Over the ${MAX_DATASET_BYTES / 1024} KB per-dataset budget: ${list}`);
	}
}

main().catch((err) => {
	console.error(`\n${err.message}`);
	process.exit(1);
});

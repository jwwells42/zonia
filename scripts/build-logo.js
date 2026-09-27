#!/usr/bin/env node
/**
 * Draws Zonia's mark: the Earth, seen from space, from the same Natural Earth
 * data the quizzes are built from.
 *
 * Natural Earth is public domain, so the mark needs no licence and no credit.
 * It replaced a school's trademarked logo, which Zonia had outgrown.
 *
 * Colours are read from the custom properties in src/routes/styles.css, so the
 * mark follows the page if those change.
 *
 * Outputs are committed, so deploys never run this. Re-run with `npm run logo`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { geoArea, geoOrthographic, geoPath } from 'd3-geo';
import mapshaper from 'mapshaper';
import { merge } from 'topojson-client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(root, 'static');

/** The point the globe faces, as [longitude, latitude]. The Americas and the Atlantic. */
const CENTRE = [-60, 15];

/**
 * At 16 pixels, one pixel of the mark is about 900 km of Earth. Finer coastline
 * is noise there and small islands are specks. The same file is also drawn at
 * 180 pixels, where a coarser outline looked cut from card. These values keep
 * the SVG under 4 KB and read at both ends.
 */
const SIMPLIFY = '10%';
const MIN_ISLAND_KM2 = 50000;

/** Drawing units. The SVG scales, so only the proportions matter. */
const SIZE = 64;
const RIM = 3;

/** How much of the square the globe fills on a home screen, which rounds the corners. */
const TOUCH_ICON_SCALE = 0.8;

function cssColour(css, name) {
	const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
	if (!match) throw new Error(`--${name} not found in styles.css`);
	return match[1];
}

async function landOutline() {
	const topology = JSON.parse(readFileSync(join(staticDir, 'geo', 'world.topo.json'), 'utf8'));
	const land = merge(topology, topology.objects.in.geometries);
	const input = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: land }] };
	const out = await mapshaper.applyCommands(
		`-i land.json -simplify ${SIMPLIFY} keep-shapes ` +
			`-filter-islands min-area=${MIN_ISLAND_KM2}km2 remove-empty ` +
			'-o land.json format=geojson geojson-type=FeatureCollection',
		{ 'land.json': JSON.stringify(input) }
	);
	const simplified = JSON.parse(out['land.json']);
	simplified.features.forEach((f) => windForD3(f.geometry));
	return simplified;
}

/**
 * d3-geo decides which side of a ring is inside from the ring's direction.
 * mapshaper writes the opposite direction, which d3 reads as "everything but
 * the land" and fills the whole disc. No continent is bigger than a
 * hemisphere, so any polygon d3 measures as bigger is inside out.
 */
function windForD3(geometry) {
	const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
	for (const rings of polygons) {
		if (geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI) {
			for (const ring of rings) ring.reverse();
		}
	}
}

function markSvg({ land, colours, square }) {
	const radius = SIZE / 2 - RIM;
	const projection = geoOrthographic()
		.rotate([-CENTRE[0], -CENTRE[1]])
		.clipAngle(90)
		.scale(radius)
		.translate([SIZE / 2, SIZE / 2]);
	const d = geoPath(projection).digits(1)(land);

	// The rim sits just outside the land, so a coast at the horizon is never
	// drawn over.
	const globe =
		`<circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${radius + RIM / 2}" ` +
		`fill="${colours.night}" stroke="${colours.accent}" stroke-width="${RIM}"/>` +
		`<path fill="${colours.ink}" d="${d}"/>`;

	const body = square
		? `<rect width="${SIZE}" height="${SIZE}" fill="${colours.night}"/>` +
			`<g transform="translate(${SIZE / 2} ${SIZE / 2}) scale(${TOUCH_ICON_SCALE}) ` +
			`translate(${-SIZE / 2} ${-SIZE / 2})">${globe}</g>`
		: globe;

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">${body}</svg>\n`;
}

function writePng(svg, size, file) {
	// The mark has no text. Left on, the font scan can take minutes or hang.
	const options = { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } };
	const png = new Resvg(svg, options).render().asPng();
	writeFileSync(join(staticDir, file), png);
}

const css = readFileSync(join(root, 'src', 'routes', 'styles.css'), 'utf8');
const colours = {
	night: cssColour(css, 'night'),
	ink: cssColour(css, 'ink'),
	accent: cssColour(css, 'accent')
};
const land = await landOutline();

const mark = markSvg({ land, colours, square: false });
writeFileSync(join(staticDir, 'favicon.svg'), mark);
writePng(mark, 32, 'favicon-32.png');

// iOS ignores SVG here and fills any transparency with black.
writePng(markSvg({ land, colours, square: true }), 180, 'apple-touch-icon.png');

console.log(`favicon.svg ${Buffer.byteLength(mark)} bytes`);

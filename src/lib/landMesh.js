/**
 * The land and its borders as two geometries, instead of two meshes per region.
 *
 * three-globe's polygon layer builds a cap mesh and an outline for every part of
 * every region. On `/world` that is 720 draw calls a frame, and on a weak CPU
 * frame rate follows that number, not the pixel count. See CLAUDE.md.
 *
 * So every cap goes into one geometry, coloured per vertex, and every border
 * into one set of line segments. A region changes colour by rewriting its own
 * slice of the colour attribute. Borders come from the TopoJSON arcs, so a
 * border between two countries is drawn once instead of once per neighbour.
 *
 * The cap for each part is still built by `ConicPolygonGeometry`, with the
 * arguments three-globe gave it, so the land looks the same. `capResolution`
 * still decides which regions get an exact cap. What changes is only how many
 * times the GPU is asked to draw.
 *
 * No DOM here, so it can be tested without a browser. The renderer owns the
 * meshes and materials.
 */

import { BufferAttribute } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import ConicPolygonGeometry from 'three-conic-polygon-geometry';
import GeoJsonGeometry from 'three-geojson-geometry';
import { polygonParts } from './geo.js';

/**
 * Every region's cap, merged into one geometry with a `color` attribute.
 *
 * @param {{ properties: { name: string }, geometry: any }[]} features
 * @param {object} options
 * @param {number} options.radius Where the caps sit, from the globe's centre.
 * @param {(feature: any) => number} options.resolutionFor Curvature resolution per
 *   region. See `capResolution`.
 * @returns {{ geometry: import('three').BufferGeometry,
 *   ranges: Map<string, { start: number, count: number }> }}
 *   `ranges` is each region's run of vertices, for recolouring it.
 */
export function landGeometry(features, { radius, resolutionFor }) {
	const parts = [];
	const ranges = new Map();
	let vertices = 0;

	for (const feature of features) {
		const resolution = resolutionFor(feature);
		const start = vertices;
		for (const rings of polygonParts(feature.geometry)) {
			// The same arguments three-globe used: no bottom, a closed top, no sides.
			const part = new ConicPolygonGeometry(rings, 0, radius, false, true, false, resolution);
			// A flat colour needs neither. Dropping them makes the merge smaller.
			part.deleteAttribute('uv');
			part.deleteAttribute('normal');
			parts.push(part);
			vertices += part.getAttribute('position').count;
		}
		ranges.set(feature.properties.name, { start, count: vertices - start });
	}

	const geometry = mergeGeometries(parts);
	for (const part of parts) part.dispose();
	if (!geometry) throw new Error('Could not merge the region geometry');

	geometry.setAttribute('color', new BufferAttribute(new Float32Array(vertices * 3), 3));
	return { geometry, ranges };
}

/**
 * Paints one region a colour, and marks only its slice for upload.
 *
 * @param {import('three').BufferGeometry} geometry From `landGeometry`.
 * @param {{ start: number, count: number }} range
 * @param {{ r: number, g: number, b: number }} color Linear, as three.js holds it.
 */
export function paintRange(geometry, { start, count }, { r, g, b }) {
	const colors = /** @type {import('three').BufferAttribute} */ (geometry.getAttribute('color'));
	const array = /** @type {Float32Array} */ (colors.array);
	for (let i = start * 3, end = (start + count) * 3; i < end; i += 3) {
		array[i] = r;
		array[i + 1] = g;
		array[i + 2] = b;
	}
	colors.addUpdateRange(start * 3, count * 3);
	colors.needsUpdate = true;
}

/**
 * Every border once, as line segments.
 *
 * @param {any} borders A MultiLineString from topojson-client's `mesh`, which
 *   returns each shared arc a single time.
 * @param {object} options
 * @param {number} options.radius
 * @param {number} options.resolution Longest segment in degrees before it is
 *   bent to follow the globe. The same as the caps' curvature resolution.
 */
export function borderGeometry(borders, { radius, resolution }) {
	return new GeoJsonGeometry(borders, radius, resolution);
}

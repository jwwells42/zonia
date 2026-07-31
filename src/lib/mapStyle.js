/**
 * The MapLibre style for a quiz globe.
 *
 * Kept out of the component because a style spec is data, not behaviour, and
 * reads far better as one declarative object than as a sequence of addLayer
 * calls interleaved with game logic.
 *
 * There is deliberately no raster basemap. Under globe projection a basemap has
 * to be a Web Mercator tile pyramid, and the night-earth artwork is a single
 * equirectangular image — reprojecting it needs tooling this project does not
 * carry. Instead the world outline is drawn as a dark silhouette under the quiz
 * layer, which keeps surrounding continents legible, and the starfield stays a
 * CSS layer behind a canvas whose sky is transparent.
 */

export const COLORS = {
	ocean: '#0b1c30',
	land: '#16273b',
	landLine: '#22384f',
	region: '#4682b4',
	regionHover: '#f58622',
	regionCorrect: '#3fb950',
	regionWrong: '#d9534f',
	regionLearned: '#2f5f86',
	regionLine: '#0d1a26'
};

/** Layer id the quiz queries and styles. Exported so the component never guesses it. */
export const REGION_FILL_LAYER = 'regions-fill';

/**
 * @param {any} regions GeoJSON FeatureCollection for the quiz.
 * @param {any} land GeoJSON FeatureCollection drawn beneath it for context.
 * @returns {import('maplibre-gl').StyleSpecification}
 */
export function buildStyle(regions, land) {
	return {
		// Annotated as the literal 8 because the spec's version field is that exact
		// value, and a plain object literal widens it to `number`.
		version: /** @type {8} */ (8),
		// Pinned rather than 'globe'. MapLibre's 'globe' interpolates to mercator
		// at zoom 12, and a quiz that silently unrolls into a flat map when a
		// player pinch-zooms is not what anyone wants.
		projection: { type: 'vertical-perspective' },
		sources: {
			// promoteId lets feature-state be keyed by region name, so the quiz never
			// has to maintain a name-to-id mapping.
			regions: { type: 'geojson', data: regions, promoteId: 'name' },
			land: { type: 'geojson', data: land }
		},
		// No text layers, so no glyph endpoint is needed. Region names come from
		// the HUD and the hover readout.
		layers: [
			{ id: 'ocean', type: 'background', paint: { 'background-color': COLORS.ocean } },
			{ id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': COLORS.land } },
			{
				id: 'land-line',
				type: 'line',
				source: 'land',
				paint: { 'line-color': COLORS.landLine, 'line-width': 0.5 }
			},
			{
				id: REGION_FILL_LAYER,
				type: 'fill',
				source: 'regions',
				paint: {
					// Answering a question is a feature-state write; this expression is
					// what turns that into a colour, so nothing has to touch geometry.
					// Written inline rather than hoisted so it is checked against the
					// style spec's own types.
					'fill-color': [
						'case',
						['boolean', ['feature-state', 'wrong'], false],
						COLORS.regionWrong,
						['boolean', ['feature-state', 'correct'], false],
						COLORS.regionCorrect,
						['boolean', ['feature-state', 'hover'], false],
						COLORS.regionHover,
						['boolean', ['feature-state', 'learned'], false],
						COLORS.regionLearned,
						COLORS.region
					]
				}
			},
			{
				id: 'regions-line',
				type: 'line',
				source: 'regions',
				paint: { 'line-color': COLORS.regionLine, 'line-width': 0.8 }
			}
		],
		sky: {
			'sky-color': COLORS.ocean,
			'horizon-color': '#2a4a6b',
			'fog-color': COLORS.ocean,
			// Leaves space around the globe unpainted so the CSS starfield shows.
			'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 6, 0]
		}
	};
}

/** Shortest signed distance from `a` to `b` in degrees of longitude. */
const lngDelta = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

/** Rough centre of a feature, as the midpoint of its extent relative to `origin`. */
function featureCentre(geometry, origin) {
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	const walk = (c) => {
		if (typeof c[0] === 'number') {
			// Measured as an offset from origin so features spanning the
			// antimeridian do not wrap into nonsense.
			const x = lngDelta(origin, c[0]);
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minY = Math.min(minY, c[1]);
			maxY = Math.max(maxY, c[1]);
			return;
		}
		c.forEach(walk);
	};
	walk(geometry.coordinates);
	return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, minX, maxX, minY, maxY };
}

/**
 * Bounding box to open on, as [[west, south], [east, north]].
 *
 * Two things make a naive min/max wrong here.
 *
 * The obvious one is the antimeridian: the US dataset reaches from the Aleutians
 * to Maine, so raw longitudes span the planet and put the "centre" of the United
 * States somewhere near Africa. Everything is therefore measured as an offset
 * from `origin`, the authored centre for the quiz.
 *
 * The subtler one is outliers. Alaska and Hawaii stretch the extent to 120° of
 * longitude, and fitting that on a portrait phone is width-constrained — it
 * leaves the contiguous states about a hundred pixels across, with the smaller
 * ones too small to hit. So the box covers the bulk of the regions and lets
 * distant ones sit off-frame, reachable by dragging. A quiz whose regions are
 * genuinely spread out, like the world, keeps them all: the trim only applies
 * while a clear majority of regions remain.
 *
 * @param {any} collection GeoJSON FeatureCollection.
 * @param {number} origin Authored centre longitude for the quiz.
 * @param {number} [keepFraction] Share of regions the box must cover.
 * @returns {[[number, number], [number, number]]}
 */
export function boundsOf(collection, origin, keepFraction = 0.9) {
	const centres = collection.features.map((f) => featureCentre(f.geometry, origin));

	// Keep the regions nearest the authored centre, by distance from it.
	const byDistance = [...centres].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
	const keep = Math.max(1, Math.ceil(byDistance.length * keepFraction));
	const cutoff = Math.hypot(byDistance[keep - 1].x, byDistance[keep - 1].y);
	const framed = centres.filter((c) => Math.hypot(c.x, c.y) <= cutoff);

	let west = Infinity;
	let east = -Infinity;
	let south = Infinity;
	let north = -Infinity;
	for (const c of framed) {
		west = Math.min(west, c.minX);
		east = Math.max(east, c.maxX);
		south = Math.min(south, c.minY);
		north = Math.max(north, c.maxY);
	}

	return [
		[origin + west, south],
		[origin + east, north]
	];
}

/**
 * Planar geometry on longitude/latitude pairs.
 *
 * Degrees are treated as a flat plane throughout. That is wrong as geography and
 * right for what these are used for: asking whether a point is inside a shape,
 * how far it is from an edge, and how wide a shape is. All stay correct enough
 * under the distortion.
 *
 * Pure and DOM-free, so `pick.js`, `Globe.svelte` and the tests can all share one
 * copy.
 */

/**
 * Each part of a Polygon or MultiPolygon, as `[outerRing, ...holes]`.
 * Holes are kept so nothing is placed in one or picked out of one.
 */
export function polygonParts(geometry) {
	if (geometry.type === 'Polygon') return [geometry.coordinates];
	if (geometry.type === 'MultiPolygon') return geometry.coordinates;
	return [];
}

/** Bounding box of a ring. */
export function ringBounds(ring) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const [x, y] of ring) {
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	}
	return { minX, minY, maxX, maxY };
}

/** Ray casting against a single ring. */
export function pointInRing(px, py, ring) {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

/** True when a point is inside `[outerRing, ...holes]` and in none of the holes. */
export function pointInRings(px, py, [outer, ...holes]) {
	return pointInRing(px, py, outer) && !holes.some((hole) => pointInRing(px, py, hole));
}

/** Squared distance from a point to a line segment. */
export function segmentDistSq(px, py, ax, ay, bx, by) {
	let x = ax;
	let y = ay;
	const dx = bx - ax;
	const dy = by - ay;
	if (dx !== 0 || dy !== 0) {
		const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
		if (t > 1) {
			x = bx;
			y = by;
		} else if (t > 0) {
			x += dx * t;
			y += dy * t;
		}
	}
	return (px - x) ** 2 + (py - y) ** 2;
}

/**
 * Distance from a point to the polygon's edge, negative when outside.
 * Rings after the first are holes, so being inside one counts as outside.
 */
export function signedDistance(px, py, rings) {
	let inside = false;
	let minSq = Infinity;

	for (const ring of rings) {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [xi, yi] = ring[i];
			const [xj, yj] = ring[j];
			if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
			minSq = Math.min(minSq, segmentDistSq(px, py, xi, yi, xj, yj));
		}
	}
	return (inside ? 1 : -1) * Math.sqrt(minSq);
}

/**
 * Resolution that leaves a cap with no interior grid points, so
 * three-conic-polygon-geometry triangulates it with earcut alone.
 */
export const EXACT_CAP = 1000;

/**
 * Widest a region may be, in degrees of arc, and still get the exact cap.
 *
 * A cap with no subdivision is flat, and a flat chord across an angle a sags
 * below the sphere by R(1 - cos(a/2)). Regions are drawn one unit above the
 * globe, so the sag has to stay under that or the land sinks into the planet.
 * Solving for nine tenths of a unit gives 15.4 degrees, rounded down.
 */
const EXACT_CAP_MAX_SPAN = 15;

/** Greatest angular extent of a geometry, in degrees of arc. */
export function angularSpan(geometry) {
	let widest = 0;
	for (const rings of polygonParts(geometry)) {
		if (!(rings[0]?.length > 2)) continue;
		const { minX, minY, maxX, maxY } = ringBounds(rings[0]);
		// Longitude degrees shrink towards the poles, so convert before comparing.
		const middle = ((minY + maxY) / 2) * (Math.PI / 180);
		widest = Math.max(widest, (maxX - minX) * Math.cos(middle), maxY - minY);
	}
	return widest;
}

/**
 * How finely three-globe should subdivide a region's cap.
 *
 * **Small regions are triangulated exactly, and that is a correctness fix, not
 * a tuning knob.** three-conic-polygon-geometry has two paths. Given no
 * interior grid points it runs earcut over the outline, which is exact. Given
 * them it runs Delaunay over the outline plus the grid, then discards any
 * triangle touching the outline whose *centroid* falls outside the polygon.
 * That last test is a guess, and on a narrow shape it guesses wrong and leaves
 * land with nothing drawn on it.
 *
 * That is what put holes through the Caprivi Strip and northern Botswana.
 * Sampling inside every polygon of the shipped world geometry and asking
 * whether any triangle covers the point, 23 of 177 regions had uncovered land.
 * Tuning the resolution does not help, because the guess converges on nothing:
 * Namibia missed 133 samples at 9, 7 and 5 degrees, 196 at 3, none at 2, 3 at
 * 1. Taking the exact path wherever it is safe brings 23 down to 14, and costs
 * nothing: 11,161 triangles against 11,381.
 *
 * What is left is the handful of regions too wide to lie flat, which still need
 * the guess. The answer for those is to build the cap ourselves, which is the
 * merge described under Performance constraints in CLAUDE.md.
 *
 * `subdivided` is the resolution to use when the region is too wide for the
 * exact path, in angular degrees.
 */
export function capResolution(geometry, subdivided) {
	return angularSpan(geometry) <= EXACT_CAP_MAX_SPAN ? EXACT_CAP : subdivided;
}

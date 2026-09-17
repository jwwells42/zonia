/**
 * Planar geometry on longitude/latitude pairs.
 *
 * Degrees are treated as a flat plane throughout. That is wrong as geography and
 * right for what these are used for: ranking one region against another, and
 * asking whether a point is inside a shape. Both stay correct under the
 * distortion.
 *
 * Pure and DOM-free, so `labels.js`, `pick.js` and the tests can all share one
 * copy. Before this existed there were three.
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

/**
 * Signed area of a ring, in square degrees.
 *
 * Only ever compared against other rings. It picks the biggest piece of an
 * archipelago and ranks small countries below large ones, which is all it is for.
 */
export function ringArea(ring) {
	let sum = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
	}
	return Math.abs(sum / 2);
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

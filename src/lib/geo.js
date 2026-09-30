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

/** Area of a ring in square degrees. Only ever compared, so the distortion does not matter. */
export function ringArea(ring) {
	let sum = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
	}
	return Math.abs(sum / 2);
}

/**
 * The point inside a polygon furthest from any edge, its pole of inaccessibility.
 *
 * Averaging a ring's vertices is not good enough. For anything crescent shaped
 * the average lands outside the shape entirely: it puts Norway in Sweden,
 * Croatia in Bosnia and Florida in the Gulf. When this was written for the
 * standing names, a plain centroid missed its own region 26 times out of 467.
 *
 * This is the standard cartographic answer, by quadtree subdivision. Start with
 * a grid of square cells covering the shape. Each cell knows the distance from
 * its centre to the edge, so `distance + halfDiagonal` bounds how good any point
 * inside it could possibly be. Repeatedly take the most promising cell and split
 * it in four, discarding any cell whose bound cannot beat the best point found
 * so far.
 *
 * @param {number[][][]} rings `[outerRing, ...holes]`.
 * @returns {{ lat: number, lng: number }}
 */
function poleOfInaccessibility(rings) {
	const { minX, minY, maxX, maxY } = ringBounds(rings[0]);
	const width = maxX - minX;
	const height = maxY - minY;
	const cellSize = Math.min(width, height);
	// A zero-width sliver has no interior worth searching.
	if (cellSize === 0) return { lng: minX, lat: minY };

	// Relative to the shape, so a small country is not searched to the same
	// absolute precision as Russia.
	const precision = cellSize / 40;

	const makeCell = (x, y, h) => {
		const d = signedDistance(x, y, rings);
		return { x, y, h, d, max: d + h * Math.SQRT2 };
	};

	/** Cells still worth exploring. Small enough that a linear scan beats a heap. */
	const queue = [];
	let h = cellSize / 2;
	for (let x = minX; x < maxX; x += cellSize) {
		for (let y = minY; y < maxY; y += cellSize) queue.push(makeCell(x + h, y + h, h));
	}

	let best = makeCell(minX + width / 2, minY + height / 2, 0);

	while (queue.length) {
		let bestIndex = 0;
		for (let i = 1; i < queue.length; i++) {
			if (queue[i].max > queue[bestIndex].max) bestIndex = i;
		}
		const cell = queue.splice(bestIndex, 1)[0];

		if (cell.d > best.d) best = cell;
		// Nothing in this cell, or any cell behind it, can beat what we have.
		if (cell.max - best.d <= precision) continue;

		h = cell.h / 2;
		queue.push(
			makeCell(cell.x - h, cell.y - h, h),
			makeCell(cell.x + h, cell.y - h, h),
			makeCell(cell.x - h, cell.y + h, h),
			makeCell(cell.x + h, cell.y + h, h)
		);
	}

	return { lng: best.x, lat: best.y };
}

/**
 * One point to show a region by: inside its largest piece, as far from the
 * edges as it gets. The hint turns the globe to it and rings it.
 *
 * The largest piece, so a country with distant islands is shown on its
 * mainland and not out in open water.
 */
export function interiorPoint(geometry) {
	const usable = polygonParts(geometry).filter((rings) => rings[0]?.length > 2);
	if (!usable.length) return null;
	let largest = usable[0];
	for (const rings of usable) {
		if (ringArea(rings[0]) > ringArea(largest[0])) largest = rings;
	}
	return poleOfInaccessibility(largest);
}

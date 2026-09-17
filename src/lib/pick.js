/**
 * Which region a point on the globe falls in.
 *
 * Pure and DOM-free like `quiz.js` and `labels.js`, so it can be tested against
 * the geometry that actually ships and either renderer can drive it.
 *
 * **Why the renderer does not answer this.** three-render-objects resolves a
 * click by handing back whatever its hover raycaster last landed on, and that
 * raycaster is throttled to 50ms and skipped entirely while the pointer is
 * dragging. On a mouse that is invisible. On a touch panel it is the game: there
 * is no hover before a tap, a finger always slides a pixel or two so the tap is
 * classed as a drag, and the answer that comes back is stale or nothing at all.
 * Asking the geometry directly has no such state to get wrong.
 */

import { polygonParts, pointInRings, ringBounds, signedDistance } from './geo.js';

/**
 * Prepares features for repeated lookups.
 *
 * Each part carries its own bounding box, so a lookup only does real work on the
 * handful of shapes that could possibly contain the point. Built once when the
 * dataset loads.
 *
 * @param {{ properties: { name: string }, geometry: any }[]} features
 */
export function regionIndex(features) {
	const parts = [];
	for (const feature of features) {
		for (const rings of polygonParts(feature.geometry)) {
			if (!(rings[0]?.length > 2)) continue;
			parts.push({ name: feature.properties.name, rings, bounds: ringBounds(rings[0]) });
		}
	}
	return parts;
}

const within = ({ minX, minY, maxX, maxY }, x, y, slack) =>
	x >= minX - slack && x <= maxX + slack && y >= minY - slack && y <= maxY + slack;

/**
 * The region at a point, or null.
 *
 * `tolerance` is a margin in degrees, applied only when the point is inside no
 * region at all. A finger is wide and a small country can be a few pixels
 * across, so a tap that lands just off Luxembourg should still count as
 * Luxembourg. A tap in open ocean should still count as nothing, which is why
 * the margin is small and why it never overrides a direct hit.
 *
 * @param {ReturnType<typeof regionIndex>} index
 * @param {number} lat
 * @param {number} lng
 * @param {number} [tolerance] Degrees of slack, used only on a miss.
 */
export function regionAt(index, lat, lng, tolerance = 0) {
	for (const part of index) {
		if (!within(part.bounds, lng, lat, 0)) continue;
		if (pointInRings(lng, lat, part.rings)) return part.name;
	}

	if (tolerance <= 0) return null;

	let nearest = null;
	let shortest = tolerance;
	for (const part of index) {
		if (!within(part.bounds, lng, lat, tolerance)) continue;
		// Outside every region by now, so this is negative and the least negative
		// value wins.
		const distance = -signedDistance(lng, lat, part.rings);
		if (distance < shortest) {
			shortest = distance;
			nearest = part.name;
		}
	}
	return nearest;
}

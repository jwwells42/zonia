/**
 * Where to draw region names, with no dependency on the globe or the DOM.
 *
 * Kept pure for the same reason as `quiz.js`: it can be tested, and either
 * renderer can drive it by passing in its own projection.
 *
 * Names are drawn on the map rather than shown on hover. Hover does not exist on
 * a touchscreen, and Zonia is used on classroom panels, so a hover tooltip means
 * the naming aid is simply missing on the hardware that matters most. Standing
 * labels behave the same under a finger and a mouse.
 */

import { polygonParts, ringArea, signedDistance } from './geo.js';

/**
 * Fallback box size for a label, used when no measurer is supplied.
 *
 * Only the tests run without one. In the browser the renderer measures the real
 * text, because guessing at a proportional font is guessing twice: too narrow
 * and labels overlap on screen having passed the collision test, too wide and
 * names get dropped that would have fitted.
 */
const CHAR_WIDTH = 0.6;
const LINE_HEIGHT = 1.6;

const estimateBox = (name, fontSize) => ({
	width: name.length * fontSize * CHAR_WIDTH,
	height: fontSize * LINE_HEIGHT
});

/**
 * The point inside a polygon furthest from any edge, its pole of inaccessibility.
 *
 * Averaging a ring's vertices is not good enough. For anything crescent shaped
 * the average lands outside the shape entirely: it puts Norway's name in Sweden,
 * Croatia's in Bosnia and Florida's in the Gulf. Measured across every dataset,
 * a plain centroid missed its own region 26 times out of 467, and it missed on
 * exactly the countries whose outline a student finds hardest.
 *
 * This is the standard cartographic answer, by quadtree subdivision. Start with
 * a grid of square cells covering the shape. Each cell knows the distance from
 * its centre to the edge, so `distance + halfDiagonal` bounds how good any point
 * inside it could possibly be. Repeatedly take the most promising cell and split
 * it in four, discarding any cell whose bound cannot beat the best point found
 * so far. The bound is what keeps this cheap enough to run on load.
 *
 * @param {number[][][]} rings `[outerRing, ...holes]`.
 */
function poleOfInaccessibility(rings) {
	const outer = rings[0];
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const [x, y] of outer) {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}

	const width = maxX - minX;
	const height = maxY - minY;
	const cellSize = Math.min(width, height);
	// A zero-width sliver has no interior worth searching.
	if (cellSize === 0) return { lng: minX, lat: minY };

	/**
	 * Stop refining once further splits could not move the label perceptibly.
	 *
	 * Relative to the shape, so a small country is not searched to the same
	 * absolute precision as Russia. Every dataset places all 467 anchors inside
	 * their region anywhere from a tenth of this to ten times it, so this sits in
	 * the middle: loose enough to keep the load cost down, tight enough to leave
	 * room if a future roster brings in a more awkward outline.
	 */
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
 * A label anchor per feature, computed once when the data loads.
 *
 * The anchor goes on the feature's *largest* piece, so a country with distant
 * islands is named on its mainland rather than out in open water, and it goes at
 * that piece's pole of inaccessibility rather than its centroid, so the name
 * lands inside the shape even when the shape is a crescent.
 *
 * `area` is the total across every piece, because it decides who wins a
 * collision and that should reflect the whole country. `width` is estimated from
 * the name rather than measured, since measuring real text for 177 features
 * would cost more than the accuracy is worth.
 *
 * @param {{ properties: { name: string }, geometry: any }[]} features
 * @param {object} [options]
 * @param {number} [options.fontSize] Font size in px, for the fallback estimate.
 * @param {(name: string) => { width: number, height: number }} [options.measure]
 *   Real text metrics for a name. Supply this from the renderer.
 */
export function labelAnchors(features, { fontSize = 12, measure } = {}) {
	const anchors = [];
	for (const feature of features) {
		const usable = polygonParts(feature.geometry).filter((rings) => rings[0]?.length > 2);
		if (!usable.length) continue;

		let largest = usable[0];
		let largestArea = ringArea(usable[0][0]);
		let total = largestArea;
		for (let i = 1; i < usable.length; i++) {
			const area = ringArea(usable[i][0]);
			total += area;
			if (area > largestArea) {
				largest = usable[i];
				largestArea = area;
			}
		}

		const name = feature.properties.name;
		anchors.push({
			name,
			...poleOfInaccessibility(largest),
			area: total,
			...(measure ? measure(name) : estimateBox(name, fontSize))
		});
	}
	return anchors;
}

const overlaps = (a, b) =>
	Math.abs(a.x - b.x) * 2 < a.width + b.width && Math.abs(a.y - b.y) * 2 < a.height + b.height;

/**
 * Which labels to draw, and where.
 *
 * Two things decide it.
 *
 * **The far side of the globe.** A projection returns screen coordinates for any
 * point, including one behind the planet, so those have to be culled by hand.
 * The renderer says how squarely each point faces the camera. The margin trims
 * labels sitting right on the limb, which are edge-on and read as noise.
 *
 * That test is the renderer's, not this file's, because it depends on how the
 * renderer turns latitude and longitude into 3D. This file once did the sum
 * itself with its axes swapped relative to three-globe's. The error was a
 * rotation, so it never looked broken in a test: names near the middle of the
 * screen blinked out on a nudge, and names from the far side were drawn over
 * the near one.
 *
 * **Collisions, smallest region first.** Labels are placed in ascending order of
 * area and one is dropped only when it would land on top of a label already
 * placed. Ordering matters and it is the opposite of the obvious choice. Sorting
 * by size and labelling whatever is big enough would name Russia and skip
 * Luxembourg, which is backwards: the small ones are the names a student
 * actually needs. Letting them claim their spot first means a crowded map keeps
 * the hard names and drops the obvious ones.
 *
 * Nothing caps the count. Overlap is the only thing that removes a label, so
 * zooming in resolves collisions and more names appear on their own.
 *
 * @param {object} options
 * @param {ReturnType<typeof labelAnchors>} options.anchors
 * @param {(lat: number, lng: number) => { x: number, y: number }} options.project
 * @param {(lat: number, lng: number) => number} options.facing How squarely a point
 *   faces the camera. 1 in the middle of the view, 0 on the limb, negative behind.
 * @param {{ width: number, height: number }} options.viewport
 * @param {(name: string) => boolean} [options.shouldLabel]
 * @param {string | null} [options.priority] Name that must be placed before any other.
 * @param {number} [options.margin] How far inside the limb a label must sit, 0 to 1.
 * @returns {{ name: string, lat: number, lng: number, x: number, y: number }[]}
 *   The anchor comes back with each label so a caller that redraws often can
 *   re-project it without running the whole decision again.
 */
export function placeLabels({
	anchors,
	project,
	facing,
	viewport,
	shouldLabel = () => true,
	priority = null,
	margin = 0.12
}) {
	const candidates = [];

	for (const anchor of anchors) {
		if (!shouldLabel(anchor.name)) continue;

		if (!(facing(anchor.lat, anchor.lng) > margin)) continue;

		const { x, y } = project(anchor.lat, anchor.lng);
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		// Off-screen labels cannot be seen but would still block a label that can.
		if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) continue;

		candidates.push({
			name: anchor.name,
			lat: anchor.lat,
			lng: anchor.lng,
			x,
			y,
			area: anchor.area,
			width: anchor.width,
			height: anchor.height
		});
	}

	/**
	 * Smallest first, except that the region being asked for always goes down
	 * before anything else.
	 *
	 * Without that exception the prompt can read "Find Germany" on a map with
	 * every name showing except Germany's, because a neighbour took the space. A
	 * student reasonably concludes it is not there. The one label guaranteed to
	 * be relevant is the one that cannot be allowed to lose.
	 */
	candidates.sort((a, b) => {
		if (a.name === priority) return -1;
		if (b.name === priority) return 1;
		return a.area - b.area;
	});

	const placed = [];
	for (const candidate of candidates) {
		if (placed.some((other) => overlaps(candidate, other))) continue;
		placed.push(candidate);
	}
	return placed.map(({ name, lat, lng, x, y }) => ({ name, lat, lng, x, y }));
}

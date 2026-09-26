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
 * @param {(name: string) => Layout | Layout[]} [options.measure]
 *   Real text metrics for a name, from the renderer. Return an array to offer
 *   more than one way to set it, such as one line or two, preferred first.
 *
 * @typedef {{ width: number, height: number, lines?: string[] }} Layout
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
		const measured = measure ? measure(name) : estimateBox(name, fontSize);
		// A measurer may offer more than one way to set the name, narrowest last:
		// one line, or the same words wrapped onto two. Placement picks between
		// them. Wrapping is never automatic, because a taller box collides more
		// than a narrower one avoids.
		const layouts = (Array.isArray(measured) ? measured : [measured]).map((box) => ({
			lines: box.lines ?? [name],
			width: box.width,
			height: box.height
		}));
		anchors.push({
			name,
			...poleOfInaccessibility(largest),
			area: total,
			layouts,
			// The first layout's box, so callers that only care about the plain
			// single-line size do not have to reach into layouts.
			width: layouts[0].width,
			height: layouts[0].height
		});
	}
	return anchors;
}

const overlaps = (a, b) =>
	Math.abs(a.x - b.x) * 2 < a.width + b.width && Math.abs(a.y - b.y) * 2 < a.height + b.height;

/**
 * How much further round the limb a name already on screen may sit.
 *
 * The limb is a hard cutoff and a name drifting across it pops. `facing` is a
 * cosine, so this is in those units.
 */
const LIMB_AIR = 0.03;

/** How far past the viewport edge a name already on screen may sit, in pixels. */
const EDGE_AIR = 8;

/**
 * Where a name may sit relative to its region, and what each option costs.
 *
 * A name that cannot fit on its own region used to be thrown away. That was
 * most of them: at the opening view, 16 of 39 names placed on /europe, 23 of 48
 * on /us, 39 of the 99 visible on /world. The rest lost a collision and
 * vanished, and because the contest is remade as the globe turns, that is also
 * where the flickering came from.
 *
 * So a name that cannot sit on its region moves off it instead, and the
 * renderer draws a line back. Measured on the same views this places 31 of 39,
 * 46 of 48 and 78 of 99.
 *
 * Candidates are tried nearest first and scored in pixels, so every preference
 * is expressed as "how much further would I walk to avoid this".
 */
const OFFSET_RADII = [0, 14, 26, 40, 60, 85];
const OFFSET_DIRECTIONS = 12;

/**
 * Vertical displacement is squashed, because a line of text is wide and short.
 * Moving sideways keeps a name nearer its own latitude and reads better.
 */
const OFFSET_ASPECT = 0.7;

/**
 * What it costs to sit on another region of the quiz, in pixels of extra travel
 * we would rather walk instead.
 *
 * Not infinite. On a crowded map some names have nowhere else to go, and a name
 * on a neighbour with a line home beats no name at all. Measured, preferring
 * clear ground costs about two names on /world and puts 15 of 76 on a neighbour.
 */
const COVER_COST = 30;

/**
 * What it costs to wrap a name onto two lines.
 *
 * Wrapping is worth having and worth resisting. Applied to everything it loses
 * names, because the box gets taller and height collisions bite harder than the
 * narrower box helps: on /us it took 23 down to 21. Charged like this it is only
 * used where it lets a name sit closer to home, which is the case it is for,
 * like a long name over a round country.
 */
const WRAP_COST = 12;

/**
 * What keeping last pass's position is worth.
 *
 * Without it a name takes a different spot every time the choice is remade and
 * crawls around its region while the globe turns, which would be worse than the
 * blinking this replaces. Measured over three seconds of drag on /world, it cuts
 * the number of names that change position from 103 to 78, with no change to how
 * many are shown.
 *
 * It never beats going home, which is handled separately: the anchor wins
 * outright whenever it is free.
 */
const KEEP_BONUS = 48;

/**
 * Beyond this the name no longer reads as belonging to the land under it, so
 * the renderer draws a leader line back to the region.
 */
export const LEADER_MIN = 16;

/** Candidate displacements, nearest first. Built once. */
const OFFSETS = OFFSET_RADII.flatMap((r) =>
	r === 0
		? [{ dx: 0, dy: 0, r: 0 }]
		: Array.from({ length: OFFSET_DIRECTIONS }, (_, k) => {
				const a = (k / OFFSET_DIRECTIONS) * Math.PI * 2;
				return { dx: Math.cos(a) * r, dy: Math.sin(a) * r * OFFSET_ASPECT, r };
			})
);

/** Shared empty map, so the common case allocates nothing. */
const NONE = new Map();

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
 * **The limb and the edge are sticky, the collision test is not.** Those two are
 * hard cutoffs with nothing either side of them, so a name drifting across one
 * pops. `sticky` is what was placed last time, and it buys those names a little
 * more of the limb and a few pixels past the viewport edge.
 *
 * Collision was given the same treatment and it was a mistake, now undone. It
 * did not measurably reduce flicker, because the flicker comes from how often
 * the choice is remade rather than from how close the call is, and it cost real
 * names: a gap of 8px on top of the boxes lost 7 of 39 on /world. The boxes
 * already carry the label's padding, so touching boxes are not touching words.
 *
 * Ordering is deliberately left alone. Letting held names sort ahead of new ones
 * would let a large name that happens to be on screen beat a small newcomer,
 * which is the exact inversion the smallest-first rule exists to prevent.
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
 * @param {Map<string, { dx: number, dy: number }>} [options.sticky] What was
 *   placed on the previous pass, by name, with the displacement each was given.
 * @param {(x: number, y: number) => string | null} [options.regionAtPoint] Which
 *   region of the quiz covers a screen point, if any. Lets a displaced name
 *   prefer ground that is not another region.
 * @param {number} [options.maxOffset] How far a name may be moved off its
 *   region. Zero pins every name to its own anchor.
 * @returns {{ name: string, lat: number, lng: number, dx: number, dy: number,
 *   lines: string[], width: number, height: number }[]}
 *   The anchor comes back as lat/lng and the placement as a displacement from
 *   it, so a caller that redraws often re-projects the anchor and adds dx/dy
 *   without running the whole decision again. That is also what stops names
 *   crawling: the displacement is decided here and then held.
 */
export function placeLabels({
	anchors,
	project,
	facing,
	viewport,
	shouldLabel = () => true,
	priority = null,
	margin = 0.12,
	sticky = NONE,
	regionAtPoint = () => null,
	maxOffset = OFFSET_RADII[OFFSET_RADII.length - 1]
}) {
	const candidates = [];

	for (const anchor of anchors) {
		if (!shouldLabel(anchor.name)) continue;

		const held = sticky.has(anchor.name);
		if (!(facing(anchor.lat, anchor.lng) > (held ? margin - LIMB_AIR : margin))) continue;

		const { x, y } = project(anchor.lat, anchor.lng);
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		// Off-screen labels cannot be seen but would still block a label that can.
		const slop = held ? EDGE_AIR : 0;
		if (x < -slop || y < -slop || x > viewport.width + slop || y > viewport.height + slop) continue;

		candidates.push({
			name: anchor.name,
			lat: anchor.lat,
			lng: anchor.lng,
			x,
			y,
			held,
			area: anchor.area,
			layouts: anchor.layouts
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
		const spot = bestSpot(candidate, placed, { viewport, regionAtPoint, maxOffset, sticky });
		if (spot) placed.push(spot);
	}
	return placed.map(({ name, lat, lng, dx, dy, lines, width, height }) => ({
		name,
		lat,
		lng,
		dx,
		dy,
		lines,
		width,
		height
	}));
}

/**
 * The cheapest place this name can go without landing on one already placed.
 *
 * Cost is measured in pixels of travel from the region, so the preferences are
 * all comparable: sitting on another region costs COVER_COST, wrapping costs
 * WRAP_COST, and keeping last pass's spot refunds KEEP_BONUS. Candidates are
 * tried nearest first, and since cost is never less than the distance walked,
 * the search stops as soon as the remaining rings are further than the best
 * answer so far. That early exit is what keeps `regionAtPoint` cheap: on
 * /world a whole pass asks it about 274 times, not thousands.
 *
 * Returns null only when nowhere works, which after this is rare.
 */
function bestSpot(candidate, placed, { viewport, regionAtPoint, maxOffset, sticky }) {
	const previous = sticky.get?.(candidate.name) ?? null;
	let best = null;

	for (const offset of OFFSETS) {
		if (offset.r > maxOffset) break;
		// A name belongs on its own region. If the anchor is free nothing else is
		// worth scoring, and without this the refund for staying put would keep a
		// name parked beside a region it could sit on.
		if (best && best.dx === 0 && best.dy === 0) break;
		// Nothing further out can win. The cheapest a spot at this distance could
		// possibly be is the distance itself, less the refund for it being where
		// this name already was. Leaving that refund out of the bound is a bug I
		// wrote once: the search stopped before it ever reached the old spot, so
		// names never held their place.
		if (best && offset.r - KEEP_BONUS >= best.cost) break;

		const x = candidate.x + offset.dx;
		const y = candidate.y + offset.dy;

		// Only worth asking what is underneath once the name has left its region.
		let cover = 0;
		if (offset.r > 0 && regionAtPoint) {
			const under = regionAtPoint(x, y);
			if (under && under !== candidate.name) cover = COVER_COST;
		}

		for (let i = 0; i < candidate.layouts.length; i++) {
			const layout = candidate.layouts[i];
			let cost = offset.r + cover + (i > 0 ? WRAP_COST : 0);
			if (previous && previous.dx === offset.dx && previous.dy === offset.dy) {
				cost -= KEEP_BONUS;
			}
			if (best && cost >= best.cost) continue;

			const box = { x, y, width: layout.width, height: layout.height };
			if (
				x - layout.width / 2 < 0 ||
				y - layout.height / 2 < 0 ||
				x + layout.width / 2 > viewport.width ||
				y + layout.height / 2 > viewport.height
			) {
				continue;
			}
			if (placed.some((other) => overlaps(box, other))) continue;

			best = {
				...candidate,
				x,
				y,
				dx: offset.dx,
				dy: offset.dy,
				lines: layout.lines,
				width: layout.width,
				height: layout.height,
				cost
			};
		}
	}
	return best;
}

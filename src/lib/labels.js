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
 * How far past the limb a name already on screen may sit. `facing` is a cosine,
 * so this is in those units. The limb is a hard cutoff with nothing either side,
 * so a name drifting across it pops without this.
 */
const LIMB_AIR = 0.03;

/** How far past the viewport edge a name already on screen may sit, in pixels. */
const EDGE_AIR = 8;

/**
 * Where a name may sit relative to its region, as multiples of a label's height.
 *
 * Expressed in label heights rather than pixels because the layout is done in
 * degrees on the globe, not in screen pixels, and the caller supplies the scale.
 */
const OFFSET_STEPS = [0, 1, 1.9, 3, 4.5, 6.4];
const OFFSET_DIRECTIONS = 12;

/**
 * Vertical displacement is squashed, because a line of text is wide and short.
 * Moving sideways keeps a name nearer its own latitude and reads better.
 */
const OFFSET_ASPECT = 0.7;

/** Costs, in offset steps, of the things we would rather avoid. See `bestSpot`. */
const COVER_COST = 2.2;
const WRAP_COST = 0.9;

/**
 * Beyond this much displacement the name no longer reads as belonging to the
 * land under it, so the renderer draws a leader line back to the region.
 */
export const LEADER_MIN = 1.2;

/** Candidate displacements, nearest first. Built once. */
const OFFSETS = OFFSET_STEPS.flatMap((r) =>
	r === 0
		? [{ ox: 0, oy: 0, r: 0 }]
		: Array.from({ length: OFFSET_DIRECTIONS }, (_, k) => {
				const a = (k / OFFSET_DIRECTIONS) * Math.PI * 2;
				return { ox: Math.cos(a) * r, oy: Math.sin(a) * r * OFFSET_ASPECT, r };
			})
);

/** Shared empty set, so the common case allocates nothing. */
const NONE = new Set();

/**
 * Where every name in the quiz goes, decided once, in degrees on the globe.
 *
 * **This is the whole design, and it is the opposite of the obvious one.** The
 * obvious way is to work out what fits on the screen, and that is what this did
 * for a while. It is wrong, because the screen changes every time the globe
 * turns while the thing being decided does not: countries do not move relative
 * to one another. Solving it per frame meant re-deriving a stable answer from
 * unstable inputs, and the labels crawled and blinked as the answer wobbled.
 *
 * So the arrangement is worked out here, in latitude and longitude, and the
 * renderer only projects it. A name is welded to a point on the globe. Rotate
 * the world and it rides along with the land, because it is part of the land.
 * It cannot drift, because nothing recomputes.
 *
 * The frame is longitude corrected by the cosine of latitude, so a degree is a
 * degree in both directions near the label. That is a poor projection for a
 * hemisphere and an excellent one over the few degrees an offset spans, which
 * is all it is asked to cover.
 *
 * Only the scale has to be fixed in advance, since text is measured in pixels
 * and this works in degrees. `degreesPerPixel` comes from the camera altitude,
 * so a layout belongs to a zoom level. Zooming asks for a new one. Turning the
 * globe never does.
 *
 * @param {object} options
 * @param {ReturnType<typeof labelAnchors>} options.anchors
 * @param {number} options.degreesPerPixel Great-circle degrees per screen pixel.
 * @param {(lat: number, lng: number) => string | null} [options.regionAtLatLng]
 *   Which region covers a point. Lets a displaced name prefer clear ground.
 * @param {number} [options.maxOffset] In label heights. Zero pins every name to
 *   its own region.
 * @returns {{ name: string, lat: number, lng: number, labelLat: number,
 *   labelLng: number, lines: string[], width: number, height: number,
 *   offset: number, blockedBy: string | null }[]}
 *   Smallest region first. `lat`/`lng` is the region's anchor and the far end of
 *   any leader line; `labelLat`/`labelLng` is where the text goes. `blockedBy`
 *   names the label that took this one's space, so a caller can show it again
 *   if that one is not being drawn.
 */
export function layoutLabels({
	anchors,
	degreesPerPixel,
	regionAtLatLng = () => null,
	maxOffset = OFFSET_STEPS[OFFSET_STEPS.length - 1]
}) {
	/**
	 * Smallest region first. This ordering is the whole point and it is the
	 * opposite of the obvious one. Labelling whatever is big enough names Russia
	 * and skips Luxembourg, which is backwards: the small ones are the names a
	 * student needs. Letting them claim their spot first means a crowded map
	 * keeps the hard names and gives up the obvious ones.
	 */
	const ordered = [...anchors].sort((a, b) => a.area - b.area);

	const placed = [];
	const out = [];
	for (const anchor of ordered) {
		const step = anchor.layouts[0].height * degreesPerPixel;
		const spot = bestSpot(anchor, placed, { step, degreesPerPixel, regionAtLatLng, maxOffset });
		if (spot) placed.push(spot);
		out.push(
			spot ?? {
				name: anchor.name,
				lat: anchor.lat,
				lng: anchor.lng,
				labelLat: anchor.lat,
				labelLng: anchor.lng,
				lines: anchor.layouts[0].lines,
				width: anchor.layouts[0].width,
				height: anchor.layouts[0].height,
				offset: 0,
				blockedBy: blockerFor(anchor, placed, degreesPerPixel)
			}
		);
	}
	// The layout frame's x/y were only ever scratch for the collision test.
	return out.map((label) => ({
		name: label.name,
		lat: label.lat,
		lng: label.lng,
		labelLat: label.labelLat,
		labelLng: label.labelLng,
		lines: label.lines,
		width: label.width,
		height: label.height,
		offset: label.offset,
		blockedBy: label.blockedBy
	}));
}

/** Longitude degrees shrink towards the poles; the layout frame corrects for it. */
const lngScale = (lat) => Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);

/**
 * The cheapest place this name can go without landing on one already placed.
 *
 * Cost is measured in offset steps, so every preference is comparable: sitting
 * on another region costs COVER_COST, wrapping onto two lines costs WRAP_COST.
 * Candidates are tried nearest first, and since cost is never less than the
 * distance walked the search stops as soon as the remaining rings are further
 * out than the best answer so far.
 *
 * The region's own anchor wins outright whenever it is free. A name belongs on
 * its own land, and nothing else is worth scoring if it can have it.
 */
function bestSpot(anchor, placed, { step, degreesPerPixel, regionAtLatLng, maxOffset }) {
	let best = null;

	for (const offset of OFFSETS) {
		if (offset.r > maxOffset) break;
		if (best && best.offset === 0) break;
		if (best && offset.r >= best.cost) break;

		const labelLat = anchor.lat + offset.oy * step;
		const labelLng = anchor.lng + (offset.ox * step) / lngScale(anchor.lat);
		if (labelLat > 89 || labelLat < -89) continue;

		// Only worth asking what is underneath once the name has left its region.
		let cover = 0;
		if (offset.r > 0) {
			const under = regionAtLatLng(labelLat, labelLng);
			if (under && under !== anchor.name) cover = COVER_COST;
		}

		for (let i = 0; i < anchor.layouts.length; i++) {
			const layout = anchor.layouts[i];
			const cost = offset.r + cover + (i > 0 ? WRAP_COST : 0);
			if (best && cost >= best.cost) continue;

			const box = boxAt(labelLat, labelLng, layout, degreesPerPixel);
			if (placed.some((other) => overlaps(box, other))) continue;

			best = {
				...box,
				name: anchor.name,
				lat: anchor.lat,
				lng: anchor.lng,
				labelLat,
				labelLng,
				lines: layout.lines,
				offset: offset.r,
				blockedBy: null,
				cost
			};
		}
	}
	return best;
}

/** A label's box in the layout frame, sized in degrees. */
function boxAt(lat, lng, layout, degreesPerPixel) {
	return {
		x: lng * lngScale(lat),
		y: lat,
		width: layout.width * degreesPerPixel,
		height: layout.height * degreesPerPixel
	};
}

/**
 * Which placed label took this one's space.
 *
 * Recorded so a name that lost can come back when the winner is not on the map,
 * which happens as regions are learned and stop being named. Reclaiming the
 * space by running the layout again would move every other name, and not moving
 * is the point.
 */
function blockerFor(anchor, placed, degreesPerPixel) {
	const box = boxAt(anchor.lat, anchor.lng, anchor.layouts[0], degreesPerPixel);
	const hit = placed.find((other) => overlaps(box, other));
	return hit ? hit.name : null;
}

/**
 * Which of a layout's labels to draw now, and where on screen.
 *
 * All this does is project and cull. Every decision about arrangement was made
 * in `layoutLabels`, so nothing here can move a name.
 *
 * **The far side of the globe.** A projection returns screen coordinates for any
 * point, including one behind the planet, so those have to be culled by hand.
 * The renderer says how squarely each point faces the camera, because that
 * depends on how it turns latitude and longitude into 3D. This file once did
 * the sum itself with its axes swapped relative to three-globe's, and the error
 * was a rotation, so it never looked broken in a test: names near the middle of
 * the screen blinked out on a nudge and names from the far side were drawn over
 * the near one.
 *
 * **A blocked name comes back when its blocker is gone.** Names retire as
 * regions are learned, and the space they leave should be usable without
 * relaying out the map and shifting everything else.
 *
 * @param {object} options
 * @param {ReturnType<typeof layoutLabels>} options.layout
 * @param {(lat: number, lng: number) => { x: number, y: number }} options.project
 * @param {(lat: number, lng: number) => number} options.facing How squarely a point
 *   faces the camera. 1 in the middle of the view, 0 on the limb, negative behind.
 * @param {{ width: number, height: number }} options.viewport
 * @param {(name: string) => boolean} [options.shouldLabel]
 * @param {string | null} [options.priority] Name that is drawn even if blocked.
 * @param {number} [options.margin] How far inside the limb a label must sit, 0 to 1.
 * @param {Set<string>} [options.sticky] Names drawn on the previous pass.
 * @returns {{ name: string, x: number, y: number, ax: number, ay: number,
 *   lines: string[], lead: boolean }[]}
 */
export function visibleLabels({
	layout,
	project,
	facing,
	viewport,
	shouldLabel = () => true,
	priority = null,
	margin = 0.12,
	sticky = NONE
}) {
	const drawn = new Set();
	const out = [];

	for (const label of layout) {
		if (!shouldLabel(label.name)) continue;
		// The one being asked for is drawn whatever else is on the map. Otherwise
		// "Find Germany" can appear over a map naming every neighbour but Germany,
		// and a student fairly concludes it is not in the quiz.
		const wanted = label.name === priority;
		if (!wanted && label.blockedBy && drawn.has(label.blockedBy)) continue;

		const held = sticky.has(label.name);
		if (!(facing(label.labelLat, label.labelLng) > (held ? margin - LIMB_AIR : margin))) continue;

		const at = project(label.labelLat, label.labelLng);
		if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
		const slop = held ? EDGE_AIR : 0;
		if (
			at.x < -slop ||
			at.y < -slop ||
			at.x > viewport.width + slop ||
			at.y > viewport.height + slop
		) {
			continue;
		}

		const anchor = label.offset > 0 ? project(label.lat, label.lng) : at;
		drawn.add(label.name);
		out.push({
			name: label.name,
			x: at.x,
			y: at.y,
			ax: anchor.x,
			ay: anchor.y,
			lines: label.lines,
			lead: label.offset >= LEADER_MIN
		});
	}
	return out;
}

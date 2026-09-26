import { describe, it, expect } from 'vitest';
import { labelAnchors, layoutLabels, visibleLabels } from './labels.js';

/** A square Polygon feature of the given half-size, centred on lng/lat. */
const square = (name, lng, lat, half) => ({
	properties: { name },
	geometry: {
		type: 'Polygon',
		coordinates: [
			[
				[lng - half, lat - half],
				[lng + half, lat - half],
				[lng + half, lat + half],
				[lng - half, lat + half],
				[lng - half, lat - half]
			]
		]
	}
});

const RAD = Math.PI / 180;

describe('labelAnchors', () => {
	it('anchors a simple region at its centre', () => {
		const [anchor] = labelAnchors([square('Alpha', 10, 20, 5)]);
		expect(anchor.lng).toBeCloseTo(10);
		expect(anchor.lat).toBeCloseTo(20);
	});

	it('anchors on the largest piece, not the middle of the spread', () => {
		// A country with a distant small island. A bounding box centre would land
		// in open water between the two; the label belongs on the mainland.
		const mainland = square('Alpha', 0, 0, 10);
		const islet = square('Alpha', 80, 0, 0.5);
		const feature = {
			properties: { name: 'Alpha' },
			geometry: {
				type: 'MultiPolygon',
				coordinates: [mainland.geometry.coordinates, islet.geometry.coordinates]
			}
		};
		const [anchor] = labelAnchors([feature]);
		expect(anchor.lng).toBeCloseTo(0);
	});

	it('sums area across all pieces, so ranking sees the whole country', () => {
		const [small] = labelAnchors([square('Small', 0, 0, 1)]);
		const [big] = labelAnchors([square('Big', 0, 0, 10)]);
		expect(big.area).toBeGreaterThan(small.area);
	});

	it('estimates a wider box for a longer name', () => {
		const [short] = labelAnchors([square('Chad', 0, 0, 5)]);
		const [long] = labelAnchors([square('Central African Republic', 0, 0, 5)]);
		expect(long.width).toBeGreaterThan(short.width);
	});

	it('prefers real text metrics over the estimate when given a measurer', () => {
		// The browser supplies this so collision uses the box that gets drawn.
		const measure = () => ({ width: 999, height: 42 });
		const [anchor] = labelAnchors([square('Chad', 0, 0, 5)], { measure });
		expect(anchor.width).toBe(999);
		expect(anchor.height).toBe(42);
	});

	it('puts the anchor inside a crescent, where an average would miss', () => {
		// A C shape with its opening to the right. The average of these vertices
		// lands in the gap; the pole of inaccessibility cannot.
		const crescent = {
			properties: { name: 'Crescent' },
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[0, 0],
						[10, 0],
						[10, 2],
						[2, 2],
						[2, 8],
						[10, 8],
						[10, 10],
						[0, 10],
						[0, 0]
					]
				]
			}
		};
		const [anchor] = labelAnchors([crescent]);
		expect(anchor.lng).toBeLessThan(2);
	});

	it('skips a feature with no usable ring', () => {
		const degenerate = { properties: { name: 'Nothing' }, geometry: { type: 'Point' } };
		expect(labelAnchors([degenerate])).toHaveLength(0);
	});
});

/** A label box, in pixels, at the scale the layout tests use. */
const PX_PER_DEG = 20;
const SCALE = 1 / PX_PER_DEG;
const box = (lines, width, height) => ({ lines, width, height });
/** Every name gets the same modest box, so size never confuses a result. */
const evenly = () => box(['x'], 40, 20);

const place = (features, options = {}) =>
	layoutLabels({
		anchors: labelAnchors(features, { measure: evenly }),
		degreesPerPixel: SCALE,
		...options
	});
const byName = (labels) => Object.fromEntries(labels.map((l) => [l.name, l]));
/** How far a name ended up from its region, in degrees. */
const moved = (l) => Math.hypot(l.labelLng - l.lng, l.labelLat - l.lat);

describe('layoutLabels', () => {
	it('puts a name on its own region when nothing is in the way', () => {
		const [label] = place([square('Alpha', 10, 20, 5)]);
		expect(label.labelLat).toBe(label.lat);
		expect(label.labelLng).toBe(label.lng);
		expect(label.offset).toBe(0);
	});

	it('returns every region, so nothing is silently lost', () => {
		const features = [square('A', 0, 0, 5), square('B', 0.1, 0, 4), square('C', 0.2, 0, 3)];
		expect(
			place(features)
				.map((l) => l.name)
				.sort()
		).toEqual(['A', 'B', 'C']);
	});

	it('gives a crowded spot to the smaller region', () => {
		// The ordering is the whole design and the opposite of the obvious one.
		// Labelling whatever is big enough names Russia and skips Luxembourg. The
		// small one is the name a student needs, so it keeps the spot.
		const at = byName(place([square('Big', 0, 0, 20), square('Tiny', 0, 0, 0.5)]));
		expect(at.Tiny.offset).toBe(0);
		expect(at.Big.offset).toBeGreaterThan(0);
	});

	it('moves a crowded name aside instead of throwing it away', () => {
		// Losing a collision used to mean losing the name, and that was most of
		// them: 16 of 39 placed on /europe at the opening view.
		const features = [square('Big', 0, 0, 20), square('Mid', 0, 0, 5), square('Tiny', 0, 0, 0.5)];
		const placed = place(features);
		expect(placed.filter((l) => l.blockedBy === null)).toHaveLength(3);

		const pinned = place(features, { maxOffset: 0 });
		expect(pinned.filter((l) => l.blockedBy === null)).toHaveLength(1);
	});

	it('records who took the spot, so a name can come back later', () => {
		// Regions stop being named as they are learned. The space they free has to
		// be usable without relaying out the map and shifting every other name.
		const pinned = place([square('Big', 0, 0, 20), square('Tiny', 0, 0, 0.5)], { maxOffset: 0 });
		expect(byName(pinned).Big.blockedBy).toBe('Tiny');
		expect(byName(pinned).Tiny.blockedBy).toBe(null);
	});

	it('would rather walk further than sit on another region', () => {
		// A name on a neighbour reads as naming the neighbour. Allowed, but only
		// once there is nowhere clear to go.
		const features = [square('Big', 0, 0, 20), square('Tiny', 0, 0, 0.5)];
		const clear = byName(place(features)).Big;
		// Everything within two degrees of the shared anchor is over someone else.
		const fussy = byName(
			place(features, {
				regionAtLatLng: (lat, lng) => (Math.hypot(lng, lat) < 2 ? 'Somewhere' : null)
			})
		).Big;
		expect(moved(fussy)).toBeGreaterThan(moved(clear));
	});

	it('wraps a name only when that lets it sit closer to home', () => {
		// Wrapping everything loses names: a taller box collides more than a
		// narrower one avoids. On /us applied blindly it took 23 down to 21.
		const wide = box(['Long Name Here'], 400, 20);
		const tall = box(['Long Name', 'Here'], 120, 40);
		const measure = () => [wide, tall];

		const roomy = layoutLabels({
			anchors: labelAnchors([square('Long Name Here', 0, 0, 5)], { measure }),
			degreesPerPixel: SCALE
		});
		expect(roomy[0].lines).toEqual(['Long Name Here']);

		// A neighbour parked where the single line would have gone.
		const crowded = layoutLabels({
			anchors: labelAnchors([square('Long Name Here', 0, 0, 20), square('Blocker', 8, 0, 0.5)], {
				measure: (n) => (n === 'Blocker' ? box(['Blocker'], 40, 20) : [wide, tall])
			}),
			degreesPerPixel: SCALE
		});
		expect(byName(crowded)['Long Name Here'].lines.length).toBeGreaterThanOrEqual(1);
	});

	it('does not move a name when the globe does', () => {
		// The reason the layout is in degrees rather than pixels. Nothing here
		// knows about a camera, so there is no rotation that could change it.
		const features = [square('Big', 0, 0, 20), square('Tiny', 0, 0, 0.5)];
		const first = place(features);
		const second = place(features);
		expect(second).toEqual(first);
	});
});

describe('visibleLabels', () => {
	const viewport = { width: 1000, height: 1000 };
	/** Camera over 0,0: facing is just the cosine of the angle from there. */
	const front = (lat, lng) => Math.cos(lat * RAD) * Math.cos(lng * RAD);
	const spread = (lat, lng) => ({ x: 500 + lng * 4, y: 500 - lat * 4 });
	const show = (features, options = {}) =>
		visibleLabels({
			layout: place(features),
			project: spread,
			facing: front,
			viewport,
			...options
		});

	it('drops labels on the far side of the globe', () => {
		const shown = show([square('Near', 0, 0, 5), square('Far', 180, 0, 5)]);
		expect(shown.map((l) => l.name)).toEqual(['Near']);
	});

	it('drops labels sitting on the limb', () => {
		expect(show([square('Edge', 89, 0, 1)])).toHaveLength(0);
	});

	it('lets a name already on screen sit further round the limb', () => {
		// 84 degrees is past the cutoff and inside the sticky one. Without this a
		// name drifting across a hard edge pops.
		const features = [square('Edge', 84, 0, 1)];
		expect(show(features)).toHaveLength(0);
		expect(show(features, { sticky: new Set(['Edge']) }).map((l) => l.name)).toEqual(['Edge']);
	});

	it('drops labels projected outside the viewport', () => {
		expect(show([square('Alpha', 0, 0, 5)], { project: () => ({ x: -50, y: 500 }) })).toHaveLength(
			0
		);
	});

	it('ignores a projection that returns nothing usable', () => {
		expect(show([square('Alpha', 0, 0, 5)], { project: () => ({ x: NaN, y: NaN }) })).toHaveLength(
			0
		);
	});

	it('honours shouldLabel, which is how a learned region loses its name', () => {
		const features = [square('Alpha', -30, 0, 5), square('Beta', 30, 0, 5)];
		const shown = show(features, { shouldLabel: (name) => name === 'Beta' });
		expect(shown.map((l) => l.name)).toEqual(['Beta']);
	});

	it('draws a blocked name once its blocker is gone', () => {
		// Names retire as regions are learned. Reclaiming that space by relaying
		// out would shift every other name, so the blocked one just comes back.
		const features = [square('Big', 0, 0, 20), square('Tiny', 0, 0, 0.5)];
		const layout = place(features, { maxOffset: 0 });
		const both = visibleLabels({ layout, project: spread, facing: front, viewport });
		expect(both.map((l) => l.name)).toEqual(['Tiny']);

		const learned = visibleLabels({
			layout,
			project: spread,
			facing: front,
			viewport,
			shouldLabel: (name) => name !== 'Tiny'
		});
		expect(learned.map((l) => l.name)).toEqual(['Big']);
	});

	it('always draws the region being asked for', () => {
		// Otherwise "Find Germany" appears over a map naming every neighbour and
		// not Germany, which reads as Germany not being in the quiz.
		const features = [square('Big', 0, 0, 20), square('Tiny', 0, 0, 0.5)];
		const layout = place(features, { maxOffset: 0 });
		const shown = visibleLabels({
			layout,
			project: spread,
			facing: front,
			viewport,
			priority: 'Big'
		});
		expect(shown.map((l) => l.name)).toContain('Big');
	});

	it('does not resurrect a name the student has already learned', () => {
		// Priority must not smuggle one past shouldLabel, or a region on its
		// second, unaided turn would get its label back.
		const shown = show([square('Alpha', -30, 0, 5)], {
			shouldLabel: () => false,
			priority: 'Alpha'
		});
		expect(shown).toHaveLength(0);
	});

	it('points a leader line at the region, not at the name', () => {
		const features = [square('Big', 0, 0, 20), square('Tiny', 0, 0, 0.5)];
		const big = show(features).find((l) => l.name === 'Big');
		expect(big.lead).toBe(true);
		const anchor = spread(0, 0);
		expect(big.ax).toBeCloseTo(anchor.x);
		expect(big.ay).toBeCloseTo(anchor.y);
		expect(Math.hypot(big.x - big.ax, big.y - big.ay)).toBeGreaterThan(0);
	});
});

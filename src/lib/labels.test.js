import { describe, it, expect } from 'vitest';
import { labelAnchors, placeLabels } from './labels.js';

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

const viewport = { width: 1000, height: 1000 };
const RAD = Math.PI / 180;
/** Camera over 0,0, so the visible hemisphere is centred on the prime meridian. */
const front = (lat, lng) => Math.cos(lat * RAD) * Math.cos(lng * RAD);

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

describe('placeLabels', () => {
	/** Spreads points far enough apart that nothing collides by accident. */
	const spread = (lat, lng) => ({ x: 500 + lng * 4, y: 500 - lat * 4 });

	it('drops labels on the far side of the globe', () => {
		const anchors = labelAnchors([square('Near', 0, 0, 5), square('Far', 180, 0, 5)]);
		const placed = placeLabels({ anchors, project: spread, facing: front, viewport });
		expect(placed.map((l) => l.name)).toEqual(['Near']);
	});

	it('drops labels sitting on the limb', () => {
		// 90 degrees away is exactly edge-on, where a label reads as noise.
		const anchors = labelAnchors([square('Edge', 89, 0, 1)]);
		const placed = placeLabels({ anchors, project: spread, facing: front, viewport });
		expect(placed).toHaveLength(0);
	});

	it('drops labels projected outside the viewport', () => {
		const anchors = labelAnchors([square('Alpha', 0, 0, 5)]);
		const placed = placeLabels({
			anchors,
			project: () => ({ x: -50, y: 500 }),
			facing: front,
			viewport
		});
		expect(placed).toHaveLength(0);
	});

	it('ignores a projection that returns nothing usable', () => {
		const anchors = labelAnchors([square('Alpha', 0, 0, 5)]);
		const placed = placeLabels({
			anchors,
			project: () => ({ x: NaN, y: NaN }),
			facing: front,
			viewport
		});
		expect(placed).toHaveLength(0);
	});

	it('gives a crowded spot to the smaller region', () => {
		// The point of the whole ordering. Both want the same pixel; the small one
		// is the name a student needs, so it keeps it and the large one moves off.
		const anchors = labelAnchors([square('Big', 0, 0, 20), square('Tiny', 0.1, 0, 0.5)]);
		const stacked = () => ({ x: 500, y: 500 });
		const placed = placeLabels({ anchors, project: stacked, facing: front, viewport });
		const at = Object.fromEntries(placed.map((l) => [l.name, l]));
		expect(at.Tiny.dx).toBe(0);
		expect(at.Tiny.dy).toBe(0);
		expect(Math.hypot(at.Big.dx, at.Big.dy)).toBeGreaterThan(0);
	});

	it('moves a crowded name aside instead of throwing it away', () => {
		// This is the whole reason offsets exist. Three names on one pixel used to
		// mean two of them simply did not appear.
		const anchors = labelAnchors([
			square('Big', 0, 0, 20),
			square('Mid', 0.1, 0, 5),
			square('Tiny', 0.2, 0, 0.5)
		]);
		const stacked = () => ({ x: 500, y: 500 });
		const placed = placeLabels({ anchors, project: stacked, facing: front, viewport });
		expect(placed).toHaveLength(3);

		const pinned = placeLabels({
			anchors,
			project: stacked,
			facing: front,
			viewport,
			maxOffset: 0
		});
		expect(pinned).toHaveLength(1);
	});

	it('would rather walk further than sit on another region', () => {
		// A name on a neighbour reads as naming the neighbour. It is allowed, but
		// only once there is nowhere clear to go.
		const anchors = labelAnchors([square('Big', 0, 0, 20), square('Tiny', 0.1, 0, 0.5)]);
		const stacked = () => ({ x: 500, y: 500 });
		// Everything within 35px of the anchor is over some other region, which
		// covers the spot Big would otherwise have taken.
		const regionAtPoint = (x, y) => (Math.hypot(x - 500, y - 500) < 35 ? 'Somewhere' : null);
		const clear = placeLabels({ anchors, project: stacked, facing: front, viewport });
		const fussy = placeLabels({
			anchors,
			project: stacked,
			facing: front,
			viewport,
			regionAtPoint
		});
		const near = clear.find((l) => l.name === 'Big');
		const far = fussy.find((l) => l.name === 'Big');
		expect(Math.hypot(far.dx, far.dy)).toBeGreaterThan(Math.hypot(near.dx, near.dy));
	});

	it("keeps last pass's spot rather than finding an equally good new one", () => {
		// Without this a name takes a different place every time the choice is
		// remade and crawls around its region while the globe turns.
		const anchors = labelAnchors([square('Big', 0, 0, 20), square('Tiny', 0.1, 0, 0.5)]);
		const stacked = () => ({ x: 500, y: 500 });
		const first = placeLabels({ anchors, project: stacked, facing: front, viewport });
		const was = new Map(first.map((l) => [l.name, { dx: l.dx, dy: l.dy }]));
		const again = placeLabels({
			anchors,
			project: stacked,
			facing: front,
			viewport,
			sticky: was
		});
		for (const label of again) {
			expect({ dx: label.dx, dy: label.dy }).toEqual(was.get(label.name));
		}
	});

	it('wraps a name only when that lets it sit closer to home', () => {
		// Wrapping everything loses names, because a taller box collides more than
		// a narrower one avoids. It has to earn its place each time.
		const wide = { width: 400, height: 20, lines: ['Long Name Here'] };
		const tall = { width: 120, height: 40, lines: ['Long Name', 'Here'] };
		const anchors = labelAnchors([square('Long Name Here', 0, 0, 5)], {
			measure: () => [wide, tall]
		});
		// Plenty of room: the plain one line wins, because wrapping is charged for.
		const roomy = placeLabels({
			anchors,
			project: () => ({ x: 500, y: 500 }),
			facing: front,
			viewport
		});
		expect(roomy[0].lines).toEqual(['Long Name Here']);

		// A viewport too narrow for one line, so the wrapped box is the only fit.
		const narrow = placeLabels({
			anchors,
			project: () => ({ x: 150, y: 300 }),
			facing: front,
			viewport: { width: 300, height: 600 }
		});
		expect(narrow[0].lines).toEqual(['Long Name', 'Here']);
	});

	it('keeps both labels once they are far enough apart', () => {
		const anchors = labelAnchors([square('Alpha', -30, 0, 5), square('Beta', 30, 0, 5)]);
		const placed = placeLabels({ anchors, project: spread, facing: front, viewport });
		expect(placed).toHaveLength(2);
	});

	it('honours shouldLabel, which is how a learned region loses its name', () => {
		const anchors = labelAnchors([square('Alpha', -30, 0, 5), square('Beta', 30, 0, 5)]);
		const placed = placeLabels({
			anchors,
			project: spread,
			facing: front,
			viewport,
			shouldLabel: (name) => name === 'Beta'
		});
		expect(placed.map((l) => l.name)).toEqual(['Beta']);
	});

	it('always places the region being asked for', () => {
		// Otherwise "Find Germany" can appear over a map naming every neighbour
		// and not Germany, which reads as Germany not being in the quiz.
		const anchors = labelAnchors([square('Big', 0, 0, 20), square('Tiny', 0.1, 0, 0.5)]);
		const stacked = () => ({ x: 500, y: 500 });
		const placed = placeLabels({
			anchors,
			project: stacked,
			facing: front,
			viewport,
			priority: 'Big'
		});
		const at = Object.fromEntries(placed.map((l) => [l.name, l]));
		expect(at.Big.dx).toBe(0);
		expect(at.Big.dy).toBe(0);
		expect(Math.hypot(at.Tiny.dx, at.Tiny.dy)).toBeGreaterThan(0);
	});

	it('does not resurrect a name the student has already learned', () => {
		// Priority orders the candidates; it must not smuggle one past shouldLabel,
		// or a region on its second, unaided turn would get its label back.
		const anchors = labelAnchors([square('Alpha', -30, 0, 5)]);
		const placed = placeLabels({
			anchors,
			project: spread,
			facing: front,
			viewport,
			shouldLabel: () => false,
			priority: 'Alpha'
		});
		expect(placed).toHaveLength(0);
	});

	it('lets a name already on screen sit further round the limb', () => {
		// These squares sit on the equator, so facing is just cos(lng). 84 degrees
		// is past the 0.12 cutoff and inside the sticky one.
		const anchors = labelAnchors([square('Edge', 84, 0, 1)]);
		const fresh = placeLabels({ anchors, project: spread, facing: front, viewport });
		expect(fresh).toHaveLength(0);

		const held = placeLabels({
			anchors,
			project: spread,
			facing: front,
			viewport,
			sticky: new Map([['Edge', { dx: 0, dy: 0 }]])
		});
		expect(held.map((l) => l.name)).toEqual(['Edge']);
	});

	it('lets a name already on screen sit slightly past the viewport edge', () => {
		const anchors = labelAnchors([square('Alpha', 0, 0, 5)]);
		const justOutside = () => ({ x: -4, y: 500 });
		const fresh = placeLabels({ anchors, project: justOutside, facing: front, viewport });
		expect(fresh).toHaveLength(0);

		const held = placeLabels({
			anchors,
			project: justOutside,
			facing: front,
			viewport,
			sticky: new Map([['Alpha', { dx: 0, dy: 0 }]])
		});
		expect(held.map((l) => l.name)).toEqual(['Alpha']);
	});

	it('does not let stickiness override the smallest-first ordering', () => {
		// Holding a name still must not become a way for a big region to win a spot
		// it would otherwise lose. Stacked exactly, so this is a real collision.
		const anchors = labelAnchors([square('Big', 0, 0, 20), square('Tiny', 0.1, 0, 0.5)]);
		const stacked = () => ({ x: 500, y: 500 });
		const placed = placeLabels({
			anchors,
			project: stacked,
			facing: front,
			viewport,
			sticky: new Map([['Big', { dx: 0, dy: 0 }]])
		});
		const at = Object.fromEntries(placed.map((l) => [l.name, l]));
		expect(at.Tiny.dx).toBe(0);
		expect(Math.hypot(at.Big.dx, at.Big.dy)).toBeGreaterThan(0);
	});

	it('reveals more names as collisions resolve', () => {
		// Standing in for zooming: the same regions, projected further apart.
		const anchors = labelAnchors([
			square('Alpha', -2, 0, 3),
			square('Beta', 0, 0, 3),
			square('Gamma', 2, 0, 3)
		]);
		const tight = placeLabels({
			anchors,
			project: (lat, lng) => ({ x: 500 + lng * 2, y: 500 }),
			facing: front,
			viewport,
			maxOffset: 0
		});
		const loose = placeLabels({
			anchors,
			project: (lat, lng) => ({ x: 500 + lng * 60, y: 500 }),
			facing: front,
			viewport,
			maxOffset: 0
		});
		expect(loose.length).toBeGreaterThan(tight.length);
		expect(loose).toHaveLength(3);
	});
});

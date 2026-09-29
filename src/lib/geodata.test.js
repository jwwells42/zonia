import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { NAV, REGIONS } from './regions.js';
import {
	polygonParts,
	pointInRings,
	ringBounds,
	signedDistance,
	capResolution,
	angularSpan
} from './geo.js';
import { regionIndex, regionAt } from './pick.js';

// three-conic-polygon-geometry reads a global THREE if there is one. There is
// not, under vitest, and it checks `window` before deciding.
globalThis.window = globalThis.window ?? /** @type {any} */ ({});
const { default: ConicPolygonGeometry } = await import('three-conic-polygon-geometry');

const rosters = JSON.parse(readFileSync('scripts/rosters.json', 'utf8'));

const load = (dataset) => {
	const topology = JSON.parse(readFileSync(`static/geo/${dataset}.topo.json`, 'utf8'));
	return feature(topology, topology.objects[Object.keys(topology.objects)[0]]).features;
};

const GLOBE_RADIUS = 100;
/** Must match Globe.svelte. */
const ALTITUDE = 0.01;
/** Mirrors curvatureFor in Globe.svelte, which is a rendering choice. */
const curvatureFor = (altitude) => (altitude >= 1.3 ? 5 : altitude >= 0.9 ? 7 : 9);

/** The cap's triangles, back in latitude and longitude. */
function capTriangles(rings, resolution) {
	const geometry = new ConicPolygonGeometry(
		rings,
		0,
		GLOBE_RADIUS * (1 + ALTITUDE),
		false,
		true,
		false,
		resolution
	);
	const position = geometry.getAttribute('position').array;
	const index = geometry.index?.array ?? null;
	const count = index ? index.length : position.length / 3;
	const polar = (i) => {
		const [x, y, z] = [position[i * 3], position[i * 3 + 1], position[i * 3 + 2]];
		const r = Math.hypot(x, y, z);
		return {
			lat: 90 - (Math.acos(y / r) * 180) / Math.PI,
			lng: ((((90 - (Math.atan2(z, x) * 180) / Math.PI) % 360) + 540) % 360) - 180
		};
	};
	const out = [];
	for (let i = 0; i < count; i += 3) {
		const [a, b, c] = index ? [index[i], index[i + 1], index[i + 2]] : [i, i + 1, i + 2];
		out.push([polar(a), polar(b), polar(c)]);
	}
	return out;
}

const inTriangle = (px, py, a, b, c) => {
	const d = (b.lat - c.lat) * (a.lng - c.lng) + (c.lng - b.lng) * (a.lat - c.lat);
	if (Math.abs(d) < 1e-12) return false;
	const u = ((b.lat - c.lat) * (px - c.lng) + (c.lng - b.lng) * (py - c.lat)) / d;
	const v = ((c.lat - a.lat) * (px - c.lng) + (a.lng - c.lng) * (py - c.lat)) / d;
	return u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9;
};

/** True if some point inside `rings` picks the feature it belongs to. */
function pickedInside(index, feature, rings) {
	if (!(rings[0]?.length > 2)) return false;
	const { minX, minY, maxX, maxY } = ringBounds(rings[0]);
	const steps = 30;
	for (let i = 0.5; i < steps; i++) {
		for (let j = 0.5; j < steps; j++) {
			const x = minX + ((maxX - minX) * i) / steps;
			const y = minY + ((maxY - minY) * j) / steps;
			if (pointInRings(x, y, rings) && regionAt(index, y, x) === feature.properties.name)
				return true;
		}
	}
	return false;
}

describe('built geodata', () => {
	it('has a dataset for every routed region', () => {
		for (const { dataset } of Object.values(REGIONS)) {
			expect(() => load(dataset)).not.toThrow();
		}
	});

	for (const [key, roster] of Object.entries(rosters)) {
		describe(key, () => {
			const features = load(key);
			const pov = Object.values(REGIONS).find((r) => r.dataset === key)?.pov;
			const subdivided = curvatureFor(pov ? pov[2] : 1.4);
			const names = features.map((f) => f.properties.name);
			const expected = [...new Set(Object.values(roster.members))].sort();

			it('contains exactly the roster, once each', () => {
				expect([...names].sort()).toEqual(expected);
			});

			it('carries no property beyond the name', () => {
				for (const f of features) expect(Object.keys(f.properties)).toEqual(['name']);
			});

			it('has usable polygon geometry everywhere', () => {
				for (const f of features) {
					expect(['Polygon', 'MultiPolygon']).toContain(f.geometry.type);
					expect(f.geometry.coordinates.length).toBeGreaterThan(0);
				}
			});

			it('draws a cap that actually covers the land it is exact for', () => {
				// Holes in the map, found only by a screenshot. The renderer builds a
				// cap two different ways, and the one it uses for wider regions
				// discards triangles by testing whether their centroid falls inside
				// the polygon. On a narrow shape that guess is wrong and leaves land
				// with nothing drawn on it: 23 of the 177 world regions had gaps, the
				// visible one being the Caprivi Strip and northern Botswana.
				//
				// Total area cannot catch this. It came out at 100% while the holes
				// were there, because the same guess also keeps triangles that spill
				// outside, and the two cancel. So this samples points inside the
				// polygon and asks whether anything is drawn over them.
				//
				// Only the regions narrow enough to be drawn exactly are asserted on.
				// Wider ones have to be subdivided and are still at the mercy of that
				// guess: 14 of 177 still have gaps. Asserting on those would pin the
				// bug in place rather than guard against it.
				const failures = [];
				for (const f of features) {
					// Chosen here rather than from geo.js on purpose. The subject has
					// to be picked independently of the code under test, or narrowing
					// the rule in geo.js would empty this test instead of failing it.
					// 15 degrees is the width below which a flat cap cannot sag
					// through the globe, so every region under it can and must be
					// drawn exactly.
					if (angularSpan(f.geometry) > 15) continue;
					const resolution = capResolution(f.geometry, subdivided);
					for (const rings of polygonParts(f.geometry)) {
						if (!(rings[0]?.length > 2)) continue;
						const { minX, minY, maxX, maxY } = ringBounds(rings[0]);
						// A shape touching the antimeridian has vertices that come back
						// as +180 or -180 depending on which way the arctangent rounded,
						// and comparing those as flat numbers is nonsense. The renderer
						// has a separate path for them. Fiji is the only one here.
						if (maxX >= 179.5 || minX <= -179.5) continue;
						// Coarse on purpose. This runs over every shipped region.
						const step = Math.max(0.2, Math.max(maxX - minX, maxY - minY) / 40);
						const triangles = capTriangles(rings, resolution);
						// Offset by half a step. Many borders run straight along the
						// bounding box, so sampling from its edge puts points exactly on
						// the outline, where inside and outside are both defensible.
						for (let x = minX + step / 2; x <= maxX; x += step) {
							for (let y = minY + step / 2; y <= maxY; y += step) {
								if (!pointInRings(x, y, rings)) continue;
								// Closer to the outline than the data's own precision, a point
								// is both inside and out. The cap is stored as 32-bit floats,
								// which can round it either way. Okushiri, off Japan, drew one
								// sample 0.0005 degrees from its edge.
								if (Math.abs(signedDistance(x, y, rings)) < 0.001) continue;
								if (triangles.some(([a, b, c]) => inTriangle(x, y, a, b, c))) continue;
								failures.push(`${f.properties.name} at ${x.toFixed(2)},${y.toFixed(2)}`);
							}
						}
					}
				}
				expect(failures.slice(0, 8)).toEqual([]);
			});

			it('lets every region be picked somewhere inside it', () => {
				// A region nobody can tap cannot be mastered, so the quiz cannot be
				// won. The risk is an enclave. Vatican City and San Marino are holes
				// in Italy, and if simplification closed a hole, a tap there would
				// answer Italy. Filling Italy's holes makes this fail for both.
				const index = regionIndex(features);
				const unreachable = features
					.filter((f) => !polygonParts(f.geometry).some((rings) => pickedInside(index, f, rings)))
					.map((f) => f.properties.name);
				expect(unreachable).toEqual([]);
			});

			it('stays within valid latitude and longitude', () => {
				const walk = (c) => {
					if (typeof c[0] === 'number') {
						expect(Math.abs(c[0])).toBeLessThanOrEqual(180);
						expect(Math.abs(c[1])).toBeLessThanOrEqual(90);
						return;
					}
					c.forEach(walk);
				};
				features.forEach((f) => walk(f.geometry.coordinates));
			});
		});
	}
});

/**
 * Regions a submenu deliberately leaves out of its parts, by parent dataset.
 * M49's Northern America is Canada, the US, Greenland, Bermuda, and Saint
 * Pierre and Miquelon: too few for a quiz.
 */
const LEFT_OUT = { na: ['BMU', 'CAN', 'GRL', 'SPM', 'USA'] };

describe('submenus', () => {
	for (const item of NAV.filter((entry) => entry.children)) {
		const parent = REGIONS[item.href].dataset;
		const members = rosters[parent].members;

		describe(item.label, () => {
			const parts = item.children.map((child) => rosters[REGIONS[child.href].dataset].members);

			it('asks only about regions in the parent quiz, named the same', () => {
				for (const part of parts) {
					for (const [code, name] of Object.entries(part)) expect(members[code]).toBe(name);
				}
			});

			it('puts every region in exactly one part', () => {
				const counted = parts.flatMap((part) => Object.keys(part));
				expect(new Set(counted).size).toBe(counted.length);
				const expected = Object.keys(members).filter((code) => !LEFT_OUT[parent]?.includes(code));
				expect(counted.sort()).toEqual(expected.sort());
			});
		});
	}
});

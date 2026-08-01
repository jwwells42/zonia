import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { REGIONS } from './regions.js';
import { labelAnchors } from './labels.js';

const rosters = JSON.parse(readFileSync('scripts/rosters.json', 'utf8'));

/** Ray casting against a single ring. */
function inRing([x, y], ring) {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

/** True when a point is inside any part of a feature and in none of its holes. */
function inFeature(point, geometry) {
	const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
	return parts.some(
		([outer, ...holes]) => inRing(point, outer) && !holes.some((hole) => inRing(point, hole))
	);
}

const load = (dataset) => {
	const topology = JSON.parse(readFileSync(`static/geo/${dataset}.topo.json`, 'utf8'));
	return feature(topology, topology.objects[Object.keys(topology.objects)[0]]).features;
};

describe('built geodata', () => {
	it('has a dataset for every routed region', () => {
		for (const { dataset } of Object.values(REGIONS)) {
			expect(() => load(dataset)).not.toThrow();
		}
	});

	for (const [key, roster] of Object.entries(rosters)) {
		describe(key, () => {
			const features = load(key);
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

			it('puts every label anchor inside its own region', () => {
				// Against the real geometry, not a fixture. A label sitting in the
				// wrong country is the most visible way this can break, and it breaks
				// silently: the name still renders, just over a neighbour. Awkward
				// outlines are what catch it, so this has to run on the shipped data.
				const byName = new Map(features.map((f) => [f.properties.name, f.geometry]));
				for (const anchor of labelAnchors(features)) {
					const geometry = byName.get(anchor.name);
					expect(
						inFeature([anchor.lng, anchor.lat], geometry),
						`${anchor.name} anchor fell outside its region`
					).toBe(true);
				}
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

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { REGIONS } from './regions.js';
import { labelAnchors } from './labels.js';
import { regionIndex, regionAt } from './pick.js';

const rosters = JSON.parse(readFileSync('scripts/rosters.json', 'utf8'));

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
				// Against the real geometry, not a fixture. Two things break silently
				// here. A label sitting in the wrong country still renders, just over
				// a neighbour. A tap landing on the wrong country still scores, just
				// against the wrong answer. Both come down to the same question, and
				// both are worst on the awkward outlines a student finds hardest, so
				// this has to run on the shipped data.
				const index = regionIndex(features);
				for (const anchor of labelAnchors(features)) {
					expect(
						regionAt(index, anchor.lat, anchor.lng),
						`${anchor.name} anchor did not resolve to its own region`
					).toBe(anchor.name);
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

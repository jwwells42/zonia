import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { feature, mesh } from 'topojson-client';
import { capResolution, polygonParts } from './geo.js';

// three-conic-polygon-geometry reads a global THREE if there is one. There is
// not, under vitest, and it checks `window` before deciding.
globalThis.window = globalThis.window ?? /** @type {any} */ ({});
const { landGeometry, paintRange, borderGeometry } = await import('./landMesh.js');
const { default: GeoJsonGeometry } = await import('three-geojson-geometry');

// The world quiz, because it is the one this exists for.
const topology = JSON.parse(readFileSync('static/geo/world.topo.json', 'utf8'));
const object = topology.objects[Object.keys(topology.objects)[0]];
const features = feature(topology, object).features;

const RADIUS = 101;
const resolutionFor = (f) => capResolution(f.geometry, 5);
const { geometry, ranges } = landGeometry(features, { radius: RADIUS, resolutionFor });

describe('landGeometry', () => {
	it('gives every region its own run of vertices, with nothing left over', () => {
		// Recolouring writes to a region's range. A gap or an overlap means a
		// hover paints part of a neighbour, or leaves part of the region its old
		// colour.
		expect(ranges.size).toBe(features.length);
		const sorted = [...ranges.values()].sort((a, b) => a.start - b.start);
		let next = 0;
		for (const range of sorted) {
			expect(range.start).toBe(next);
			expect(range.count).toBeGreaterThan(0);
			next += range.count;
		}
		expect(next).toBe(geometry.getAttribute('position').count);
	});

	it('puts the caps at the radius it was given', () => {
		const position = geometry.getAttribute('position');
		for (let i = 0; i < position.count; i += 97) {
			const r = Math.hypot(position.getX(i), position.getY(i), position.getZ(i));
			expect(r).toBeCloseTo(RADIUS, 3);
		}
	});
});

describe('paintRange', () => {
	it('changes one region and leaves its neighbours alone', () => {
		const colors = geometry.getAttribute('color');
		const before = Float32Array.from(colors.array);
		const range = ranges.get('Luxembourg');
		paintRange(geometry, range, { r: 1, g: 0.5, b: 0.25 });

		for (let i = 0; i < colors.count; i++) {
			const inside = i >= range.start && i < range.start + range.count;
			const rgb = [colors.getX(i), colors.getY(i), colors.getZ(i)];
			if (inside) expect(rgb).toEqual([1, 0.5, 0.25]);
			else expect(rgb).toEqual([before[i * 3], before[i * 3 + 1], before[i * 3 + 2]]);
		}
	});
});

describe('borderGeometry', () => {
	it('draws a shared border once, not once per neighbour', () => {
		// Outlining every polygon draws each land border twice, one line from
		// each side. The TopoJSON mesh has each arc once, so it should come to
		// clearly fewer segments than the outlines it replaces.
		const borders = borderGeometry(mesh(topology, object), { radius: RADIUS, resolution: 5 });
		const outlines = features
			.flatMap((f) => polygonParts(f.geometry))
			.reduce((sum, rings) => {
				const outline = new GeoJsonGeometry({ type: 'Polygon', coordinates: rings }, RADIUS, 5);
				return sum + outline.index.count;
			}, 0);
		expect(borders.index.count).toBeGreaterThan(0);
		expect(borders.index.count).toBeLessThan(outlines * 0.8);
	});
});

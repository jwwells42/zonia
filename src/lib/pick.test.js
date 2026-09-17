import { describe, it, expect } from 'vitest';
import { regionIndex, regionAt } from './pick.js';

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

/** A ring, as `[[x, y], ...]`, for a square centred on lng/lat. */
const ring = (lng, lat, half) => square('', lng, lat, half).geometry.coordinates[0];

describe('regionAt', () => {
	const index = regionIndex([square('Alpha', 0, 0, 10), square('Beta', 40, 0, 5)]);

	it('finds the region under the point', () => {
		expect(regionAt(index, 0, 0)).toBe('Alpha');
		expect(regionAt(index, 0, 40)).toBe('Beta');
	});

	it('returns null out in the open', () => {
		expect(regionAt(index, 0, 25)).toBe(null);
	});

	it('picks the right one when two regions are near each other', () => {
		expect(regionAt(index, 4, 9)).toBe('Alpha');
		expect(regionAt(index, 4, 36)).toBe('Beta');
	});

	it('claims a near miss when given tolerance', () => {
		// A finger is wide and a small country can be a few pixels across.
		expect(regionAt(index, 0, 11)).toBe(null);
		expect(regionAt(index, 0, 11, 2)).toBe('Alpha');
	});

	it('still returns nothing when the miss is wide', () => {
		expect(regionAt(index, 0, 25, 2)).toBe(null);
	});

	it('prefers a direct hit to a near miss', () => {
		// Sitting inside Alpha but within tolerance of Beta's edge.
		const touching = regionIndex([square('Alpha', 0, 0, 10), square('Beta', 21, 0, 10)]);
		expect(regionAt(touching, 0, 9.5, 5)).toBe('Alpha');
	});

	it('takes the nearest region when several are in reach', () => {
		expect(regionAt(index, 0, 13, 30)).toBe('Alpha');
		expect(regionAt(index, 0, 30, 30)).toBe('Beta');
	});

	it('does not pick a region through its hole', () => {
		const donut = regionIndex([
			{
				properties: { name: 'Donut' },
				geometry: { type: 'Polygon', coordinates: [ring(0, 0, 10), ring(0, 0, 3)] }
			}
		]);
		expect(regionAt(donut, 0, 6)).toBe('Donut');
		expect(regionAt(donut, 0, 0)).toBe(null);
	});

	it('finds a region on any of its pieces', () => {
		const islands = regionIndex([
			{
				properties: { name: 'Alpha' },
				geometry: { type: 'MultiPolygon', coordinates: [[ring(0, 0, 10)], [ring(80, 0, 2)]] }
			}
		]);
		expect(regionAt(islands, 0, 0)).toBe('Alpha');
		expect(regionAt(islands, 0, 80)).toBe('Alpha');
	});

	it('ignores parts with no usable ring', () => {
		const degenerate = regionIndex([
			{
				properties: { name: 'Sliver' },
				geometry: {
					type: 'MultiPolygon',
					coordinates: [
						[
							[
								[0, 0],
								[1, 1]
							]
						],
						[ring(0, 0, 5)]
					]
				}
			}
		]);
		expect(regionAt(degenerate, 0, 0)).toBe('Sliver');
	});
});

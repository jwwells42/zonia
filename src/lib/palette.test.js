import { describe, it, expect } from 'vitest';
import { LAND, HOVER, CORRECT, WRONG, HINT } from './palette.js';

/**
 * Simulated dichromat vision, at full severity. Machado, Oliveira and Fernandes,
 * "A Physiologically-based Model for Simulation of Color Vision Deficiency",
 * IEEE TVCG 2009. The matrices apply to linear RGB.
 */
const VISION = {
	deuteranopia: [
		[0.367322, 0.860646, -0.227968],
		[0.280085, 0.672501, 0.047413],
		[-0.01182, 0.04294, 0.968881]
	],
	protanopia: [
		[0.152286, 1.052583, -0.204868],
		[0.114503, 0.786281, 0.099216],
		[-0.003882, -0.048116, 1.051998]
	]
};

/**
 * How far apart two colours must stay, as CIE76 ΔE. The old green and red were
 * 8 apart under deuteranopia. The current set's closest pair is 33.
 */
const MIN_DELTA_E = 25;

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function linearRgb(hex) {
	return [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
}

const clamp = (v) => Math.min(1, Math.max(0, v));

function simulate(rgb, matrix) {
	return matrix.map((row) => clamp(row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]));
}

/** Linear sRGB to CIE L*a*b*, D65 white. */
function lab([r, g, b]) {
	const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
	const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
	const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
	const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
	return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

const STATES = { LAND, HOVER, CORRECT, WRONG, HINT };

const pairs = Object.entries(STATES).flatMap(([nameA, a], i, all) =>
	all.slice(i + 1).map(([nameB, b]) => [`${nameA}/${nameB}`, a, b])
);

describe('quiz colours', () => {
	it.each(pairs)('%s are distinct with normal vision', (_, a, b) => {
		expect(deltaE(linearRgb(a), linearRgb(b))).toBeGreaterThanOrEqual(MIN_DELTA_E);
	});

	for (const [vision, matrix] of Object.entries(VISION)) {
		it.each(pairs)(`%s are distinct with ${vision}`, (_, a, b) => {
			const seenA = simulate(linearRgb(a), matrix);
			const seenB = simulate(linearRgb(b), matrix);
			expect(deltaE(seenA, seenB)).toBeGreaterThanOrEqual(MIN_DELTA_E);
		});
	}
});

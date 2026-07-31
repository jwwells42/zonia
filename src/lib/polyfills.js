/**
 * Runtime methods MapLibre needs that older Chromium does not have.
 *
 * Zonia runs on classroom hardware. Android smart panels and older Chromebooks
 * often ship a Chromium several years behind. MapLibre uses two methods that
 * would otherwise set a hard floor:
 *
 * - `Array.prototype.at`, Chrome 92, August 2021
 * - `Object.hasOwn`, Chrome 93, September 2021
 *
 * Both are called from `maplibre-gl-shared.mjs`, which runs on the main thread
 * *and* inside the map worker. A worker is a separate global scope, so this
 * module is imported in both places. See `maplibreWorker.js`.
 *
 * These are runtime methods, not syntax, so no build target can supply them.
 *
 * globe.gl and three.js need none of this. Only the MapLibre renderer does.
 *
 * Import for side effects only, and import it first.
 */

const define = (target, name, value) => {
	if (target[name]) return;
	Object.defineProperty(target, name, { value, writable: true, configurable: true });
};

/** @param {number} index */
function at(index) {
	const i = Math.trunc(index) || 0;
	const from = i < 0 ? this.length + i : i;
	return from < 0 || from >= this.length ? undefined : this[from];
}

define(Array.prototype, 'at', at);
define(String.prototype, 'at', at);
define(Object, 'hasOwn', (object, key) => Object.prototype.hasOwnProperty.call(object, key));

<script>
	import { onMount, tick } from 'svelte';
	import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	// Installs Array.prototype.at and Object.hasOwn for the main thread. MapLibre
	// needs both and older classroom hardware lacks them.
	import './polyfills.js';
	/**
	 * MapLibre locates its worker with `new URL('./maplibre-gl-worker.mjs',
	 * import.meta.url)`. That path is assembled at runtime, so no bundler can see
	 * it: Vite inlines the library into a hashed chunk and the worker 404s beside
	 * it. Without a worker the map never fires 'load' and never errors. It just
	 * sits there.
	 *
	 * `?worker&url` is the fix rather than `?url`, because the worker itself
	 * imports `./maplibre-gl-shared.mjs`. Plain `?url` copies the one file without
	 * its dependency and the failure simply moves inside the worker, where it is
	 * invisible. `?worker` bundles the worker with everything it needs.
	 *
	 * The entry is our own shim, not MapLibre's worker directly, so the worker's
	 * separate global scope gets the polyfills too.
	 */
	import maplibreWorkerUrl from './maplibreWorker.js?worker&url';
	import { feature } from 'topojson-client';
	import Confetti from './Confetti.svelte';
	import { createQuiz } from './quiz.js';
	import { datasetUrl } from './regions.js';
	import { buildStyle, REGION_FILL_LAYER, boundsOf, zoomToFillGlobe } from './mapStyle.js';
	import starfield from '$lib/images/night-sky.webp';

	/**
	 * Same contract as Globe.svelte so the two are swappable behind one route.
	 * `pov` is accepted for that reason but only its centre is meaningful here.
	 * The opening zoom comes from fitting the data, not from globe.gl's camera
	 * altitude, which does not map onto MapLibre zoom by any stable factor.
	 */
	let {
		dataset,
		pov = [37, -95, 0.7],
		label = '',
		pixelRatio = Math.min(2, window.devicePixelRatio || 1)
	} = $props();

	/** Half-width of the tap box, in px. Gives fingers a margin on small regions. */
	const TAP_TOLERANCE = 8;
	const FEEDBACK_MS = 450;

	let containerEl;

	let score = $state(0);
	let learned = $state(0);
	let total = $state(0);
	let instruction = $state('Loading…');
	let ready = $state(false);
	let confetti = $state(false);
	let confettiAmount = $state(0);
	let won = $state(false);

	/**
	 * Hover label, matching what globe.gl puts on version A so the two can be
	 * compared fairly. Like A's, it names only regions the player has yet to
	 * learn. Once a region is mastered its label stops giving the answer away.
	 */
	let hoverLabel = $state('');
	let labelAt = $state({ x: 0, y: 0 });

	setWorkerUrl(maplibreWorkerUrl);

	let map;
	let quiz;
	let hoveredName = null;
	let feedbackTimer;

	/** feature-state is keyed by name thanks to promoteId, so no id bookkeeping. */
	const setState = (name, state) => map?.setFeatureState({ source: 'regions', id: name }, state);

	function setHover(name, point) {
		hoverLabel = name && !quiz.state.mastered(name) ? name : '';
		if (point) labelAt = { x: point.x, y: point.y };

		if (hoveredName === name) return;
		if (hoveredName) setState(hoveredName, { hover: false });
		hoveredName = name;
		if (name) setState(name, { hover: true });
	}

	function confettiCount() {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
		return window.innerWidth < 700 ? 60 : 200;
	}

	/** Resolves a pointer position to a region, allowing for imprecise taps. */
	function regionAt(point) {
		const box = [
			[point.x - TAP_TOLERANCE, point.y - TAP_TOLERANCE],
			[point.x + TAP_TOLERANCE, point.y + TAP_TOLERANCE]
		];
		const hits = map.queryRenderedFeatures(box, { layers: [REGION_FILL_LAYER] });
		return hits.length ? hits[0].id : null;
	}

	function answer(name) {
		if (won || !name) return;
		const result = quiz.click(name);

		score = quiz.state.score;
		learned = quiz.state.masteredCount;

		setState(name, result.correct ? { correct: true } : { wrong: true });
		// Drop the label the moment the region is learned, rather than leaving a
		// stale answer under a stationary cursor.
		if (hoveredName && quiz.state.mastered(hoveredName)) hoverLabel = '';

		clearTimeout(feedbackTimer);
		feedbackTimer = setTimeout(() => {
			setState(name, { correct: false, wrong: false });
			// A mastered region stays visibly dimmed so progress is readable.
			if (quiz.state.mastered(name)) setState(name, { learned: true });
		}, FEEDBACK_MS);

		if (result.won) {
			won = true;
			confettiAmount = confettiCount();
			confetti = confettiAmount > 0;
			instruction = 'WINNER!';
		} else if (result.correct) {
			instruction = `Good job. That was ${name}. Now find ${result.target}.`;
		} else {
			instruction = `That was ${name}. Find ${result.target}.`;
		}
	}

	onMount(() => {
		let cancelled = false;

		(async () => {
			const [regionsRes, landRes] = await Promise.all([
				fetch(datasetUrl(dataset)),
				fetch(datasetUrl('world'))
			]);
			if (!regionsRes.ok) throw new Error(`Could not load ${dataset}: ${regionsRes.status}`);
			const [regionsTopo, landTopo] = await Promise.all([regionsRes.json(), landRes.json()]);
			if (cancelled) return;

			const decode = (topo) => feature(topo, topo.objects[Object.keys(topo.objects)[0]]);
			const regions = decode(regionsTopo);

			quiz = createQuiz(regions.features.map((f) => f.properties.name));
			total = quiz.state.total;
			instruction = `Find ${quiz.state.target}!`;
			await tick();

			map = new MapLibreMap({
				container: containerEl,
				style: buildStyle(regions, decode(landTopo)),
				// Framed from the quiz's own data, so it is self-correcting from nine
				// northeastern states up to the whole world without a per-region zoom
				// to maintain.
				bounds: boundsOf(regions, pov[1]),
				fitBoundsOptions: { padding: 24 },
				// MapLibre takes the raw devicePixelRatio unless told otherwise. The
				// caller caps it to match globe.gl so the A/B is not decided by one
				// renderer drawing more pixels than the other.
				pixelRatio,
				attributionControl: false,
				// The quiz is about finding places, not surveying them.
				pitchWithRotate: false,
				dragRotate: false
			});

			// Never let the globe shrink to a marble. See zoomToFillGlobe.
			const { width, height } = containerEl.getBoundingClientRect();
			const fill = zoomToFillGlobe(width, height);
			if (map.getZoom() < fill) map.setZoom(fill);

			// MapLibre reports style and source failures through an event rather than
			// throwing, so without this a bad style just never finishes loading and
			// the player sits on the spinner with nothing explaining why.
			const failure = new Promise((_, reject) =>
				map.on('error', (e) => reject(e.error ?? new Error('Map failed to load')))
			);

			map.on('mousemove', REGION_FILL_LAYER, (e) => setHover(e.features[0]?.id ?? null, e.point));
			map.on('mouseleave', REGION_FILL_LAYER, () => setHover(null));
			map.on('click', (e) => answer(regionAt(e.point)));

			await Promise.race([new Promise((resolve) => map.once('load', resolve)), failure]);
			if (cancelled) return;
			ready = true;
		})().catch((err) => {
			instruction = `This map did not load. ${err.message}`;
			ready = true;
		});

		return () => {
			cancelled = true;
			clearTimeout(feedbackTimer);
			map?.remove();
			map = null;
		};
	});
</script>

{#if confetti}
	<div id="confetti-container" aria-hidden="true">
		<Confetti
			x={[-5, 5]}
			y={[0, 0.1]}
			delay={[500, 2000]}
			amount={confettiAmount}
			infinite
			fallDistance="100vh"
		/>
	</div>
{/if}

<div id="container" style:background-image="url({starfield})">
	<div id="hud">
		<p id="instruction" aria-live="polite">{instruction}</p>
		<p id="score">
			Score: {score}
			{#if total}
				<span class="muted">· {learned}/{total} learned</span>
			{/if}
		</p>
	</div>

	<div id="map" bind:this={containerEl}></div>

	{#if hoverLabel}
		<div class="tooltip" style:left="{labelAt.x}px" style:top="{labelAt.y}px">{hoverLabel}</div>
	{/if}

	{#if !ready}
		<div id="loading">
			<p class="loading-label">Loading {label || dataset}…</p>
			<div class="spinner"></div>
		</div>
	{/if}
</div>

<style>
	#container {
		position: relative;
		width: 100%;
		height: calc(100svh - var(--header-height));
		overflow: hidden;
		background-color: var(--night);
		background-size: cover;
		background-position: center;
	}

	#map {
		width: 100%;
		height: 100%;
		/* The map claims every gesture, so dragging the globe cannot scroll the
		   page or trigger pull-to-refresh. */
		touch-action: none;
	}

	/* Let the starfield behind the canvas show through around the globe. */
	#map :global(.maplibregl-canvas) {
		background: transparent;
	}

	/* Deliberately mirrors globe.gl's own tooltip (float-tooltip) so the A/B is
	   not decided by one version having nicer labels than the other. */
	.tooltip {
		position: absolute;
		z-index: 1;
		width: max-content;
		max-width: max(50%, 150px);
		padding: 3px 5px;
		border-radius: 3px;
		font-size: 12px;
		color: #eee;
		background: rgba(0, 0, 0, 0.6);
		pointer-events: none;
		/* Sits above the pointer, so a finger does not cover its own label. */
		transform: translate(-50%, calc(-100% - 12px));
	}

	#hud {
		position: absolute;
		z-index: 1;
		top: 0;
		left: 0;
		max-width: min(30rem, calc(100% - 2rem));
		padding: 0.5rem max(1rem, env(safe-area-inset-right)) 0.5rem
			max(1rem, env(safe-area-inset-left));
		color: var(--ink);
		/* A step heavier than body text, to hold up over the stars. */
		font-weight: 500;
		pointer-events: none;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
	}

	#instruction {
		margin: 0;
		font-size: clamp(1.1rem, 3.5vw, 2rem);
		line-height: 1.25;
	}

	#score {
		margin: 0.25rem 0 0;
		font-size: clamp(0.9rem, 2.2vw, 1.5rem);
	}

	.muted {
		opacity: 0.75;
	}

	#loading {
		position: absolute;
		inset: 0;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		background: var(--night);
		color: var(--ink);
	}

	.loading-label {
		margin: 0;
		font-size: 1.1rem;
	}

	.spinner {
		width: 2rem;
		height: 2rem;
		border: 3px solid rgba(255, 255, 255, 0.15);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 900ms linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}

	#confetti-container {
		position: fixed;
		top: -50px;
		left: 0;
		height: 100vh;
		width: 100vw;
		display: flex;
		justify-content: center;
		overflow: hidden;
		z-index: 2;
		pointer-events: none;
	}
</style>

<script>
	import { onMount, tick } from 'svelte';
	import GlobeGL from 'globe.gl';
	// MeshBasic, not Lambert: this is what three-globe builds its own default cap
	// material from, so the unlit look of the original polygons is preserved.
	import { MeshBasicMaterial } from 'three';
	import { feature } from 'topojson-client';
	import Confetti from './Confetti.svelte';
	import { createQuiz } from './quiz.js';
	import { datasetUrl } from './regions.js';
	import globeSkin from '$lib/images/earth-night.webp';
	import globeBackground from '$lib/images/night-sky.webp';

	let { dataset, pov = [37, -95, 0.7], label = '' } = $props();

	const CAP = '#4682b4'; // steelblue
	const CAP_HOVER = '#f58622';
	const CAP_CORRECT = '#3fb950';
	const CAP_WRONG = '#d9534f';

	/**
	 * Regions lie flat on the globe rather than standing proud of it.
	 *
	 * three-globe decides whether to build side-wall geometry purely from whether
	 * a side colour is set (`hasSide = !!(sideColor || sideMaterial)` gates
	 * `includeSides` on ConicPolygonGeometry). Measured on these datasets, those
	 * walls were ~67% of every triangle. 34,507 down to 11,381 for `world`. Triangle
	 * count drives both load tessellation and per-pointer-move raycasting.
	 *
	 * Small islands look better for it too: Hawaii and the Aleutians used to be
	 * mostly side wall seen edge-on, which read as smears hanging past the globe's
	 * silhouette rather than as land.
	 *
	 * The altitude is not quite zero. It lifts the caps clear of the globe sphere
	 * so the two do not z-fight.
	 */
	const ALTITUDE = 0.01;

	let globeEl;
	let containerEl;

	// Only values the template renders are $state. Everything globe.gl touches
	// stays a plain variable. Svelte 5's deep proxies would wrap thousands of
	// GeoJSON coordinate arrays and make every render path allocate.
	let score = $state(0);
	let learned = $state(0);
	let total = $state(0);
	let instruction = $state('Loading…');
	let progress = $state(0);
	let ready = $state(false);
	let confetti = $state(false);
	let confettiAmount = $state(0);
	let won = $state(false);

	let quiz;
	let world;
	let hovered = null;
	/**
	 * Transient per-polygon click feedback: name -> 'correct' | 'wrong'.
	 * Deliberately a plain Map, not a SvelteMap. Nothing in the template reads
	 * it, and the repaint it drives is pushed to three.js by hand. Reactivity here
	 * would only add proxy overhead on a hot path.
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	let flash = new Map();
	let flashTimer;

	// One material per visual state, shared by every polygon. three-globe re-runs
	// its whole polygon digest whenever a colour accessor changes, so handing it
	// stable material instances keeps that pass from rebuilding colours object by
	// object on every pointer move.
	const capMaterials = {
		base: new MeshBasicMaterial({ color: CAP }),
		hover: new MeshBasicMaterial({ color: CAP_HOVER }),
		correct: new MeshBasicMaterial({ color: CAP_CORRECT }),
		wrong: new MeshBasicMaterial({ color: CAP_WRONG })
	};

	const nameOf = (polygon) => polygon.properties.name;

	/**
	 * Each confetto is a DOM node running two infinite CSS animations. The
	 * original 500 of them are a slideshow on a phone, so scale to the screen and
	 * skip them entirely for anyone who asked for less motion.
	 */
	function confettiCount() {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
		return window.innerWidth < 700 ? 60 : 200;
	}

	function materialFor(polygon) {
		const name = nameOf(polygon);
		const flashed = flash.get(name);
		if (flashed) return capMaterials[flashed];
		if (polygon === hovered) return capMaterials.hover;
		return capMaterials.base;
	}

	/** Re-runs the cap-material accessor without allocating a new closure. */
	const repaint = () => world?.polygonCapMaterial(materialFor);

	/**
	 * Curvature resolution is the angular step three-conic-polygon-geometry
	 * subdivides caps at, so it trades triangles against how round a wide polygon
	 * looks. Zoomed-in quizzes get a coarser step than the 5° default because no
	 * single state spans enough longitude to bend visibly. Never go below the
	 * default: the pulled-back views are also the ones with the most polygons, so
	 * finer subdivision there costs the most and buys the least.
	 */
	const curvatureFor = (altitude) => (altitude >= 1.3 ? 5 : altitude >= 0.9 ? 7 : 9);

	/** globe.gl sizes itself to the window once at construction and never again. */
	function fit() {
		if (!world || !containerEl) return;
		const { width, height } = containerEl.getBoundingClientRect();
		if (width && height) world.width(width).height(height);
	}

	function showFeedback(name, kind) {
		flash.set(name, kind);
		repaint();
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => {
			flash.clear();
			repaint();
		}, 450);
	}

	function handleClick(polygon) {
		if (won) return;
		const name = nameOf(polygon);
		const result = quiz.click(name);

		score = quiz.state.score;
		learned = quiz.state.masteredCount;
		showFeedback(name, result.correct ? 'correct' : 'wrong');

		if (result.won) {
			won = true;
			confettiAmount = confettiCount();
			confetti = confettiAmount > 0;
			instruction = 'WINNER!';
		} else if (result.correct) {
			instruction = `Good job. That was ${name}. Now find ${result.target}.`;
		} else {
			// On touch there is no hover, so naming what was actually tapped is the
			// only feedback the player gets about where their finger landed.
			instruction = `That was ${name}. Find ${result.target}.`;
		}
	}

	onMount(() => {
		let resizeObserver;
		let cancelled = false;

		(async () => {
			// Each await yields to the browser so the loading overlay actually
			// paints before the next blocking step rather than after all of them.
			const res = await fetch(datasetUrl(dataset));
			if (!res.ok) throw new Error(`Could not load ${dataset}: ${res.status}`);
			const topology = await res.json();
			if (cancelled) return;

			const collection = feature(topology, topology.objects[Object.keys(topology.objects)[0]]);
			const polygons = collection.features;
			quiz = createQuiz(polygons.map(nameOf));
			total = quiz.state.total;

			progress = 0.35;
			instruction = `Find ${quiz.state.target}!`;
			await tick();

			// Decode textures up front. Left to globe.gl these load after first
			// paint and pop in mid-game.
			await Promise.all(
				[globeSkin, globeBackground].map(
					(src) =>
						new Promise((resolve) => {
							const img = new Image();
							img.onload = () => img.decode().then(resolve, resolve);
							img.onerror = resolve;
							img.src = src;
						})
				)
			);
			if (cancelled) return;

			progress = 0.6;
			await tick();

			world = new GlobeGL(globeEl)
				.pointOfView({ lat: pov[0], lng: pov[1], altitude: pov[2] }, 0)
				.globeImageUrl(globeSkin)
				.backgroundImageUrl(globeBackground)
				// Without this every accessor change spawns a Tween per polygon,
				// which on a hover-driven accessor means allocating on every frame
				// the pointer moves.
				.polygonsTransitionDuration(0)
				.polygonCapCurvatureResolution(curvatureFor(pov[2]))
				.polygonAltitude(ALTITUDE)
				// Falsy on purpose. This is what stops the side geometry being built.
				.polygonSideColor(() => null)
				.polygonStrokeColor(() => '#111')
				.polygonCapMaterial(materialFor)
				.polygonLabel((polygon) =>
					quiz.state.mastered(nameOf(polygon))
						? ''
						: `<p style="font-family: Poppins; font-size: 1em">${nameOf(polygon)}</p>`
				)
				.onPolygonHover((polygon) => {
					if (hovered === polygon) return;
					hovered = polygon;
					repaint();
				})
				.onPolygonClick(handleClick);

			fit();
			world.polygonsData(polygons);

			progress = 0.85;
			await tick();

			// onGlobeReady fires once three-globe's own texture load resolves. Cap the
			// wait so a blocked or corrupt image degrades to a plain globe rather
			// than stranding the player on the loading screen.
			await Promise.race([
				new Promise((resolve) => world.onGlobeReady(resolve)),
				new Promise((resolve) => setTimeout(resolve, 5000))
			]);
			if (cancelled) return;

			progress = 1;
			ready = true;

			resizeObserver = new ResizeObserver(() => fit());
			resizeObserver.observe(containerEl);
		})().catch((err) => {
			instruction = `This map did not load. ${err.message}`;
			ready = true;
		});

		return () => {
			cancelled = true;
			clearTimeout(flashTimer);
			resizeObserver?.disconnect();
			// Without this, switching regions leaks a WebGL context and its
			// textures each time. The old code sidestepped it by forcing a full
			// page reload on every nav.
			world?._destructor?.();
			for (const material of Object.values(capMaterials)) material.dispose();
			world = null;
		};
	});
</script>

<svelte:head>
	<link rel="preload" as="image" href={globeSkin} />
	<link rel="preload" as="image" href={globeBackground} />
</svelte:head>

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

<div id="container" bind:this={containerEl}>
	<div id="hud">
		<p id="instruction" aria-live="polite">{instruction}</p>
		<p id="score">
			Score: {score}
			{#if total}
				<span class="muted">· {learned}/{total} learned</span>
			{/if}
		</p>
	</div>

	<div id="globe" bind:this={globeEl}></div>

	{#if !ready}
		<div id="loading">
			<p class="loading-label">Loading {label || dataset}…</p>
			<div class="bar"><div class="fill" style:width="{Math.round(progress * 100)}%"></div></div>
		</div>
	{/if}
</div>

<style>
	#container {
		position: relative;
		width: 100%;
		/* The header is in normal flow above this, so the globe gets what's left.
		   svh tracks the collapsing mobile URL bar; vh would overflow behind it. */
		height: calc(100svh - var(--header-height));
		overflow: hidden;
	}

	#globe {
		width: 100%;
		height: 100%;
		/* Claim every gesture for the globe, so dragging it can't scroll the page
		   or trigger pull-to-refresh. */
		touch-action: none;
	}

	#hud {
		position: absolute;
		z-index: 1;
		top: 0;
		left: 0;
		max-width: min(30rem, calc(100% - 2rem));
		padding: 0.5rem max(1rem, env(safe-area-inset-right)) 0.5rem
			max(1rem, env(safe-area-inset-left));
		color: white;
		pointer-events: none;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
	}

	#instruction {
		margin: 0;
		font-family: Poppins, sans-serif;
		font-size: clamp(1.1rem, 3.5vw, 2rem);
		line-height: 1.25;
	}

	#score {
		margin: 0.25rem 0 0;
		font-family: Poppins-500, sans-serif;
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
		background: #060a18;
		color: white;
		font-family: Poppins, sans-serif;
	}

	.loading-label {
		margin: 0;
		font-size: 1.1rem;
	}

	.bar {
		width: min(18rem, 60vw);
		height: 6px;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.15);
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: #f58622;
		transition: width 200ms ease-out;
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

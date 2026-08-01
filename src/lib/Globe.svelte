<script>
	import { onMount, tick } from 'svelte';
	import GlobeGL from 'globe.gl';
	// MeshBasic, not Lambert: this is what three-globe builds its own default cap
	// material from, so the unlit look of the original polygons is preserved.
	import { MeshBasicMaterial } from 'three';
	import { feature } from 'topojson-client';
	import Confetti from './Confetti.svelte';
	import { createQuiz } from './quiz.js';
	import { labelAnchors, placeLabels } from './labels.js';
	import { datasetUrl } from './regions.js';
	import globeSkin from '$lib/images/earth-night.webp';
	import globeBackground from '$lib/images/night-sky.webp';

	let {
		dataset,
		pov = [37, -95, 0.7],
		label = '',
		pixelRatio = Math.min(2, window.devicePixelRatio || 1),
		/**
		 * Starting state for region names, from `?labels`. The in-quiz button
		 * overrides it from here on, so a teacher's link sets the opening position
		 * without locking a student out of changing it.
		 */
		labels = true,
		/** Set false to drop the atmosphere glow and antialiasing. See `?fx=off`. */
		effects = true
	} = $props();

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

	/** Must match the .region-label rule below, since text is measured against it. */
	const LABEL_FONT = '12px Poppins, sans-serif';
	/** Horizontal and vertical padding on a label box, from the same rule. */
	const LABEL_PADDING = [8, 8];

	/**
	 * Real text metrics for a name, so collision uses the box that will actually
	 * be drawn.
	 *
	 * Guessing a width from a character count is guessing twice over: too narrow
	 * and labels overlap on screen after passing the collision test, too wide and
	 * names are dropped that would have fitted. A 2D context measures the same
	 * font the browser is about to lay out, and it runs once per region at load.
	 */
	function textMeasurer() {
		const ctx = document.createElement('canvas').getContext('2d');
		if (!ctx) return undefined;
		ctx.font = LABEL_FONT;
		return (name) => {
			const m = ctx.measureText(name);
			// Ascent and descent give the real cap-to-tail height of this string,
			// which is tighter and truer than assuming a line box.
			const height = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
			return {
				width: m.width + LABEL_PADDING[0],
				height: (height || 12) + LABEL_PADDING[1]
			};
		};
	}

	/**
	 * How often label positions are recomputed while the globe is moving.
	 *
	 * Projecting every anchor and packing the survivors is far too much to do on
	 * every frame, and it does not need to be. Labels trailing the globe by a
	 * fraction of a second during a spin is invisible; a frame rate drop while
	 * dragging is exactly what this app cannot afford.
	 */
	const LABEL_INTERVAL_MS = 90;

	/**
	 * Stable reference for "no labels", so turning them off repeatedly assigns the
	 * same array and Svelte skips the update instead of re-rendering nothing.
	 */
	const NO_LABELS = Object.freeze([]);

	/** Placed labels, in screen coordinates. The one globe value the template reads. */
	let regionLabels = $state(NO_LABELS);
	/**
	 * Whether names are showing.
	 *
	 * Writable derived, so the URL sets the opening position and the button
	 * overrides it from there. Navigating to a link that specifies `?labels`
	 * re-derives and wins again, which is what a teacher handing out a link
	 * expects.
	 */
	let labelsOn = $derived(labels);
	/** Plain, not $state: thousands of coordinates went into these. */
	let anchors = [];
	let labelTimer;

	function updateLabels() {
		if (!world || !containerEl || !quiz) return;
		if (!labelsOn) {
			regionLabels = NO_LABELS;
			return;
		}

		const { width, height } = containerEl.getBoundingClientRect();
		// The camera always looks at the origin, so its position doubles as the
		// direction the visible hemisphere faces.
		const { x, y, z } = world.camera().position;
		const length = Math.hypot(x, y, z) || 1;

		regionLabels = placeLabels({
			anchors,
			project: (lat, lng) => world.getScreenCoords(lat, lng),
			cameraDir: { x: x / length, y: y / length, z: z / length },
			viewport: { width, height },
			shouldLabel: (name) => quiz.state.scaffolded(name),
			// "Find Germany" over a map showing every name but Germany's reads as
			// Germany not being in the quiz.
			priority: quiz.state.target
		});
	}

	// Repack whenever names are switched on or off, from either source. Doing it
	// here rather than in the click handler means the globe is never rebuilt.
	$effect(() => {
		labelsOn;
		updateLabels();
	});

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
		updateLabels();
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
		// A correct click is what retires a region's name, so the labels have to be
		// repacked: losing one frees space a crowded-out neighbour can now use.
		updateLabels();

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
		let cleanUpControls;
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
			// One pass over the geometry, here rather than per frame.
			anchors = labelAnchors(polygons, { measure: textMeasurer() });

			progress = 0.35;
			instruction = `Find ${quiz.state.target}!`;
			await tick();

			// Decode the globe texture up front. Left to globe.gl it loads after
			// first paint and pops in mid-game. The starfield is a CSS background
			// now, so the browser fetches it alongside without our help.
			await new Promise((resolve) => {
				const img = new Image();
				img.onload = () => img.decode().then(resolve, resolve);
				img.onerror = resolve;
				img.src = globeSkin;
			});
			if (cancelled) return;

			progress = 0.6;
			await tick();

			world = new GlobeGL(globeEl, {
				// Antialiasing is on by default in three-render-objects. Off is worth
				// measuring on a weak mobile GPU, where it can cost real frames.
				rendererConfig: { antialias: effects }
			})
				.pointOfView({ lat: pov[0], lng: pov[1], altitude: pov[2] }, 0)
				.globeImageUrl(globeSkin)
				/**
				 * The starfield is a CSS background behind a transparent canvas, not a
				 * `backgroundImageUrl`. That option wraps the whole scene in a second,
				 * enormous textured sphere which repaints every pixel of the viewport
				 * every frame, to show a backdrop that never moves. CSS draws it once.
				 * MapGlobe.svelte has always done it this way; this brings the two in
				 * line. The Earth itself is still `globeImageUrl` above.
				 */
				.backgroundColor('rgba(0,0,0,0)')
				// A large alpha-blended sphere around the globe. Pretty, and blending
				// over that area is not free on a mobile GPU.
				.showAtmosphere(effects)
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
				// No polygonLabel. Names are drawn on the map by updateLabels instead
				// of following the pointer, because hover does not exist on a touch
				// panel and that is where this is used.
				.onPolygonHover((polygon) => {
					if (hovered === polygon) return;
					hovered = polygon;
					repaint();
				})
				.onPolygonClick(handleClick);

			// three-render-objects sets this to Math.min(2, devicePixelRatio) at
			// construction and offers no option for it, so it is overridden after the
			// fact. Everything the globe draws is fill-rate work, so this number is
			// the largest single lever on frame rate.
			world.renderer().setPixelRatio(pixelRatio);

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

			/**
			 * Labels follow the camera on a timer rather than on every frame.
			 *
			 * OrbitControls fires `change` continuously through a drag, and the work
			 * behind each update is a projection per region plus a collision pass.
			 * Doing that 60 times a second on a classroom panel would cost more frames
			 * than the labels are worth. `end` gives the settled positions once the
			 * globe stops, so the throttle is never the last word.
			 */
			const controls = world.controls();
			const onChange = () => {
				if (labelTimer) return;
				labelTimer = setTimeout(() => {
					labelTimer = null;
					updateLabels();
				}, LABEL_INTERVAL_MS);
			};
			controls.addEventListener('change', onChange);
			controls.addEventListener('end', updateLabels);
			cleanUpControls = () => {
				controls.removeEventListener('change', onChange);
				controls.removeEventListener('end', updateLabels);
			};

			updateLabels();

			resizeObserver = new ResizeObserver(() => fit());
			resizeObserver.observe(containerEl);
		})().catch((err) => {
			instruction = `This map did not load. ${err.message}`;
			ready = true;
		});

		return () => {
			cancelled = true;
			clearTimeout(flashTimer);
			clearTimeout(labelTimer);
			cleanUpControls?.();
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

<svelte:window onresize={updateLabels} />

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

<div id="container" bind:this={containerEl} style:background-image="url({globeBackground})">
	<div id="hud">
		<p id="instruction" aria-live="polite">{instruction}</p>
		<p id="score">
			Score: {score}
			{#if total}
				<span class="muted">· {learned}/{total} learned</span>
			{/if}
		</p>
		<button id="labels-toggle" onclick={() => (labelsOn = !labelsOn)} aria-pressed={labelsOn}>
			{labelsOn ? 'Hide names' : 'Show names'}
		</button>
	</div>

	<div id="globe" bind:this={globeEl}></div>

	<!-- Names are plain DOM text, not geometry on the globe. three-globe's label
	     layer builds a TextGeometry per label from a typeface font, which on the
	     world quiz would be 177 more meshes and 177 more draw calls on hardware
	     already short of both. Text nodes also stay crisp and can be read aloud
	     by a screen reader, which a canvas never can. -->
	{#each regionLabels as region (region.name)}
		<span class="region-label" style:left="{region.x}px" style:top="{region.y}px">
			{region.name}
		</span>
	{/each}

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
		/* The starfield, which used to be a scene-sized sphere inside WebGL. It
		   never moves, so painting it once in CSS beats redrawing every pixel of
		   it on every frame. */
		background-color: #060a18;
		background-size: cover;
		background-position: center;
	}

	/* Let the starfield show through around the globe. */
	#globe :global(canvas) {
		background: transparent;
	}

	#labels-toggle {
		/* #hud ignores pointer events so drags pass through to the globe. This is
		   the one thing in it that has to be clickable. */
		pointer-events: auto;
		margin-top: 0.4rem;
		/* Comfortably over the 44px touch target minimum, since the people using
		   this are often standing at a wall panel. */
		min-height: 44px;
		padding: 0 0.9rem;
		border: 1px solid rgba(255, 255, 255, 0.35);
		border-radius: 6px;
		background: rgba(6, 10, 24, 0.6);
		color: white;
		font-family: Poppins, sans-serif;
		font-size: 0.9rem;
		cursor: pointer;
	}

	#labels-toggle:hover,
	#labels-toggle:focus-visible {
		background: rgba(20, 38, 57, 0.85);
	}

	.region-label {
		position: absolute;
		z-index: 1;
		/* Centred on the region rather than hanging off it, because there is no
		   pointer to avoid. Nothing here is interactive; taps go to the globe. */
		transform: translate(-50%, -50%);
		padding: 1px 4px;
		border-radius: 3px;
		/* Kept in step with LABEL_FONT and LABEL_PADDING, which collision uses. */
		font:
			12px Poppins,
			sans-serif;
		line-height: 1.4;
		white-space: nowrap;
		color: #fff;
		background: rgba(0, 0, 0, 0.45);
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
		pointer-events: none;
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

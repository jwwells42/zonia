<script>
	import { onMount, tick } from 'svelte';
	import GlobeGL from 'globe.gl';
	// MeshBasic, not Lambert: this is what three-globe built its own cap material
	// from, so the unlit look of the original polygons is preserved.
	import {
		Color,
		DoubleSide,
		LineBasicMaterial,
		LineSegments,
		Mesh,
		MeshBasicMaterial,
		Raycaster,
		Sphere,
		Vector2,
		Vector3
	} from 'three';
	import { feature, mesh } from 'topojson-client';
	import Confetti from './Confetti.svelte';
	import { createQuiz } from './quiz.js';
	import { regionIndex, regionAt } from './pick.js';
	import { capResolution } from './geo.js';
	import { datasetUrl } from './regions.js';
	import { borderGeometry, landGeometry, paintRange } from './landMesh.js';
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
	 * `landGeometry` builds caps with no side walls. Measured on these datasets,
	 * those walls were ~67% of every triangle. 34,507 down to 11,381 for `world`.
	 *
	 * Small islands look better for it too: Hawaii and the Aleutians used to be
	 * mostly side wall seen edge-on, which read as smears hanging past the globe's
	 * silhouette rather than as land.
	 *
	 * The altitude is not quite zero. It lifts the caps clear of the globe sphere
	 * so the two do not z-fight.
	 */
	const ALTITUDE = 0.01;

	/**
	 * How far the borders sit above the caps, as a fraction of the globe radius.
	 * The same lift three-globe gave its outlines, so they are never hidden in
	 * the cap they outline.
	 */
	const BORDER_LIFT = 1e-4;
	const BORDER = '#111';

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
	/** Name of the region under the pointer, from `regionUnder`. */
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
	/** Bounding-boxed geometry for resolving a tap to a region. Plain, not $state. */
	let regions = [];

	/**
	 * The land and borders, as two meshes for the whole quiz. See landMesh.js.
	 * Plain, not $state: it holds every vertex on the map.
	 */
	let land = null;

	/** One colour per visual state. `Color` converts to the linear values three.js draws with. */
	const capColors = {
		base: new Color(CAP),
		hover: new Color(CAP_HOVER),
		correct: new Color(CAP_CORRECT),
		wrong: new Color(CAP_WRONG)
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

	function colorOf(name) {
		const flashed = flash.get(name);
		if (flashed) return capColors[flashed];
		if (name === hovered) return capColors.hover;
		return capColors.base;
	}

	/**
	 * Repaints one region to match its state. Only that region's vertices are
	 * rewritten and uploaded, so a hover costs the size of one country.
	 */
	function repaint(name) {
		const range = name && land?.ranges.get(name);
		if (range) paintRange(land.geometry, range, colorOf(name));
	}

	/**
	 * Whether pointing at a region shows its name.
	 *
	 * Writable derived, so the URL sets the opening position and the button
	 * overrides it from there. Navigating to a link that specifies `?labels`
	 * re-derives and wins again, which is what a teacher handing out a link
	 * expects.
	 */
	let labelsOn = $derived(labels);

	/**
	 * The one name on screen, if any: `{ name, x, y, touch }` in canvas pixels.
	 *
	 * Names are shown on demand, one at a time, for the region being pointed at.
	 * Standing names for every region were tried and taken out. They cluttered the
	 * world view, and moving eighty of them on every frame of a drag cost frames
	 * the panel did not have.
	 */
	let peek = $state(null);

	/** Where the hold ring is drawn while a finger is held down, or null. */
	let hold = $state(null);

	/** Shown under the score, because holding to answer is not something anyone guesses. */
	const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
	let hint = $derived(
		coarsePointer
			? labelsOn
				? 'Tap to see a name. Hold to answer.'
				: 'Hold to answer.'
			: 'Click to answer.'
	);

	/**
	 * Where the name sits relative to the pointer, in CSS pixels. Clear of the
	 * hold ring above a finger, and clear of the arrow beside a cursor.
	 */
	const PEEK_ABOVE_FINGER_PX = 52;
	const PEEK_BESIDE_CURSOR_PX = 16;

	/**
	 * Lights a region and, while it is still being learned, names it.
	 *
	 * The highlight always shows, so a player can see what they are about to
	 * answer. The name follows the same rule the quiz uses: gone once the region
	 * has been found once, so the second find is from memory.
	 */
	function showPeek(name, clientX, clientY, touch) {
		setHover(name);
		if (!name || !labelsOn || !quiz?.state.scaffolded(name)) {
			peek = null;
			return;
		}
		const rect = globeEl.getBoundingClientRect();
		peek = { name, x: clientX - rect.left, y: clientY - rect.top, touch };
	}

	function clearPeek() {
		setHover(null);
		peek = null;
	}

	function toggleNames() {
		labelsOn = !labelsOn;
		if (!labelsOn) peek = null;
	}

	/**
	 * Curvature resolution is the angular step three-conic-polygon-geometry
	 * subdivides caps at, so it trades triangles against how round a wide polygon
	 * looks. Zoomed-in quizzes get a coarser step than the 5° default because no
	 * single state spans enough longitude to bend visibly. Never go below the
	 * default: the pulled-back views are also the ones with the most polygons, so
	 * finer subdivision there costs the most and buys the least.
	 */
	const curvatureFor = (altitude) => (altitude >= 1.3 ? 5 : altitude >= 0.9 ? 7 : 9);

	/** See `capResolution`: small regions get an exact cap, wide ones a subdivided one. */
	const capResolutionFor = (polygon) => capResolution(polygon.geometry, curvatureFor(pov[2]));

	/**
	 * The whole map as two meshes: every cap in one, every border in the other.
	 *
	 * three-globe's polygon layer made a cap mesh and an outline per region part,
	 * which on the world quiz is 720 draw calls a frame. On weak hardware frame
	 * rate followed that number and nothing else. This is 2.
	 *
	 * Only the regions' vertices ever change after this, and only their colour.
	 */
	function buildLand(polygons, topology, object) {
		const radius = world.getGlobeRadius();
		const { geometry, ranges } = landGeometry(polygons, {
			radius: radius * (1 + ALTITUDE),
			resolutionFor: capResolutionFor
		});
		const borders = borderGeometry(mesh(topology, object), {
			radius: radius * (1 + ALTITUDE + BORDER_LIFT),
			resolution: curvatureFor(pov[2])
		});
		land = {
			geometry,
			ranges,
			caps: new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide })),
			borders: new LineSegments(borders, new LineBasicMaterial({ color: BORDER }))
		};
		for (const name of ranges.keys()) repaint(name);
		world.scene().add(land.caps, land.borders);
	}

	/** globe.gl sizes itself to the window once at construction and never again. */
	function fit() {
		if (!world || !containerEl) return;
		const { width, height } = containerEl.getBoundingClientRect();
		if (width && height) world.width(width).height(height);
	}

	function showFeedback(name, kind) {
		flash.set(name, kind);
		repaint(name);
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => {
			const flashed = [...flash.keys()];
			flash.clear();
			for (const each of flashed) repaint(each);
		}, 450);
	}

	function answer(name) {
		if (won) return;
		const result = quiz.click(name);

		score = quiz.state.score;
		learned = quiz.state.masteredCount;
		showFeedback(name, result.correct ? 'correct' : 'wrong');
		// A correct answer retires the region's name, so the one on screen may
		// now be wrong. The next hover or tap asks again.
		peek = null;

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

	/**
	 * How far a finger may slide and still count as a tap, in CSS pixels.
	 *
	 * Generous, because the people using this are standing at a wall panel and
	 * pressing it with a whole fingertip. Nothing is lost by being generous: a
	 * real drag moves far further than this in the first frame.
	 */
	const TAP_SLOP_PX = 12;

	/**
	 * How far off a region a tap may land and still count as hitting it, in CSS
	 * pixels. Applied only when the tap hit no region at all.
	 */
	const TAP_TOLERANCE_PX = 8;

	/**
	 * Ceiling on that tolerance once it is converted to degrees.
	 *
	 * Near the limb a degree of latitude compresses to almost no pixels, so the
	 * conversion runs away and a tap in open water could claim a country a long
	 * way inland. Beyond this the slack is simply not offered.
	 */
	const MAX_TAP_TOLERANCE_DEG = 4;

	/**
	 * How long a finger must stay down to answer, in milliseconds.
	 *
	 * On touch a tap only shows a name, and holding answers. That gives a finger
	 * what hover gives a mouse: a way to look before committing. It is long on
	 * purpose. The players are young, they are standing at a wall panel, and a
	 * name wants reading before the answer goes in. The ring under the finger
	 * shows it filling, so nobody lets go wondering what is happening.
	 */
	const HOLD_MS = 1000;

	/**
	 * The pointer currently down, while it can still be a tap or a hold:
	 * `{ id, x, y, touch, name }`. Null once it has moved far enough to be a drag.
	 */
	let press = null;
	let holdTimer;
	/** Fingers on the glass. A second one means a pinch, never a tap. */
	let pointersDown = 0;

	/**
	 * The tap tolerance in degrees at the point tapped.
	 *
	 * Degrees per pixel changes with the camera altitude and with where on the
	 * globe you are, so it is measured rather than assumed: project a one degree
	 * step and see how far it moved. The step is towards the equator so it cannot
	 * run past a pole.
	 */
	function tapToleranceDegrees(lat, lng) {
		const here = world.getScreenCoords(lat, lng, ALTITUDE);
		const step = world.getScreenCoords(lat + (lat > 0 ? -1 : 1), lng, ALTITUDE);
		const pxPerDegree = Math.hypot(step.x - here.x, step.y - here.y);
		if (!(pxPerDegree > 0)) return 0;
		return Math.min(TAP_TOLERANCE_PX / pxPerDegree, MAX_TAP_TOLERANCE_DEG);
	}

	/**
	 * Where on the globe a screen point lands, on the surface the regions are
	 * actually drawn on.
	 *
	 * globe.gl's toGlobeCoords is not used for this. It raycasts to the bare
	 * globe sphere, which sits ALTITUDE below the regions. Away from the middle of
	 * the view the ray meets the drawn region first and then carries on towards
	 * the limb before reaching that sphere. Near the edge of the globe that is a
	 * degree or two, which put taps on a border into the country behind it: the
	 * region lit up under the pointer was not the one that got answered.
	 */
	// The origin and direction are placeholders. setFromCamera overwrites both.
	const raycaster = new Raycaster(new Vector3(), new Vector3());
	function surfaceAt(canvasX, canvasY) {
		const rect = globeEl.getBoundingClientRect();
		const pointer = new Vector2((canvasX / rect.width) * 2 - 1, -(canvasY / rect.height) * 2 + 1);
		raycaster.setFromCamera(pointer, world.camera());
		const surface = new Sphere(new Vector3(), world.getGlobeRadius() * (1 + ALTITUDE));
		const point = raycaster.ray.intersectSphere(surface, new Vector3());
		return point && world.toGeoCoords(point);
	}

	/**
	 * Which region is under a screen point. Null for sky or open water.
	 *
	 * The hover highlight and the answer both come through here, and that is the
	 * point of it. They used to be resolved two different ways: the answer by
	 * this route, the highlight by globe.gl's onPolygonHover, which raycasts the
	 * scene. Those two disagree near a border, because the raycaster also hits
	 * the polygon outlines, which three-globe raises above the caps and three.js
	 * picks with `params.Line.threshold` of 1. At a globe radius of 100 that is
	 * several screen pixels of invisible grab zone, and both neighbours draw an
	 * outline along a shared border. So the pointer lit one country and the click
	 * answered the other. One function cannot do that.
	 */
	function regionUnder(clientX, clientY) {
		if (!world || !globeEl || !regions.length) return null;
		const rect = globeEl.getBoundingClientRect();
		const hit = surfaceAt(clientX - rect.left, clientY - rect.top);
		if (!hit) return null;
		return regionAt(regions, hit.lat, hit.lng, tapToleranceDegrees(hit.lat, hit.lng));
	}

	/** Resolves a tap position to a region and plays it. */
	function answerAt(clientX, clientY) {
		if (won) return;
		const name = regionUnder(clientX, clientY);
		if (name) answer(name);
	}

	/** Hover picking runs no more often than this, as globe.gl's also did. */
	const HOVER_INTERVAL_MS = 50;
	let hoverAt = null;
	let hoverTimer;

	function setHover(name) {
		if (hovered === name) return;
		const previous = hovered;
		hovered = name;
		repaint(previous);
		repaint(name);
	}

	/** Ends a press that has not answered, and takes its ring away. */
	function cancelPress() {
		clearTimeout(holdTimer);
		holdTimer = null;
		press = null;
		hold = null;
	}

	function onPointerDown(event) {
		pointersDown++;
		if (pointersDown > 1) {
			// A second finger is a pinch. Nothing that finger does is an answer.
			cancelPress();
			clearPeek();
			return;
		}
		const touch = event.pointerType !== 'mouse';
		press = { id: event.pointerId, x: event.clientX, y: event.clientY, touch, name: null };
		if (!touch) return;

		// The finger lands and the region under it lights and is named at once, so
		// the player sees what they are about to answer before they commit to it.
		const name = regionUnder(event.clientX, event.clientY);
		press.name = name;
		showPeek(name, event.clientX, event.clientY, true);
		if (!name || won) return;

		const rect = globeEl.getBoundingClientRect();
		hold = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		holdTimer = setTimeout(() => {
			// The region lit when the finger landed, not whatever is under it now.
			// Anything that moved it far enough to matter already cancelled this.
			const chosen = press.name;
			cancelPress();
			clearPeek();
			answer(chosen);
		}, HOLD_MS);
	}

	function onPointerMove(event) {
		if (press && event.pointerId === press.id) {
			if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_SLOP_PX) {
				// A drag. A name pinned to where the finger was would be left behind
				// over whatever the globe turns under it.
				if (press.touch) clearPeek();
				cancelPress();
			}
		}

		if (event.pointerType !== 'mouse') return;
		hoverAt = { x: event.clientX, y: event.clientY };
		// The name follows the cursor every move. Only working out which region is
		// under it is throttled, and that is where the cost is.
		if (peek) {
			const rect = globeEl.getBoundingClientRect();
			peek = { ...peek, x: hoverAt.x - rect.left, y: hoverAt.y - rect.top };
		}
		// Never pick while a button is down. That is a drag, and on a classroom
		// panel the frames are worth more than the highlight.
		if (pointersDown || hoverTimer) return;
		hoverTimer = setTimeout(() => {
			hoverTimer = null;
			if (!pointersDown && hoverAt) {
				showPeek(regionUnder(hoverAt.x, hoverAt.y), hoverAt.x, hoverAt.y, false);
			}
		}, HOVER_INTERVAL_MS);
	}

	function onPointerLeave(event) {
		// A finger fires this every time it lifts, which would take away the name a
		// tap has just shown. Only a mouse leaving means the pointer has gone.
		if (event.pointerType !== 'mouse') return;
		hoverAt = null;
		clearPeek();
	}

	function onPointerUp(event) {
		pointersDown = Math.max(0, pointersDown - 1);
		const from = press;
		if (!from || event.pointerId !== from.id) return;
		cancelPress();
		// A finger lifted before the hold finished was a tap. Its name stays up
		// until the next touch, so it can be read without holding a finger on it.
		if (from.touch) return;
		if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > TAP_SLOP_PX) return;
		answerAt(event.clientX, event.clientY);
	}

	function onPointerCancel(event) {
		pointersDown = Math.max(0, pointersDown - 1);
		if (press?.touch && event.pointerId === press.id) clearPeek();
		cancelPress();
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

			// Each dataset file holds exactly one object: every region in the quiz.
			const object = Object.values(topology.objects)[0];
			const polygons = feature(topology, object).features;
			quiz = createQuiz(polygons.map(nameOf));
			total = quiz.state.total;
			// One pass over the geometry, here rather than per tap.
			regions = regionIndex(polygons);

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
				// On by default in three-render-objects. `?fx=off` turns it off to test
				// a device for a fill-rate limit.
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
				// No polygon layer at all. The land is two meshes of our own, added
				// below. globe.gl's pointer system is off too: both the highlight and
				// the answer come from regionUnder. See there for why they must not be
				// resolved separately.
				.enablePointerInteraction(false);

			// three-render-objects sets this to Math.min(2, devicePixelRatio) at
			// construction and offers no option for it, so it is overridden after the
			// fact. This is what `?dpr` reaches.
			world.renderer().setPixelRatio(pixelRatio);

			fit();
			buildLand(polygons, topology, object);

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
			clearTimeout(hoverTimer);
			clearTimeout(holdTimer);
			resizeObserver?.disconnect();
			// Without this, switching regions leaks a WebGL context and its
			// textures each time. The old code sidestepped it by forcing a full
			// page reload on every nav. globe.gl now also empties its scene on
			// destruct, but the land is ours, so we free it ourselves.
			if (land) {
				land.geometry.dispose();
				land.caps.material.dispose();
				land.borders.geometry.dispose();
				land.borders.material.dispose();
				land = null;
			}
			world?._destructor?.();
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

<div id="container" bind:this={containerEl} style:background-image="url({globeBackground})">
	<div id="hud">
		<p id="instruction" aria-live="polite">{instruction}</p>
		<p id="score">
			Score: {score}
			{#if total}
				<span class="muted">· {learned}/{total} learned</span>
			{/if}
		</p>
		<p id="hint">{hint}</p>
		<button id="labels-toggle" onclick={toggleNames} aria-pressed={labelsOn}>
			{labelsOn ? 'Hide names' : 'Show names'}
		</button>
	</div>

	<!-- Taps are handled here rather than through globe.gl's own click, which
	     reports whatever its throttled hover raycaster last saw. On a touch panel
	     that is stale or nothing. See pick.js.

	     The context menu is blocked because a held finger is how a touch player
	     answers, and Chromium opens a menu on a long press.

	     No role, because there is no keyboard way to play and claiming one would
	     tell a screen reader this is operable when it is not. globe.gl's own
	     handler had the same gap; it was just inside a library where the linter
	     could not see it. Playing by keyboard is a real feature and not this. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		id="globe"
		bind:this={globeEl}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerCancel}
		onpointerleave={onPointerLeave}
		oncontextmenu={(event) => event.preventDefault()}
	></div>

	<!-- The ring fills for as long as the finger has to stay down to answer. It
	     is a CSS animation, so nothing runs in script while it fills. -->
	{#if hold}
		<svg
			class="hold-ring"
			style:transform="translate({hold.x}px, {hold.y}px) translate(-50%, -50%)"
			style:--hold-ms="{HOLD_MS}ms"
			viewBox="0 0 100 100"
			aria-hidden="true"
		>
			<circle class="track" cx="50" cy="50" r="44" />
			<circle class="fill" cx="50" cy="50" r="44" pathLength="100" />
		</svg>
	{/if}

	<!-- One name, for the region being pointed at. Plain DOM text rather than a
	     globe layer, so it stays crisp and a screen reader can read it. Beside the
	     cursor for a mouse. Above the finger for touch, where the finger would
	     otherwise cover it. -->
	{#if peek}
		<span
			class="peek"
			style:transform={peek.touch
				? `translate(${peek.x}px, ${peek.y}px) translate(-50%, calc(-100% - ${PEEK_ABOVE_FINGER_PX}px))`
				: `translate(${peek.x + PEEK_BESIDE_CURSOR_PX}px, ${peek.y + PEEK_BESIDE_CURSOR_PX}px)`}
			aria-live="polite"
		>
			{peek.name}
		</span>
	{/if}

	{#if !ready}
		<div id="loading">
			<p class="loading-label">Loading {label || dataset}…</p>
			<div class="bar">
				<div class="progress" style:width="{Math.round(progress * 100)}%"></div>
			</div>
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

	/* Both of these are placed by a transform from the top left corner, so moving
	   them never lays the page out again. */
	.peek,
	.hold-ring {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 1;
		pointer-events: none;
	}

	.peek {
		padding: 2px 8px;
		border: 1px solid rgba(255, 255, 255, 0.35);
		border-radius: 4px;
		/* Big enough to read across a classroom from a wall panel. */
		font:
			1.1rem Poppins,
			sans-serif;
		white-space: nowrap;
		color: #fff;
		background: rgba(6, 10, 24, 0.85);
	}

	.hold-ring {
		width: 88px;
		height: 88px;
	}

	.hold-ring circle {
		fill: none;
		stroke-width: 6;
	}

	.hold-ring .track {
		stroke: rgba(255, 255, 255, 0.25);
	}

	.hold-ring .fill {
		stroke: #f58622;
		stroke-dasharray: 100;
		stroke-dashoffset: 100;
		/* Start at twelve o'clock and fill clockwise. */
		transform: rotate(-90deg);
		transform-origin: center;
		animation: hold-fill var(--hold-ms) linear forwards;
	}

	@keyframes hold-fill {
		to {
			stroke-dashoffset: 0;
		}
	}

	#globe {
		width: 100%;
		height: 100%;
		/* Claim every gesture for the globe, so dragging it can't scroll the page
		   or trigger pull-to-refresh. */
		touch-action: none;
		/* A held finger answers. Without these it selects text or opens a callout. */
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
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

	#hint {
		margin: 0.25rem 0 0;
		font-family: Poppins, sans-serif;
		font-size: clamp(0.8rem, 1.6vw, 1rem);
		opacity: 0.85;
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

	.progress {
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

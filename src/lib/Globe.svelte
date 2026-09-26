<script>
	import { onMount, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import GlobeGL from 'globe.gl';
	// MeshBasic, not Lambert: this is what three-globe builds its own default cap
	// material from, so the unlit look of the original polygons is preserved.
	import { MeshBasicMaterial, Raycaster, Sphere, Vector2, Vector3 } from 'three';
	import { feature } from 'topojson-client';
	import Confetti from './Confetti.svelte';
	import { createQuiz } from './quiz.js';
	import { labelAnchors, placeLabels } from './labels.js';
	import { regionIndex, regionAt } from './pick.js';
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
	 * The border between regions, and it must not be near-background.
	 *
	 * This was '#111'. WebGL draws a line one device pixel wide and there is no
	 * way to ask for thinner, so a region narrower than about two pixels on screen
	 * is completely covered by its own outline and its neighbours'. Against a dark
	 * starfield a near-black smear reads as a hole punched through the land, which
	 * is what it was taken for.
	 *
	 * It is not a rare case. Measured on the shipped world geometry at the
	 * standard framing, 41 of 177 regions average under four screen pixels wide.
	 * The Caprivi Strip, where this was noticed, is 0.28 degrees across, about 1.4
	 * pixels. Luxembourg is 1.5 and The Gambia 1.4, and those are exactly the
	 * names the quiz most wants a student to find.
	 *
	 * So the border is a lighter tint than the cap rather than a darker one. A
	 * sliver drawn entirely in it still reads as land.
	 */
	const BORDER = '#7d9fb8';

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
		if (name === hovered) return capMaterials.hover;
		return capMaterials.base;
	}

	/** Re-runs the cap-material accessor without allocating a new closure. */
	const repaint = () => world?.polygonCapMaterial(materialFor);

	// All four must match the .region-label rule below, because collision is
	// tested against the box they describe.
	const LABEL_FONT_SIZE = 12;
	const LABEL_FONT = `${LABEL_FONT_SIZE}px Poppins, sans-serif`;
	const LABEL_LINE_HEIGHT = 1.4;
	/** Vertical then horizontal, as in the CSS shorthand. Per side. */
	const LABEL_PADDING = [1, 4];

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
		// Height is the line box, not the glyphs. Measuring ascent and descent
		// looks more precise and is wrong: it gives about 9px for a name with no
		// descender, while the span the browser lays out is always 18.8px tall.
		// Collision then passed pairs that overlap once drawn, which is the exact
		// failure the comment above warns about.
		const height = LABEL_FONT_SIZE * LABEL_LINE_HEIGHT + LABEL_PADDING[0] * 2;
		return (name) => ({
			width: ctx.measureText(name).width + LABEL_PADDING[1] * 2,
			height
		});
	}

	/**
	 * How often the *choice* of which names to draw is remade while the globe is
	 * moving.
	 *
	 * Deciding costs a projection and a facing test for every region in the quiz,
	 * then a collision pass over whatever survives. That is far too much to do on
	 * every frame and it does not need to be: which names fit changes slowly.
	 *
	 * Moving names that have already been chosen is a different job and it does
	 * run every frame. See positionLabels.
	 *
	 * This is also the main lever on names blinking in and out, and the only one
	 * that costs nothing. Greedy packing is unstable: move the globe a little and
	 * whether the third name fits depends on exactly where the first two landed,
	 * so a name drops and the next pass puts it back. Every remake is a chance to
	 * blink, so making fewer of them removes most of the blinking.
	 *
	 * Measured against the shipped world geometry, three seconds of drag, counting
	 * names that vanished and returned within 360ms:
	 *
	 * | drag      | every 90ms | every 300ms |
	 * | --------- | ---------- | ----------- |
	 * | 25 deg/s  | 1          | 1           |
	 * | 40 deg/s  | 9          | 2           |
	 * | 70 deg/s  | 19         | 1           |
	 *
	 * The count of names actually drawn did not move. It is free because
	 * positionLabels keeps them glued to the land every frame regardless, so all
	 * that lags is the choice, which is the thing that should be steady. A drag
	 * ending fires a repack directly, so the settled view is never stale.
	 *
	 * Widening the gap between labels was tried instead and is a bad trade. It
	 * buys fewer blinks by drawing fewer names: 8px cost 7 of 39 on /world and
	 * 4 of 23 on /us, and those are the names a student needs.
	 */
	const REPACK_INTERVAL_MS = 300;

	/**
	 * Stable reference for "no labels", so turning them off repeatedly assigns the
	 * same array and Svelte skips the update instead of re-rendering nothing.
	 */
	const NO_LABELS = Object.freeze([]);

	/** Placed labels, in screen coordinates. The one globe value the template reads. */
	let regionLabels = $state(NO_LABELS);
	/**
	 * The same labels as last chosen, still carrying their anchors. Plain, not
	 * $state: this is what positionLabels re-projects, and nothing renders it.
	 */
	let shownLabels = [];
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
	/** Bounding-boxed geometry for resolving a tap to a region. Plain, same reason. */
	let regions = [];

	/**
	 * Projects a point on the regions' surface to the screen, as the camera is now.
	 *
	 * OrbitControls fires `change` after moving the camera but before the frame
	 * renders, and only the render refreshes the camera's world matrix. Projecting
	 * straight away used last frame's rotation, so names trailed the land by a
	 * frame all through a drag. Refreshing it here costs one matrix inverse.
	 *
	 * The altitude is the regions', so a name sits on the drawn land rather than
	 * on the sphere just below it.
	 */
	function screenProjector() {
		world.camera().updateMatrixWorld();
		return (lat, lng) => world.getScreenCoords(lat, lng, ALTITUDE);
	}

	/**
	 * How squarely a point faces the camera: 1 in the middle of the view, 0 on
	 * the visible edge of the globe. Built from three-globe's own coordinates so
	 * there is only one idea of where a latitude and longitude are in 3D. See
	 * placeLabels.
	 *
	 * This is the angle between the surface and the line of sight to the camera,
	 * not to a camera infinitely far away. The difference is large. A camera at a
	 * finite distance sees less than half the sphere, so the edge is not 90° from
	 * the middle of the view. At the world quiz's opening distance it is about 65°,
	 * and on the Northeast quiz under 50°. Assuming 90° drew names for land
	 * already out of sight, stacked on the rim over empty space.
	 */
	function cameraFacing() {
		const eye = world.camera().position;
		return (lat, lng) => {
			const p = world.getCoords(lat, lng, ALTITUDE);
			const sight = { x: eye.x - p.x, y: eye.y - p.y, z: eye.z - p.z };
			const dot = p.x * sight.x + p.y * sight.y + p.z * sight.z;
			return dot / (Math.hypot(p.x, p.y, p.z) * Math.hypot(sight.x, sight.y, sight.z));
		};
	}

	/**
	 * Re-chooses which names to draw. The expensive half, so it runs on a timer.
	 */
	function repackLabels() {
		if (!world || !containerEl || !quiz) return;
		if (!labelsOn) {
			shownLabels = [];
			regionLabels = NO_LABELS;
			return;
		}

		const { width, height } = containerEl.getBoundingClientRect();
		shownLabels = placeLabels({
			anchors,
			project: screenProjector(),
			facing: cameraFacing(),
			viewport: { width, height },
			shouldLabel: (name) => quiz.state.scaffolded(name),
			// "Find Germany" over a map showing every name but Germany's reads as
			// Germany not being in the quiz.
			priority: quiz.state.target,
			// What was chosen last time, which placeLabels holds a little harder so
			// the set stops flickering as the globe turns. See labels.js.
			sticky: new Set(shownLabels.map((label) => label.name))
		});
		positionLabels();
	}

	/**
	 * Moves the names already chosen to where the globe has got to. Runs on every
	 * camera change, which during a drag means every frame.
	 *
	 * This used to be part of the throttled pass, and on a classroom panel that
	 * was the bug people saw: at 20 fps a 90ms throttle leaves the names a couple
	 * of frames behind the land, so a finger sweep drags the globe out from under
	 * them and the words visibly swim across the map before catching up.
	 *
	 * Doing it every frame is affordable because it is not the expensive part. The
	 * throttled pass projects every region in the quiz and runs a collision pass;
	 * this projects the twenty or thirty that are actually on screen and writes
	 * two style properties each.
	 */
	function positionLabels() {
		if (!world) return;
		if (!shownLabels.length) {
			regionLabels = NO_LABELS;
			return;
		}
		const project = screenProjector();
		regionLabels = shownLabels.map((label) => ({ ...label, ...project(label.lat, label.lng) }));
	}

	// Repack whenever names are switched on or off, from either source. Doing it
	// here rather than in the click handler means the globe is never rebuilt.
	$effect(() => {
		labelsOn;
		repackLabels();
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
		repackLabels();
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

	function answer(name) {
		if (won) return;
		const result = quiz.click(name);

		score = quiz.state.score;
		learned = quiz.state.masteredCount;
		showFeedback(name, result.correct ? 'correct' : 'wrong');
		// A correct click is what retires a region's name, so the labels have to be
		// repacked: losing one frees space a crowded-out neighbour can now use.
		repackLabels();

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

	/** The pointer currently down, if a tap is still possible. */
	let tapFrom = null;
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
	function surfaceAt(clientX, clientY) {
		const rect = globeEl.getBoundingClientRect();
		const pointer = new Vector2(
			((clientX - rect.left) / rect.width) * 2 - 1,
			-((clientY - rect.top) / rect.height) * 2 + 1
		);
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
		if (!world || !regions.length) return null;
		const hit = surfaceAt(clientX, clientY);
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
		hovered = name;
		repaint();
	}

	function onPointerDown(event) {
		pointersDown++;
		tapFrom = pointersDown > 1 ? null : { id: event.pointerId, x: event.clientX, y: event.clientY };
		// Hover means nothing once a finger is involved, and a region left lit
		// after the finger has gone just looks like a wrong answer.
		if (event.pointerType !== 'mouse') setHover(null);
	}

	function onPointerMove(event) {
		if (tapFrom && event.pointerId === tapFrom.id) {
			if (Math.hypot(event.clientX - tapFrom.x, event.clientY - tapFrom.y) > TAP_SLOP_PX) {
				tapFrom = null;
			}
		}

		if (event.pointerType !== 'mouse') return;
		hoverAt = { x: event.clientX, y: event.clientY };
		// Never pick while a button is down. That is a drag, and on a classroom
		// panel the frames are worth more than the highlight.
		if (pointersDown || hoverTimer) return;
		hoverTimer = setTimeout(() => {
			hoverTimer = null;
			if (!pointersDown && hoverAt) setHover(regionUnder(hoverAt.x, hoverAt.y));
		}, HOVER_INTERVAL_MS);
	}

	function onPointerLeave() {
		hoverAt = null;
		setHover(null);
	}

	function onPointerUp(event) {
		pointersDown = Math.max(0, pointersDown - 1);
		const from = tapFrom;
		tapFrom = null;
		if (!from || event.pointerId !== from.id) return;
		if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > TAP_SLOP_PX) return;
		answerAt(event.clientX, event.clientY);
	}

	function onPointerCancel() {
		pointersDown = Math.max(0, pointersDown - 1);
		tapFrom = null;
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
				.polygonStrokeColor(() => BORDER)
				.polygonCapMaterial(materialFor)
				// No polygonLabel. Names are drawn on the map by the label passes above
				// instead of following the pointer, because hover does not exist on a
				// touch panel and that is where this is used.
				//
				// No onPolygonHover or onPolygonClick either, and globe.gl's pointer
				// system is off entirely. Both the highlight and the answer come from
				// regionUnder. See there for why they must not be resolved separately.
				// This also drops a raycast over every polygon every 50ms.
				.enablePointerInteraction(false);

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
			 * Names track the camera on every change, and are re-chosen on a timer.
			 *
			 * OrbitControls fires `change` continuously through a drag and through
			 * the damped glide that follows it, so this is effectively a per-frame
			 * hook. Moving the names there is what keeps them stuck to their
			 * countries. Deciding which names fit is the costly part and stays
			 * throttled.
			 */
			const controls = world.controls();
			const onChange = () => {
				positionLabels();
				if (labelTimer) return;
				labelTimer = setTimeout(() => {
					labelTimer = null;
					repackLabels();
				}, REPACK_INTERVAL_MS);
			};
			controls.addEventListener('change', onChange);
			controls.addEventListener('end', repackLabels);
			cleanUpControls = () => {
				controls.removeEventListener('change', onChange);
				controls.removeEventListener('end', repackLabels);
			};

			repackLabels();

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
			clearTimeout(hoverTimer);
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

<svelte:window onresize={repackLabels} />

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

	<!-- Taps are handled here rather than through globe.gl's own click, which
	     reports whatever its throttled hover raycaster last saw. On a touch panel
	     that is stale or nothing. See pick.js.

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
	></div>

	<!-- Names are plain DOM text, not geometry on the globe. three-globe's label
	     layer builds a TextGeometry per label from a typeface font, which on the
	     world quiz would be 177 more meshes and 177 more draw calls on hardware
	     already short of both. Text nodes also stay crisp and can be read aloud
	     by a screen reader, which a canvas never can.

	     The fade is deliberately longer than one repack. Svelte reverses an
	     interrupted transition, so a name that drops out for a pass or two and
	     comes back dips in opacity and recovers instead of vanishing. Slowing the
	     repack removes most of those; this covers the rest. -->
	{#each regionLabels as region (region.name)}
		<span
			class="region-label"
			style:left="{region.x}px"
			style:top="{region.y}px"
			transition:fade={{ duration: 400 }}
		>
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

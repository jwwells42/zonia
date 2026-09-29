<script>
	import { page } from '$app/state';
	import Globe from '$lib/Globe.svelte';
	import MapGlobe from '$lib/MapGlobe.svelte';
	import Diagnostics from '$lib/Diagnostics.svelte';
	import { regionFor } from '$lib/regions.js';

	const region = $derived(regionFor(page.url.pathname));

	/**
	 * Renderer is a query parameter so every quiz can be played on either engine
	 * while the two are being compared. `?r=maplibre` opts in. Anything else, and
	 * the absence of it, gets the shipping renderer.
	 */
	const useMapLibre = $derived(page.url.searchParams.get('r') === 'maplibre');
	// Capitalised because it is rendered as a component directly. In runes mode
	// components are dynamic by default, so `<svelte:component>` is not needed.
	const Renderer = $derived(useMapLibre ? MapGlobe : Globe);

	/** `?stats` shows the on-device diagnostics readout. Off for ordinary players. */
	const showStats = $derived(page.url.searchParams.has('stats'));

	/**
	 * Render resolution, and `?dpr=1.5` to override it on a device under test.
	 *
	 * Both renderers cap at 2 by default. globe.gl has that cap hardcoded inside
	 * three-render-objects; MapLibre takes the raw value, so it is capped here to
	 * match and to keep the A/B fair.
	 *
	 * The override separates a fill-rate problem from a main-thread one. If frame
	 * rate scales with pixel count, the GPU is the limit. If it does not move, the
	 * cost is elsewhere. On the classroom panel's profile it did not move. See
	 * CLAUDE.md. It stays for testing the next device.
	 */
	const pixelRatio = $derived(
		Number(page.url.searchParams.get('dpr')) || Math.min(2, window.devicePixelRatio || 1)
	);

	/**
	 * `?labels=off` starts the quiz with no region names at all.
	 *
	 * Names are normally on, and retire one at a time as the player learns each
	 * region. This is the override for a class that is past needing them, and it
	 * is a URL parameter so a teacher can link straight to it.
	 */
	const labels = $derived(page.url.searchParams.get('labels') !== 'off');

	/**
	 * `?fx=off` drops the atmosphere glow and antialiasing.
	 *
	 * Both are pure appearance and both cost fill rate. Like `?dpr`, it tests a
	 * device for a fill-rate limit. On the classroom panel's profile it changed
	 * nothing.
	 */
	const effects = $derived(page.url.searchParams.get('fx') !== 'off');
</script>

<svelte:head>
	<title>{region ? `${region.label} | Zonia` : 'Zonia'}</title>
</svelte:head>

{#if region}
	<!-- Keyed on renderer as well as dataset, so switching either one tears the
	     old engine down and builds a fresh one. The old site achieved this with a
	     full page reload. -->
	{#key `${useMapLibre}:${region.dataset}:${pixelRatio}:${effects}`}
		<Renderer
			dataset={region.dataset}
			pov={region.pov}
			label={region.label}
			{pixelRatio}
			{labels}
			{effects}
		/>
		{#if showStats}
			<Diagnostics label={useMapLibre ? 'B (maplibre)' : 'A (globe.gl)'} quiz={region.label} />
		{/if}
	{/key}

	<!-- Here rather than in a renderer, so both show it. Bottom left, clear of
	     the prompt at the top and the ?stats readout at the bottom right. -->
	<a
		class="namesake"
		href="https://en.wikipedia.org/wiki/Zonia_Baber"
		target="_blank"
		rel="noopener noreferrer"
	>
		Named for Zonia Baber
	</a>
{:else}
	<div class="missing">
		<h1>No quiz here</h1>
		<p>Pick a region from the menu above.</p>
	</div>
{/if}

<style>
	.namesake {
		position: fixed;
		z-index: 2;
		left: max(0.75rem, env(safe-area-inset-left));
		bottom: max(0.75rem, env(safe-area-inset-bottom));
		display: flex;
		align-items: center;
		/* A finger's width, like every other target on a wall panel. */
		min-height: 44px;
		padding: 0 0.75rem;
		border-radius: 6px;
		/* The globe can turn under it, so it carries its own backing. */
		background: rgba(6, 10, 24, 0.6);
		color: var(--ink-muted);
		font-size: 0.85rem;
	}

	.namesake:hover,
	.namesake:focus-visible {
		color: var(--ink);
	}

	.missing {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: calc(100svh - var(--header-height));
		color: var(--ink);
		background: var(--night);
		text-align: center;
		padding: 1rem;
	}
</style>

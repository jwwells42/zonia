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
{:else}
	<div class="missing">
		<h1>No quiz here</h1>
		<p>Pick a region from the menu above.</p>
	</div>
{/if}

<style>
	.missing {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: calc(100svh - var(--header-height));
		color: white;
		background: #060a18;
		font-family: Poppins, sans-serif;
		text-align: center;
		padding: 1rem;
	}
</style>

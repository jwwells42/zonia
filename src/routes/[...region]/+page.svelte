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
</script>

<svelte:head>
	<title>{region ? `${region.label} | Zonia` : 'Zonia'}</title>
</svelte:head>

{#if region}
	<!-- Keyed on renderer as well as dataset, so switching either one tears the
	     old engine down and builds a fresh one. The old site achieved this with a
	     full page reload. -->
	{#key `${useMapLibre}:${region.dataset}`}
		<Renderer dataset={region.dataset} pov={region.pov} label={region.label} />
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

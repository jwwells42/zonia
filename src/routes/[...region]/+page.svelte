<script>
	import { page } from '$app/state';
	import Globe from '$lib/Globe.svelte';
	import { regionFor } from '$lib/regions.js';

	const region = $derived(regionFor(page.url.pathname));
</script>

<svelte:head>
	<title>{region ? `${region.label} — Zonia` : 'Zonia'}</title>
</svelte:head>

{#if region}
	<!-- Keyed on the dataset so switching quizzes tears the old globe down and
	     builds a fresh one. The old site achieved this with a full page reload. -->
	{#key region.dataset}
		<Globe dataset={region.dataset} pov={region.pov} label={region.label} />
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

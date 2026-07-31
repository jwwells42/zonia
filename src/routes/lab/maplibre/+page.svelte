<script>
	import MapGlobe from '$lib/MapGlobe.svelte';
	import { REGIONS } from '$lib/regions.js';

	// Same dataset and opening view as version A at /us, so the comparison is
	// about the renderer and nothing else.
	const region = REGIONS['/us'];
</script>

<svelte:head>
	<title>Version B | Zonia</title>
</svelte:head>

<MapGlobe dataset={region.dataset} pov={region.pov} label={region.label} />

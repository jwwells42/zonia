<script>
	import Globe from '$lib/Globe.svelte';
	let pov = [37, -95, 0.7];
</script>

<svelte:head>
	<title>Zonia</title>
</svelte:head>

<Globe {pov} chosenJSON="/globeData/us-s.json" />

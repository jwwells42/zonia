<script>
	import Globe from '$lib/Globe.svelte';
	let pov = [43, 15.2, 1.4];
</script>

<svelte:head>
	<title>Zonia</title>
</svelte:head>

<Globe {pov} chosenJSON="/globeData/eu.json" />

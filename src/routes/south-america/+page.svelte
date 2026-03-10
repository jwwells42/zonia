<script>
	import Globe from '$lib/Globe.svelte';
	let pov = [-25, -55, 1.4];
</script>

<svelte:head>
	<title>Zonia</title>
</svelte:head>

<Globe {pov} chosenJSON="/globeData/sa.json" />

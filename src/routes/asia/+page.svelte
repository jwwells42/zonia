<script>
	import Globe from '$lib/Globe.svelte';
	let pov = [28, 84, 1.2];
</script>

<svelte:head>
	<title>Zonia</title>
</svelte:head>

<Globe {pov} chosenJSON="/globeData/asia.json" />

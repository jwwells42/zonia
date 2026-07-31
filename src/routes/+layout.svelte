<script>
	import { onMount } from 'svelte';
	import Header from './Header.svelte';
	import './styles.css';

	let { children } = $props();

	// Hand off from the static shell in app.html now that the real UI exists.
	onMount(() => document.getElementById('boot')?.remove());
</script>

<Header />
{@render children?.()}

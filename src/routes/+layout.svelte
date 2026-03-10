<script>
	import Header from './Header.svelte';
	import './styles.css';

	let { children } = $props();
</script>

<Header />
{@render children?.()}

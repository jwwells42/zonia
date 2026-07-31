<script>
	// Deliberately labelled A and B rather than "current" and "new". Testers who
	// know which one is the replacement tend to report on that instead of on what
	// they actually experienced.
	const versions = [
		{ letter: 'A', href: '/us' },
		{ letter: 'B', href: '/lab/maplibre' }
	];
</script>

<svelte:head>
	<title>Help us test | Zonia</title>
</svelte:head>

<div class="lab">
	<h1>Two versions of the same quiz</h1>
	<p class="lead">Both are the United States quiz. Play each one. Then tell us what you noticed.</p>

	<div class="picker">
		{#each versions as version (version.letter)}
			<a class="card" href={version.href}>
				<span class="letter">{version.letter}</span>
				<span class="go">Play version {version.letter}</span>
			</a>
		{/each}
	</div>

	<h2>What we'd like to know</h2>
	<ul>
		<li>Did one start faster?</li>
		<li>Was one smoother to drag and spin?</li>
		<li>Was one easier to tap? Try a small state like Rhode Island.</li>
		<li>Which looked better?</li>
		<li>Did anything feel broken or slow?</li>
	</ul>
	<p class="note">Tell us what you played on. Phone, Chromebook, classroom board, or desktop.</p>
</div>

<style>
	.lab {
		box-sizing: border-box;
		min-height: calc(100svh - var(--header-height));
		padding: clamp(1.5rem, 5vw, 3rem) max(1.25rem, env(safe-area-inset-left));
		margin: 0 auto;
		max-width: 44rem;
		background: #060a18;
		color: #e8eef6;
		font-family: var(--font-body);
	}

	h1 {
		margin: 0 0 0.5rem;
		font-family: 'Anta', sans-serif;
		font-size: clamp(1.6rem, 5vw, 2.4rem);
		color: #f58622;
	}

	h2 {
		margin: 2.5rem 0 0.75rem;
		font-size: 1.15rem;
	}

	.lead {
		margin: 0;
		font-size: 1.05rem;
		opacity: 0.85;
	}

	.picker {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 1rem;
		margin: 2rem 0 0;
	}

	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 8rem;
		padding: 1.5rem;
		border: 1px solid #24405c;
		border-radius: 12px;
		background: #0e1c2e;
		color: #e8eef6;
		text-decoration: none;
	}

	.card:hover,
	.card:focus-visible {
		border-color: #f58622;
		background: #142639;
	}

	.letter {
		font-family: 'Anta', sans-serif;
		font-size: 3rem;
		line-height: 1;
		color: #f58622;
	}

	.go {
		font-size: 1rem;
	}

	ul {
		margin: 0;
		padding-left: 1.25rem;
	}

	li {
		margin-bottom: 0.4rem;
		line-height: 1.5;
	}

	.note {
		margin-top: 1.5rem;
		font-size: 0.95rem;
		opacity: 0.7;
	}
</style>

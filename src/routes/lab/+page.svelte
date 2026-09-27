<script>
	// Labelled A and B, not "current" and "new". Testers who know which one is
	// the replacement report on that instead of on what they experienced.
	//
	// The world quiz leads because it is the hard case. It has 177 regions where
	// the United States has 50, and it is the one quiz where extra detail stopped
	// paying for itself.
	const tests = [
		{
			title: 'World',
			note: 'The main test. Please play this one.',
			a: '/world',
			b: '/world?r=maplibre'
		},
		{
			title: 'United States',
			note: 'Optional. Only if you have time.',
			a: '/us',
			b: '/us?r=maplibre'
		}
	];
</script>

<svelte:head>
	<title>Help us test | Zonia</title>
</svelte:head>

<div class="lab">
	<h1>Two versions of the same quiz</h1>
	<p class="lead">Play version A. Then play version B. Then tell us what you noticed.</p>

	{#each tests as test (test.title)}
		<section>
			<h2>{test.title}</h2>
			<p class="note">{test.note}</p>
			<div class="picker">
				<a class="card" href={test.a}><span class="letter">A</span><span>Play A</span></a>
				<a class="card" href={test.b}><span class="letter">B</span><span>Play B</span></a>
			</div>
		</section>
	{/each}

	<h2>What we'd like to know</h2>
	<ul>
		<li>Did one start faster?</li>
		<li>Was one smoother to drag and spin?</li>
		<li>Was one easier to tap? Try a small country.</li>
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
		background: var(--night);
		color: var(--ink);
	}

	h1 {
		margin: 0 0 0.5rem;
		font-size: clamp(1.6rem, 5vw, 2.4rem);
		font-weight: 700;
	}

	h2 {
		margin: 2.5rem 0 0.25rem;
		font-size: 1.15rem;
	}

	.lead {
		margin: 0;
		font-size: 1.05rem;
		color: var(--ink-muted);
	}

	section h2 {
		margin-bottom: 0.25rem;
	}

	.picker {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 1rem;
		margin: 1rem 0 0;
	}

	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		min-height: 7rem;
		padding: 1.25rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--surface);
		color: var(--ink);
		text-decoration: none;
	}

	.card:hover,
	.card:focus-visible {
		border-color: var(--accent);
		background: var(--surface-hover);
	}

	.letter {
		font-size: 2.5rem;
		font-weight: 800;
		line-height: 1;
		color: var(--accent);
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
		margin: 0;
		font-size: 0.95rem;
		color: var(--ink-muted);
	}
</style>

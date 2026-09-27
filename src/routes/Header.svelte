<script>
	import { page } from '$app/state';
	import { NAV } from '$lib/regions.js';

	let menuOpen = $state(false);
	/** Which top-level submenu is expanded, by label. */
	let openSubmenu = $state(null);

	const isCurrent = (href) => page.url.pathname === href;

	function toggleSubmenu(label) {
		openSubmenu = openSubmenu === label ? null : label;
	}

	function closeAll() {
		menuOpen = false;
		openSubmenu = null;
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') closeAll();
	}}
/>

<header>
	<a href="/" class="logo" onclick={closeAll}>
		<!-- Empty alt: the name beside it already says where the link goes. -->
		<img src="/favicon.svg" alt="" width="32" height="32" />
		Zonia
	</a>

	<button
		class="menu-toggle"
		aria-expanded={menuOpen}
		aria-controls="navbar"
		onclick={() => (menuOpen = !menuOpen)}
	>
		<span class="bars" aria-hidden="true"></span>
		<span class="sr-only">Menu</span>
	</button>

	<nav id="navbar" class="navbar" class:open={menuOpen}>
		<ul>
			{#each NAV as item (item.label)}
				<li class="top">
					<div class="row">
						<a
							href={item.href}
							aria-current={isCurrent(item.href) ? 'page' : undefined}
							onclick={closeAll}
						>
							{item.label}
						</a>
						{#if item.children}
							<!-- A tap disclosure, not :hover. The old submenu only opened on
							     hover, so on a touchscreen tapping the parent navigated away
							     and the four US regions were unreachable. -->
							<button
								class="disclosure"
								aria-expanded={openSubmenu === item.label}
								onclick={() => toggleSubmenu(item.label)}
							>
								<span class="chevron" class:up={openSubmenu === item.label} aria-hidden="true"
								></span>
								<span class="sr-only">Show {item.label} regions</span>
							</button>
						{/if}
					</div>

					{#if item.children && openSubmenu === item.label}
						<ul class="submenu">
							{#each item.children as child (child.href)}
								<li>
									<a
										href={child.href}
										aria-current={isCurrent(child.href) ? 'page' : undefined}
										onclick={closeAll}
									>
										{child.label}
									</a>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	</nav>
</header>

<style>
	header {
		position: relative;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-height: var(--header-height);
		padding: 0 max(0.75rem, env(safe-area-inset-right)) 0 max(0.75rem, env(safe-area-inset-left));
		box-sizing: border-box;
		border-bottom: 1px solid var(--line);
		background-color: var(--surface);
	}

	.logo {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: clamp(1.5rem, 4vw, 2rem);
		font-weight: 800;
		color: var(--ink);
		text-decoration: none;
		white-space: nowrap;
	}

	.logo img {
		width: 1.2em;
		height: 1.2em;
	}

	.navbar ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.navbar > ul {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
	}

	.row {
		display: flex;
		align-items: center;
	}

	.navbar a {
		display: block;
		/* >=44px tall at every breakpoint. The old 16px padding on a 15px font
		   left taps landing between targets. */
		padding: 0.75rem 0.9rem;
		min-height: 44px;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		color: var(--ink);
		font-size: clamp(0.95rem, 1.6vw, 1.2rem);
		font-weight: 500;
		text-decoration: none;
		white-space: nowrap;
	}

	.navbar a:hover,
	.navbar a:focus-visible {
		background-color: var(--surface-hover);
	}

	.navbar a[aria-current='page'] {
		box-shadow: inset 0 -3px 0 var(--accent);
	}

	.disclosure,
	.menu-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		padding: 0;
		border: 0;
		background: none;
		color: var(--ink);
		cursor: pointer;
	}

	.disclosure:hover,
	.menu-toggle:hover,
	.disclosure:focus-visible,
	.menu-toggle:focus-visible {
		background-color: var(--surface-hover);
	}

	.chevron {
		width: 0;
		height: 0;
		border-left: 5px solid transparent;
		border-right: 5px solid transparent;
		border-top: 6px solid currentColor;
		transition: transform 150ms ease;
	}

	.chevron.up {
		transform: rotate(180deg);
	}

	/* Three bars drawn with borders, so there is no icon font or SVG to load. */
	.bars,
	.bars::before,
	.bars::after {
		display: block;
		width: 22px;
		height: 2px;
		background: currentColor;
	}

	.bars {
		position: relative;
	}

	.bars::before,
	.bars::after {
		content: '';
		position: absolute;
	}

	.bars::before {
		top: -7px;
	}
	.bars::after {
		top: 7px;
	}

	.menu-toggle {
		display: none;
	}

	.submenu {
		position: absolute;
		min-width: 12rem;
		border: 1px solid var(--line);
		background: var(--surface);
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	@media (max-width: 1150px) {
		.menu-toggle {
			display: flex;
		}

		.navbar {
			position: absolute;
			top: 100%;
			left: 0;
			right: 0;
			max-height: calc(100svh - var(--header-height));
			overflow-y: auto;
			background: var(--surface);
			border-top: 1px solid var(--line);
			display: none;
		}

		.navbar.open {
			display: block;
		}

		.navbar > ul {
			flex-direction: column;
			align-items: stretch;
		}

		.row {
			justify-content: space-between;
		}

		.row a {
			flex: 1;
		}

		.submenu {
			position: static;
			border: 0;
			box-shadow: none;
			/* Recessed below the menu, so its own hover still shows. */
			background: var(--night);
		}

		.submenu a {
			padding-left: 2rem;
		}
	}
</style>

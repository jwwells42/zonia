<script>
	import { onMount } from 'svelte';

	/**
	 * On-device performance readout, shown only when the URL carries `?stats`.
	 *
	 * The point is to replace "it felt laggy" with numbers, from the machine that
	 * actually felt laggy. Desktop benchmarks cannot model a classroom panel or a
	 * school Chromebook, and CPU throttling does not model fill rate at all.
	 *
	 * Frame rate is the headline because lag is a frame-rate experience. The
	 * browser version is here because MapLibre needs runtime methods that older
	 * Chromium lacks, so "version B was slow" and "version B never ran" look the
	 * same from across a room.
	 */
	let { label = '', quiz = '' } = $props();

	/** Frames slower than this count as a stutter a person would notice. */
	const SLOW_FRAME_MS = 50;
	/** Rolling window, about eight seconds at 60fps. */
	const WINDOW = 500;

	let fps = $state(0);
	let fpsLow = $state(0);
	let worstFrame = $state(0);
	let slowFrames = $state(0);
	let sampled = $state(0);
	let interactive = $state(0);
	let device = $state(null);
	let copied = $state(false);
	let collapsed = $state(false);

	const round = (n, places = 0) => Number(n.toFixed(places));

	/** Percentile of a sorted-in-place copy. */
	function percentile(values, p) {
		if (!values.length) return 0;
		const sorted = [...values].sort((a, b) => a - b);
		return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
	}

	function describeDevice() {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
		const debug = gl?.getExtension('WEBGL_debug_renderer_info');

		// Chromium reports itself in the UA as Chrome/<version>. On Android panels
		// that number is often years behind, which is the whole reason this is here.
		const chrome = navigator.userAgent.match(/Chrom(?:e|ium)\/(\d+)/);

		let moduleWorker;
		try {
			// Constructing a module worker from an empty blob is the only reliable
			// feature test; browsers without support throw here.
			const url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
			new Worker(url, { type: 'module' }).terminate();
			URL.revokeObjectURL(url);
			moduleWorker = true;
		} catch {
			moduleWorker = false;
		}

		return {
			browser: chrome ? `Chromium ${chrome[1]}` : navigator.userAgent.slice(0, 60),
			gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl ? 'hidden' : 'no webgl',
			webgl2: !!canvas.getContext('webgl2'),
			viewport: `${window.innerWidth}x${window.innerHeight}`,
			screen: `${window.screen.width}x${window.screen.height}`,
			dpr: window.devicePixelRatio,
			cores: navigator.hardwareConcurrency ?? 'unknown',
			// Both are needed by MapLibre and missing before Chromium 92 and 93.
			// Reported after polyfills, so this says "supported or shimmed".
			arrayAt: typeof [].at === 'function',
			objectHasOwn: typeof Object.hasOwn === 'function',
			moduleWorker
		};
	}

	const summary = $derived(
		[
			`Zonia ${label} | ${quiz}`,
			`fps median ${fps}  low5% ${fpsLow}  worst frame ${worstFrame}ms  slow frames ${slowFrames}/${sampled}`,
			`interactive ${interactive}ms`,
			device &&
				[
					`${device.browser}`,
					`gpu ${device.gpu}`,
					`viewport ${device.viewport} screen ${device.screen} dpr ${device.dpr}`,
					`cores ${device.cores} webgl2 ${device.webgl2} moduleWorker ${device.moduleWorker}`,
					`Array.at ${device.arrayAt} Object.hasOwn ${device.objectHasOwn}`
				].join('\n')
		]
			.filter(Boolean)
			.join('\n')
	);

	async function copy() {
		try {
			await navigator.clipboard.writeText(summary);
		} catch {
			// Clipboard access is refused without a secure context, which a locally
			// hosted panel may well be. Selecting the text is the fallback.
			const box = document.getElementById('diag-summary');
			if (box) {
				const range = document.createRange();
				range.selectNodeContents(box);
				const selection = window.getSelection();
				selection?.removeAllRanges();
				selection?.addRange(range);
			}
		}
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	onMount(() => {
		device = describeDevice();

		let frame = 0;
		let last = performance.now();
		/** @type {number[]} */
		const deltas = [];

		const tick = (now) => {
			const delta = now - last;
			last = now;

			// Skip the first frame and any gap from a backgrounded tab.
			if (delta > 0 && delta < 2000) {
				deltas.push(delta);
				if (deltas.length > WINDOW) deltas.shift();
				if (delta > worstFrame) worstFrame = round(delta);
				if (delta > SLOW_FRAME_MS) slowFrames++;
			}

			// Recompute a few times a second rather than every frame; the readout
			// should not be a meaningful share of what it is measuring.
			if (deltas.length && ++frame % 20 === 0) {
				fps = round(1000 / percentile(deltas, 0.5), 1);
				fpsLow = round(1000 / percentile(deltas, 0.95), 1);
				sampled = deltas.length;
			}
			raf = requestAnimationFrame(tick);
		};
		let raf = requestAnimationFrame(tick);

		// "Interactive" means the quiz is playable: the renderer has cleared its
		// loading overlay. Both renderers use the same #loading element.
		const start = performance.now();
		const poll = setInterval(() => {
			if (!document.getElementById('loading')) {
				interactive = round(performance.now() - start);
				clearInterval(poll);
			}
		}, 50);

		return () => {
			cancelAnimationFrame(raf);
			clearInterval(poll);
		};
	});
</script>

<div class="diag" class:collapsed>
	<button class="bar" onclick={() => (collapsed = !collapsed)} aria-expanded={!collapsed}>
		<span class="dot" class:bad={fps > 0 && fps < 30} class:ok={fps >= 50}></span>
		<strong>{fps || '--'} fps</strong>
		<span class="dim">{label}</span>
		<span class="chev">{collapsed ? '+' : '−'}</span>
	</button>

	{#if !collapsed}
		<pre id="diag-summary">{summary}</pre>
		<button class="copy" onclick={copy}>{copied ? 'Copied' : 'Copy results'}</button>
	{/if}
</div>

<style>
	.diag {
		position: fixed;
		right: 0.5rem;
		bottom: 0.5rem;
		z-index: 5;
		max-width: min(24rem, calc(100vw - 1rem));
		border-radius: 6px;
		background: rgba(4, 8, 18, 0.92);
		border: 1px solid #2b4058;
		color: #dce6f2;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 11px;
		overflow: hidden;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		min-height: 40px;
		padding: 0.4rem 0.6rem;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
		text-align: left;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #d9a441;
		flex: none;
	}
	.dot.ok {
		background: #3fb950;
	}
	.dot.bad {
		background: #d9534f;
	}

	.dim {
		opacity: 0.6;
		flex: 1;
	}

	.chev {
		opacity: 0.6;
	}

	pre {
		margin: 0;
		padding: 0 0.6rem 0.5rem;
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.45;
	}

	.copy {
		display: block;
		width: calc(100% - 1.2rem);
		margin: 0 0.6rem 0.6rem;
		min-height: 36px;
		border: 1px solid #2b4058;
		border-radius: 4px;
		background: #12253c;
		color: #dce6f2;
		font: inherit;
		cursor: pointer;
	}

	.copy:hover {
		background: #1a3350;
	}
</style>

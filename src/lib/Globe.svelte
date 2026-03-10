<script>
	import { onMount } from 'svelte';
	import GlobeGL from 'globe.gl';
	import Confetti from './Confetti.svelte';
	import globeSkin from '$lib/images/earth-night.jpg';
	import globeBackground from '$lib/images/night-sky.png';

	let { chosenJSON, pov = [37, -95, 0.7] } = $props();

	let globeEl;

	// Only use $state for values rendered in the template.
	// Globe.gl's internal data stays as plain variables to avoid
	// Svelte 5's deep proxy wrapping on large GeoJSON arrays.
	let bigScore = $state(0);
	let instruction = $state('Click to win!');
	let confetti = $state(false);

	// Internal game state — no reactivity needed
	let countries;
	let stateData;
	let stateNames;
	let target;

	onMount(async () => {
		const response = await fetch(chosenJSON);
		countries = await response.json();

		stateData = {};
		countries.features.forEach(feature => {
			stateData[feature.properties.NAME] = { score: 0 };
		});

		stateNames = Object.keys(stateData);
		target = stateNames[Math.floor(Math.random() * stateNames.length)];
		const winningScore = stateNames.length * 2;
		instruction = 'Find ' + target + '!';

		const world = GlobeGL()
			.pointOfView({ lat: pov[0], lng: pov[1], altitude: pov[2] }, 200)
			.globeImageUrl(globeSkin)
			.backgroundImageUrl(globeBackground)
			.lineHoverPrecision(0)
			.polygonsData(countries.features)
			.polygonAltitude(0.06)
			.polygonCapColor(() => 'steelblue')
			.polygonSideColor(() => 'rgba(0, 100, 0, 0.15)')
			.polygonStrokeColor(() => '#111')
			.polygonLabel(({ properties: d }) => {
				if (stateData[d.NAME].score < 1) {
					return `<p style="
						font-family: Poppins;
						font-size: 1em;
					">${d.NAME}</p>`;
				} else {
					return '';
				}
			})
			.onPolygonHover(hoverD =>
				world.polygonCapColor(d => (d === hoverD ? '#f58622' : 'steelblue'))
			)
			.onPolygonClick(polygon => {
				const currentTarget = stateData[target];
				if (polygon.properties.NAME === target) {
					currentTarget.score++;
					bigScore++;
					if (currentTarget.score >= 2) {
						stateNames = stateNames.filter(name => name !== target);
					}
					const filteredStateNames = stateNames.filter(name => name !== target);
					if (filteredStateNames.length > 1) {
						target = filteredStateNames[Math.floor(Math.random() * filteredStateNames.length)];
					} else {
						target = stateNames[Math.floor(Math.random() * stateNames.length)];
					}
					if (bigScore >= winningScore || stateNames.length === 0) {
						instruction = 'WINNER!';
						confetti = true;
					} else {
						instruction =
							'Good job! You clicked ' +
							polygon.properties.NAME +
							'! Now find ' +
							target +
							'.';
					}
				} else {
					stateData[target].score--;
					if (bigScore > 0) {
						bigScore--;
					}
					instruction =
						'Keep trying! That was ' +
						polygon.properties.NAME +
						'. Find ' +
						target +
						'.';
				}
			})(globeEl);
	});
</script>

{#if confetti}
	<div id="confetti-container">
		<Confetti x={[-5, 5]} y={[0, 0.1]} delay={[500, 2000]} infinite amount={500} fallDistance="100vh" />
	</div>
{/if}
<div id="container">
	<div id="instruction-container">
		<div id="instruction">{instruction}</div>
		<div id="score">Score: {bigScore}</div>
	</div>
	<div bind:this={globeEl}></div>
</div>

<style>
	#instruction-container {
		position: absolute;
		color: white;
		z-index: 1;
		margin-left: 20px;
		pointer-events: none;
	}

	#instruction {
		margin-top: 1%;
		font-size: 2em;
		font-family: Poppins;
		max-width: 100%;
	}

	#score {
		font-family: Poppins-500;
		font-size: 1.5em;
		margin-top: 0;
		padding: 0;
	}

	#confetti-container {
		position: fixed;
		top: -50px;
		left: 0;
		height: 100vh;
		width: 100vw;
		display: flex;
		justify-content: center;
		overflow: hidden;
		z-index: 2;
		pointer-events: none;
	}

	@media (max-width: 600px) {
		#instruction {
			font-size: 1em;
			max-width: 100%;
		}
	}
</style>

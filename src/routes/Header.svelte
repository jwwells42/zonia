<header>
	<a href="/" class="logo">Zonia</a>
	<input type="checkbox" id="menu-bar" />
	<label for="menu-bar">Menu</label>

	<nav class="navbar" data-sveltekit-reload>
		<ul>
			<li>
				<a href="/">United States</a>
				<ul class="submenu">
					<li class="second"><a href="/us/northeast">Northeast</a></li>
					<li class="second"><a href="/us/south">South</a></li>
					<li class="second"><a href="/us/midwest">Midwest</a></li>
					<li class="second"><a href="/us/west">West</a></li>
				</ul>
			</li>
			<li><a href="/africa">Africa</a></li>
			<li><a href="/europe">Europe</a></li>
			<li><a href="/asia">Asia</a></li>
			<li><a href="/middle-east">Middle East</a></li>
			<li><a href="/north-america">North America</a></li>
			<li><a href="/south-america">South America</a></li>
			<li><a href="/world">World</a></li>
		</ul>
	</nav>
</header>

<style>
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin: 0;
		padding: 0 3%;
		box-sizing: border-box;
		text-transform: capitalize;
		text-decoration: none;
		font-family: 'Anta', sans-serif;
		font-weight: 400;
		font-style: normal;
		background-color: #c82689;
	}

	header .logo {
		font-weight: bolder;
		font-size: 200%;
		color: #f58622;
		font-family: 'Anta', sans-serif;
	}

	.navbar ul {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 15px;
	}

	.navbar > ul {
		display: flex;
		flex-wrap: wrap;
	}

	.navbar > ul > li {
		position: relative;
		background-color: #c82689;
		z-index: 3;
	}

	.second {
		text-align: center;
	}

	.navbar a {
		font-size: 150%;
		padding: 16px;
		color: white;
		display: block;
		text-decoration: none;
		cursor: pointer;
	}

	.navbar a:hover {
		background-color: #8b2261;
	}

	.submenu {
		position: absolute;
		left: 0;
		width: 200px;
		background: #c82689;
		display: none;
	}

	.submenu li {
		width: 100%;
		border-top: 1px solid rgba(0, 0, 0, 0.1);
	}

	.navbar > ul > li:hover > .submenu,
	.navbar > ul > li:focus-within > .submenu {
		display: block;
	}

	#menu-bar {
		display: none;
	}

	header label {
		font-size: 150%;
		color: #333;
		cursor: pointer;
		display: none;
	}

	@media (max-width: 1150px) {
		header label {
			display: block;
			position: relative;
			z-index: 5;
		}

		.navbar {
			position: fixed;
			top: 50px;
			left: 0;
			right: 0;
			background: #c82689;
			border-top: 1px solid rgba(0, 0, 0, 0.1);
			display: none;
			z-index: 4;
		}

		.navbar > ul {
			flex-direction: column;
		}

		.navbar > ul > li {
			width: 100%;
		}

		.submenu {
			position: static;
			width: 100%;
		}

		#menu-bar:checked ~ .navbar {
			display: block;
		}
	}
</style>

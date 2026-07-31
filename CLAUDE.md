# Zonia

A geography quiz on a 3D globe. You are told a region to find, you click it on the globe, and
you win once every region has been clicked correctly twice.

SvelteKit 2 + Svelte 5 (runes) + `globe.gl`, deployed to Vercel. Rendering is client-only.

## Code standards

This is maintained by people, and readability for a human reader is a first-class
requirement. It is not traded away for cleverness or for a few milliseconds. Write to the
standard an experienced practitioner would expect:

- Say why, not what. A comment explaining a non-obvious constraint earns its place; one narrating
  the line below it does not.
- Prefer the boring, legible construction. If something has to be subtle for a measured reason,
  put the reason in a comment right there. See the notes under Performance constraints.
- **Restructuring existing code is in scope.** If a change is awkward because the surrounding
  design is wrong, fix the design rather than working around it. Duplicated routes, logic welded
  into a component, a helper doing two jobs. Reshape them.
- Keep decisions in one place. Quiz definitions live in `src/lib/regions.js`, region membership in
  `scripts/rosters.json`, rules in `src/lib/quiz.js`. Adding a quiz should not mean editing a
  component.
- Logic worth testing should be reachable by a test. `quiz.js` is pure and DOM-free precisely so it
  can be, and so two different renderers can share it unchanged.

## Writing

This applies to everything a person reads. App copy, page text, docs, commit messages.

LLM writing style is wrong for this project. The audience is students and teachers. Default
model prose is too long, too smooth, and too self-satisfied.

Rules:

- No em dashes. Use a period. Start a new sentence.
- No long sentences. One idea per sentence. If a sentence needs a comma to survive, split it.
- No "not just X, but Y". No "it's worth noting". No throat-clearing before the point.
- Plain words. "Use", not "utilize". "About", not "regarding".
- Say the thing. Then stop.

**When real prose is needed, do not write it.** An About page, help text, a lesson blurb: these
need a human voice. Leave a placeholder instead. List the topics worth covering, as bullets, and
let a person write the actual words.

Like this:

```
<!-- TODO: copy needed. Suggested topics:
     - what the quiz is
     - how scoring works
     - that regions need two correct clicks
     - which regions are available
-->
```

Short functional strings are fine to write directly. Button labels, error messages, the quiz
prompts in `Globe.svelte` and `MapGlobe.svelte`.

## Commands

| Command                             | What it does                                                         |
| ----------------------------------- | -------------------------------------------------------------------- |
| `npm run dev`                       | Dev server                                                           |
| `npm run build` / `npm run preview` | Production build / serve it locally                                  |
| `npm test`                          | Vitest over quiz logic and built geodata                             |
| `npm run check`                     | `svelte-check`                                                       |
| `npm run lint` / `npm run format`   | Prettier check + ESLint / rewrite                                    |
| `npm run geodata`                   | Rebuild `static/geo/` from upstream sources. **Not** part of `build` |

## Layout

```
scripts/build-geodata.js   Geometry pipeline (build-time only)
scripts/rosters.json       Which regions each quiz contains. The contract
src/lib/regions.js         Every quiz, keyed by URL path, + nav structure
src/lib/quiz.js            Quiz rules, pure, no DOM
src/lib/Globe.svelte       Renderer A, globe.gl / three-globe
src/lib/MapGlobe.svelte    Renderer B, MapLibre (evaluation)
src/lib/mapStyle.js        MapLibre style spec and view framing
src/routes/[...region]/    One route serving all 14 quizzes
src/routes/lab/            A/B test harness for the renderer comparison
static/geo/*.topo.json     Built geometry (committed)
```

## Two renderers, on purpose

`Globe.svelte` (globe.gl) is what the site ships. `MapGlobe.svelte` (MapLibre) is under evaluation
at `/lab`, which presents both as neutral "A" and "B" for testers.

Both take the same props and both drive `quiz.js` unchanged. That is the point. If a renderer
change ever requires editing `quiz.js`, the separation has been broken.

Measured on `/us` with a 4× CPU throttle, MapLibre against flat globe.gl:

|                 | globe.gl | MapLibre   |
| --------------- | -------- | ---------- |
| transfer        | 1490 KB  | 1205 KB    |
| load scripting  | 3625 ms  | **317 ms** |
| hover scripting | 2157 ms  | **275 ms** |

The load figure is the interesting one. MapLibre tiles and simplifies GeoJSON in a Web Worker, so
that work leaves the main thread entirely; three-globe tessellates synchronously. This matters most
on the weakest target hardware. It also means added detail, rivers for example, is close to free
rather than permanently more expensive.

Two things to know before touching `MapGlobe.svelte`:

- **The worker must be imported as `?worker&url`.** MapLibre builds its worker path at runtime, so
  no bundler can see it; the map then never fires `load` _and never errors_. Plain `?url` is not
  enough. The worker imports `maplibre-gl-shared.mjs`, so copying one file just moves the
  failure inside the worker where nothing surfaces it. `vite.config.js` sets `worker.format:
'es'` to match.
- **Always subscribe to the map's `error` event.** MapLibre reports style and source failures
  through an event rather than throwing, so an unsubscribed failure looks exactly like a slow load.

## Adding or changing a quiz

Add an entry to `REGIONS` in `src/lib/regions.js`, and to `NAV` if it should appear in the header.
Both are keyed by path, so URLs and navigation stay in sync automatically. To change _which_
regions a quiz asks about, edit `scripts/rosters.json` and re-run `npm run geodata`.

`/oceania` exists and is playable but is intentionally absent from `NAV`. The original site
shipped that dataset without ever linking to it.

## The geodata pipeline

Sources are deliberately richer than the output: simplifying down from dense geometry beats
shipping a coarse source. Countries come from Natural Earth 1:50m, states from Census cartographic
boundaries at 1:500k. Both are cut to a per-dataset vertex budget in `BUDGETS`.

`scripts/rosters.json` is the contract. It pins the exact set of regions in each quiz and their
display names, so changing sources cannot silently change what the quiz asks. **A source that
cannot supply a roster member fails the build**. Fix the join. Do not edit the roster, unless the
quiz content is genuinely meant to change.

Output is quantized TopoJSON with a single `name` property. Everything else is discarded: Natural
Earth ships 169 fields per feature and they were ~90% of the old payload. Shared arcs mean a border
between two countries is stored once.

Re-running the pipeline needs network access; downloads cache in `scripts/.cache/` (gitignored).
Outputs are committed so deploys never run it.

## Performance constraints

This is a WebGL app that tessellates every polygon at load and raycasts on every pointer move.
Things that look harmless and are not:

- **Never put GeoJSON in `$state`.** Svelte 5's deep proxies would wrap thousands of coordinate
  arrays. Only values the template renders are runes; everything `globe.gl` touches is a plain
  variable, and repaints are pushed to three.js by hand.
- **Keep `polygonsTransitionDuration(0)`.** At its default, every change to a colour or material
  accessor allocates a `Tween` per polygon. Since hover drives an accessor, that means allocating
  on every frame the pointer moves.
- **Hover swaps materials, not colours.** three-globe re-runs its whole polygon digest on any
  accessor change; handing it stable, pre-created `MeshBasicMaterial` instances keeps that pass
  from rebuilding colours object by object. Use `MeshBasicMaterial`. It is what three-globe builds
  its own default from, so Lambert would change the shading.
- **`globe.gl` never resizes itself.** It reads `window.innerWidth/innerHeight` once at
  construction. `Globe.svelte` drives `.width()/.height()` from a `ResizeObserver`; without it the
  page overflows and phone rotation permanently breaks the view.
- **Dispose the globe on unmount.** `world._destructor()` plus material disposal. Skipping this
  leaks a WebGL context per region switch. The original code avoided the issue by forcing a full
  page reload on every navigation. That is why it felt slow.
- **`polygonCapCurvatureResolution` trades triangles for roundness.** The 5° default is wasted on a
  zoomed-in region where nothing spans enough longitude to bend visibly. See `curvatureFor`.
- **Regions lie flat; `polygonSideColor` must stay falsy.** three-globe gates side-wall geometry on
  that colour alone (`hasSide` sets `includeSides`), and those walls were ~67% of every triangle.
  34,507 down to 11,381 for `world`. Setting a side colour silently triples the geometry and doubles
  hover cost.

The client bundle is ~1.8 MB raw / ~530 KB gzipped, almost entirely three.js and three-globe.
three-globe ships as one pre-bundled module with every layer (hexbin, tiles, voronoi, paths, arcs)
referenced by its kapsule composition, so the unused ones cannot be tree-shaken. Dropping `globe.gl`
for direct three-globe use was measured and does not pay. Because of that bundle plus `ssr = false`,
`src/app.html` carries a static `#boot` splash that paints before any JavaScript runs;
`+layout.svelte` removes it on mount.

## Quiz rules

In `src/lib/quiz.js`, deliberately free of DOM and globe concerns so it can be tested.

Winning means **every region mastered**, never a score threshold. Score also decrements on
mistakes. A score-driven win check let a player master everything and never be told they won.
Wrong answers cost score only, floored at zero; they never add to what a region requires. A correct
click rotates the target away, so mastering a region means clicking it correctly across several
turns. When nothing remains, `target` becomes `null` rather than `undefined`.

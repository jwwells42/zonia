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

## Committing and shipping

**Commit and push finished work. Do not leave it sitting in the working tree.**

The reason is testing. Zonia has to be tried on real hardware: a classroom panel, a school
Chromebook, a phone. None of that can happen from someone's working tree. Pushed work gets a URL,
and a URL can be opened on the panel or sent to a teacher with no further thought. Work that is not
pushed cannot be tested where it matters, and this project's whole performance story came from
testing where it matters.

Reverting is cheap. That is what git is for. The risk of shipping something imperfect is smaller
than the cost of not being able to try it.

**The site is <https://zonia-seven.vercel.app>, built from `main`.** That is the only URL that works
on a locked-down classroom panel or in someone else's hands, so reaching it is what "done" means.

**Getting to `main` is part of finishing a change, not a separate favour to ask for.** A change that
stops at a branch cannot be tested, and this project is only ever really tested on hardware.

The cycle:

1. Commit in logical chunks, with a message that says why. The Writing rules above apply to commit
   messages.
2. `npm test`, `npm run check`, `npm run lint`, and `npm run build` all clean.
3. Push, then merge to `main`. Say plainly that this is a production deploy, because the audience is
   live classrooms. Then say what to look at on the panel.

Revert with `git revert -m 1 <merge-commit>` on `main` and push. Vercel redeploys.

**Vercel preview URLs are not usable here.** Deployment Protection is on, so a preview link
redirects to `vercel.com/login`. It works for whoever owns the Vercel account and for nobody else,
which means it is no good for a panel or for handing to a teacher. Do not offer a preview as if it
were a way to test. Until that setting changes, `main` is the only route to a testable URL.

## Layout

```
scripts/build-geodata.js   Geometry pipeline (build-time only)
scripts/rosters.json       Which regions each quiz contains. The contract
src/lib/regions.js         Every quiz, keyed by URL path, + nav structure
src/lib/quiz.js            Quiz rules, pure, no DOM
src/lib/labels.js          Where region names go, pure, no DOM
src/lib/pick.js            Which region a tap landed on, pure, no DOM
src/lib/geo.js             Planar geometry primitives shared by those two
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

### What the numbers actually say

Measured on `/world`, which is the hard case at 177 regions. Frame rate is sampled while dragging
the globe, because lag is a frame-rate experience. Real GPU unless noted.

| profile                     | A globe.gl  | B MapLibre  |
| --------------------------- | ----------- | ----------- |
| desktop 1280x820            | 60 fps      | 60 fps      |
| 4K viewport, 3840x2160      | 60 fps      | 60 fps      |
| **weak CPU, 6x throttle**   | **10 fps**  | **60 fps**  |
| **weak GPU, software rast** | **8.6 fps** | **7.5 fps** |
| time to playable, 6x CPU    | 5363 ms     | 1888 ms     |

Read that carefully before assuming MapLibre is simply faster.

That table is a renderer comparison and nothing more. Its A column is stale as an absolute: it was
taken at a different viewport and before the starfield stopped being a second WebGL sphere. The
6x CPU row now reads 20 fps, not 10. Use the measurements in the next section for anything about
where the time goes.

**MapLibre's advantage is CPU bound, not GPU bound.** It tiles and simplifies GeoJSON in a Web
Worker. three-globe builds an object per polygon part on the main thread and submits every one of
them every frame. Starve the CPU and A collapses while B does not.

On healthy hardware the two are indistinguishable, which is why desktop testing finds nothing.

**Hover is not the cost, whatever it looks like.** It is tempting to blame raycasting, and this
file used to say three-globe raycasts every polygon on every pointer move. It does not.
`pointerRaycasterThrottleMs` defaults to 50 and `hoverDuringDrag` defaults to false
(`three-render-objects.mjs`), so a drag does no picking at all. Since frame rate is sampled while
dragging, those numbers contain no hover cost.

**That same hover machinery is why taps had to be taken away from globe.gl.** Those two defaults
are cheap because they make hover lazy, and three-render-objects answers a click by handing back
whatever the lazy hover raycaster last landed on. On a mouse that is invisible. On a touch panel it
is the game. There is no hover before a tap, so the answer is stale or null. Worse, any finger that
slides more than a pixel sets `isPointerDragging`, and `clickAfterDrag` defaults to false, so the
tap is discarded without a sound. A fingertip on a wall panel always slides more than a pixel.
`Globe.svelte` now does its own tap detection and asks `pick.js` what is under the finger, which
has no such state to get wrong. It also turns `enablePointerInteraction` off the first time a
finger is used, since hover means nothing on a panel and the raycast is pure cost there.

### What is actually slow, measured

A ClearTouch classroom panel, July 2026: Chromium 99, Mali-G52, CSS viewport 1280x624,
**devicePixelRatio 3**, 4 cores. `/world` on globe.gl ran at **20 fps** median.

That was reproduced exactly on a desktop GTX 1050 at 6x CPU throttle, at the panel's drawing buffer.
Both axes were then swept separately. Draw calls counted by wrapping the WebGL context, so the app
did not know it was being measured.

Pixels, CPU unthrottled:

| drawing buffer | megapixels | fps |
| -------------- | ---------- | --- |
| 1280x482       | 0.6        | 60  |
| 2560x964       | 2.5        | 60  |
| 3840x1446      | 5.6        | 60  |

CPU, at the panel's resolution:

| CPU throttle | fps    |
| ------------ | ------ |
| 1x           | 60     |
| 2x           | 60     |
| 4x           | 30     |
| **6x**       | **20** |
| 10x          | 12     |

At that 6x setting, holding CPU and resolution fixed and changing only the scene:

| route           | regions | draw calls | fps |
| --------------- | ------- | ---------- | --- |
| `/world`        | 177     | 720        | 20  |
| `/us`           | 50      | 414        | 30  |
| `/middle-east`  | 15      | 70         | 60  |
| `/world?fx=off` | 177     | 719        | 20  |
| `/world?dpr=1`  | 177     | 719        | 20  |

**Frame rate tracks draw calls. It does not track pixels.** Quartering the pixel count changed
nothing. Turning off the atmosphere and antialiasing changed nothing. Cutting the region count took
it from 20 fps to 60.

So `?dpr` and `?fx` will not rescue that panel, and neither will a smaller globe or a lower
resolution. **The lever is the 720 draw calls.** See Performance constraints.

One caveat kept honest: this was measured on a desktop GPU with the CPU throttled, so it proves the
workload is not pixel-heavy for a capable GPU. A Mali-G52 has a small fraction of that fill rate and
could still be partly limited by it. The draw-call sensitivity is the robust finding.

Two things to know before touching `MapGlobe.svelte`:

- **The worker must be imported as `?worker&url`.** MapLibre builds its worker path at runtime, so
  no bundler can see it; the map then never fires `load` _and never errors_. Plain `?url` is not
  enough. The worker imports `maplibre-gl-shared.mjs`, so copying one file just moves the
  failure inside the worker where nothing surfaces it. `vite.config.js` sets `worker.format:
'es'` to match.
- **Always subscribe to the map's `error` event.** MapLibre reports style and source failures
  through an event rather than throwing, so an unsubscribed failure looks exactly like a slow load.
- **MapLibre raises the browser floor. globe.gl does not.** `maplibre-gl-shared.mjs` calls
  `Array.prototype.at` (Chromium 92) and `Object.hasOwn` (Chromium 93). It runs on the main thread
  and in the worker, which are separate global scopes, so `src/lib/polyfills.js` is imported in
  both. three.js and globe.gl need neither.
- **`npm run build` asserts the worker survived.** `scripts/check-build.js` checks the chunk is
  large enough to contain MapLibre, that it assigns `self.worker`, and that the polyfills come
  first. This exists because the worker has already been silently removed twice, once by a bundler
  path it could not see and once by tree shaking, and the app gives no sign either time.

### Trying a renderer, and reading a device

Any quiz runs on either engine. `?r=maplibre` opts into MapLibre. Without it you get the shipping
renderer.

| flag          | what it does                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?r=maplibre` | Renderer B. Without it you get the shipping renderer                                                                                                        |
| `?stats`      | On-screen readout. Frame rate, worst frame, time to playable, real GPU, Chromium version, drawing buffer, and the methods MapLibre needs. Has a copy button |
| `?dpr=1.5`    | Overrides render resolution. Both renderers otherwise cap at 2                                                                                              |
| `?fx=off`     | Drops the atmosphere glow and antialiasing. Both are appearance, both cost fill rate                                                                        |
| `?labels=off` | Starts with no region names. The in-quiz button overrides it either way                                                                                     |

Send someone `/world?stats` and `/world?r=maplibre&stats` to get numbers off their hardware instead
of an impression.

`?dpr` and `?fx` exist to separate a fill-rate problem from a main-thread one. On the numbers above
they answer it: neither moves the frame rate on this workload. Keep them for checking a new device,
not for fixing this one.

Frame rate alone does not prove the renderer drew anything, and there is no code that can tell you
it did: neither renderer keeps its drawing buffer, so reading the canvas afterwards returns
transparent pixels whether or not the globe is on screen. An attempt at automating this reported
BLANK over a working globe and was removed. Look at the screen.

### The maintainer does the testing

Every test that needs a screen is run by a person. Do not ask for access to the maintainer's
browser and do not drive it. Two reasons. Testing by the model has not been accurate here, and it
reports success it has not seen. Handing an agent a logged-in browser is also a security problem
on its own.

So do not claim a change works in the app. Say what was checked and how. `npm test`, `npm run
check`, `npm run lint` and `npm run build` are yours to run and to report honestly.

Then finish the job: ship it, and write down what to click and what should happen. A short list of
steps is worth more than a claim.

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

This is a WebGL app that tessellates every polygon at load and redraws hundreds of separate meshes
every frame. Things that look harmless and are not:

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
- **The starfield is CSS, not `backgroundImageUrl`.** That option wraps the scene in a second,
  enormous textured sphere and repaints every pixel of the viewport with it every frame, to show a
  backdrop that never moves. It is a `background-image` on the container over a transparent canvas
  in both renderers. `globeImageUrl` is the Earth and is a different thing entirely.
- **Region names are DOM, not a globe layer.** three-globe's `labelsData` builds a `TextGeometry`
  per label from a typeface font, which on `/world` is 177 more meshes on hardware already short of
  draw calls. `labels.js` places them and `Globe.svelte` renders spans. See below.
- **Choosing names is throttled. Moving them is not.** These are two jobs and they run at two
  rates. Choosing means projecting every anchor in the quiz, culling the far side, and packing the
  survivors against collisions; at 60Hz that would cost more than the labels are worth, so
  `repackLabels` runs on a timer. Moving the twenty or thirty names already chosen is one
  projection each, and it runs on every `change`, which during a drag means every frame.
  `positionLabels` does that. Throttling both is what made names swim across the map on a panel:
  at 20 fps a 90ms throttle leaves them two frames behind the land.

**The next real optimisation, and the only one left that matters.** three-globe builds a cap mesh
and a stroke line per polygon part (`three-globe.mjs`), and `/world` measures **720 draw calls a
frame**. That number, not pixel count, is what sets the frame rate on weak hardware. See the
measurements above.

Merging the caps into one mesh with a vertex colour attribute, and the borders into one
`LineSegments` built from the shared TopoJSON arcs, takes 720 to about 4. Hover and click feedback
become a partial write to the colour attribute instead of a material swap, and picking maps a face
index back to a feature through stored ranges. Borders get drawn once each rather than once per
neighbour, which the pipeline's shared arcs already make possible.

It means not using three-globe's polygon layer. That is the cost, and it is worth it: nothing else
on the list moves the number.

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

### The name fades before the region is finished

Two thresholds, and they are deliberately different numbers.

- `MASTERY` is 2. Correct clicks needed before a region is done and counts towards the win.
- `SCAFFOLD` is 1. Correct clicks after which the region stops showing its name.

So a student meets a region with its name on the map and finds it by reading. That name then goes,
and the second, unaided click is the one that tests whether they remember where it was. The support
is there for the trial that builds the memory and gone for the trial that checks it. Names thin out
across a session as regions are learned, which frees space for the ones still showing.

`SCAFFOLD` must stay below `MASTERY` or the progression does nothing: the label would only vanish
at the moment the region was already finished. An earlier pass moved label hiding to `MASTERY`,
treating a half-learned region losing its name as a bug. It is the entire point. `quiz.test.js`
guards the relationship.

The region currently being asked for always gets its name placed, ahead of every other, whenever it
is still scaffolded. Otherwise "Find Germany" can appear over a map naming all of Germany's
neighbours and not Germany, and a student fairly concludes it is not in the quiz.

Names are drawn on the map, not on hover. Hover does not exist on a touchscreen, so a hover tooltip
meant the naming aid was missing on classroom panels, which is where this is used. `?labels=off`
and the in-quiz button switch them off for a class past needing them.

### Where a name goes

`src/lib/labels.js`, pure and DOM-free like `quiz.js`, so both renderers could drive it and the
placement rules can be tested without a browser.

- **The anchor is the pole of inaccessibility**, the point inside the shape furthest from any edge,
  found by quadtree subdivision. A centroid is not good enough. Averaging vertices put 26 of 467
  anchors outside their own region: Norway in Sweden, Croatia in Bosnia, Florida in the Gulf. It
  failed on exactly the outlines a student finds hardest. `geodata.test.js` asserts all 467 land
  inside, against the real shipped geometry.
- **Multi-part regions are named on their largest piece**, so a country with distant islands gets
  its name on the mainland rather than out at sea.
- **Only what the camera can see.** A projection happily returns screen coordinates for a point
  behind the planet, so those are culled. The renderer supplies the test, built from its own
  lat/lng-to-3D function, so there is one convention and not two. It measures the angle to the
  camera itself. A camera at a finite distance sees less than a hemisphere: about 65° either side at
  `/world`, under 50° on `/us/northeast`. An earlier version had its axes swapped relative to
  three-globe and assumed 90°. Names blinked out at the centre of the screen and far-side names
  were drawn over near-side land.
- **Collisions resolve smallest region first.** This ordering is the whole design and it is the
  opposite of the obvious one. Labelling whatever is big enough names Russia and skips Luxembourg,
  which is backwards: small regions are the names a student needs. Letting them claim their spot
  first means a crowded map keeps the hard names and drops the obvious ones.
- **Text is measured, not estimated.** The renderer passes a `measure` function built from a 2D
  canvas using the same font as the CSS. Guessing width from a character count is guessing twice:
  too narrow and labels overlap after passing the collision test, too wide and names get dropped
  that would have fitted.
- **Measure the box, not the glyphs.** Width comes from `measureText`, but height is the line box:
  font size times line height, plus padding. An earlier pass used `actualBoundingBoxAscent` and
  `actualBoundingBoxDescent`, which looks more precise and is wrong. It gives about 9px for a name
  with no descender while the span the browser lays out is always 18.8px tall, so collision passed
  pairs that overlap once drawn. That is the failure the bullet above warns about, in the code
  written to prevent it.
- **Every threshold is sticky.** `placeLabels` takes `sticky`, the names chosen on the previous
  pass, and judges those more leniently: some overlap allowed, a little more of the limb, a few
  pixels past the viewport edge. Without it names blinked in and out. The choice is remade every
  90ms while the globe moves, each cutoff is hard, and with several names close together whether
  the third fits depends on where the first two landed, so one pixel of drift cascades. Ordering
  is deliberately left alone. Sorting held names ahead of new ones would let a large name that
  happens to be on screen beat a small newcomer, which inverts the rule above it.
- **A new name needs clear air, not a free pixel.** The same constant is the gutter. Boxes sharing
  an edge passed the old test and read on screen as one run of text.

**Known limit, and the fix if it is wanted.** Nothing caps the label count, so collisions are the
only thing that removes a name. At the opening view of a regional quiz that still bites: `/europe`
places 19 of 39 at 1280x624, because the small countries are stacked in a small part of the screen.
Two ways out. Framing, by lowering the `pov` altitude in `regions.js` so the quiz opens closer. Or
leader lines: place a crowded name in the empty space around the landmass and draw a thin line back
to its region, the way an atlas names Luxembourg. Leader lines are the better answer, because a
globe view has a lot of empty space and they would let most of those 39 names show at once. It
needs an offset search in `placeLabels` and an SVG overlay for the lines.

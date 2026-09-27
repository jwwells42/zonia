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

| Command                             | What it does                                                             |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`                       | Dev server                                                               |
| `npm run build` / `npm run preview` | Production build / serve it locally                                      |
| `npm test`                          | Vitest over quiz logic and built geodata                                 |
| `npm run check`                     | `svelte-check`                                                           |
| `npm run lint` / `npm run format`   | Prettier check + ESLint / rewrite                                        |
| `npm run geodata`                   | Rebuild `static/geo/` from upstream sources. **Not** part of `build`     |
| `npm run logo`                      | Redraw the mark and favicons from `static/geo/`. **Not** part of `build` |

## Starting work

**Read the git before planning anything.** `git fetch`, then read `git log origin/main`. Not just
before merging. Before planning.

The branch in the working tree tells you nothing about what has shipped. The maintainer works
from more than one device and ships to `main` from all of them, so `main` can be weeks ahead of
whatever happens to be checked out. The status snapshot at the top of a session is a snapshot,
and it goes stale.

**If the working branch is behind `main`, stop and reconcile.** Say what has moved and agree what
to do about it. Do not start a second branch to work around it, and do not carry on regardless.
One line of work, reconciled first.

**When the maintainer asks about the state of the repo, that is the job.** Read the branches, the
log on `origin/main`, the stashes, and anything unpushed. Answer from what git says, not from the
opening snapshot.

This is not a formality. In September 2026 a session planned and wrote three commits on a branch
from August. `main` had moved twice in between and already carried fixes for the same faults. Two
of the three commits were thrown away, and one of them was built on a diagnosis that the shipped
code had already disproved.

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
scripts/build-logo.js      Draws the mark and favicons from world.topo.json
scripts/rosters.json       Which regions each quiz contains. The contract
src/lib/regions.js         Every quiz, keyed by URL path, + nav structure
src/lib/quiz.js            Quiz rules, pure, no DOM
src/lib/pick.js            Which region a tap landed on, pure, no DOM
src/lib/geo.js             Planar geometry primitives, shared with the tests
src/lib/landMesh.js        Every cap in one mesh, every border once, no DOM
src/lib/Globe.svelte       Renderer A, globe.gl / three-globe
src/lib/MapGlobe.svelte    Renderer B, MapLibre (evaluation)
src/lib/mapStyle.js        MapLibre style spec and view framing
src/lib/palette.js         Region colours, shared by both renderers
src/routes/styles.css      Page colour tokens and the one typeface
src/routes/[...region]/    One route serving every quiz
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
taken at a different viewport, before the starfield stopped being a second WebGL sphere, and
before the land became one mesh. Use the measurements in the next section for anything about where
the time goes. The comparison has not been re-run since.

**MapLibre's advantage is CPU bound, not GPU bound.** It tiles and simplifies GeoJSON in a Web
Worker. three-globe built an object per polygon part on the main thread and submitted every one of
them every frame. Starve the CPU and A collapsed while B did not. A no longer does that. See "The
land is one mesh" below.

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
has no such state to get wrong.

**The highlight has to come from the same place as the answer.** Moving taps to `pick.js` and
leaving hover on `onPolygonHover` left two different ideas of which region is under the pointer,
and near a border they disagree: the pointer lit one country and the click answered its
neighbour. The cause is in the hover raycaster. three-globe gives each polygon a cap mesh and a
`LineSegments` outline and scales the outline to sit above the cap, and three.js counts a line as
hit whenever the ray passes within `raycaster.params.Line.threshold` of it, which
three-render-objects leaves at 1. The globe radius is 100, so that is several screen pixels of
invisible grab zone, and both neighbours draw an outline along a shared border.

So `enablePointerInteraction` is off from construction and globe.gl does no picking at all. One
function, `regionUnder`, answers both, with the same tap tolerance for both. They cannot disagree
now because there is nothing left to disagree with. It is also cheaper: a raycast over every
polygon every 50ms is gone, replaced by one sphere intersection and a point-in-polygon test.

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
resolution. **The lever is the 720 draw calls.** They are now 4. See Performance constraints.

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
| `?labels=off` | Starts with names off, so a tap or hover lights a region without naming it. The button overrides it                                                         |

Send someone `/world?stats` and `/world?r=maplibre&stats` to get numbers off their hardware instead
of an impression.

`?dpr` and `?fx` exist to separate a fill-rate problem from a main-thread one. On the numbers above
they answer it: neither moves the frame rate on this workload. Keep them for checking a new device,
not for fixing this one.

**No URL flag can turn the GPU off.** The browser chooses the GPU before any page code runs. To
imitate a weak device from a desktop, change the browser instead:

- Weak CPU: DevTools, Performance, CPU throttling. 6x reproduced the panel's 20 fps before the
  land became one mesh.
- No GPU: start Chromium with software WebGL. Recent Chromium needs the second flag, or WebGL is
  simply unavailable. The separate profile stops an already running Chromium from ignoring the
  flags.

  ```
  chromium --use-angle=swiftshader --enable-unsafe-swiftshader --user-data-dir=/tmp/zonia-nogpu
  ```

  Check the GPU line in `?stats` says SwiftShader. If it names a real card, the flags did not take.
  Software rendering runs GPU work on the CPU, so this mixes the two costs. It tells you whether a
  change helps a weak GPU. It does not tell you which of the two is the limit.

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

Add an entry to `REGIONS` in `src/lib/regions.js`, and its path to `NAV` if it should appear in
the header. `NAV` takes its labels from `REGIONS`, so a quiz is named once. To change _which_
regions a quiz asks about, edit `scripts/rosters.json` and re-run `npm run geodata`. A new roster
also needs a vertex budget in `BUDGETS`.

**Continent subregions follow the UN's M49 scheme**, names and membership:
<https://unstats.un.org/unsd/methodology/m49/overview/>. It was chosen because a teacher can cite
it. Where M49 differs from a textbook, M49 wins, unless a named curriculum document says otherwise.
"How it is usually taught" from memory is not a source. Four regions are not in M49 and are placed
with their neighbour; `regions.js` lists them. North America has no Northern America part, because
three countries are not a quiz.

`geodata.test.js` checks every submenu: each part asks only about its parent's regions, and every
parent region is in exactly one part. Anything left out on purpose is listed there with the reason.

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

Each file must stay under 150 KB, because a player downloads only the quiz they open. `world` is
the largest, at about 120 KB. Most subregions are at Natural Earth 1:50m's full detail already, so
a sharper subregion needs a finer source, not a bigger budget.

Re-running the pipeline needs network access; downloads cache in `scripts/.cache/` (gitignored).
Outputs are committed so deploys never run it.

## Performance constraints

This is a WebGL app that tessellates every polygon at load and redraws the whole map every frame.
Things that look harmless and are not:

- **Never put GeoJSON in `$state`.** Svelte 5's deep proxies would wrap thousands of coordinate
  arrays. Only values the template renders are runes; everything `globe.gl` touches is a plain
  variable, and repaints are pushed to three.js by hand.
- **The land is two meshes, not three-globe's polygon layer.** See the next section. Do not
  bring back `polygonsData`: it is 720 draw calls on `/world`.
- **Hover and feedback rewrite one region's colours.** `paintRange` writes that region's slice of
  the colour attribute and marks only that slice for upload. Use `MeshBasicMaterial`. It is what
  three-globe built its caps from, so Lambert would change the shading.
- **`globe.gl` never resizes itself.** It reads `window.innerWidth/innerHeight` once at
  construction. `Globe.svelte` drives `.width()/.height()` from a `ResizeObserver`; without it the
  page overflows and phone rotation permanently breaks the view.
- **Dispose the globe on unmount.** `world._destructor()`, plus the land's geometries and
  materials. globe.gl 2.46 empties its scene on destruct as well, but the land is ours, so we free
  it ourselves. Skipping this leaks a WebGL context per region switch. The original code avoided the issue by forcing a full
  page reload on every navigation. That is why it felt slow.
- **Curvature resolution trades triangles for roundness.** The 5° default is wasted on a
  zoomed-in region where nothing spans enough longitude to bend visibly. See `curvatureFor`.
- **Small regions get an exact cap, and that is correctness, not tuning.**
  `three-conic-polygon-geometry` has two paths. Given no interior grid points it runs earcut over
  the outline, which is exact. Given them it runs Delaunay over outline plus grid, then discards
  any triangle touching the outline whose _centroid_ falls outside the polygon. That last test is
  a guess, and on a narrow shape it guesses wrong and leaves land with nothing drawn on it. It is
  what put holes through the Caprivi Strip and northern Botswana. Sampling inside every polygon
  of the shipped world geometry, **23 of 177 regions had uncovered land**. `capResolution` in
  `geo.js` sends anything under 15 degrees of arc down the exact path, which takes 23 to 14 and
  costs nothing: 11,161 triangles against 11,381. The limit is where a flat chord would sag
  through the globe. Wider regions still need the guess.
- **Total area cannot detect a hole in a cap.** It measured 100% while the holes were there. The
  same guess that drops triangles inside the shape also keeps triangles that spill outside it, and
  the two cancel. `geodata.test.js` samples points inside each polygon and asks whether any
  triangle covers them, which is the test that finds it.
- **Thin regions are mostly border, and the right colour for that is unsettled.** WebGL draws a
  line one device pixel wide and will not go thinner, so a region narrower than about two screen
  pixels is covered completely by its own outline and its neighbours'. Measured on the shipped
  world geometry at the standard framing, **41 of 177 regions average under four screen pixels
  wide**: Luxembourg 1.5, The Gambia 1.4, the Caprivi Strip about 1.4. The border was lightened
  to stop those reading as gaps, and that was reverted pending a look on a real screen. The
  measurement stands; the colour is a judgement nobody has made yet. Removing the stroke is not
  the answer: a thin region's cap is the same colour as its neighbour's, so the outline is the
  only thing showing it is there.
- **Regions lie flat.** `landGeometry` passes `includeSides` false. Side walls were ~67% of every
  triangle: 34,507 down to 11,381 for `world`.
- **The starfield is CSS, not `backgroundImageUrl`.** That option wraps the scene in a second,
  enormous textured sphere and repaints every pixel of the viewport with it every frame, to show a
  backdrop that never moves. It is a `background-image` on the container over a transparent canvas
  in both renderers. `globeImageUrl` is the Earth and is a different thing entirely.
- **The region name is DOM, not a globe layer.** three-globe's `labelsData` builds a
  `TextGeometry` per label from a typeface font, which costs a mesh and a draw call each. There is
  only ever one name on screen, and it is a span placed with a `transform`, so moving it never lays
  the page out again.

**The land is one mesh and the borders are one more.** three-globe's polygon layer built a cap
mesh and an outline per polygon part, and `/world` measured **720 draw calls a frame**. On weak
hardware that number, not pixel count, set the frame rate.

`landMesh.js` builds every cap with the same `ConicPolygonGeometry` call three-globe made, then
merges them into one geometry with a colour per vertex. `ranges` records each region's run of
vertices. Borders come from topojson-client's `mesh`, so a shared border is drawn once, not once per
neighbour. Both meshes go straight into globe.gl's scene, which uses the same coordinates as
three-globe. Picking never touched the meshes, so it did not change.

Measured on the GTX 1050 at 6x CPU throttle, 1280x700 at dpr 3, dragging:

| quiz           | draw calls | fps before | fps after | worst frame before | after |
| -------------- | ---------- | ---------- | --------- | ------------------ | ----- |
| `/world`       | 720 to 4   | 7          | **30**    | 183 ms             | 50 ms |
| `/us`          | 414 to 4   | 10         | **60**    | 183 ms             | 33 ms |
| `/middle-east` | 70 to 4    | 60         | 60        | 67 ms              | 33 ms |

The "before" figures are lower than the 20 fps in the table above. Same GPU and throttle, but a
different day and harness, so compare within a table, not across them. `?stats` now shows draw
calls, so a panel can confirm the 4.

**Where it stands, September 2026.** On the maintainer's desktop in Chrome DevTools, `/world` drags
smoothly at 6x CPU throttle. At 20x everything lags: turning, hovering, the lot. That points to
per-frame main-thread cost in general, not one feature. Tap and hold works on a phone. The panel
itself has not been re-measured since the land became one mesh. Do that first. `/world?stats` on
the panel is the number that matters.

The client bundle is ~1.8 MB raw / ~530 KB gzipped, almost entirely three.js and three-globe.
three-globe ships as one pre-bundled module with every layer (hexbin, tiles, voronoi, paths, arcs)
referenced by its kapsule composition, so the unused ones cannot be tree-shaken. Dropping `globe.gl`
for direct three-globe use was measured and does not pay. Because of that bundle plus `ssr = false`,
`src/app.html` carries a static `#boot` splash that paints before any JavaScript runs;
`+layout.svelte` removes it on mount.

## Design system

Three rules, each with a source a teacher could check.

- **Hues come from Okabe and Ito's Color Universal Design palette.** The globe uses yellow for
  hover, blue for right and vermillion for wrong. The old green and red came out as the same khaki
  under simulated deuteranopia, which affects up to 8% of boys. `palette.test.js` fails if any two
  region states get too close under deuteranopia or protanopia. The page's one accent is reddish
  purple, the Okabe-Ito hue the globe does not use, so nothing on the page looks like an answer.
  <https://easystats.github.io/see/reference/palette_okabeito.html>
- **Greys come from USWDS system tokens.** Each has a grade from 0 (white) to 100 (black). A gap of
  50 or more between two grades meets WCAG AA for text. WCAG 2.1 AA is what the ADA Title II rule
  asks of US public schools. <https://designsystem.digital.gov/design-tokens/color/overview/>
- **One typeface, upright only: Atkinson Hyperlegible Next.** The Braille Institute drew it with
  low-vision readers so that I, l and 1 differ. In Poppins and Anta, which it replaced, "Illinois"
  began with two identical strokes. The prompt used to be italic, and italic reads worse for
  students with dyslexia (Rello and Baeza-Yates, 2013). Do not swap in a "dyslexia font". Studies
  of OpenDyslexic found no gain.

Region colours live in `src/lib/palette.js` and page colours in `src/routes/styles.css`. `app.html`
repeats four page colours because it paints before the stylesheet loads. Translucent overlays stay
as `rgba()`, because `color-mix()` needs Chromium 111 and the panel runs 99.

The mark is the Earth drawn from Natural Earth, which is public domain. It replaced the EAST
Eureka Springs Middle School logo, which is someone else's registered mark. Change its view or
detail in `scripts/build-logo.js` and run `npm run logo`.

The land grey, the header and the accent have not been judged on the panel yet.

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

So a student meets a region with its name one tap or hover away and finds it by reading. That name then goes,
and the second, unaided click is the one that tests whether they remember where it was. The support
is there for the trial that builds the memory and gone for the trial that checks it.

`SCAFFOLD` must stay below `MASTERY` or the progression does nothing: the name would only vanish
at the moment the region was already finished. An earlier pass moved label hiding to `MASTERY`,
treating a half-learned region losing its name as a bug. It is the entire point. `quiz.test.js`
guards the relationship.

### Names on demand

|            | Mouse | Touch or pen                |
| ---------- | ----- | --------------------------- |
| See a name | Hover | Tap, or the start of a hold |
| Answer     | Click | Hold for `HOLD_MS`, 1000 ms |

A name shows for the region being pointed at, one at a time. It shows only while the region is
scaffolded. The highlight shows either way, so a player always sees what they are about to answer.
`?labels=off` and the in-quiz button turn the names off.

This replaced standing names on every region, and the reasons are worth keeping:

- **Hover alone left touch with nothing.** That is why standing names were tried. Tap to see and
  hold to answer gives a finger the same look-then-commit that hover gives a mouse.
- **Standing names cost frames and cluttered the map.** On `/world` about 88 names and 25 leader
  lines were repositioned on every frame of a drag, on a panel already at 20 fps. They took many
  rounds to stop drifting and blinking. The last version is in git at `dacf6b3` if they are ever
  wanted back.

Rules that hold this together:

- **Where the finger lands decides the answer.** The region lit on `pointerdown` is the one a hold
  answers. Moving past `TAP_SLOP_PX` makes it a drag and cancels the hold. A second finger makes it
  a pinch and cancels it too.
- **A tap's name stays up after the finger lifts**, until the next touch, a drag, or an answer. It
  sits above the finger, where the class can read it.
- **Mouse or touch is decided per event** from `pointerType`, never per device. A touchscreen
  Chromebook gets both.
- **The browser's own long press is blocked on the globe.** Chromium opens a menu or selects text
  on a held finger, and a held finger is how a touch player answers.
- **The hold ring is a CSS animation.** Nothing runs in script while it fills.

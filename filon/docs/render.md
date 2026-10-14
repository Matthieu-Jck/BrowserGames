# Rendering (`src/render/**`)

Ocelle draws one world in two views — an **isometric** view to look at the colony and a top-down
**plan** view to build — and morphs between them in half a second. PixiJS 8 (WebGL) draws; all
art is generated in code with Canvas2D in a "Moebius ink" style: terrain in a worker, sprites in
atlases baked on the main thread. Render reads the sim and never mutates it.

## Where things are

| Path | Role |
|---|---|
| [stage.ts](../src/render/stage.ts) | Creates the Pixi renderer (no `Application`, no ticker) and the root container |
| [projection.ts](../src/render/projection.ts) | `proj(t)`: the tile → world-px map of the view, its inverse, culling helpers |
| [iso.ts](../src/render/iso.ts) | Iso constants `TW`/`TH`/`LH`, `tileToIso`/`isoToTile` (+ legacy iso-only helpers) |
| [camera.ts](../src/render/camera.ts), [camera-math.ts](../src/render/camera-math.ts) | Smoothed camera centred in tile space; pure world ↔ screen maths |
| [layers.ts](../src/render/layers.ts) | The fixed container tree, `LayerName`, `setView` (projection + cross-fade) |
| [relief.ts](../src/render/relief.ts) | Pure maths of the tiered rock relief (levels, masks, slabs, walls); `tileTop`, the one height of a tile's top every lift reads; `surfaceTile`, the tile a view ray meets first |
| [perf-overlay.ts](../src/render/perf-overlay.ts) | Frame timing, draw-call counter, `FL.perf()` stats |
| [stress.ts](../src/render/stress.ts) | `StressSpike`: the M0 particle spike kept as a perf tool (`FL.stress`) on `fxTop` |
| [daynight.ts](../src/render/daynight.ts) | The time of day's look: keyframes → `Grade` (tint, night factor, sun, clouds); `DayNight` applies it and holds the `FL.dayPhase` offset |
| [world/terrain-chunks.ts](../src/render/world/terrain-chunks.ts) | Streams painted ground / relief-paint chunk textures; fog |
| [world/relief-view.ts](../src/render/world/relief-view.ts) | Near-zoom rock columns as depth-sorted sprites; `level(x, y)` (= `tileTop`) |
| [world/buildings-view.ts](../src/render/world/buildings-view.ts) | Building sprites (iso + plan, lifted onto the rock top when they stand on the mountains), ribbon pieces; moving parts turning (`animate`); the incinerators' pits and their flames; the cast shadows |
| [world/stand.ts](../src/render/world/stand.ts) | Pure: how high a building stands and how it sorts (D44): `computeStands` once per rebuild, `standOf` / `liftOf` for the other views, `standLevel` for the ghost, `drawnLevel` (a ribbon: its tile's top) for picking; the depth keys `rockZ`, `buildingZ`, `standZ`, `beltZ`, `liftZ` |
| [world/traction-lifts.ts](../src/render/world/traction-lifts.ts) | The traction ribbons' elevators (D56): which steps get one (`liftOfBelt`), their frames baked on demand (`liftFrames`: back, car, front, plan mark) |
| [world/belt-lift.ts](../src/render/world/belt-lift.ts) | Pure: where an item is drawn and how high (`place`: its tile's top, or on an elevator's car), where each car is (`settle`, `carAt`), and where an item above the floor, in a shaft or at an incinerator sorts among the volumes (`itemZ`: its host tile's key) |
| [world/pits.ts](../src/render/world/pits.ts) | The incinerators' pits (D51): an item's way in (`pitPath`: up the chute, over the lip, falling), the fire (`PitFire`, one per colony, `pitFire(sim)`: when the last item fell, its heat), the pit's frames baked on demand (`pitFrames`: back and front; `flameFrames`; `planFlameFrame`) |
| [world/moving-parts.ts](../src/render/world/moving-parts.ts) | Pure: how fast a moving part turns (a turbine with the wind on its grid, a machine while it works), each building's own start phase |
| [world/cast-shadows.ts](../src/render/world/cast-shadows.ts) | Pure: the cast shadows' look through the day (`shadowLook`: length, swing, opacity), the map that stretches a baked shadow (`shadowMap`), the sun's direction (`sunDirection`), the seam a mask is clipped to (`farSide`, `seamClip`), how far a shadow can reach (`shadowReach`) |
| [world/items-view.ts](../src/render/world/items-view.ts) | Items riding ribbons and routing blocks: draws the item flow at the land's height (belt-lift.ts) — on the floor as particles under the volumes, above it (or falling into a pit) as sprites sorted among the volumes in iso and as particles over the rock ribbons' plan copies in plan |
| [world/item-flow.ts](../src/render/world/item-flow.ts) | Pure (no Pixi): the paths items ride across each ribbon tile (`buildPieces`: bends, a skybridge's leap and decks, a junction's hump and when items are drawn over it), a routing block's way through its centre |
| [world/cell-flow.ts](../src/render/world/cell-flow.ts) | Pure: where each item is drawn, read from the engine's cells (D57): on its tile, eased in from where it was over one step |
| [world/cast-shadows.ts](../src/render/world/cast-shadows.ts) `reliefSun`, [art/terrain.ts](../src/render/art/terrain.ts) `paintSunShadows`, [world/relief-view.ts](../src/render/world/relief-view.ts) `setSun` | The rock's shadows following the sun (D59): the floor's as a chunk texture (`s`), the rock tops' as a tint of their columns |
| [world/heart-flag.ts](../src/render/world/heart-flag.ts), [art/emblem.ts](../src/render/art/emblem.ts) | The claim's flag on the Heart (D58): baked wave frames bearing the emblem, laid and stepped by the buildings view; the emblem's ink drawing (shared with the register's designer) |
| [world/ghost-view.ts](../src/render/world/ghost-view.ts) | Build ghost, demolition / marking boxes, hover outline; the flow arrows of a directional routing block being placed |
| [world/flow-arrows.ts](../src/render/world/flow-arrows.ts) | Pure: which blocks take in at their back only (`isDirectional`) and their flow arrows (`flowArrows`) |
| [world/overlays-view.ts](../src/render/world/overlays-view.ts) | Grid, the claim's land in parcels (D60: held, leased, a sister claim's; the land mode's grid and marks), the power overlay (P), the Link tool's marks, selection, dig/fill marks, freight routes, reach circles |
| [world/wires-view.ts](../src/render/world/wires-view.ts) | The power wires (D25), terminal to terminal: fine catenaries in iso, straight inked lines in plan, glints, the Link tool's preview wire |
| [world/wire-geom.ts](../src/render/world/wire-geom.ts) | Pure wire geometry: a building's terminals in the world (`terminalsAt`, lifted with a building on the mountains), the one a wire hangs from (`wireAnchor`, `wireEnds`), sag, catenary points, points along a polyline |
| [world/drifters-view.ts](../src/render/world/drifters-view.ts) | Freight balloons shuttling between skydocks |
| [world/landing-view.ts](../src/render/world/landing-view.ts) | `LandingView`: the intro's landing (D31) — the Heart lowered into the cirque by a CrierBelt sky-crane (`drawCrane` with `SKY_CRANE`, the drawing the cargo drone shares): descent, flames, dust, touchdown, the crane's exit |
| [world/cargo-view.ts](../src/render/world/cargo-view.ts) | `CargoView`: at each trade, a CrierBelt cargo drone (the sky-crane at 0.9 scale) works the trade post's deck — hauls a container up (a sale), sets one down (a purchase) — and the deck's lift iris takes it in or brings it up |
| [world/cargo-flight.ts](../src/render/world/cargo-flight.ts) | Pure: the cargo drone's choreography (`poseAt`), the deck's place on a trade post (`deckCentre`, mirrored from its art: the middle of its 5 × 5 pad and apron, D62) |
| [world/lights-view.ts](../src/render/world/lights-view.ts) | `LightsView`: night glows (additive), solar states (solar panel petals, PV cells); `CloudShadows` |
| [art/tokens.ts](../src/render/art/tokens.ts), [ink.ts](../src/render/art/ink.ts) | Palette; inked strokes, flat fills, hatching, stipple, shadows |
| [art/shapes.ts](../src/render/art/shapes.ts), [iso-shapes.ts](../src/render/art/iso-shapes.ts) | Machine vocabulary seen from above (`Frame`) / in iso volume (`IsoFrame`, `Scene`) |
| [art/terminals.ts](../src/render/art/terminals.ts) | Where the power wires meet each building: the terminal table (`TERMINALS`, one point or a few per building, in its unrotated frame), the poles' heads (`POLE`, `PYLON`), the Heart's link masts; `turnsArt` / `artRot` (which rotation a building's art is drawn in), `rotLocal` (the art's rotation rule) |
| [art/recipes/](../src/render/art/recipes/) | One drawing per building (iso + plan), belts, item glyphs, status icons; `fx.ts`: the light spy, night rigs, glow / haze / cloud textures, solar panel petals, PV states; `moving.ts`: the buildings with a moving part and the geometry their two views share |
| [art/silhouette.ts](../src/render/art/silhouette.ts) | A context that paints a drawing's solid fills in one colour (cast-shadow masks) |
| [art/solar.ts](../src/render/art/solar.ts) | `PV` (the solar-cell colour) and `pvPanel`: draw cells with them and they get their day / night states |
| [art/atlas.ts](../src/render/art/atlas.ts), [dyn-atlas.ts](../src/render/art/dyn-atlas.ts) | Static atlas baked at boot; on-demand atlas for relief columns |
| [art/terrain.ts](../src/render/art/terrain.ts), [terrain.worker.ts](../src/render/art/terrain.worker.ts), [rock.ts](../src/render/art/rock.ts) | Chunk painters (ground, relief paint) and the rock-column painter, worker-safe |

Related: [app.md](app.md) (frame loop, view state, picking), [input.md](input.md), [content.md](content.md),
[engine.md](engine.md), [testing.md](testing.md), [glossary.md](glossary.md), [extending.md](extending.md)
(end-to-end checklists), [../ARCHITECTURE.md](../ARCHITECTURE.md).

## 1. How a frame is drawn

Render has no loop. `main.ts` runs one `requestAnimationFrame` loop and calls the app's frame,
which drives render in this order (details in [app.md](app.md)):

1. **View morph.** The view state moves a linear `t` towards its goal (0 iso, 1 plan) over 0.5 s;
   `te = ease(t)`; `P = proj(te)`. P goes to `camera.P` and to `layers.setView(P, te)`.
2. **Sim and events.** Fixed-step ticks; chunks in `grid.dirtyChunks` → `terrain.invalidate(ck)` and
   `relief.invalidate(ck)`; a structural change → `buildings.rebuild(sim)`, `items.rebuild(sim)` and
   `lights.rebuild(sim)`.
3. **Camera.** `camera.update(dt)`, then `camera.apply(world, w, h, resolution, snap)`, with `snap`
   only when `te` is exactly 0 or 1.
4. **Views**, in this order (relief reads the chunks terrain found visible):
   `terrain.update(cam, w, h, dpr, P, te)` → `relief.update(cam, w, h, terrain.visible, P, te)` →
   `ghost.draw(preview, sim, hover, show)` (the preview is null outside build mode) →
   `wires.update(sim, te, dt, linkPreview, overlays.powerOn)` (the Link tool's preview and
   `overlays.linking` are set first, its hover from `picker.entityAt`) →
   `overlays.update(sim, viewTiles, te, zoom, selected, relief.level, ghostReach)` →
   `dayNight.update(worldTick, te)` → `lights.update(grade, P, te, seconds)` →
   `clouds.update(grade, P, te, tx, ty, zoom, seconds)` (§10, *Day and night*) →
   `drifters.update(sim, P, te, seconds)` → `buildings.setPlanness(te)` → `buildings.animate(sim,
   gameSeconds, grade)` (moving parts, cast shadows) → `items.update(sim, fractionalTick, P, te, zoom, viewTiles)`.
   The dev `StressSpike` updates last, if active.
5. `renderer.render(stage.root)`, then perf stats.

Conventions: a parameter named `t` in render code is always the **eased** plan-ness `te`, never
the linear morph parameter. `viewTiles` is the tile rectangle covering the screen: its corners
unprojected through P⁻¹, plus the relief headroom.

### Coordinate spaces

| Space | Definition | Who lives there |
|---|---|---|
| Tile | Continuous; integer = tile corner; +x east, +y south; `Rot` 0 = N, clockwise | Sim, camera centre, everything on a P plane |
| Iso world px | `tileToIso(x, y, z)` = P(0)·(x, y) − z·`LH` | Volumes: building and cliff sprites (`objects`) |
| View world px | `apply(P, x, y)` | Items, drifters, `CamState.cx/cy` |
| Screen CSS px | `(world − centre)·zoom + viewport/2` | Pointer events, DOM |
| Atlas px | 2× world for iso sprites (`k = 0.5`), 64 px/tile for plan and belts | Art recipes |

## 2. Stage ([stage.ts](../src/render/stage.ts))

`createStage(host, { perf })` calls `autoDetectRenderer` with `preference: 'webgl'`,
`resolution = min(2, devicePixelRatio)` (1 in perf mode), `autoDensity`, antialias off in perf
mode, a sand background, and **`textureGCActive: false`**. The atlas is permanent and terrain
textures are evicted by their own LRU, so lifetimes are managed by hand ([Pitfalls](#14-pitfalls)).
`root.eventMode = 'none'`: picking goes through the sim's occupancy grid and the app's volume
tests, never through Pixi's event traversal. `stage.width/height` are CSS px; `resize()` runs on
window resize. The canvas is fixed full-window, so `clientX/clientY` are canvas coordinates.

## 3. Projection: one linear map, two views

```
tile (x, y) ──P(te)──▶ view world px ──camera──▶ screen px
                ▲
iso px ──M(te)──┘      M(te) = P(te)·P(0)⁻¹   (identity at te = 0)

te = 0, iso:  P = rotate 45°, then scale (45.25, 22.63)   te = 1, plan:  P = 32·I
                  (0,0)                                         (0,0)──(1,0)
             (0,1)     (1,0)    a tile = 64 × 32 diamond          │ 32 px │
                  (1,1)                                         (0,1)──(1,1)
```

`proj(t)` ([projection.ts](../src/render/projection.ts)) interpolates the *angle* and the *axis
scales*, not the matrix entries, so the board turns and lies down instead of shearing:

```ts
θ = π/4·(1 − t);  sx = lerp(TW/2·√2, TOP, t);  sy = lerp(TH/2·√2, TOP, t)   // TOP = 32
X = sx·(cos θ·x − sin θ·y)    // Lin: a = sx·cos θ,  c = −sx·sin θ
Y = sy·(sin θ·x + cos θ·y)    //      b = sy·sin θ,  d =  sy·cos θ
```

- `Lin {a, b, c, d}` uses Pixi's matrix layout (`X = a·x + c·y`, `Y = b·x + d·y`); `apply`,
  `invert`, `compose(B, A)` (A first) work on it. `ease` is smoothstep; `ISO_LIN = proj(0)` equals
  `tileToIso` at z = 0.
- **Flat content lives in tile units under P.** Ground and relief-paint chunks, ribbons, plan
  sprites, grid, overlays, fog and ghost are drawn top-down in tile units. A linear map of the
  plane keeps them valid for every `te`, so one ground texture per chunk serves both views and
  the whole morph.
- **Volumes live in iso px under M = P·P(0)⁻¹.** Building and cliff sprites are pre-drawn in
  iso perspective, so their height is baked into the bitmap and they cannot be re-projected.
  Their anchors sit at `tileToIso(x, y)` = P(0)·(x, y), so M·P(0)·(x, y) = P(te)·(x, y): each
  sprite stays glued to its footprint while the ground turns. The art only looks right at
  te = 0, so volumes fade out by te = 0.6 and separate plan sprites fade in.
- Helpers: `isoToView(P)` (= M), `screenTile(P, cam, w, h, sx, sy)` (screen → tile on the ground
  plane, z = 0), `visibleChunksP(P, cam, w, h, margin, reliefPx)` (unprojects the screen corners,
  also lifted by the relief headroom, then box-tests each chunk with `tileBoxBounds`),
  `reliefHead(t, levels) = levels·LH·(1 − t)` (cliffs only stand up in iso).

[iso.ts](../src/render/iso.ts) holds the iso constants (`TW` 64, `TH` 32, `LH` 16 px per level)
and `tileToIso`/`isoToTile`. Its other exports (`visibleChunks`, `chunkIsoBounds`, `groundMatrix`,
`screenToTile`, `depthOf`, `WORLD_ISO`) predate the morph and are only used by `iso.test.ts`.

## 4. Camera ([camera.ts](../src/render/camera.ts), [camera-math.ts](../src/render/camera-math.ts))

- **Centre in tile space.** `cur` and `target` are `{tx, ty, zoom}`. The tile at the screen
  centre stays put while the view morphs; `state` turns it into world px with the current `P`
  (the app sets `camera.P` every frame).
- **Moves:** `panScreen(dx, dy)` maps a screen delta through P⁻¹ at the target zoom.
  `zoomBy(f, sx, sy, w, h)` keeps the ground point under the cursor fixed: it computes the
  cursor's tile offset before and after, in tile space through P⁻¹. `jumpTo` and `centerOnTile`
  cut; `glideTo` only moves the target (used by Home).
- **Glide:** `update(dt)` eases with `k = 1 − e^(−14·dt)` (frame-rate independent), zoom in log
  space, and snaps to the target below small thresholds. `moving()` compares cur and target.
- **Apply:** `apply(world, w, h, resolution, snap)` sets the world container's scale and position;
  when idle and `snap` is on, the position is rounded to device pixels so ink lines stay crisp.
- **Limits:** zoom is clamped to [`ZOOM_MIN` 0.125, `ZOOM_MAX` 2] (`clampZoom`); the centre is
  clamped to `bounds`, which is the whole 1024² map.
- [camera-math.ts](../src/render/camera-math.ts): `worldToScreen`, `screenToWorld`, `clampZoom`
  and `CamState` are live. `TILE`, `zoomAt`, `viewRect`, `chunkRange` and `tileAt` assume the old
  top-down world (1 tile = 32 px) and are used only by tests.

## 5. Layers and z-order ([layers.ts](../src/render/layers.ts))

```
stage.root                          eventMode 'none'
└─ world        [render group]      camera transform (scale = zoom, position)
   ├─ lit       [render group]      the graded world: DayNight's tint, one uniform
   │  ├─ plane        P             terrain · decals · belts
   │  ├─ items        —     [rg]    item particles on the floor, in view world px
   │  ├─ shadowsIso   M   × isoA    shadows  (the buildings' cast shadows on the ground)
   │  ├─ reliefPlane  P   × isoA    relief   (painted relief chunks)
   │  ├─ planPlane    P   × planA   plan     (plan building sprites; sorted: rock ribbons' copies, items over them, buildings)
   │  ├─ volumes [rg] M   × isoA    objects  (iso buildings + cliff columns + items above the floor, z-sorted)
   │  ├─ itemsOver    —     [rg]    items riding a junction's deck or a skybridge, over every building
   │  ├─ wiresIso     M   × isoA    wires [rg]      (power wires)
   │  ├─ wiresPlanPlane P × planA   wiresPlan [rg]
   │  └─ shade        —             cloud shadows (multiply; CloudShadows sets P itself)
   ├─ lights    [render group]      night glows, additive (LightsView: iso under M, plan under P)
   ├─ top             P             grid · overlays · fog · land · ghost [rg]
   ├─ status    [rg]  —             drifters (view world px)
   ├─ fxTop           —             the cargo drones' containers, the intro's landing (under M), M0 stress spike
   └─ fxGlow          —             the landing's and the cargo drones' flames and their light (untinted); the cargo drones over their flames (tinted by hand)
```

| LayerName | Filled by | Notes |
|---|---|---|
| `terrain` | TerrainChunks: ground chunks, sand placeholders | |
| `decals` | — | Declared, unused |
| `belts` | BuildingsView: ribbon and conduit pieces on the floor (JunctionsView: the passages) | Flat in both views. A piece on rock goes to `objects` (iso, key `beltZ`) and `plan` instead (D56) |
| `items` | ItemsView: the items on the floor | Drawn above belts, below relief paint, plan sprites and volumes. Items above the floor (on rock, in an elevator's shaft) or at an incinerator are drawn among the volumes in iso (`objects`) and over their ribbons on `plan` |
| `itemsOver` | ItemsView: items riding a junction's deck or a skybridge (the model's `o`) | Over every building in both views (render group) |
| `shadows` | BuildingsView: the cast shadows | Iso px under M, faded with the volumes; above ribbons and items (they fall over them), under the relief paint and every volume (a shadow never falls on a building) |
| `relief` | TerrainChunks: relief-paint chunks | The *painted* relief; relief *sprites* are in `objects` |
| `plan` | BuildingsView: plan sprites; ItemsView: the items above the floor (a container drawn through P⁻¹, so in view px) | `sortableChildren` in bands (stand.ts `PLAN_Z`): the plan copies of ribbons and junction passages on rock (−2), the elevators' marks (−1.5), the items riding them (−1), every building sprite at 0 in the order laid — so items on rock show over their ribbons and go under a building, as on the floor |
| `objects` | BuildingsView iso sprites (the incinerators' pits in two parts with their flames), ReliefView columns, ItemsView: pooled sprites of the items above the floor, in a shaft or at an incinerator | `sortableChildren`, shared zIndex keys (§7.4). Its parent `volumes` is a render group: an item crossing a tile changes its key, and the re-sort and re-batch stay inside the volumes |
| `grid`, `overlays` | OverlaysView | Fade by `te` inside the view |
| `land` | OverlaysView: the claim's land (D60) — parcels held, leased, a sister claim's; the land mode's parcel grid, hovered and picked parcel | Above the fog (a map of who holds what, readable over land not explored yet), below the ghost; untinted like the overlays |
| `fog` | TerrainChunks fog masks | Above the overlays |
| `ghost` | GhostView | Render group |
| `status` | DriftersView | Named for status icons, which do not exist yet |
| `fxTop` | CargoView (the deck's iris, shadows, dust, the container, cables), LandingView (the Heart, the crane, cables, dust, shadow), `StressSpike` (`FL.stress`) | |
| `fxGlow` | LandingView and CargoView: thruster flames, nozzle halos, the plumes' light on the ground; the cargo drones themselves, over their flames, and their own lights at night | Above everything and outside the day / night grade, so emitted light stays bright at night. A cargo drone sits here so its hub, beams and pods hide its plumes (the back engine's burns behind the hub); it copies `fxTop`'s tint every frame to stay graded |
| `shade` | CloudShadows | Inside `lit` (graded), above everything in it; multiply blend |
| `lights` | LightsView glows | Above `lit` so the grade never dims them; additive; its alpha is the night factor |
| `wires` | WiresView, iso: wires, preview wire, glints | Under M with the volumes, faded by `isoA`; above every building and cliff (not depth-sorted: a wire may pass over a building) |
| `wiresPlan` | WiresView, plan: lines, preview, glints | Tile units under P, faded by `planA`, above the plan sprites |

DayNight tints `lit`, `fog`, `status` and `fxTop` (and the stage background): the grid, the
overlays and the ghost stay untinted so building aids read the same day and night.

`setView(P, te)` gives the plane containers (`plane`, `reliefPlane`, `planPlane`, `top`, `wiresPlanPlane`) `P`, and `volumes`, `shadowsIso` and `wiresIso` M = `isoToView(P)`; the shadows and the iso wires fade with the volumes (`isoA`), the plan wires with the plan sprites (`planA`). It then
cross-fades with an overlap, so the colony never vanishes mid-morph:
`isoA = 1 − te/0.6` (volumes and relief paint) and `planA = (te − 0.3)/0.7` (plan sprites), both
clamped. A container at alpha 0 is also made invisible, so Pixi skips it.

| te | 0 | 0.3 | 0.45 | 0.6 | 0.8 | 1 |
|---|---|---|---|---|---|---|
| isoA | 1 | 0.5 | 0.25 | 0 | 0 | 0 |
| planA | 0 | 0 | 0.21 | 0.43 | 0.71 | 1 |

The views fade their own content: grid `te × zoom ramp × 0.55`; the land `max(te, landOn)` (its grid and marks only with `landOn`); flat
marks `te`, lifted marks `1 − te`. Items on the floor float `(3 + z)·(1 − te)` px above ribbons (z: a skybridge deck or a junction's hump). Above the floor, in an elevator's shaft or at an incinerator, an item is drawn among the volumes while `te < 0.6`, at its iso px `tileToIso(x, y) − (3 + z + lv·LH)` (lv: the land's height under it, belt-lift.ts) like any volume, so M carries it with the ribbon it rides, its sprite drawn through M⁻¹ so it stays upright; and on `plan` from `te > 0.3`, flat over the ribbons' plan copies (`(3 + z)·(1 − te)`): it cross-fades as its ribbon does. Drifters fly at
80 px (±3) in iso and 6 px in plan. Relief-paint sprites show and relief columns stream only
while `te < 0.6`. Render groups (`world`, `items`, `itemsOver`, `volumes`, `ghost`, `status`) keep the transforms on the
GPU and isolate rebuilds of fast-changing content.

## 6. Terrain chunks ([terrain-chunks.ts](../src/render/world/terrain-chunks.ts), [terrain.ts](../src/render/art/terrain.ts), [terrain.worker.ts](../src/render/art/terrain.worker.ts))

Each 32 × 32-tile chunk has two textures. Both are painted top-down, sized in tiles, and laid on a
P plane:

| Kind | Layer | Shown | px per tile | Painter |
|---|---|---|---|---|
| `'g'` ground | `terrain` | both views | 8, 16, 32, 64 | `paintChunk` |
| `'r'` relief paint | `relief` | `te < 0.6` | ≤ 32 (`RELIEF_MAX`) | `paintRelief` (null when no rock) |

**Bucket choice.** `need = zoom·(36 − 4·te)·dpr` texels per tile, for about 1 texel per device
pixel (a tile edge spans about 36 world px in iso and 32 in plan). The chosen bucket is the
smallest one ≥ 0.9·need, else 64.

**Per frame** (`update(cam, w, h, dpr, P, te)`):
1. `visible = visibleChunksP(P, cam, w, h, 0, reliefHead(te, MAX_LEVEL))`. This list is shared
   with ReliefView.
2. For each visible chunk and kind: show the wanted bucket if it is cached. Otherwise request it,
   plus an 8 px/tile stand-in first, and show the best cached bucket meanwhile. A ground chunk
   with nothing cached shows a flat sand placeholder. `missing.count` counts ground chunks not at
   their bucket; it becomes perf `chunksMissing`, which the smoke test waits to see reach 0.
3. Sprites of chunks that left the view are destroyed; their textures stay cached.
4. `pump()` keeps at most 3 paints in flight. The queue is sorted by distance to the camera centre,
   stand-ins first and relief after ground. Queued requests at a stale bucket are dropped.

**Worker protocol.** `buildWindow(grid.chunkAt, cx, cy, 1024)` cuts the paint window: the chunk
plus `BORDER` = 7 tiles all round (`WIN` = 46) of terrain / ore / rich / height / biome. The main
thread posts `PaintRequest {…window, key, ppt, kind}`, **transferring** the five buffers. The
worker paints a `32·ppt` px OffscreenCanvas and transfers back `{key, bitmap}`; `bitmap: null`
means nothing to paint. The bitmap becomes an `ImageSource` texture (mipmapped, linear). A relief
request whose window has no rock (`hasRock`) is answered locally with null.

**Memory.** Cache key `${kind}:${ck}:${ppt}`, LRU by last frame shown. The budget is 256 MB of
bitmap bytes (w·h·4; mipmaps are not counted). Over budget, entries not on screen are dropped,
oldest first, down to 85 %. `drop()` destroys the texture and its source plus any sprite showing it.

**Invalidation.** Digging or filling adds the chunk to `grid.dirtyChunks`. The app calls
`invalidate(ck)`, which drops both kinds at every bucket, and the next update repaints. See
[Known gaps](#15-known-gaps) for the neighbour-seam and in-flight caveats.

**Fog.** Each visible chunk gets a 4-texel-per-tile alpha mask built from `sim.explored` discs
`[x, y, r]`. Tiles 2 or more inside a disc are clear; the mask ramps to 93 % fog colour at the
disc edge. Chunks fully inside a disc have no sprite. A mask is rebuilt when the set of discs
touching its chunk changes (discs only grow).

**`paintChunk` passes:** (1) a smoothly upscaled pastel field with biome tints and height
whitening; (2) world-hashed stipple; (2b) hardpan plateaus; (3) water with an inked shore; (4) rock
as a map of its **levels** (owner, 2026-10-14: the mountains looked different in plan and in iso, and
were hard to build on): each rock tile's terrace slabs outlined exactly as the iso columns are
(relief.ts `masksAt` / `slabOutline`: the tile, its corners chamfered by its neighbours), step by
step from the foot up — the step's shadow on the terrace below, its fill in the colour its columns'
tops wear in iso (`topColor`: hardness, lighter by 0.075 a relief level so the plan, which sees only
tops, tells the levels apart), its silhouette inked (bold at the floor) — over the rock's soft cast
shadow; the old contours and hatching drawn from the smoothed height field are gone; (5) vents, ore
deposits, biome decor. Ripples, crackle and decor need ≥ 16 px/tile. Edges use marching
squares over a smoothed field read from the border window, and every random choice is hashed from
**world** coordinates, so seams match without coordination.

## 7. Relief

### 7.1 Pure maths ([relief.ts](../src/render/relief.ts))

Shared by the worker and the main thread; no DOM, no Pixi.

| Concept | Rule |
|---|---|
| Level | `levelOf(terrain, level)`: 0 off rock. On rock it is the sim's own level (D45, `grid.level`, the paint windows' `level` array), clamped 1..5 (`MAX_TERRACE`), × `STEP_LEVELS` (2): 2 to 10 relief levels. Water and reclaimed ground (`Filled`) above the floor — the Crown's tarn (D63), the one water up there — stand at their level too, a column like the rock round them; any other ground has relief level 0. Since D52 (2026-10-13) it no longer comes from a smoothed height, so the drawn terraces are the levels placement, ribbons and wires obey, and a footprint the rules call level ground is drawn flat. 1 level = `LH` = 16 world px; a terrace is a one-tile-high wall. |
| Tile top | `tileTop(land, x, y)`: THE height of a tile's top (levels; 0 = the floor), where whatever stands on it stands. Every lift reads it, so all move together when it changes: buildings on the mountains, their moving parts, shadows, night lights and wire anchors (through world/stand.ts), the build ghost, the iso picking, the overlays' marks on rock (`ReliefView.level`). Today `levelAt` over the land (a height of 0 off the world, as the paint windows read it), so it is exactly the level the sprites and the paint draw; meant to become the sim's `grid.level(x, y)` × one terrace's height. |
| Ray | `surfaceTile(land, px, py)`: the tile a view ray meets first, from its ground point (where it crosses z = 0). A point `lv` levels up on the same ray lies `lv·SHIFT` tiles further along +x+y, so walking down from `MAX_LEVEL`, the first tile whose top reaches the ray is the rock top or cliff it hits; else the ground tile. |
| Mask | `maskAt(level, x, y, at)`, 8 bits. `M_E/M_S/M_W/M_N`: that side drops below the threshold. `M_NE/M_SE/M_SW/M_NW`: the diagonal neighbour stands as high; kept only at convex corners, so columns that look alike share one sprite. |
| Slabs | `masksAt` returns one mask per terrace step (thresholds 2, 4, … level). A column erodes only down to its neighbours' height, never to the ground. |
| Chamfers | A convex corner is cut 0.38 tile along each side, or all the way to the next corner where a diagonal neighbour carries the edge on. Diagonal fronts become straight walls instead of staircases. |
| Outline | `slabOutline(masks, t)`: the unit tile clipped by the half-planes of every chamfer of steps 0..t. Upper slabs nest inside lower ones and never leave the tile. Each segment carries a silhouette flag (its side drops, or it is a chamfer). |
| Walls | `wallRuns(outline)`: runs of silhouette segments that face the camera (`facesCamera`: normal towards +x+y), each with open-air ends. `shadeOf(a)`: 0 for the lit +y face, 1 for the shaded +x face. |

### 7.2 Painter ([rock.ts](../src/render/art/rock.ts))

`drawColumn(ctx, proj, cls, masks, {detail, seed, k, top})` draws the slabs bottom-up. Walls come first:
per-segment shade, occlusion at the foot, and hardness marks (`cls` 0 sandstone strata, 1 basalt
joints, 2 obsidian facets and glints, 3 heartrock with glowing veins), hatched on shaded faces at
detail 2. Next a flat top, lighter with height, with grain. The ink goes last: lit lip,
silhouettes, ground contact, open-air verticals, folds. `columnShadow` casts along +x. Detail is
0 (flat), 1 (worker, ≥ 32 px/tile) or 2 (sprites). The caller's `proj` picks the projection, so
one painter serves both renderings and they always agree.

**Water up on the rock** (D63: the Crown's tarn; owner: "put the lake at the top of the moutain").
A column whose tile is water or reclaimed ground, or rock in whose corner three tiles of water at
its height meet, gets a `top` (`TopLook`: what the tile is, and which tiles of its 3 × 3 hold water
and deep water at its height; [terrain.ts](../src/render/art/terrain.ts) `columnLook` reads it from
the paint window, and gives a column of water the hardest rock round it for its walls). Its top is
the rock's, then its part of the pool: marching squares over the tile's corners (each worth the
share of the four tiles meeting there that hold water, cut at a half), so the shore runs on from
tile to tile — straight along a side, on the diagonal at a corner, into the rock's corner where
the water turns — shallow, the deep within it (the same cut over deep tiles), a ripple, the shore
inked over a paper glow as on the floor's water. Each part bleeds its colour (not over a deep
neighbour's), and is clipped to its top only when a drop has cut that top back (the rock round
the pool dug away), so tiles of water join without a seam. Reclaimed ground is fill. The water is
drawn at its level in both renderings, never as a hole down to the floor; in plan the ground
paint shows it within the rock (water before rock in `paintChunk`).

### 7.3 Two renderings of the same columns

| | Far: relief paint | Near: relief sprites |
|---|---|---|
| Where | `'r'` chunk textures on `relief` | `objects`, depth-sorted with buildings |
| How | `paintRelief` in the worker paints the columns in depth order through an **oblique** projection. One level shifts a point `SHIFT` = LH/TH = 0.5 tile along −x−y, which P(0) turns into a pure 16 px lift. Shadows are composited once, at 24 %. | `ReliefView` makes one sprite per rock tile, baked on demand into a `DynAtlas` |
| When | Always in the iso half | Zoom ≥ 0.3 turns them on, < 0.26 off (hysteresis); frozen while `te ≥ 0.6` |

Near the camera both are drawn. The sprites cover the painted columns exactly, and the paint still
supplies the cast shadows, which the sprites lack (hence the 32 px/tile cap). Past the LOD
threshold the sprites go and only the line work changes.

**ReliefView.** Columns stream in 8 × 8-tile blocks, culled with `tileBoxBounds` plus the relief
headroom. Per-chunk relief (levels, per-step masks, rock class, top) is computed with the worker's
own `buildWindow` + `windowLevels` + `columnLook` and cached. A sprite's atlas key is
`${cls}:${masks}:${variant}:${topKey}`, with two hashed variants. Baking is capped at 8 ms per frame. A block appears only when all of its
columns are baked; otherwise it is retried next frame and the paint shows meanwhile (`pending`
counts the waiting columns). Sprites are 2× (scale 0.5), anchored on the tile's back corner at
`tileToIso(x, y)`. `invalidate(ck)` drops the 3 × 3 neighbourhood, because masks and smoothing read
neighbours. `stats()` feeds perf `reliefSprites` and `reliefBaked`. `level(x, y)` returns a tile's
top (0 = floor): `tileTop`, the one height function, today the level the columns are drawn at. The
overlays use it to lift iso marks onto rock tops: shifting `level·SHIFT` tiles along −x−y moves a
point exactly `level·LH` px up in iso.

**DynAtlas** ([dyn-atlas.ts](../src/render/art/dyn-atlas.ts)) grows on demand. `add(key, w, h,
ox, oy, draw)` bakes through a temp canvas onto shelf-packed 2048² pages (6 px padding) and
accumulates `spent` ms. `flush()` uploads dirty pages once per frame and resets the budget. It
never evicts: the key space is bounded (4 hardnesses × mask combinations × 2 variants).

### 7.4 Depth sorting with buildings

`objects` has `sortableChildren` (set by BuildingsView's constructor). Its zIndex keys share one
scale, `4 × (doubled depth) + kind`, all in [world/stand.ts](../src/render/world/stand.ts):

```ts
rockZ(x, y)                 = 8·(x + y)                                 // kind 0
buildingZ(x, y, w, h)       = 4·(2x + w − 1 + 2y + h − 1) + 1           // kind 1: on the floor
standZ(x, y, w, h, reach)   = 8·(x + w − 1 + y + h − 1 + reach) + 0.5   // standing on the mountains
beltZ(x, y)                 = 8·(x + y) + 0.5                           // a ribbon piece on a rock top
liftZ(lowX, lowY)           = 8·(lowX + lowY) + 0.7                     // an elevator, by its low tile (+0.01 car, +0.02 front)
// items (belt-lift.ts `itemZ`), by their host tile:
beltZ + 0.05                                                            // on a ribbon (or bare rock) on the rock top
liftZ + 0.03                                                            // on an elevator's low tile: over its front frame
beltZ − 0.02                                                            // on a building's tile (a routing block, a junction's tunnel): under it
key(pit) + 0.1 | + 0.2                                                  // an incinerator's: behind its flame (far half, falling) | over it all (near half)
```

**Items among the volumes** (owner, 2026-10-14: "the copper is above the building that is in
front… the traction ribbon sometimes makes items disappear"). An item above the floor, in an
elevator's shaft or at an incinerator is a sprite in `objects` keyed by the tile it rides over,
so the painter's order hides it behind exactly what stands in front of it — a higher column, a
silo, a pole (only the pole's pixels) — and nothing else. The host is the tile its front-most
point (`ITEM_REACH`, 0.16 tile along x and y: the glyph is a third of a tile across) is on, when
every tile it overhangs is no higher than it rides and holds no building; else its centre's
tile. That keeps an item crossing onto the next tile of a plateau from being clipped by that
column's top, keeps one on the car at the top of a step down away from the viewer over the high
column (it shows over the edge, then sinks behind it with the car), and keeps one at the foot of
a wall behind it. A tile with an elevator keys its items after the elevator's front frame (drawn
over its elevator, never behind it, owner 2026-10-13); a building's tile just under the building
(after a junction's passage at − 0.05, under the bridge; a routing block swallows what goes in);
an incinerator's tile, or one overhanging it, sorts with its pit (§10, *Incinerators*). On the
floor away from any incinerator an item stays a particle on `items`, under every volume. The keys
are worked out per tile on first ask after each rebuild (`BeltLift` reads the stands the
buildings view has just worked out).

A ribbon piece on rock sorts after the columns of its own diagonal and before those in front (a
tile of the same diagonal never overlaps it on screen); a junction's passage just under it (− 0.05,
under the bridge). An elevator stands on its step's low tile, so it sorts after that tile's ribbon
and, when the high column is in front of it (its wall faces away from the camera), before that
column, which hides all but its head — and the items in its shaft below the column's top.

A cliff in front of a machine hides it, and a machine in front of a cliff covers it. Equal keys
keep insertion order (the sort is stable). Sorting by centre depth is a painter's approximation
that holds for buildings on the floor. A building standing on the rock (D44) sorts by its front
tile instead, or the column under its front corner (8·(x + y + 2) for a 2 × 2, past its centre
key) would cover it, and on past the columns ahead of it that stand no higher than it (they
never overlap it on screen), as far as its longest shadow falls (`reach`, from
`shadowReach(isoHead)`): its shadow lies among the volumes just under it (key − 0.3), over that
rock. The reach stops short of a higher column in the building's screen band (rock in front of it
still hides it) and of a building on the floor (it stays in front), and keeps every lifted
building ahead of it after it (stands are worked out front to back). A moving part sorts at the
key ± 0.2, a solar overlay at + 0.25, a chosen item at + 0.4, an incinerator's flame at + 0.12 and its near rim at + 0.15. Inside one sprite, the recipe's
`Scene` orders the parts. The app's iso picking ranks its hits by the same keys.

## 8. Atlas ([atlas.ts](../src/render/art/atlas.ts))

`bakeAtlas()` runs once at boot on the main thread (timed as perf `atlasMs`). It draws every piece
with Canvas2D and shelf-packs the pieces, tallest first with ties broken by key (deterministic),
onto 2048² pages with 8 px padding that survives mipmapping. Each page is one `CanvasSource`, so a
layer batches per page. `Atlas = {pages, frames, textures, bakeMs}`. `frameCanvas(atlas, key,
scale)` copies one frame into a standalone canvas for the DOM (build-bar icons, artboard),
pixel-identical to the game. The canvas is backed at `devicePixelRatio` (up to 3) and shown at its
CSS size, so icons stay sharp on high-density screens.

| Key | Helper | Content | Anchor `(ox, oy)` | `k` | Rotations |
|---|---|---|---|---|---|
| `b:<id>:<rot>` | `bKey` | Iso volume | Rotated footprint's ground corner (tile 0,0, z = 0) | 0.5 world px / atlas px | 4 if `needsRotations(id)` (= `turnsArt`), else rot 0 |
| `bt:<id>:<rot>` | `btKey` | Plan sprite | `TOP_MARGIN` (14, 14) = footprint top-left | 1/64 tile / atlas px | 4 if `needsRotationsTop(id)` (= `turnsArt`) |
| `i:<id>` | `iKey` | Item glyph, drawn in its 32 px space at 2× (64 px: crisp UI icons on dense screens; a sorter's chosen item) | Centre | 0.5 | — |
| `ib:<id>` | `ibKey` | Item as it rides a ribbon: the glyph at 2× on a paper halo, with a contact shadow, `IB_PX` 64 px | Centre | 1 | — |
| `belt:<tier>:s\|c` | `beltKey` | Straight (moving north) / corner (south → east), 64 px | Centre | 1/64 | Turned / mirrored at draw time |
| `belt:<tier>:inlet` | `inletKey` | Side inlet over a straight piece: a line merging in from the left (the rail opens) | Centre | 1/64 | Turned with the piece; mirrored for the right side |
| `belt:deck` | `DECK_KEY` | Skybridge deck, one tile, seamless along its length | Centre | 1/64 | Turned with the bridge |
| `ic:<id>` | `iconKey` | Status cartouche, 40 px | Centre | 1 | — |
| `b:…/body`, `bt:…/body` | `bodyKey` | A building with a moving part (`recipes/moving.ts`): its body alone (with its ports) | As its sprite | As its sprite | As its sprite |
| `b:…/<k>`, `bt:…/<k>` | `partKey` | Phase k of its moving part, cropped to the bounds all phases paint; the phases are packed as one sheet (one page: stepping through them never breaks a batch) | As its sprite | As its sprite | As its sprite |

`FrameInfo {page, x, y, w, h, ox, oy, k}`: `k` converts atlas px to the sprite's space. Views
fall back to rot 0 when a rotation was not baked. `Atlas.moving` maps a building sprite's key
(`b:` / `btKey`) to `{n, over}`: its phase count and whether, in iso and that rotation, the part
is drawn over the body (else under it); plan parts are always over. The full sprite (`b:`, `bt:`)
stays the whole picture — body and part at phase 0 — for icons, the artboard, picking and the
night lights. Ribbon-like ids (`isBeltDef`: ribbon, swift,
express, conduit) get no building frames.

## 9. Art pipeline: the Moebius ink

Style rules, as the code applies them:

0. **Precise, not sketchy** (owner, 2026-10-12). One knob in [ink.ts](../src/render/art/ink.ts), `INK`, sets how hand-made a line looks: ink outlines × 0.78 (coloured strokes keep their width), wobble × 0.35, width variation ± 6 %, shadow-side swell + 30 %, ellipse irregularity × 0.5. Tune it there, not recipe by recipe.
1. **Ink, never black.** Outlines use `C.ink` (#1b1830, a violet black) drawn by `ink()` as filled
   ribbons of varying width: seeded wobble, tapered ends, heavier on the shadow side.
2. **Flat fills, no gradients** (`flat`, `shape`). Shading comes from hatching (`hatch`, mostly
   π/4 seen from above and π/3 on iso faces), stippling (`stipple`, `grain`) and shadow crescents.
3. **Light from the top-left of the screen, whatever the rotation** (`LIGHT = (−0.6, −0.8)`; in tile
   terms it comes from −x). Tops get a lit rim. The +y face (`'L'`) is mid-tone and the +x face
   (`'R'`) is shaded and hatched. Cast shadows are flat ink at low alpha, offset down-right
   (`castShadow`), and highlights sit upper-left. Frames rotate positions, never the light.
4. **Palette** ([tokens.ts](../src/render/art/tokens.ts)): the land is in warm desert pastels
   (sand, dune, mesa, peach, salt, hardpan; rock runs from peach sandstone to violet heartrock).
   Machinery is cold painted metal (steel blues, teal, violet, ice) with hot accents (coral, brass,
   hazard) and glowing lights (`led`, `ledWarm`, `ledRed`, `ledGreen`, `glow*`). Ports: turquoise
   intakes, coral nozzles. `num()` gives a Pixi tint, `mix()`/`rgba()` blend, and
   `pushTokensToCss()` exposes `--t-<token>` so the DOM and the canvas agree.
5. **Deterministic.** Strokes are seeded (`makeRng`, `hash32`); terrain randomness is hashed from
   world coordinates; atlas packing is ordered.
6. **Detail by scale.** Ground details appear at ≥ 16 px/tile; rock detail is 0/1/2 (§7.2).
7. **Item glyphs are precise vector icons** (owner, 2026-10-12: "we need something precise, recognizable"): plain paths, each part drawn by `part()` in [recipes/items.ts](../src/render/art/recipes/items.ts): a flat body, a shaded and a lit crescent (`rim()`, light from the top-left), one 1.6 px ink outline (`OUT`); no wobble and no hatching. They must read at 12–20 px, on a ribbon and in the HUD; a new item gets a silhouette no other item has.
8. **Power reads as power** (owner, 2026-10-12: "poles should look more like poles"; wires to "a precise place on every building"). The pole is a utility pole — a slim weathered-steel post on a concrete footing, a crossarm level across the screen (the local diagonal (1, −1)) on two braces, porcelain pin insulators, a junction box with its light, a drop cable (nobody climbs it: no pegs); the pylon a square steel lattice with a crossarm and suspension strings. Every building that takes part in power shows where its wires clamp: an insulator from [art/terminals.ts](../src/render/art/terminals.ts) — glazed porcelain (`C.ice`), a brass clamp, on a short dark service mast — at the point its table gives (§10, *WiresView*). The first pole's petal-cup drawing is kept, unused (`petalMastIso`, `petalMastTop`).
9. **The CrierBelt mark** (owner, 2026-10-12: "simpler, more sci-fi"): a ringed planet — a teal world with a crisp shadow crescent, a brass belt rising to the right, its far half behind the planet, its near half across it; two colours, one precise ink line, flat fills, no wobble (`crierMarkMapped` in [shapes.ts](../src/render/art/shapes.ts)). It reads at 8 px (the crescent drops out below 7). One drawing through a `map(u, v)`: a sign from above (`crierMark`), a deck or a wall in iso (`crierMarkIso`, `crierMarkFace`), the Heart's curved uplink dish (`dish3d`), the intro's register (a canvas), the landing crane's hub. It wore it on the trade post and the Heart's dish until 2026-10-13 (owner: "the planet icons are not needed", D58); it is left on CrierBelt's own things: the register's heading, the freight container, the landing crane.
10. **The trade post keeps a flame apron** (owner, 2026-10-14: "should block any construction in a 1 case radius around it because of the flames of the drones… a special ribbon at the entrance, and on the other side for the imports, that can resist to the flames", D62). Its 5 × 5 footprint is drawn in three parts, the same in iso (`trade_post` in [recipes/buildings.ts](../src/render/art/recipes/buildings.ts)) and in plan ([recipes/buildings-top.ts](../src/render/art/recipes/buildings-top.ts)). **The pad** (`TP_PAD`, the middle 3 × 3): the D58 platform on a `slab` / `plinth` over that rect only (their `at` argument), its hazard edge broken by the exit's hood, the deck (`TP_DECK` at local (2.5, 2.5), radius `TP_DECK_R`, height `DECK_Z`), three lamp posts (`TP_LAMPS`) and the power pedestal (`TP_PED`) with its wire terminal ([terminals.ts](../src/render/art/terminals.ts)). **The scorched apron** (the outer ring, `tpApron` / `scorchTop`): baked ground at the edge, ragged burns darkening towards the pad (`SCORCH`: baked, burnt, soot), blast streaks fanning out, stipple soot, cracks with a pale lip, sand fused to lilac glass, a few coral embers (paint, not LED tokens: the night would light them white), and CrierBelt's keep-out line in hazard dashes, half burnt off; its marks come from one seeded `apronMarks()` in local tiles, so both views and all four rotations agree. **The two flame-proof ribbons** (`TP_RIBBON`: the entrance across local (2, 4), the exit across (2, 0), at rotation 0; `tpRibbon` / `tpRibbonTop`): a dark-steel chute ramping from the ground at the apron's edge up to the pad (iso), its band (`TP_BAND`, a ribbon's width) laid with ceramic heat-shield plates, low riveted shield walls (`TP_WALL`) tempered along their length (`TP_TEMPER`: straw at the cool end, bronze, purple, blue at the pad), chevrons in the port's colour (cyan in, coral out) pointing the way the items go, and at the pad an armoured hood (`tpHood` / `tpHoodTop`) whose dark mouth faces the ribbon. The far ribbon is drawn before the pad, the near one after everything on it. The apron and the ribbons lie on the ground and **cast no shadow** (the recipe skips them in a `ShadowFrame`: a cast shadow is stretched from the foot with the day, and would drag a 5 × 5 decal across the sand).

11. **The incinerator is a pit that burns what falls in** (owner, 2026-10-14: "the incinerator should have a style that shows more clearly that it will destroy the item. Maybe a hole in the ground with a flame that activates when an item falls in it?", D51). One tile, the same in iso (`pitIso` in [recipes/buildings.ts](../src/render/art/recipes/buildings.ts)) and plan (`pitTop` in [recipes/buildings-top.ts](../src/render/art/recipes/buildings-top.ts)), its geometry in `PIT` (local tiles, levels: the collar's radii and top, the throat's floor below the ground, the chutes' width and lip): scorched ground (`pitMarks`: soot blotches and cracks, seeded once for both views); a low riveted collar whose top is tempered by the heat (`PIT_TEMPER`: brass at its edge to blue at the throat); a dark throat whose far wall darkens into a coral glow down to a grate over the fire bed (`EMBER`, paint, not LED tokens: the pit's night glow is its fire's, lights-view.ts); on every side a steel chute from the tile's edge up over the collar to a lip above the throat, a turquoise band at its mouth (the way in, as every in-port) and a cyan chevron pointing in. It is drawn in parts (`PitPart`): the `back` (ground, throat, the collar's far half, the far chutes) and the `front` (the collar's near half, the near chutes), so the world can put an item falling in and the flame's root behind the near rim; the atlas sprite is both (`all`: icons, picking). **The flame** (`pitFlameIso`, `PIT_FLAMES` heights × two flickers, and the embers at level 0): flat tongues, coral outside, orange, a pale core, inked in dark coral, sparks over the tallest; embers rising and a wisp of smoke as it dies. In plan, the flame seen from above (`pitFlameTop`): a ragged star of coral tongues over the throat, faded in with the fire. The ground and the hole cast no shadow (a `ShadowFrame` skips them): only the collar and the chutes do.

| Module | Draws | Frame |
|---|---|---|
| [shapes.ts](../src/render/art/shapes.ts) | Seen from above: plinth (over the footprint, or a part of it: `at`), dome, bulb, pipe, rotor, petals, antenna, arm, spire, vault, port, grille, dish, LEDs, cable, hull, chevron, tankTop, stack, crate, drumTop, truss, `terminalTop` (a power terminal), the CrierBelt mark (`crierMarkMapped`, `crierMark`)… | `Frame(S, M, w, h, rot)`: `p(x, y)` maps unrotated tile coords → px, `l(len)`, `dir(side)` |
| [iso-shapes.ts](../src/render/art/iso-shapes.ts) | Iso volumes: `box`, `slab` (over the footprint, or a part of it: `at`), `cylinder`, `domeIso`, `vaultIso`, `rotorIso`, `mastIso`, `dishIso`, `sphereIso`, `wheelIso`, `bucketWheelIso` (turning by a phase), `cupIso`, `pipeIso`, `portIso`, `prismIso`, `frustumIso`, `latheIso`, `drumIso`, `trussIso`, `chevronIso`, `terminalIso` (a power terminal: service mast, porcelain, clamp), `crierMarkIso` / `crierMarkFace`, `face*` / `faceInk` details | `IsoFrame(w, h, rot, head)` at 2× (`IS` 64, `IH` 32, `ILH` 32 px/level, margin 14): `p(x, y, z)`, `rect`, `ell`, `depth`; `Scene` = painter's queue; `ShadowFrame` lays every point on the ground along the light (cast shadows) |
| [recipes/buildings.ts](../src/render/art/recipes/buildings.ts) | `R[id] = {head, draw(ctx, f, seed)}`, or `{head, moving: {body, part(…, t), over(f), shadow?}}` for a building with a moving part; `drawBuilding` adds ports from content (far sides under the body, near over it) and the kit's power terminals (last); `drawBuildingMoving` (body and phases apart); `shadowFrameOf` / `drawBuildingShadow` (the cast shadow); `fallback`; `isoHead`; `needsRotations`; `petalMastIso` (the first pole's art, kept, unused) | IsoFrame |
| [recipes/buildings-top.ts](../src/render/art/recipes/buildings-top.ts) | `R[id] = (ctx, f, seed)`, or `MOVING_TOP[id] = {body, part}`; `drawBuildingTop`, `drawBuildingTopMoving`; ports via `shapes.port`, the kit's power terminals via `terminalTop`; `needsRotationsTop`; `petalMastTop` (kept, unused) | `Frame(TOP_PX 64, TOP_MARGIN 14)` |
| [recipes/moving.ts](../src/render/art/recipes/moving.ts) | `MOVING[id] = {frames, sym}` (phases baked per period, periods per turn); the shared geometry: `TURBINE` + `vaneAt` (the crown), `SAND_WHEEL` + `bucketFull` (the bucket wheel) | — |
| [recipes/belts.ts](../src/render/art/recipes/belts.ts) | `BELT_TIERS` colours; `drawStraight`, `drawCorner` (rails overrun the edges for seamless joins), `drawInlet` (a side merge), `drawDeck` (skybridge span) | 64 px canvas |
| [recipes/items.ts](../src/render/art/recipes/items.ts), [icons.ts](../src/render/art/recipes/icons.ts) | One glyph per `Glyph` kind, coloured by `ItemDef.color`; `ICON_IDS` cartouches | 32 / 40 px |

Worker-safe modules (no DOM, no Pixi): `terrain.ts`, `rock.ts`, `ink.ts`, `tokens.ts` (except
`pushTokensToCss`) and `relief.ts`.

## 10. World views

**BuildingsView.** `rebuild(sim)` (on structural change) destroys and recreates every sprite. A
building gets an iso sprite in `objects` (`bKey(id, rot)`, falling back to rot 0; scale `k`;
anchored at `tileToIso(e.x, e.y)`; zIndex `buildingZ`) and a plan sprite on `plan` (`btKey`, in tile
units). Pending construction (`builtAt ≠ 0`) draws at alpha 0.45; dormant buildings
(`sim.isDormant`) get a grey wash (`0x9b97a8`, an "unpainted model"). Ribbons and conduits become
belt pieces on `belts`. `beltPiece(sim, e)` returns straight when the tile behind feeds this one,
and a bend when exactly one side neighbour does (`rot` = entry direction, `mirror` for a left
turn); what feeds a tile comes from the compiled graph (`graph.feedDirs`), so what is drawn is
what is connected. A straight piece fed from a side (a merging line, a router, a machine's
outlet) gets an inlet sprite on that side: its rail opens and the belts join. `beltMatrix`
centres, scales, turns and mirrors the 64 px piece into the tile. The tier comes from the id
(`BELT_TIERS`, default ribbon). Pieces have a symmetric soft halo, never a directional shadow,
so a line looks the same whichever way it runs.

**Standing on the mountains** (D44, [world/stand.ts](../src/render/world/stand.ts)). A building
stands at the highest `tileTop` under its footprint: 0 on the floor, which is where everything
stands but the `onRock` kinds on rock (the wind turbine, the pole, the pylon, the survey beacon,
the routing blocks, the junction, the skybridge, the incinerator; ribbons have no stand, below). `rebuild` works every stand out once (`computeStands`: its level and its depth
key, §7.4) and keeps it with the entity object (`standOf`, `liftOf`); nothing re-reads the land
per frame. Its iso sprite, moving part, chosen item and cast shadow are anchored at
`tileToIso(x, y, level)` (`level·LH` px up) and sort by the stand's key, so the column under it
never covers it and higher rock in front still hides it; the night lights, the wire anchors and
the iso picking read the same stand. At far zoom it stands on the painted relief at the same
height (paint and sprites draw the same levels). In plan it lies flat, over a hint of its height:
its own plan sprite in ink (`SHADOW_TINT`, alpha 0.3) offset down-right by `riseOffset(level)`
(0.05 + 0.016·level tiles). A footprint over two terraces stands on the higher one.

**Ribbons on the mountains and the traction elevators** (D56). A ribbon piece lies on its own tile's
top (`tileTop`): on the floor on `belts` as before; on rock `layBelt` lays it twice — in iso among the
volumes (the iso map times `beltMatrix`, lifted `lv·LH`, key `beltZ`) and flat on `plan` — and so does
a junction's passage on rock. The traction ribbon is drawn as a track (`treadPlates`, `treadRails` in
recipes/belts.ts). Where a traction ribbon hands on to a tile one terrace up or down
(traction-lifts.ts `liftOfBelt`; coming down only onto a ribbon, else there is no room), an elevator
stands on the low tile against the wall: three sprites on one 1 × 2 frame anchored at the two tiles'
top corner on the low top (`liftFrames`: the back with its drive chain, the car, the front posts and
head frame), keyed by `liftZ`, and a plan mark centred on the wall (laid after every ribbon). The car
moves per frame: `animate` sets its y from `carHeight` (the items view's `BeltLift.carAt`). The
items view runs first in the frame, so the car and the item it carries move together. Seen from the
camera only the steps whose wall faces it (climbing away from it, or coming down towards it) show
the shaft; the others stand behind the high column and only their heads peek over.

**Moving parts** ([recipes/moving.ts](../src/render/art/recipes/moving.ts), [world/moving-parts.ts](../src/render/world/moving-parts.ts)).
A building listed in `MOVING` (the wind turbine's crown, the sand collector's bucket wheel) shows
its body (`bodyKey`) and, as a second sprite, its part (`partKey(key, k)`), in both views: in iso
at the body's key ± 0.2 (over the body when `Atlas.moving` says the part is the nearer one in that
rotation, under it otherwise; lifted with it on the mountains), in plan over it. `animate(sim, seconds, grade)`, per frame with the
game time (paused: nothing turns), moves each part's phase at its rate (periods per second =
turns per second × `sym` × the building's own factor 0.92–1.08, `spinSeed`) and swaps its two
textures when the phase index changes — a few texture swaps on one atlas page, no repaint, no
upload. Turns per second: a turbine on a grid follows the wind its generator sees
(`windTurns(local ‰, gust ‰)`: the producer's local wind from `graph.nets`, cached per graph
version, times `gustPermille` of the moment; 0.1–0.75), a turbine on no grid idles (0.035,
braked: wiring it sets it going), a machine's part turns while its node works (`workTurns`:
0.14 × the grid's satisfaction when `Ok` / `LowPower`, else 0); a site under construction or a
dormant building stands still. Speeds ease towards their target (about a second), so a gust
spins the crowns up; a rebuild keeps each part's phase and speed. `movingCount` counts them.

**Incinerators** ([world/pits.ts](../src/render/world/pits.ts); the art: §9, note 11). An
incinerator's iso sprite is its pit's `back` at its key, its flame at + 0.12 (hidden until
something burns) and its near rim (`front`) at + 0.15, baked on demand on the pits' own DynAtlas
(`pitFrames` per rotation of its art, `flameFrames`); in plan its sprite and, over it, the flame
from above (`planFlameFrame`), its alpha the fire's heat. An item riding a chute on the pit's near
half sorts over it all (+ 0.2), on its far half and once it tips in behind the flame (+ 0.1): it
falls behind the near rim into the fire. **The fire** (`PitFire`, one per colony, `pitFire(sim)`;
stepped in `animate`, at the render tick): each pit's feeding ribbons from the compiled graph (a
chain whose out-edge goes to its `SinkNode`); an item has fallen at `lastOut.tick + 1 +
PIT_WAY.gone · stepTicks`; the engine keeps only the last item out of a chain and a full line
hands the next one on a tick before the one before has fallen, so each feeding ribbon's previous
hand-off is kept too, and per pit the last fall seen. Its heat by the time since (`heatAt`,
ticks): up to full in 0.15 s, down to a quarter over half a second, embers dying for a second
more; a line feeding faster than the flame dies (a swift ribbon) keeps it burning. The flame shows
`flameLevel(heat)` (1…6, the embers, or nothing), its flicker one of two frames stepped with game
time (`flicker`: paused, it stands still): a texture swap on one page when it changes. A look
only: nothing in `src/sim` is read but the graph and the chains' `lastOut`, and the same frames
show the same fire on every screen. At night the lights view glows with it (*Day and night*).

**Cast shadows** ([world/cast-shadows.ts](../src/render/world/cast-shadows.ts), [art/silhouette.ts](../src/render/art/silhouette.ts)).
Every building lays its shadow on the ground on `shadows` (iso only, under every volume, over the
ribbons and their items). The mask is the building's own recipe drawn through a `ShadowFrame`
(each point laid on the ground `SHADOW_DX` = 0.42 tile per level along +x, the way the cliffs'
shadows fall) into a `silhouette` context (solid fills only, one colour; baked shadows, halos and
stipple dropped), at half the atlas scale (1 px per world px), baked into a `DynAtlas` the first
time that building and rotation show up. A moving part casts its phase-0 picture, or its own
`moving.shadow` (the spinning crown: the solid hull of its rings). The sprites are tinted ink with
a little lilac; one container alpha fades them all. Through the day (`shadowLook(hour, night)`)
they are stretched along the light (0.6× the reference at noon, up to 2.2× near sunrise and
sunset: the sun's height comes from the hour, `sunHeight`, as the seen sun is flat all day),
swung ±0.2 rad from morning to evening, darkest at midday (alpha 0.46) and softer in a low sun,
faded out through the twilight and gone at night (the container is then invisible). The stretch is
one linear map about each building's foot (`shadowMap`: it sends the reference displacement to
the sun's and keeps the direction across it), set on every shadow sprite only when the quantised
length or swing changes — a few times a minute at dawn and dusk. Pending construction casts a
faint shadow (alpha 0.35). The sun stands on the light's side all day (`sunDirection`: west-south-
west in the morning, west-north-west in the evening), every shadow opposite it.

*The seam* (owner, 2026-10-13: a turbine's shadow "goes in the direction of the sun sometimes").
The stretch is about the foot, so at dawn and dusk (2.2×) it pushed the shadow of a building's own
base on the sun's side of its foot out towards the sun: a dark wash beside a turbine's wide foot.
A mask is baked clipped to the far side of the seam, the line through the foot across the light
(`seamClip`, `farSide`): the sun's side is the base's shadow under the building (hidden by it),
and the map leaves the seam where it is, so what is kept only ever moves along the light.

*On the mountains* a building's shadow lies on the rock top: lifted with it, it goes among the
volumes at the building's key − 0.3 (after the rock it falls on, §7.4; under the building and
its moving part), with its own alpha (the look's × its base), set by `shade` when the quantised
alpha changes; the stretch is the same.

**Skybridge decks** (`addDecks`, [sky-decks.ts](../src/render/world/sky-decks.ts)). For every
skybridge pair (an end whose graph target is the next end ahead, `graph.jumps`): the start's ramp
up, a deck over each square between, the far end's ramp down — pieces baked on demand per rotation
(iso volume, plan sprite, cast-shadow mask) on a DynAtlas of their own. Iso: volumes among the
buildings (a ramp just after its end, a deck square after whatever stands on it), at the ends'
height (an end on rock lifts its pair); the line it crosses runs under it, and its items are
drawn over it (their path's `o` stretch). Plan: over the plan's buildings. Shadows with the
buildings'. **Junctions** are little bridges: their sprite (`junctionIso`) is a humped deck over a
tunnel; the line under it gets its own ribbon laid through the tunnel (`JunctionsView`, on `belts`,
or on the rock top for a junction on rock), and the line over it rides the hump (item-flow.ts).

**Items: read from the engine's cells** ([cell-flow.ts](../src/render/world/cell-flow.ts), on the
paths of [item-flow.ts](../src/render/world/item-flow.ts), drawn by
[items-view.ts](../src/render/world/items-view.ts); D57). The engine moves ribbons tile by tile:
one item per tile, one tile a step on its tier's beat (engine.md, `Chain`). So an item is drawn on
its tile, eased in from where it was over one glide: `f = (t − (moved + 1)) / untilNext`, the render
tick `t` (fractional) from just after the step that moved it, over the ticks to the line's next
step (a full step on the beat; less for an item put onto the line between beats; the faster tier's
pace for one handed over to it), so a moving item glides on at the line's pace and one that stops
sits on its tile's centre — drawn one step behind the engine, which is what makes it smooth. Where
from (`via`): the tile behind (centre to centre along the two tiles' pieces, `glide`; a side-load
into a straight tile goes on the feeder's way to its edge, then straight in); the feeding ribbon's
last tile; a building's port edge (the tile's side the building stands on); a routing block's
centre — and an item a block hands on within two steps of a ribbon bringing it in rides one path
from that ribbon's last tile through the block's centre to the outgoing tile, timed from when it
went in (`throughBlock`), so it never jumps. Out of a line's head into what is not a ribbon
(`lastOut`): into a building it glides to the edge and is gone; into a routing block to its centre,
where it sits (the block's held items, `ForkNode.mu`) until handed on. No identity is kept from
frame to frame: positions come from the engine every frame. Conduits draw nothing (their water is
in the pipe's art). An item above the floor or in an elevator's shaft is placed by belt-lift.ts
(D56) and sorted among the volumes by the tile it rides over (§7.4). Into an incinerator, the
item rides on at the line's pace — a tile a step, from the last tile's centre to the pit's
centre — up the chute, tips over the lip and falls in (pits.ts `pitPath`: `FlowItem.d`, how far it
has fallen), gone at `PIT_WAY.gone` (0.88 of the way), before the next item out of a full line
overwrites the engine's `lastOut` (the glide is drawn a tick behind).

Pieces (`buildPieces`, after each structural change): a straight tile goes entry edge → exit
edge; a bend (`beltPiece`) a quarter circle round its corner; a tile in `graph.jumps` on to the
entry edge of the tile it hands to — over a skybridge's gap (rising to `DECK_Z` on the start
tile, coming down on the far end) or through crossings; a routing block's path through its
centre (`viaPiece`), its way out carried over the junctions in line with it (`linkFork`), so an
item leaving a router through a junction glides across it instead of skipping a square. The view projects each point with P (lifted `(3 + z)·(1 − te)` px) without a
container transform, so glyphs stay upright and undistorted; those among the volumes are pooled
Sprites at their iso px drawn through M⁻¹ (one decomposition a frame: scale and skew), and in
plan particles in a container on `plan` drawn through P⁻¹ (§5). Items use the `ib:` belt frames:
a bit under half a tile across (21 world px in iso, 0.5 × 32 in plan, growing up to ×1.33 when
zoomed out); hidden below zoom 0.28 and culled outside `viewTiles` ± 1. Particles are pooled, one
`ParticleContainer` per atlas page, the particle list rebuilt only when the count changes. For the
trace rigs, `debugOn` / `debugSnapshot()` (`FL.itemsTrace(on)`) record every drawn item: its rank
this frame, tile coords, height, item, whether it rides a deck (`over`), its depth key among the
volumes (`sorted`, NaN on the floor). An item falling into a pit shrinks to half and fades out
(sprites only: in plan it is already under the incinerator's sprite).

**GhostView.** On `ghost` (tile units), `draw(pre, sim, hover, showHover)` redraws only when a
JSON signature of the `Preview` changes. Each piece shows its plan sprite (alpha 0.72, reddened
when refused), or a straight belt piece for ribbons. Its footprint is washed and outlined on top,
cyan when it fits and red (`ledRed`) when it does not: the `Graphics` sits above the sprite
container. Then come the marking box (ink when clearing, coral when marking), the demolition box
with the doomed footprints, and a white hover outline when nothing else shows. Outside a box,
`doomed` lists what a placement would replace (D24): amber footprints drawn *under* the ghost
(a separate `Graphics`), since they are refunded, not destroyed. See [input.md](input.md) for
`Preview`. A directional routing block (`isDirectional`: router, sorter, inverted sorter, both
gates — in from the back only) shows its flow over its ghost (`flowArrows`, from the piece's own
rotation, which is the ribbon's when it is dropped onto one: `Sim.placementRot`): a big turquoise
arrow (`glowTurq`, inked, on a soft shadow) from the tile behind into its back, and small coral
arrows out of its front and sides; dimmed when the placement is refused. A building in hand
that would stand above the floor (`standLevel`, from `tileTop`) is shown where it would stand: the
ghost's pieces sit in one container shifted `level·SHIFT·(1 − te)` tiles along −x−y — the full
lift in iso, flat in plan (te is read off the plane's own transform: `top` carries P(te), turned by
π/4·(1 − te)) — and in plan it lays the same ink hint of height as a placed one; red where
`canPlace` refuses (astride a cliff). The tools act in the plan half only (`view.building`), so in
play the ghost shows flat with its hint; the lift shows while the view morphs.

**OverlaysView.** `update(sim, viewTiles, te, zoom, selected, levelAt, ghostReach)`; each part is
rebuilt only when its signature changes. The z-order inside `overlays` follows the list below.
- *Grid*: a `TilingSprite` over `viewTiles`, with a 64 px tile of two inked edges plus corner
  crosses. Alpha is `te × clamp((zoom − 0.3)/0.35) × 0.55`.
- *The claim's land* (D60, [land.md](land.md); on its own layer `land`, above the fog: the
  constructor's third container), from `sim.land`, over the parcels near the view only (those
  `viewTiles` touches, one more each side): the parcels held for good (the starting square,
  bought, granted) washed turquoise (0.07) inside one solid `turqD` border drawn where a held
  parcel meets one that is not, a faint line between two held ones; a leased parcel washed amber
  in a dashed `peachD` frame; a sister claim's (`land.sister(p) ≥ 0`) hatched coral along
  x + y every two tiles in a thin `coralD` frame. Rebuilt on a signature of the view's parcel
  range, the zoom's step (a third of an octave), the starting square's reach and the bought,
  granted and leased sets; line widths are screen pixels at that step (`1 / (TOP × zoom)` tiles a
  pixel), so a border reads the same zoomed in or out. Alpha `max(te, landOn)`: shown while
  building, as the zones were, and always in the land mode. With `landOn` (the shell sets it,
  with `landHover` and `landSel`, from `LandTool` each frame) it adds the parcel grid over the
  whole range (ink, 1.2 px) and marks the hovered parcel (a paper wash, an ink frame) and the
  picked one (a cyan frame with ink corner ticks), rebuilt on their own signature.
- *Freight routes*: violet dashes between dock centres.
- *Dig / fill marks*: coral (dig) or cyan (fill) squares with two hatch strokes, brighter with a
  progress bar where a machine works. The flat copy fades in with `te`; the iso copy is lifted onto
  rock tops by `levelAt(x, y)·SHIFT` and fades out.
- *Reach*: a coral circle around the selected excavator or backfiller (`BAL.digReach` from the
  excavator's footprint edge, so `digReach + max(w, h)/2` from its centre, D54 / `fillReach`), or
  around the one in hand (`ghostReach`).
- *Selection outline*: cyan with ink corner ticks around the inspected building's footprint; a flat
  copy fades in with `te`, and an iso copy, shifted onto the rock top it stands on (`footLevel` of
  `levelAt` × `SHIFT`), fades out (owner, 2026-10-13: a turbine's outline lay on the ground below it).
- *Power overlay* (`powerOn`, the P key): each grid's buildings washed and outlined in its colour
  (`GRID_COLORS[net % n]`, shared with the wires view, which colours the wires the same way);
  buildings that make or use power but hang on no wire get a dashed coral frame. Rebuilt on
  `graph.version` / `links.version`.
- *Link tool marks* (`linking`: the tool's `LinkPreview`, set by the shell): with a source, its
  reach as the rounded rectangle its footprint sweeps out to the range, the source outlined in
  cyan, the buildings a click would wire in turquoise, its wires' other ends in ink; without one, a
  cyan ring on every pillar and on the Heart; the hovered building outlined in the colour of the
  click's verdict (turquoise wire, coral cut, red refused). Rebuilt on the preview's `sig`.
- *Selection*: a cyan footprint outline with ink corner ticks, readable in both views.

**WiresView** (D25). Each wire of `sim.links` is drawn twice, once per view, above every building,
from terminal to terminal:
- *Terminals* ([art/terminals.ts](../src/render/art/terminals.ts), owner 2026-10-12: "the
  electricity wire should link to a precise place on every building that needs it"). Every
  building that takes part in power (`linkable`: poles, the Heart, generators, accumulators,
  consumers) has one terminal or a few in `TERMINALS`, points of its own unrotated frame (tiles
  x, y, height z): the clamp of a porcelain insulator on a short service mast on one of its
  roofs (the kit: `base` set, drawn by `drawBuilding` / `drawBuildingTop` after the body), or a
  point its recipe draws itself — a pole's three crossarm pins, a pylon's two suspension
  strings, the Heart's two link masts (west and east), the charger's free bushing. The art
  draws them where the table says (`terminalIso` / `terminalTop`), and `terminalsAt` turns them
  into world tiles with the art's own rule (`rotLocal` = IsoFrame.r / Frame.p) and rotation
  (`artRot`: a building drawn once, `turnsArt` false, keeps its rot-0 points whatever its
  rotation). `wireEnds(a, b)` (the lower id first, the table's order) picks each end's terminal:
  the nearest to the other end, less its `bias` — a pole's top pin takes the wires that run
  across its crossarm (steeper than 45° on screen), the arm's end pins those that run along it;
  the Heart takes each wire on its nearer link mast — then turns a's pick towards b's actual
  terminal. Several wires may share a terminal.
- *Iso* (`wires`, iso px under M): a parabola (`catenary`, `wireCurve`) from terminal to
  terminal sagging `sagPx(span)` — about a third of a level per tile, at most 2.5 levels, never
  lower than half a level above the ground — in 6–20 pieces.
- *Plan* (`wiresPlan`, tile units under P): straight lines between the same terminals (the plan
  art draws them too, so no knots).
- *Style* (owner, 2026-10-12: "a bit more thin, and slightly transparent"; `LINE`): a fine,
  translucent dark line (1.8 px iso at 78 %, 0.055 tile plan) with a hair of light just above it
  (`C.ice`, 55 %); readable on sand by day and under the night grade. A grid with no supply (no
  renewables, no fuelled generator, no charged accumulator: night on the Heart's panel alone)
  gets dim lines; a wire to a construction site or a dormant building is dashed; with the power
  overlay each grid's wires take its colour, a little wider. One batched stroke per style.
- *Glints*: one small additive spark per powered wire (at most 400), always running from the
  generators' side towards what they feed (owner, 2026-10-13): `flowWays` (world/wire-geom) counts
  each end's distance in wires from the nearest generator (the Heart, turbines, panels, plants,
  fuel generators; accumulators only give back) and the spark runs from the nearer end; a wire
  whose ends are as near (two generators, a loop's middle) has none. Speed `2.4 tiles/s × (0.35 +
  0.65 × satisfaction)`; pooled sprites, moved each frame without allocation, only in the view(s)
  shown.
- *Preview* (`PREVIEW`): while the Link tool has a source and hovers another building, the wire
  it would make, terminal to terminal (picked as the wire will be), a little bolder than a wire —
  turquoise (would wire), coral (would cut), dashed red (refused) — and a dot on the hovered
  building's terminal.
- *Cost*: geometry rebuilt only when `links.version` or `graph.version` moves; restyled when a
  wired grid's powered state flips or the overlay toggles. `count` feeds perf `wires`.

**LandingView** (D31, driven by `app/intro.ts`). The intro's last beat, pure decoration: the
Heart's own atlas sprite (`bKey('hearth', rot)`, anchored as BuildingsView anchors it) lowered on
four cables by the CrierBelt sky-crane: `drawCrane` in [recipes/cargo.ts](../src/render/art/recipes/cargo.ts)
with `SKY_CRANE` (the trade post's cargo drone is the same drawing with `CARGO_DRONE`), baked at
the start of the landing with the buildings' kit (`IsoFrame`, `latheIso` engines, `box` beams with
hazard stripes, `pipeIso` spokes and gussets, `crierMarkIso` on the hub; no cast shadows: it
flies). `SKY_CRANE` holds the numbers the intro was drawn with: change it and the intro changes
(`cargo.test.ts` pins them). Everything sits in iso px under M = `isoToView(P)` and
fades with the volumes. The clock is real time: a pre-roll on the empty cirque, a braking fall
(`A0·(1 − u)^2.15`) while the engines burn harder, a shadow that grows and darkens, dust raised
from under the engines once low, a ring of dust at touchdown (`touchdown` hook), the cables reeling
in, the crane climbing away downwind and fading, then `done`. Dust nearer the viewer than the
footprint's centre is drawn in front of the load. `altitude` lets the shell's camera follow the
load; `seek(t)` jumps for review; `skip()` ends at once. The real Heart is hidden meanwhile
(`BuildingsView.hide(id)` / `show(id)`, kept across rebuilds; `LightsView.hidden`, applied at the
next rebuild). Textures are baked at `start` and freed at the end.

**CargoView** (`App.lift` on the `trade` event launches a sale, `App.land` on the `delivered` event a purchase — when it lands in the post's container, D43, one drone per post per tick — → `launch(pad, side)`, with the post's footprint).
At each epoch boundary where a trade post sold or bought, a CrierBelt cargo drone works its deck:
the intro's sky-crane at 0.9 scale round a 2.2-tile bay (`drawCrane` with `CARGO_DRONE`), so the two
read as one company's machines. The choreography is pure maths in
[cargo-flight.ts](../src/render/world/cargo-flight.ts) (`poseAt(side, age, out)`, game seconds):
- *A sale* (about 9.5 s): the deck's lift — an iris (`drawHatch`) dilated open by scaling it —
  brings a freight container up (`drawContainer`: coral corrugated steel, the CrierBelt mark on a
  panel, lifting eyes on the roof; drawn out of the iris in 12 steps, each clipped at the deck);
  the drone comes straight down, braking, and hovers; it pays out four cables to the eyes, hooks
  them, strains (longer flames, a sag, a tremble) and lifts off at 5.6 s in a ring of dust, slow at
  first, the load swinging a little (a damped pendulum under it), drifting downwind and fading out
  about 26 levels up.
- *A purchase* (about 7 s): the drone comes down with a container slung under it (its swing dies
  out before touchdown at 3.7 s, a ring of dust), sags as the cables slacken, unhooks, reels in and
  climbs away, lighter and faster; then the iris opens and the container sinks through it.

Drones at one deck queue (`followAfter`: the deck clear, the drone before high and fading); at
most 4 live (waiting ones included) and 1 waiting per post: past that a launch is dropped, so a
catch-up or `FL.tick` shows its first drones, never a long queue. Billboards in view world px
placed with P, like the drifters: over the post in iso, smaller (× 0.45) and flatter (altitudes
× 0.18) in plan. The deck's centre and height mirror the trade post's art (`DECK_Z`, `TP_DECK`: the deck
at local (2.5, 2.5), the middle of the pad in the 5 × 5 footprint, turned as IsoFrame turns it;
`deckCentre`); the drone's engines fire on the pad, never on the apron. On `fxTop` (graded): the iris,
shadows, dust (in front of the container when nearer the viewer than the deck's centre), the
container, the cables (one stretched sprite each), the drone. On `fxGlow`: flames, halos, the
plumes' light on the slab and, at night, the drone's own lights where its drawing puts them (the
light spy, `artOf`). Cost: textures are baked once at construction (about 15 ms: the drone, the
container's 12 steps on one sheet of trimmed frames sharing an anchor, the iris, shadows, exhaust,
dust); sprites are pooled (40 dust puffs behind the load, 40 in front); `update(P, te, dt, night)`
allocates nothing and never touches the sim. `seek(age)` poses every live drone for review (pause
the game to hold it).

**DriftersView.** Pure decoration on `status`. Each ship's phase over a round trip (load, fly out,
unload, fly back) comes from `routeDistance`, `BAL.drifter*` and the game clock; the shadow sits at
P·(x, y) and the balloon `alt` px above it. Sprites are pooled.

### Day and night ([daynight.ts](../src/render/daynight.ts), [world/lights-view.ts](../src/render/world/lights-view.ts), [art/recipes/fx.ts](../src/render/art/recipes/fx.ts), [art/solar.ts](../src/render/art/solar.ts))

**The clock.** Everything reads the absolute world tick the sim's sun uses:
`foundingEpoch · EPOCH + simTicks` (interpolated), plus `DayNight.offsetTicks` (only
`FL.dayPhase` sets it). The day phase is the world epoch mod 36; the 24-hour clock puts midnight
at day epoch 6 (the HUD's convention): night 20:00–04:00, dawn 04:00–06:00, full sun
06:00–18:00, dusk 18:00–20:00 — the SOLAR table ([engine.md](engine.md)).

**The grade** (`gradeAt(phase, out)`, pure, no allocation): keyframes by hour, smoothstep between
them.

| Hour | Multiply tint (r g b) | Night | |
|---|---|---|---|
| 00:00 | 0.56 0.54 0.80 | 1 | lilac-indigo night |
| 03:24 | 0.53 0.53 0.81 | 1 | the deep blue before dawn |
| 04:12 | 0.67 0.58 0.80 | 0.95 | first light, lilac turning rose |
| 05:00 | 0.94 0.75 0.77 | 0.55 | dawn: rose and peach |
| 06:00 | 1 0.86 0.77 | 0.1 | sunrise: peach gold |
| 07:24 | 1 0.95 0.89 | 0 | a warm morning |
| 12:00 | 1 1 0.98 | 0 | noon: neutral |
| 16:24 | 1 0.95 0.88 | 0 | a warm afternoon |
| 18:00 | 1 0.85 0.70 | 0.08 | golden hour: amber |
| 19:00 | 0.95 0.72 0.64 | 0.5 | dusk: coral |
| 20:00 | 0.72 0.59 0.76 | 0.9 | twilight: violet |
| 21:00 | 0.58 0.55 0.80 | 1 | night |

No channel drops below 0.5, so the board stays readable at night. `sun` is SOLAR joined linearly
between epoch centres (0–1); `clouds` is a smoothstep of the sun × (1 − night).

**Applying it.** `DayNight.update(worldTick, te)` writes one 24-bit tint on `lit` (a render
group: one uniform whatever the sprite count), `fog`, `status` and `fxTop`, and on the stage
background (sand × tint), only when the 24-bit colour changes: a few times a minute at dawn and
dusk, never in full day or night. The plan view keeps 40 % of the grade (`1 − 0.6·te`), so
building stays clear. A multiply tint cannot brighten: what glows does so on `lights`, above `lit`.

**Night lights** (`LightsView`). The base is automated (D29): every light is a machine's.
- *What the art bakes in.* `isoArt(id, rot)` / `planArt(id, rot)` re-run a building's recipe on
  a spy context, a Canvas2D stand-in that rasterises nothing and records every opaque fill in an
  LED token (`led`, `glowCyan`, `glowTurq`: cold; `ledWarm`, `glowPeach`: warm; `ledRed`;
  `ledGreen`) with its bounds, and every fill in `PV` with its polygon, in sprite px from the
  anchor. Cached per (building, rotation), about 1 ms per new pair. Lights therefore follow the
  art whatever it becomes: a recipe only has to draw its lights with the LED tokens at full
  opacity (`light()`, `faceLeds`).
- *Glows.* One white texture (hot core, long falloff) tinted per sprite, additive: points spread
  9× their size, strips 5×, areas wider than 7 world px get a soft haze. Cyan stays cyan, red and
  green stay; amber only on machines that run hot (`HOT`: kilns, coal generator, ceramic oven,
  sunheart, geothermal plant), and amber LEDs on any other machine glow work-lamp white.
- *Night rigs* (`nightRig`, from the kind and footprint only, never from art positions): a pool
  of work-lamp light on the ground (cold round the Heart, the landing pads of skydocks and trade
  posts — a post's pool covers its pad, not its apron — and, faintly, big machines; amber round hot machines), and the Heart's pulsing uplink
  beacon on the highest light its art draws (else at the top of its `isoHead`). Small blocks, ribbons, masts and the sleeping solar panels get
  none.
- *The incinerators' fire.* Each pit gets a warm haze on its throat, a tall amber one up its flame
  and a core (iso), a haze in plan; per frame their alpha is 0.12 (the bed smoulders) + 0.88 × its
  fire's heat (pits.ts `pitFire`, as the buildings view stepped it the frame before), so the pit
  flares at night as an item falls in.
- *On the mountains.* A building's stand (`standOf`, worked out by the buildings view's rebuild,
  which runs first) lifts its iso glows, its pool and its beacon by its level, and sorts its solar
  overlays at its key + 0.25; plan lights stay flat.
- *Cost.* Pooled sprites, rebuilt on structural changes only. Per frame: the `lights` render
  group's alpha (= `night`; invisible by day), the beacon's pulse, the pits' fire, and during a morph the two
  containers' transforms (iso under M with `isoA`, plan under P with `planA × 0.55`).

**Solar states.** The stage comes from the seen sun (`solarStage`): 0 closed (< 0.1), 1 half open
(< 0.62), 2 open (< 0.9), 3 full sun. Sun bulbs get petal overlays (`drawBulbIso`,
`drawBulbPlan`): a closed tulip bud at night, petals half open at dawn and dusk, nothing when
open, a white sheen and sparkles in full sun; iso in `objects` at `buildingZ + 0.25`, plan on
`plan`. Solar cells drawn in `PV` (art/solar.ts, `pvPanel`; the Heart's array first) get a night
film, a warm glint or a white sheen clipped to the cells (`drawPvState`), baked the first time
such a building shows up. Textures swap only when the stage changes.

**Cast shadows.** The buildings' shadows follow the clock too: long and soft when the sun is
low, short and dark at noon, gone at night (BuildingsView, *Cast shadows* above).

**Cloud shadows** (`CloudShadows`). Nine soft blobs (three shapes) in tile units on `shade`,
multiplied in a cool blue-violet. They drift east-south-east with the Sough (0.21, 0.08 tiles
per world second) on a 224-tile torus wrapped round the camera, so the sky is a function of the
world clock. Strength `clouds × (1 − te) × 0.5`, faded out below zoom 0.4 (the torus's seams).

**Debug.** `FL.dayPhase(h | 'dawn' | 'noon' | 'dusk' | 'night' | null)` shifts the clock that
the look and the HUD read (never the sim's) and returns `{ hour, sun, night, tempC, shifted }`.

## 11. LOD by zoom

| Zoom | Effect |
|---|---|
| any | Terrain bucket 8/16/32/64 px/tile from `zoom·dpr`. Ground details at ≥ 16. Relief paint capped at 32 (detail 1 at 32, flat below). |
| ≥ 0.3 / < 0.26 | Relief sprites on / off (hysteresis); the paint carries the cliffs when off |
| < 0.28 | Items hidden |
| 0.3 → 0.65 | Grid fades in (plan only) |
| 1 → 0.75 | Item glyphs grow from 0.42 to 0.56 tile, then stay |

Buildings have no LOD. The plan's L1 ("objects as dots, animations at 15 Hz below 0.55") and L2
levels are not built.

## 12. Perf overlay ([perf-overlay.ts](../src/render/perf-overlay.ts))

`PerfMeter` wraps the WebGL2 draw calls (`drawElements`, `drawArrays`, and their `Instanced`
variants) to count them per frame. `frame(ms, dt)` computes fps and the max frame time over 0.5 s
windows. `set(key, v)` adds stats (`tickMs`, `renderMs`, `chunks`, `chunksMissing`, `vramMB`,
`reliefSprites`, `reliefBaked`, `items`, `lights`, `atlasMs`). `toggle()` (Backquote) shows a `.perf` panel;
`FL.perf()` returns a copy for the smoke test.

## 13. Recipes

### Adding the art for a new building (iso sprite, plan sprite, icon, `isoHead`)

1. **Content first.** The building must exist in `src/content/buildings.ts` (`w`, `h`, `kind`,
   `ports`; see [content.md](content.md)). The atlas bakes every id in `BUILDING_IDS`; without a
   recipe the building gets the fallback (a riveted crate-like machine). Pick its side first
   (D21): machines are industrial, no domes or glass; places where people live or work get
   glass, lights and greenery (the Hearth is the one glass dome).
2. **Iso sprite.** Add an entry to `R` in [recipes/buildings.ts](../src/render/art/recipes/buildings.ts):
   ```ts
   my_mill: {
     head: 2.4,                        // tallest part, in levels (1 level = 16 world px)
     draw(ctx, f, s) {                 // f: IsoFrame on the UNROTATED footprint; s: seed
       slab(ctx, f, C.steel, 0.05, SZ, s);
       const sc = new Scene();         // parts far → near
       sc.add(f.depth(1, 1), () => {
         const rr = box(ctx, f, 0.2, 0.2, 1.8, 1.8, SZ, 1.2, C.teal, s + 1);
         faceLeds(ctx, f, rr, 'L', 0.9, 0.2, 0.8, 4);
       });
       sc.run();
     },
   },
   ```
   Work in local tiles and levels (`f.p(x, y, z)`). Never branch on `f.rot` for lighting: the
   visible faces are always the rotated +y (`'L'`, lit) and +x (`'R'`, shaded). Don't draw ports:
   `drawBuilding` adds them from `def.ports`. Use `s + n` seeds for every stroke.
3. **`isoHead`.** `head` sizes the canvas headroom and is exported as `isoHead(id)`, the height of
   the volume the app hit-tests in iso. Too low clips the top; too high makes clicks above the
   building select it.
4. **Plan sprite.** Add `R.my_mill = (ctx, f, s) => { plinth(ctx, f, C.steel, 0.05, s); … }` to
   [recipes/buildings-top.ts](../src/render/art/recipes/buildings-top.ts), using
   [shapes.ts](../src/render/art/shapes.ts) (`f.p`, `f.l`, `rr(f, …)`, `along(f, 'x')` for vaults).
   Ports are added for you.
5. **Icon.** The build-bar icon *is* the plan sprite at rot 0 (`buildingIcon` → `frameCanvas(atlas,
   btKey(def, 0))`). Status cartouches are separate: [recipes/icons.ts](../src/render/art/recipes/icons.ts).
6. **Rotations.** `needsRotations` / `needsRotationsTop` bake 4 rotations when the building has
   ports or a non-square footprint, or is in the `ORIENTED` set (drill, excavator, the
   directional routing blocks — router, sorter, inverted sorter, gates — and the skybridge): one
   rule, `turnsArt` in [art/terminals.ts](../src/render/art/terminals.ts), which the wires'
   terminals follow too. Otherwise rot 0 is reused for every rotation, so list asymmetric art there. Routing blocks have
   no content ports: draw their ribbon mouths as part of the body (the band's width, 0.2–0.8 of an
   edge). A directional block (in from the back only) wears the shared way in at its back — the
   turquoise hopper mouth, `intakeIso` / `intakeTop`, drawn before the box when the back is a far
   side (`intakeFirst`) and last otherwise; the router adds a big glowing turquoise arrow in
   (`glowTurq`, so it reads at night) and coral arrows out, the ports' colour code.
7. **Ribbon-like kinds** (`belt`, `conduit`) are not drawn as buildings: `isBeltDef` (content
   registry) decides it everywhere; add the tier's look to `BELT_TIERS`.
8. **Review.** Use `FL.open('artboard')` (every building in every rotation) or `node
   scripts/shots.mjs` → `scripts/shot-artboard.png`. Check both views and all rotations in the
   game, and check `atlasMs` and the page count.
9. **Night and sun.** Draw lights with the LED tokens at full opacity (`light()`, `faceLeds`,
   `C.led*`, `C.glow*`) and solar cells with `PV` / `pvPanel` ([art/solar.ts](../src/render/art/solar.ts)):
   the night view finds them by itself (*Day and night*, §10). Never fill anything else in those
   colours at full opacity. Check with `FL.dayPhase('night')` and `FL.dayPhase('noon')`. The
   cast shadow comes for free (the recipe drawn along the light, §10): keep washes and baked
   shadows below 50 % opacity so they stay out of it.
10. **A moving part** (a rotor, a wheel). List the building in `MOVING` ([recipes/moving.ts](../src/render/art/recipes/moving.ts))
    with its `frames` (phases baked per period: 8–16) and `sym` (periods per turn: its
    symmetry — the picture at phase 1 must be the one at phase 0, so a 3-vane rotor turns a
    third of a turn per period and an 8-bucket wheel an eighth; spokes and buckets must share
    the symmetry). In `buildings.ts` give `R[id]` a `moving: {body, part(ctx, f, s, t), over(f)}`
    instead of `draw`: body and part must be parted by a plane (a vertical one, or the horizontal
    one under a crown) so one is wholly nearer the viewer in each rotation — `over(f)` says when
    the part is. Optionally `shadow(ctx, f, s)` for what the part casts (a spinning crown casts a
    solid band). In `buildings-top.ts` add `MOVING_TOP[id] = {body, part}` (the part goes over).
    Keep LEDs off the moving part, or on its axis: night lights are placed from phase 0. Say how
    fast it turns in `BuildingsView.animate` / [world/moving-parts.ts](../src/render/world/moving-parts.ts)
    (a turbine: the wind; anything else: while its node works). The atlas bakes the body and the
    phases; the static sprite (icon, artboard, picking) is composed from them.
11. **Power terminal.** If the building makes, uses or stores power (or carries wires), give it
    its terminal in `TERMINALS` ([art/terminals.ts](../src/render/art/terminals.ts)): usually
    `roof(x, y, roofZ, stem)`, a service mast on the roof of the part that takes the power (a
    cabinet, a power pack, a motor house), in the unrotated frame — `drawBuilding` and
    `drawBuildingTop` draw it last, the wires hang from its clamp. Pick a spot on a high roof near
    an edge, clear of the moving part, that stays in sight in every baked rotation, and keep
    `head` above its clamp. A terminal the recipe draws itself (no `base`) must be drawn with
    `terminalIso` / `terminalTop` (or report its point to `terminalProbe`): `wire-geom.test.ts`
    checks that the art draws every terminal, in both views and every rotation.

### Adding a new world view or layer

1. **Pick the space** (§1). Flat, top-down content goes in tile units on a P plane. A pre-drawn
   volume goes in iso px in `objects`, with a zIndex on the shared scale (§7.4). Upright billboards
   go in view px computed with `apply(P, x, y)`, on a layer without a transform (`items`,
   `status`) — or, when they must hide behind what stands in front of them, as sprites in
   `objects` at their iso px, drawn through M⁻¹ to stay upright (items-view.ts `Sorted`).
2. **Layer.** Reuse a `LayerName`, or add one to the union and to the `Layers` constructor
   (`this.add(parent, name, renderGroup)`). Order in the constructor = z-order. The parent sets
   the transform and the fade: `plane`/`top` carry P and are always visible,
   `reliefPlane`/`volumes` are iso only, `planPlane` is plan only, `lit`/`world` have no transform.
   Give fast-changing content its own render group.
3. **View class** in `src/render/world/<name>-view.ts`. The constructor takes its layers (and the
   atlas). Provide `update(…, P, te, …)` per frame and/or `rebuild(sim)` on structure. Read the
   sim, never mutate it. Skip work with a signature, pool sprites, and destroy what you create,
   textures included.
4. **Wire it** into the app: construction, frame order, sim events ([app.md](app.md)).
5. **Measure:** add `perf.set('<stat>', n)`, watch fps and draw calls (Backquote), and add a smoke
   assertion through `window.FL` if it matters ([testing.md](testing.md)).

### Adding an overlay

1. In OverlaysView, add a `Graphics` field to the constructor's `overlayLayer.addChild(…)` list
   (position = z-order).
2. Write `updateX(sim, …)`, called from `update()`, that redraws only when a cheap signature
   changes.
3. Draw in tile units (strokes of 0.06–0.22 tile), with colours from `C` through `num()`.
4. A plan-only aid fades with `te`. If it must sit on cliffs in iso, keep two copies like the
   marks: a flat one (alpha `te`) and one lifted by `levelAt(x, y)·SHIFT` along −x−y
   (alpha `1 − te`).
5. **Toggle:** add a key action ([input.md](input.md#recipe-adding-a-key-action)) handled by the
   app that flips a public flag, like `powerOn` (P) or `landOn` (set by the land mode). `ovFlow` (F) is already bound
   but not handled.
6. If it shows what a click *would* do, it belongs in `Preview` + GhostView instead.

## 14. Pitfalls

- **Texture GC is disabled, so lifetimes are manual.** `sprite.destroy()` keeps the texture.
  Destroy textures you create with `tex.destroy(true)`, and never destroy atlas, DynAtlas or
  `Texture.WHITE` textures. `Texture.from(canvas)` also registers the texture in Pixi's global
  `Cache`: for short-lived canvases build `new Texture({ source: new CanvasSource(...) })` and
  destroy it with its sprite (`destroy({ texture: true, textureSource: true })`), as the fog does.
- **A hidden tab pauses `requestAnimationFrame`.** No frames run, so no ticks and no view updates.
  On return, `dt` is clamped to 0.1 s and the loop runs at most 8 ticks per frame; long gaps are
  the catch-up's job ([offline.md](offline.md)). Worker replies still arrive and get cached.
  Headless runs must keep the page visible.
- **`ParticleContainer` is experimental in Pixi 8** (version pinned to 8.21.0). One container
  draws a single texture source (hence one per atlas page). `particleChildren` is a plain array:
  call `update()` after changing it. Dynamic properties must be declared up front. The huge
  `boundsArea` skips bounds computation.
- **Module workers.** Keep the literal `new Worker(new URL('./x.worker.ts', import.meta.url),
  { type: 'module' })` so Vite bundles the worker; `worker.format: 'es'` lets workers share chunks.
  Worker code and its imports must stay free of DOM and Pixi. Transferred buffers are dead after
  `postMessage`. Test the preview build too.
- **Device pixel ratio.** `resolution = min(2, dpr)` is captured at boot and not updated if dpr
  changes (moving to another monitor, browser zoom). Terrain buckets scale with dpr; pixel snapping
  happens only when idle and not morphing. Sprites are baked at 2× world, so they stay sharp up to
  zoom 1 at dpr 2.
- **Z-sorting keys** (§7.4). Anything added to `objects` must use `4 × doubled depth + kind` or it
  sorts arbitrarily against cliffs. The relief view relies on BuildingsView having set
  `sortableChildren`. Every add or remove re-sorts the whole layer.
- **Ground-plane picking.** `screenTile` works at z = 0. This suits the tools (plan half only);
  iso building picking uses volume hulls `isoHead · LH` high instead — lifted for a building
  standing on the mountains (from `level·LH`, its sprite's pixels lifted too), ranked by the
  stand's key. A click that hits no sprite takes what its ray meets first (`surfaceTile`: a rock
  top or a cliff, that tile's occupant), not the ground tile far behind the rock.
- **Strokes on P planes** are in tile units and get squashed with the plane in iso.
- **Hard-coded sizes.** `>> 5`, `& 31` and `32` (chunk size) in terrain.ts, the worker and
  relief-view; `1024` (world size) in overlays-view.

## 15. Known gaps

- **Unused or misnamed layers.** `decals` is never filled; `status` holds the drifters. Status cartouches (`ic:*`)
  are baked but only the artboard shows them; no in-world status view exists.
- **Not built (M8):** FX, the flow overlay (F is bound but not handled), the other animated
  parts (drill arms, excavator wheels, pulsing kilns: the moving-part mechanism is there, see
  §13), and the LOD levels L1/L2.
- **Power terminals:** the kit's insulators are drawn after the whole body, so a terminal behind a
  taller part in one rotation shows over it (the tower workshop at rot 2 — its insulator then
  reads as standing on the upper block); the wires layer is above every building anyway. A
  wire's terminal is picked by distance, not by what is in sight. The pole's crossarm is fixed
  (the art is drawn once): wires leave it at any angle, from the pin that faces them.
- **Cast shadows:** on the floor they lie on the ground under every volume, so a tall building's
  shadow never falls on a lower neighbour (it passes under it); overlapping shadows darken each
  other; a moving part's shadow does not turn; the cliffs' shadows are baked in the terrain
  chunks and do not follow the clock. The stretch about the foot is one linear map: on the far
  side of the seam the shadow of a wide, low base runs up to 2.2× too long at dawn and dusk and
  0.6× too short at noon (only tall parts above the foot are exact).
- **Standing on the mountains (D44):** the overlays (the power overlay, the Link tool's marks; not
  the selection outline nor the dig marks, lifted) and the guide's ring (`Picker.tileToScreen`) still lie on the ground plane,
  under a lifted building; the painted relief (far zoom) lies under every volume, so there a higher
  ridge in front never hides a lifted building; a lifted building's shadow is planar at its own
  level (past a cliff edge it drapes over the wall instead of falling to the floor), and it may
  shade a building on the rock top beside it; a footprint over two terraces stands on the higher
  one, floating over the lower (the engine allows it). Ribbons and items on rock (D56): an item
  sorts by one tile (§7.4), a painter's approximation — a lifted building whose key its shadow's
  reach pushed past the item's tile is drawn over an item in front of it (a pole's foot over the
  item's top, rare: the reach stops at higher rock and floor buildings only), and an item on a
  traction step down onto a building (a slide) is drawn over that building until it is gone at
  its edge; items riding a junction's deck on rock are still drawn over every volume
  (`itemsOver`); an item entering a traction ribbon from its side jumps onto the car (the
  elevator times it by its progress along the step); a tile that is the low end of two steps
  keeps one car (an old base may have two steps back to back; placement now keeps a flat ribbon tile in front of every elevator, owner 2026-10-14).
- **Incinerators:** the fire reads only the ribbons feeding a pit (a chain's `lastOut`): an item a
  routing block or a machine hands straight to an incinerator vanishes in the block and lights no
  flame; at express pace (2–3 ticks a tile) the engine's next hand-off overwrites the gliding item
  before it reaches the lip, so it vanishes on the chute (as items going into any building do at
  that pace) — the flame still flares for each one.
- **Day and night:** glows are not depth-sorted (a light behind a building shines through it;
  kept small, it reads as scatter); cloud shadows lie on the ground plane, not on volumes in
  height; the solar panel's petals mirror `sunDish`'s numbers (`BULB_DISH`, `BULB_TOP` in fx.ts) and
  must follow any change to the bulb's dish; `FL.dayPhase` shifts the look and the HUD clock,
  not the sim (power still follows the world clock). Building sprites are never culled: every building
  keeps both sprites, and each structural change rebuilds all of them.
- **Plan differences.** Camera bounds cover the whole map, not the revealed area. The placeholder
  is flat sand, not the chunk's average colour. The LRU budget is 256 MB, not 192 MB, and does not
  count mipmaps. Atlas and relief sprites are baked on the main thread, not in an art worker.
- **Fixed in the architecture pass** (kept as a record): fog masks own their texture (an explicit
  `CanvasSource`, freed with the sprite); `TerrainChunks.invalidate` repaints the 3×3 chunks
  around a change and versions each chunk, so a paint in flight from older land is discarded;
  the worker always answers (`PaintReply.error`), failed or lost paints (no answer after 600
  frames) are retried after 120 frames instead of holding a slot. Still open: off-screen requests
  at the current bucket stay queued until painted.
- **Items: where the engine holds them.** An item stands still only where the engine holds it,
  and some of that reads as a pause: at a merge, a basic ribbon takes one whole item per 10 ticks,
  so an item arriving just after another waits at its door (up to a second); a ribbon at full
  rate into a building or out of an unloader lets one go per 10 ticks. When a building splits a
  flowing ribbon, the engine re-counts the upstream half's whole items: its tail item may stand
  about a second until it is whole again. Routing blocks linked to routing blocks (or fed by a
  building and feeding one) are balanced by item count, not by mu, as their flows are not seen.
- **Legacy and dead code:** the pre-morph helpers in iso.ts and camera-math.ts (kept alive by
  tests; `projection.test.ts` now covers the live maths), `rendererName`, `DynAtlas.canvasOf`.
  DynAtlas never evicts, and its 6 px padding differs from the static atlas's 8 px despite its
  comment. (The unused `belt:skybridge:*` frames are gone; drifters now run on game time and stop
  with the game.)

## Tests

| Test | Guards |
|---|---|
| [relief.test.ts](../src/render/relief.test.ts) | One whole terrace per level of the land (D52); a lone column is chamfered and stays inside its tile; a diagonal staircase becomes one straight wall; slabs nest (no overhang); only camera-facing walls, with open ends; `BORDER` covers every column leaning into a chunk; `tileTop` is the level the sprites and the paint draw (`windowLevels`), at the world's edges too; a click ray lands on the first rock top or cliff it meets (`surfaceTile`) |
| [iso.test.ts](../src/render/iso.test.ts) | `tileToIso` ↔ `isoToTile` identity, diamond directions, plus the legacy helpers |
| [camera-math.test.ts](../src/render/camera-math.test.ts) | World ↔ screen identity, zoom about a point, clamping, chunk ranges on negatives (legacy top-down space) |
| [daynight.test.ts](../src/render/daynight.test.ts) | The 24-hour clock on the world day; the grade never goes black and turns smoothly; lights only at night, clouds only by day; the seen sun follows SOLAR; the plan view's lighter grade |
| [art/recipes/fx.test.ts](../src/render/art/recipes/fx.test.ts) | The light spy turns LED fills into emitters and `PV` fills into cell polygons; every building recipe runs on the spy; night rigs (the Heart's beacon, amber only on hot machines) |
| [art/recipes/moving.test.ts](../src/render/art/recipes/moving.test.ts) | Moving parts draw their body and every phase in every baked rotation (iso and plan); the turbine's red light sits on its axis in every phase; the sand wheel stays behind its split plane; the silhouette context keeps solid fills only, in one colour; every building draws as its own cast shadow |
| [world/wire-geom.test.ts](../src/render/world/wire-geom.test.ts) | Every building that takes part in power has terminals on its footprint and under its head; the art (iso and plan, every baked rotation) draws each one; an anchor lands on a terminal, turned exactly as the art turns it (IsoFrame); a building drawn once keeps its rot-0 points; a pole takes a wire along its arm on the end pin, across it on the top pin; the Heart its nearer link mast; a building on the mountains hangs its wires from its terminals lifted by its level (a pole on the floor keeps its own); the catenary sags most at mid-span, capped, never to the ground even from the lowest terminal |
| [art/recipes/cargo.test.ts](../src/render/art/recipes/cargo.test.ts) | The sky-crane keeps the intro's numbers; the cargo drone is the same drawing (red to port, green to starboard, LEDs on the hub) and fits its canvas; the container passes through the deck's iris and the iris fits the deck (`TP_DECK_R`); the cables splay out from the container's eyes to the winches; the container draws at any depth in the iris and not at all once sunk |
| [world/cargo-flight.test.ts](../src/render/world/cargo-flight.test.ts) | The deck mirrors the trade post's art (`TP_DECK` in the middle of `TP_PAD`, `DECK_Z`, the drone's engines over the pad) and turns with the footprint as IsoFrame turns the art; both sequences run without a jump; the container goes through the deck only while the iris is open, hangs a cable's length under the drone, leaves the deck only once hooked and lands with its swing died out; the drone never sinks into its load; both end with nothing on screen; the next drone starts once the deck is clear |
| [world/moving-parts.test.ts](../src/render/world/moving-parts.test.ts) | Turbines turn faster in stronger wind (bounded, a mesa outspins the cirque, a turbine on the mountains the cirque floor in any gust), machines only while they work; each building's start phase and speed factor are stable and spread |
| [world/cast-shadows.test.ts](../src/render/world/cast-shadows.test.ts) | The shadow map is the identity for the reference light, sends the reference displacement to the sun's and keeps the cross direction; no shadow at night, shortest at noon, long and soft in a low sun, smooth through the day; at every hour a shadow runs straight away from the sun and nothing drawn (the far side of the seam) lies past a building's sun-side edge, which the stretch alone did at dawn; the bake's clip is exactly the far side; no shadow of the day reaches past `shadowReach` |
| [world/stand.test.ts](../src/render/world/stand.test.ts) | A building stands at 0 on the floor, on the rock top on the mountains (`tileTop`, the highest under its footprint; the ghost asks the same, ribbons lie flat); it sorts after every column under it (its front corner too), past the flat rock its shadow falls on, never past a higher column or a building on the floor ahead (a ribbon there changes nothing), behind the lifted buildings in front of it |
| [world/flow-arrows.test.ts](../src/render/world/flow-arrows.test.ts) | The ghost's way-in arrow comes from the tile behind into the block, the three ways out leave by the front and sides, in every rotation; only the blocks that take in at the back get them |
| [world/item-flow.test.ts](../src/render/world/item-flow.test.ts) | The paths: a bend round its corner; a junction's hump on the north–south line (the art's own profile, drawn over the bridge a little before and after), none under the east–west one |
| [world/cell-flow.test.ts](../src/render/world/cell-flow.test.ts) | Items drawn from the cells (D57), the real engine at 60 frames a second: a line through a junction (over its hump), a skybridge and onto a swift ribbon into an incinerator (it rides into the pit); a router dealing a line out three ways; a jammed line (each item still, on its tile's centre). Nothing jumps, nothing pops up but at a source, nothing vanishes but into a building |
| [world/belt-lift.test.ts](../src/render/world/belt-lift.test.ts) | Items at their tile's top; up a traction elevator (onto the car, up with it standing still, off over the edge; the car back down alone), down one onto a ribbon, a slide onto a building; among the volumes (`itemZ`): after their ribbon, keyed by the next tile of a plateau as they cross onto it, by their own against higher rock in front; down a step away from the viewer, after the high column while on the car at the top, behind it (and over the elevator's front frame) once it sinks, under a building in front; into an incinerator, over its pit on the near half, behind its flame on the far half and once it tips in |
| [world/pits.test.ts](../src/render/world/pits.test.ts) | The way into a pit: flat on the ribbon, up the chute, then an accelerating fall, gone before a full line's next hand-off; the flame's heat (up fast, down, embers, nothing) and levels; driven by the real engine at 60 frames a second, one flare for every item that falls in, items seen falling, no jump, the fire out once nothing comes |
| `scripts/smoke.mjs` | WebGL renderer; 20k particles > 30 fps; relief sprites > 100 near and 0 far; pan/zoom sweep settles with `chunksMissing === 0`; the morph settles; 10k items > 30 fps |

Untested: `proj`/`isoToView` endpoints, the `setView` fades, `Camera.zoomBy`/`panScreen` (the real
tile-space versions), the terrain LRU, `beltPiece`, and the `rockZ`/`buildingZ` interleave on the
floor (stand.test.ts covers it on the mountains). These are cheap pure tests to add ([testing.md](testing.md)).

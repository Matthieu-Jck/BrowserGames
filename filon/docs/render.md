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
| [relief.ts](../src/render/relief.ts) | Pure maths of the tiered rock relief (levels, masks, slabs, walls, `ledges`); `tileTop`, the one height of a tile's top every lift reads; `surfaceTile`, the tile a view ray meets first |
| [perf-overlay.ts](../src/render/perf-overlay.ts) | Frame timing, draw-call counter, `FL.perf()` stats |
| [stress.ts](../src/render/stress.ts) | `StressSpike`: the M0 particle spike kept as a perf tool (`FL.stress`) on `fxTop` |
| [daynight.ts](../src/render/daynight.ts) | The time of day's look: keyframes → `Grade` (tint, night factor, sun, clouds); `DayNight` applies it and holds the `FL.dayPhase` offset |
| [world/terrain-chunks.ts](../src/render/world/terrain-chunks.ts) | Streams painted ground / relief-paint chunk textures; fog |
| [world/relief-view.ts](../src/render/world/relief-view.ts) | Near-zoom rock columns as depth-sorted sprites (cut at their ledges, each part shaded at its height; talus decals); `level(x, y)` (= `tileTop`) |
| [world/buildings-view.ts](../src/render/world/buildings-view.ts) | Building sprites (iso + plan, lifted onto the rock top when they stand on the mountains), ribbon pieces; moving parts turning (`animate`); a production building switched off when it does not work (D83: its unlit picture, baked on demand); the incinerators' pits and their flames; the cast shadows |
| [world/work-look.ts](../src/render/world/work-look.ts) | Pure (no Pixi): which production buildings look at work (D83) — `workOf` (at work, a passing stop, stopped, per kind; it lives in the sim's [systems/work.ts](../src/sim/systems/work.ts) since D85, the debug bases' check reads it too, and is re-exported here), `WorkLook` (sampled once per game tick, a passing stop kept lit `WORK_GRACE` ticks, the flips for the views) |
| [world/stand.ts](../src/render/world/stand.ts) | Pure: how high a building stands and how it sorts (D44): `computeStands` once per rebuild, `standOf` / `liftOf` for the other views, `standLevel` for the ghost, `drawnLevel` (a ribbon: its tile's top) for picking; the depth keys `rockZ`, `buildingZ`, `standZ`, `beltZ`, `liftZ` |
| [world/traction-lifts.ts](../src/render/world/traction-lifts.ts) | The traction ribbons' elevators (D56): which steps get one (`liftOfBelt`), their frames baked on demand (`liftFrames`: back, car, front, plan mark); the conduits' falls one terrace down on the same sheet (D114: `fallOfConduit`, `fallFrames`) |
| [world/belt-lift.ts](../src/render/world/belt-lift.ts) | Pure: where an item is drawn and how high (`place`: its tile's top, or on an elevator's car), where each car is (`settle`, `carAt`), and where an item above the floor, in a shaft or at an incinerator sorts among the volumes (`itemZ`: its host tile's key) |
| [world/pits.ts](../src/render/world/pits.ts) | The incinerators' pits (D51): an item's way in (`pitPath`: up the chute, over the lip, falling), the fire (`PitFire`, one per colony, `pitFire(sim)`: when the last item fell, its heat), the pit's frames baked on demand (`pitFrames`: back and front; `flameFrames`; `planFlameFrame`) |
| [world/moving-parts.ts](../src/render/world/moving-parts.ts) | Pure: how fast a moving part turns (a turbine with the wind on its grid, still on none; a machine while it works), each building's own start phase |
| [world/cast-shadows.ts](../src/render/world/cast-shadows.ts) | Pure: the cast shadows' look through the day (`shadowLook`: length, swing, opacity), the map that stretches a baked shadow (`shadowMap`), the sun's direction (`sunDirection`), the seam a mask is clipped to (`farSide`, `seamClip`), how far a shadow can reach (`shadowReach`) |
| [world/items-view.ts](../src/render/world/items-view.ts) | Items riding ribbons and routing blocks: draws the item flow at the land's height (belt-lift.ts) — on the floor as particles under the volumes, above it (or falling into a pit) as sprites sorted among the volumes in iso and as particles over the rock ribbons' plan copies in plan; nothing on a camouflaged ribbon's tile (D109: buried; an item comes out of the sand where the line meets an open piece) |
| [world/item-flow.ts](../src/render/world/item-flow.ts) | Pure (no Pixi): the paths items ride across each ribbon tile (`buildPieces`: bends, a skybridge's leap and decks, a junction's hump and when items are drawn over it), a routing block's way through its centre |
| [world/cell-flow.ts](../src/render/world/cell-flow.ts) | Pure: where each item is drawn, read from the engine's cells (D57): on its tile, eased in from where it was over one step |
| [world/cast-shadows.ts](../src/render/world/cast-shadows.ts) `reliefSun`, [art/terrain.ts](../src/render/art/terrain.ts) `paintSunShadows`, [world/relief-view.ts](../src/render/world/relief-view.ts) `setSun` | The rock's shadows following the sun (D59): the floor's as a chunk texture (`s`), the rock tops' as a tint of their columns |
| [world/neighbours-view.ts](../src/render/world/neighbours-view.ts), [art/recipes/neighbour-dress.ts](../src/render/art/recipes/neighbour-dress.ts) | The neighbouring bases (D110): those near the view laid once surveyed — their buildings washed in their colours, lamps, wires (`layForeign` in the buildings, lights and wires views) — dressed in tarps, dome tents, banner poles and cairns; their goods, smoke, name band and drones per frame |
| [world/heart-flag.ts](../src/render/world/heart-flag.ts), [art/emblem.ts](../src/render/art/emblem.ts) | The claim's flag on the Heart (D58): baked wave frames bearing the emblem, laid and stepped by the buildings view; the emblem's ink drawing (shared with the register's designer) |
| [world/ghost-view.ts](../src/render/world/ghost-view.ts) | Build ghost, demolition / marking boxes, hover outline; the flow arrows of a directional routing block being placed; a face cutter's working side (D87: the tiles behind it turquoise where they hold quartz, coral where not, an arrow into the wall); a ribbon drag's plan as a faint placeholder until the release (D73: `DRAG_ALPHA`), a dashed line over each bridge pair's leap; a piece the drag buries (D109: the camouflaged ribbon) drawn stronger, inside a dashed ink frame (`buriedFrame`) |
| [world/flow-arrows.ts](../src/render/world/flow-arrows.ts) | Pure: which blocks take in at their back only (`isDirectional`) and their flow arrows (`flowArrows`) |
| [world/rivers-view.ts](../src/render/world/rivers-view.ts) | The rivers' running water at near zooms (D94): dashes drifting downstream on the ground plane |
| [world/overlays-view.ts](../src/render/world/overlays-view.ts) | Grid, the claim's land in parcels (D60: held, leased, a neighbouring base's holding outlined, D110; the land mode's grid, marks and usable-floor gauges, D94), the Link tool's marks, selection, dig/fill marks, reach circles |
| [world/views-view.ts](../src/render/world/views-view.ts) | The specialised views (D88): the paper veil over the base, the view's flat marks (grids by colour, ribbon heat, work states; the Vent view's wash of exposure and its arrows, D95) and its badges (sources and their output bars, consumers' gauges, troubles, jams, stops, turbines), from the shell's `Readouts` ([src/sim/readouts/](../src/sim/readouts/)) |
| [world/wind-hints-view.ts](../src/render/world/wind-hints-view.ts) | `WindHints` (D95): the wind's rare hints on the land — hairline ink flicks of a gust, low streaks of sand and ripples on open desert floor, downwind, only in clearly strong wind — the only sign of the wind before the Anémométrie plan |
| [world/wires-view.ts](../src/render/world/wires-view.ts) | The power wires (D25), terminal to terminal: fine catenaries in iso, straight inked lines in plan, glints, the Link tool's preview wire |
| [world/wire-geom.ts](../src/render/world/wire-geom.ts) | Pure wire geometry: a building's terminals in the world (`terminalsAt`, lifted with a building on the mountains), the one a wire hangs from (`wireAnchor`, `wireEnds`), sag, catenary points, points along a polyline |
| [world/gleaners-view.ts](../src/render/world/gleaners-view.ts) | The Gleaners at night (wanderers by the exposed lines, takers running off with what they took) and the glazed ribbons' glass hoods (D103) |
| [art/recipes/gleaners.ts](../src/render/art/recipes/gleaners.ts) | A Gleaner (four walk frames, carrying or not), its lantern-eye glow, the glass hood (straight and corner), the fence in iso and from above (D103) |
| [world/landing-view.ts](../src/render/world/landing-view.ts) | `LandingView`: the intro's landing (D31) — the Heart lowered into the cirque by a CrierBelt sky-crane (`drawCrane` with `SKY_CRANE`, the drawing the cargo drone shares): descent, flames, dust, touchdown, the crane's exit |
| [world/cargo-view.ts](../src/render/world/cargo-view.ts) | `CargoView`: at each trade, a CrierBelt cargo drone (the sky-crane at 0.9 scale) works the trade post's deck — hauls a container up (a sale), sets one down (a purchase) — and the deck's lift iris takes it in or brings it up |
| [world/cargo-flight.ts](../src/render/world/cargo-flight.ts) | Pure: the cargo drone's choreography (`poseAt`), the deck's place on a trade post (`deckCentre`, mirrored from its art: the middle of its 5 × 5 pad and apron, D62) |
| [world/lights-view.ts](../src/render/world/lights-view.ts) | `LightsView`: night glows (additive; none on a building switched off, D83), solar states (solar panel petals, PV cells); `CloudShadows` |
| [art/tokens.ts](../src/render/art/tokens.ts), [ink.ts](../src/render/art/ink.ts) | Palette; inked strokes, flat fills, hatching, stipple, shadows |
| [art/shapes.ts](../src/render/art/shapes.ts), [iso-shapes.ts](../src/render/art/iso-shapes.ts) | Machine vocabulary seen from above (`Frame`) / in iso volume (`IsoFrame`, `Scene`) |
| [art/terminals.ts](../src/render/art/terminals.ts) | Where the power wires meet each building: the terminal table (`TERMINALS`, one point or a few per building, in its unrotated frame), the poles' heads (`POLE`, `PYLON`), the Heart's link masts; `turnsArt` / `artRot` (which rotation a building's art is drawn in), `rotLocal` (the art's rotation rule) |
| [art/recipes/](../src/render/art/recipes/) | One drawing per building (iso + plan), belts, item glyphs, status icons; `fx.ts`: the light spy, night rigs, glow / haze / cloud textures, solar panel petals, PV states; `moving.ts`: the buildings with a moving part and the geometry their two views share (D87: the face cutter's cutting drum, `CUTTER`, which turns while it works; the deep bore's rig, `BORE`, its rotary table and kelly turning while it works, §9 note 13). The face cutter (D87) is a crawler rig whose toothed drum on its back overhangs the footprint about 0.2 tile into the wall it stands against, a ramp of cut quartz behind, a conveyor up to its output chute at the front left, an ochre power house with an amber beacon and a floodlight on the rock; the quartz workshop a saw bench and a winding spindle at its back, a lapping wheel and a tray of oscillators by its output. Item glyphs: `crystal` is quartz (two milky points on a grey stone, apart from the singing quartz's three lilac prisms), `oscillator` a silver can on two copper leads |
| [art/view-icons.ts](../src/render/art/view-icons.ts) | The views' marks (D88) in ink on a paper badge (`drawViewIcon`, `viewIconCanvas` for the DOM), their colours (`GRID_COLORS`, `SOURCE_COLOR`, `heatColor` / `HEAT`): one drawing for the world and the panels |
| [art/silhouette.ts](../src/render/art/silhouette.ts) | A context that paints a drawing's solid fills in one colour (cast-shadow masks) |
| [art/unlit.ts](../src/render/art/unlit.ts), [art/recipes/off.ts](../src/render/art/recipes/off.ts) | A building's art switched off (D83): `unlitCtx` (lamps drawn as dark glass, their halos left out; `isUnlit` for a recipe to leave out its fire and steam), `switchOff` (greyed, darker, a touch of lilac); `drawOff` runs a building's own recipe through both |
| [art/solar.ts](../src/render/art/solar.ts) | `PV` (the solar-cell colour) and `pvPanel`: draw cells with them and they get their day / night states |
| [art/atlas.ts](../src/render/art/atlas.ts), [dyn-atlas.ts](../src/render/art/dyn-atlas.ts) | Static atlas baked at boot; on-demand atlas for relief columns |
| [art/terrain.ts](../src/render/art/terrain.ts), [terrain.worker.ts](../src/render/art/terrain.worker.ts), [rock.ts](../src/render/art/rock.ts) | Chunk painters (ground, relief paint) and the rock-column painter, worker-safe |
| [art/ore.ts](../src/render/art/ore.ts) | The ore deposits on the ground (D99): `paintDeposits` (terrain.ts calls it once, pass 5), each ore's material `ORE_LOOK` (the item glyphs read the same tones), `richness`, `nodulesOf`; worker-safe |

Related: [app.md](app.md) (frame loop, view state, picking), [input.md](input.md), [content.md](content.md),
[engine.md](engine.md), [testing.md](testing.md), [glossary.md](glossary.md), [extending.md](extending.md)
(end-to-end checklists), [../ARCHITECTURE.md](../ARCHITECTURE.md).

## 1. How a frame is drawn

Render has no loop. `main.ts` runs one `requestAnimationFrame` loop and calls the app's frame,
which drives render in this order (details in [app.md](app.md)):

1. **View morph.** The view state moves a linear `t` towards its goal (0 iso, 1 plan) over 0.5 s;
   `te = ease(t)`; `P = proj(te)`. P goes to `camera.P` and to `layers.setView(P, te)`.
2. **Sim and events.** Fixed-step ticks; chunks in `grid.dirtyChunks` → `terrain.invalidate(ck)` and
   `relief.invalidate(ck)`; a structural change → `buildings.rebuild(sim)` (only the entities whose
   drawing changed are re-drawn, D92), `items.rebuild(sim)` and `lights.rebuild(sim)`.
3. **Camera.** `camera.update(dt)`, then `camera.apply(world, w, h, resolution, snap)`, with `snap`
   only when `te` is exactly 0 or 1.
4. **Views**, in this order (relief reads the chunks terrain found visible):
   `terrain.update(cam, w, h, dpr, P, te)` → `relief.update(cam, w, h, terrain.visible, P, te)` →
   `ghost.draw(preview, sim, hover, show)` (the preview is null outside build mode) →
   `wires.update(sim, te, dt, linkPreview, view === 'power')` (the Link tool's preview and
   `overlays.linking` are set first, its hover from `picker.entityAt`) →
   `overlays.update(sim, viewTiles, te, zoom, selected, relief.level, ghostReach)` →
   `viewsView.update(sim, frame, readouts)` (the specialised view's veil, marks and badges, D88) →
   `dayNight.update(worldTick, te)` → `lights.update(grade, P, te, seconds)` →
   `clouds.update(grade, P, te, tx, ty, zoom, seconds)` (§10, *Day and night*) →
   `buildings.setPlanness(te)` → `buildings.cull(viewTiles)`
   (off-screen buildings culled, D92) → `items.update(sim, fractionalTick, P, te, zoom, viewTiles)` (first:
   it moves the elevators' cars) → `buildings.animate(sim, gameSeconds, grade)` (moving parts, cast shadows).
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
| View world px | `apply(P, x, y)` | Items, `CamState.cx/cy` |
| Screen CSS px | `(world − centre)·zoom + viewport/2` | Pointer events, DOM |
| Atlas px | 2× world for iso sprites (`k = 0.5`), 64 px/tile for plan and belts | Art recipes |

## 2. Stage ([stage.ts](../src/render/stage.ts))

`createStage(host, { perf })` calls `autoDetectRenderer` with `preference: 'webgl'`,
`resolution = min(2, devicePixelRatio)` (1 in perf mode), `powerPreference` `'high-performance'` (`'low-power'` with « Basse consommation », D100: the integrated GPU on a computer with two), `autoDensity`, antialias off in perf
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
   │  ├─ items        —     [rg]    item particles on the floor, in view world px; the Gleaners' figures (D103)
   │  ├─ glassPlane   P             glass [rg] (the glazed ribbons' glass hoods over their items, D103)
   │  ├─ shadowsIso   M   × isoA    shadows  (the buildings' cast shadows on the ground)
   │  ├─ reliefPlane  P   × isoA    relief   (painted relief chunks)
   │  ├─ planPlane    P   × planA   plan [rg] (plan building sprites; sorted: rock ribbons' copies, items over them, buildings)
   │  ├─ volumes [rg] M   × isoA    objects  (iso buildings + cliff columns + items above the floor, z-sorted)
   │  ├─ itemsOver    —     [rg]    items riding a junction's deck or a skybridge, over every building
   │  ├─ veilPlane    P             veil     (a specialised view's paper wash over the base, D88)
   │  ├─ wiresIso     M   × isoA    wires [rg]      (power wires)
   │  ├─ wiresPlanPlane P × planA   wiresPlan [rg]
   │  └─ shade        —             cloud shadows (multiply; CloudShadows sets P itself), the wind's hints (WindHints sets P itself, D95)
   ├─ lights    [render group]      night glows, additive (LightsView: iso under M, plan under P)
   ├─ top             P             grid · viewFlat [rg] · overlays · fog · land · ghost [rg]
   ├─ status    [rg]  —             empty (view world px)
   ├─ viewMarks [rg]  —             a specialised view's badges (view world px, untinted)
   ├─ fxTop           —             the cargo drones' containers, the intro's landing (under M), M0 stress spike
   └─ fxGlow          —             the landing's and the cargo drones' flames and their light (untinted); the cargo drones over their flames (tinted by hand)
```

| LayerName | Filled by | Notes |
|---|---|---|
| `terrain` | TerrainChunks: ground chunks, sand placeholders | |
| `decals` | — | Declared, unused |
| `belts` | BuildingsView: ribbon and conduit pieces on the floor, in its own render group sorted by rank (`buildings:belts`, D92); JunctionsView: the passages, after it | Flat in both views. A piece on rock goes to `objects` (iso, key `beltZ`) and `plan` instead (D56) |
| `items` | ItemsView: the items on the floor | Drawn above belts, below relief paint, plan sprites and volumes. Items above the floor (on rock, in an elevator's shaft) or at an incinerator are drawn among the volumes in iso (`objects`) and over their ribbons on `plan` |
| `itemsOver` | ItemsView: items riding a junction's deck or a skybridge (the model's `o`) | Over every building in both views (render group) |
| `glass` | GleanersView: a glass hood over each glazed ribbon on the floor (D103) | Under P, over the items riding them, under the shadows and volumes; laid at each new graph |
| `shadows` | BuildingsView: the cast shadows (its container a render group sorted by rank, its alpha set when its 8-bit value changes, D92) | Iso px under M, faded with the volumes; above ribbons and items (they fall over them), under the relief paint and every volume (a shadow never falls on a building) |
| `relief` | TerrainChunks: relief-paint chunks | The *painted* relief; relief *sprites* are in `objects` |
| `plan` | BuildingsView: plan sprites; ItemsView: the items above the floor (a container drawn through P⁻¹, so in view px) | `sortableChildren` in bands (stand.ts `PLAN_Z`): the plan copies of ribbons and junction passages on rock (−2), the elevators' marks (−1.5), the items riding them (−1), every building sprite at 0 in the order laid — so items on rock show over their ribbons and go under a building, as on the floor |
| `objects` | BuildingsView iso sprites (the incinerators' pits in two parts with their flames), ReliefView columns, ItemsView: pooled sprites of the items above the floor, in a shaft or at an incinerator | `sortableChildren`, shared zIndex keys (§7.4). Its parent `volumes` is a render group: an item crossing a tile changes its key, and the re-sort and re-batch stay inside the volumes |
| `grid`, `overlays` | OverlaysView | Fade by `te` inside the view |
| `land` | OverlaysView: the claim's land (D60) — parcels held, leased, a neighbouring base's (D110); the land mode's parcel grid, hovered and picked parcel | Above the fog (a map of who holds what, readable over land not explored yet), below the ghost; untinted like the overlays |
| `fog` | TerrainChunks fog masks | Above the overlays |
| `ghost` | GhostView | Render group |
| `status` | — | Empty since the drifters went ([D108](decisions.md)): kept as the slot for billboards over the land |
| `veil` | ViewsView: a paper sprite over the visible tiles while Électricité, Logistique or Production is on (`VEIL` alpha, eased in 0.22 s) | Inside `lit` (graded with the world), over the buildings, ribbons and items, under the wires — so the Électricité view's bold wires stay on top; the shell multiplies the night glows (`lights`) by 1 − veil, and fades the wires to 0.3 under the other two views |
| `viewFlat` | ViewsView: the view's flat marks, two copies (flat in plan, lifted onto the rock tops in iso, cross-faded) | In `top`, untinted, under the overlays: colours read the same day and night |
| `viewMarks` | ViewsView: the view's badges and gauges | View world px, above `status`, untinted; placed when the projection or the zoom moves |
| `fxTop` | CargoView (the deck's iris, shadows, dust, the container, cables), LandingView (the Heart, the crane, cables, dust, shadow), `StressSpike` (`FL.stress`) | |
| `fxGlow` | LandingView and CargoView: thruster flames, nozzle halos, the plumes' light on the ground; the cargo drones themselves, over their flames, and their own lights at night | Above everything and outside the day / night grade, so emitted light stays bright at night. A cargo drone sits here so its hub, beams and pods hide its plumes (the back engine's burns behind the hub); it copies `fxTop`'s tint every frame to stay graded |
| `shade` | CloudShadows; WindHints (D95) | Inside `lit` (graded), above everything in it; the clouds' plane multiplied, the hints' plane normal |
| `lights` | LightsView glows; GleanersView: the Gleaners' lantern eyes and the halo of what they carry (their own additive container) | Above `lit` so the grade never dims them; additive; its alpha is the night factor |
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
marks `te`, lifted marks `1 − te`. Items on the floor float `(3 + z)·(1 − te)` px above ribbons (z: a skybridge deck or a junction's hump). Above the floor, in an elevator's shaft or at an incinerator, an item is drawn among the volumes while `te < 0.6`, at its iso px `tileToIso(x, y) − (3 + z + lv·LH)` (lv: the land's height under it, belt-lift.ts) like any volume, so M carries it with the ribbon it rides, its sprite drawn through M⁻¹ so it stays upright; and on `plan` from `te > 0.3`, flat over the ribbons' plan copies (`(3 + z)·(1 − te)`): it cross-fades as its ribbon does. Relief-paint sprites show and relief columns stream only
while `te < 0.6`. Render groups (`world`, `items`, `itemsOver`, `volumes`, `ghost`, `status`) keep the transforms on the
GPU and isolate rebuilds of fast-changing content; `plan`, and inside the buildings view the floor
ribbons and the shadows, are render groups for the opposite reason (D92): big and rarely changed, they
are not re-batched when the terrain streams chunks in.

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
whitening; (2) world-hashed stipple; (2b) hardpan plateaus; (3) water with an inked shore — a
**river** (map 4, D94) first, its bed `C.river` (bluer than the still lakes) and, from 16 px/tile, a
paper-white stroke and a darker one along the way it flows (the chunk's biome code: `RIVER_BIOME` +
the eighth of a turn, mapgen's `BIOME.river`), and where it steps down (the next tile along its way
stands lower: a stream falling off a massif) a band of foam across it and spray below — the plan
view's fall —, then the still water over it, one inked shore round both so a river opens into its
lake; the open sea (`SEA_BIOME`) a little bluer and darker in its deep water, two broken lines of
surf following its coast (`paintSurf`); (3b) a **chasm** drawn as a crevasse (D94; the owner: « il faut que ça ressemble à une
crevasse »): its rim points moved by a hash of their world position (broken lips that join across
chunk seams), clipped to its shape the far wall — the −x −y side, the one the iso camera looks
into — lit at the lip in the Crown's ochres and darker band by band down the slope (the shape moved
+x +y a little more each band: the walls converge), strata lines along the lip, cracks down the
face, a pebble on a ledge, hatching down the slope in the shade (grooves in iso, a drop in plan; its
lattice whole fractions of a tile so chunks meet), a cool haze over the deep bands and only a thin
near-black strip under the near lip (`CREVASSE`); its lips inked over a paper halo, heavier on the
near lip; on the floor beside it loose stones and side cracks. Water, rivers and chasms are
[art/gaps.ts](../src/render/art/gaps.ts) (`paintWater`, `paintChasms`), the window and the marching
squares [art/paint-kit.ts](../src/render/art/paint-kit.ts); both march with `keep` (a tile inside
stays inside however thin its band: drawn as the rules read it; given as a test, only the tiles it
passes, so the field stays the same on both sides of a chunk seam). All water is one outline (owner,
2026-10-17: « les rivières sont un peu cassées des fois, à la frontière entre eau bleue claire et
foncée »): the lakes, the sea, the tarn and the rivers marched together, a river's own tiles kept in;
filled with the shallows, then, clipped to it, the deep heart, the sea's deeper blue and the rivers'
blue laid in seven bands further and further out of their tiles (`march`'s `iso` 0.06 … 0.5, alphas
1/7 … whole: `FEATHER`), so where a river meets its lake or the sea, or the deep its shallows, the
colours run into each other over about a tile with no line and no ground between them, while a
bank, where the bands fall outside the clip, keeps its edge and its one inked shore. The water's texture (D115; owner: « The water texture can be improved to reach the level of the mountains texture »), in the mesas' family (`WATER`): a broad river deeper two and three tiles from its banks, still water's middle between its shallows and its deep heart (a distance to the bank capped at `DEPTH_MAX` 3 tiles, so both sides of a chunk seam read it alike), the sand through the shallows along every bank and wet sand past it; then `paintMarks`, at 16 texels a tile and more, a tile past the chunk in world order: ink current lines along a river's way (`WATER.current`, the river's dark towards the ink) with shorter paper highlights, glints on the deep, broken foam a little way in from a river's banks, foam arcs where streams meet, a fall's lip foam and spray and, where it lands on a lower stream or a pool, the water boiling (`plunge`), short ripples on still water (no line along its depth: on a small pool it drew a square). The surf keeps
off a river's mouth (no breakers where the sea meets other water). Before, the river and the still
water were two outlines (a hard seam, slivers of sand between them), the deep heart had a light rim,
and a window with a river in it drew the lake's shore with every tile kept in, one without did not:
the shore moved at the seam ([water-seam.test.ts](../src/render/art/water-seam.test.ts)); (4) rock
as a relief map of its **levels** (`paintRockMap`; owner, 2026-10-14: the mountains looked different
in plan and in iso, and were hard to build on; 2026-10-16: « les montagnes ne sont pas très belles »):
each rock tile's terrace slabs outlined exactly as the iso columns are (relief.ts `masksAt` /
`slabOutline`: the tile, its corners chamfered by its neighbours), step by step from the foot up,
over the rock's soft cast shadow. Per step: its shadow on the terrace below and the occlusion at its
foot (wide soft strokes along its edge, half covered by its fill); at the floor (≥ 32 px/tile) talus,
blocks and gravel fallen at the very foot of each cliff (`floorTalus`: along its first step's
silhouette, a chamfer's diagonal too, none into water or a gap); its fill in the colour its columns'
tops wear in iso (`topColor`: the rock of that step's height, `layersOf`, paler and cooler a level
up, so the plan, which sees only tops, tells the levels apart); inside its edges (≥ 16 px/tile)
hillshading — a lit lip where the edge faces the light (−x −y), a shaded one where it faces away —
and one or two fine lines following the edge (`insetChain`: the silhouette chains moved inwards,
mitred, run on into the next tile's), the strata seen from above, like contours; its tops' surface
(`topMarksPlan`: sand pockets, slabs, cracks, boulders by hardness, hashed from world coordinates,
kept off the tile's edges); its silhouette inked, bold at the floor; (5) the ore
deposits ([art/ore.ts](../src/render/art/ore.ts) `paintDeposits`, D99; owner, 2026-10-16: « i cannot
distinguish copper resources from iron on the ground »), then vents and biome decor. Each ground ore
wears its own material (`ORE_LOOK`), told apart first by colour — what carries at the far zoom —
then by shape: **iron** heavy angular nodules, rust-red and grey-black (magnetite), faceted, steel
flecks, rust bleeding into the sand; **copper** bright copper-orange crusts of grape-like lobes with
malachite-green blotches on them and on the ground between, a native-copper glint; **coal** black
glossy slabs along one grain (hashed per 8-tile stretch), a sheen on their lit edge, a seam across
its rich tiles; **salt** white crusts on its flats, lilac-rimmed, cubes and sparkle; any other item
(a unique's site) a pebble of its colour. Two layers: a **stain**, the deposit's ground tinted in
its ore's colour (marching squares with `keep` over its tiles, each corner moved by a hash of its
world position so the edge is organic and joins across seams — on map 4 too, whose deposits come
in whole drill blocks, D104: the stain rounds them into natural patches, and a drill in hand snaps
onto their grid), darker again over its tiles at or
above the ore's base richness; then the **nodules**, tile by tile, more and bigger the richer the
tile (`richness`: its `rich` against `BAL.depositRich`, ‰ — a near deposit's rim 700, its heart
1000, the far ring's heart 1600; `nodulesOf`: 2, 3, 5 at ≥ 32 px/tile), a rich tile's first a
boulder in its middle, each a top over a side extruded towards +x +y (straight down in iso: a lump
with a side) over its cast shadow, the ink stroked under the fills so only the silhouette is inked.
By texels per tile: 8 a coloured blob a tile; 16 a few outlined nodules; 32 and 64 the facets, the
grit, the glints. Nodules may hang over their tile's edge, so the painter walks one tile past the
chunk all round, in world order: both sides of a seam draw the same strokes ([ore.test.ts](../src/render/art/ore.test.ts)).
An ore under rock is a hidden vein, a faint mark of its ore's colour — but a face ore (D87: quartz
set in a cliff, `isFaceOre`) on a rock tile with a drop beside it is drawn as its seam: crystal
clusters with glints along every edge that drops to lower ground, kept inside the tile's own
footprint (the ground texture shows in iso too: crystals overhanging the edge stood on the floor in
front of the cliff). Ripples, crackle and decor need ≥ 16 px/tile. Edges use marching
squares over a smoothed field read from the border window, and every random choice is hashed from
**world** coordinates, so seams match without coordination.

## 7. Relief

### 7.1 Pure maths ([relief.ts](../src/render/relief.ts))

Shared by the worker and the main thread; no DOM, no Pixi.

| Concept | Rule |
|---|---|
| Level | `levelOf(terrain, level)`: 0 off rock. On rock it is the sim's own level (D45, `grid.level`, the paint windows' `level` array), clamped 1..6 (`MAX_TERRACE`: the mountains reach 5, map 4's spring summit 6, D115), × `STEP_LEVELS` (2): 2 to 12 relief levels (a wall's colour deepens up to the mountains' 10, `MOUNTAIN_TERRACE`, the summit as deep). Water and reclaimed ground (`Filled`) above the floor — the Crown's tarn (D63) — and a river tile above it — a stream up on a massif (map 4's drainage, D94; `isRiverT`) — stand at their level too, a column like the rock round them; any other ground has relief level 0. Since D52 (2026-10-13) it no longer comes from a smoothed height, so the drawn terraces are the levels placement, ribbons and wires obey, and a footprint the rules call level ground is drawn flat. 1 level = `LH` = 16 world px; a terrace is a one-tile-high wall. |
| Tile top | `tileTop(land, x, y)`: THE height of a tile's top (levels; 0 = the floor), where whatever stands on it stands. Every lift reads it, so all move together when it changes: buildings on the mountains, their moving parts, shadows, night lights and wire anchors (through world/stand.ts), the build ghost, the iso picking, the overlays' marks on rock (`ReliefView.level`). Today `levelAt` over the land (a height of 0 off the world, as the paint windows read it), so it is exactly the level the sprites and the paint draw; meant to become the sim's `grid.level(x, y)` × one terrace's height. |
| Ray | `surfaceTile(land, px, py)`: the tile a view ray meets first, from its ground point (where it crosses z = 0). A point `lv` levels up on the same ray lies `lv·SHIFT` tiles further along +x+y, so walking down from `MAX_LEVEL`, the first tile whose top reaches the ray is the rock top or cliff it hits; else the ground tile. |
| Mask | `maskAt(level, x, y, at)`, 8 bits. `M_E/M_S/M_W/M_N`: that side drops below the threshold. `M_NE/M_SE/M_SW/M_NW`: the diagonal neighbour stands as high; kept only at convex corners, so columns that look alike share one sprite. |
| Slabs | `masksAt` returns one mask per terrace step (thresholds 2, 4, … level). A column erodes only down to its neighbours' height, never to the ground. |
| Chamfers | A convex corner is cut 0.38 tile along each side, or all the way to the next corner where a diagonal neighbour carries the edge on. Diagonal fronts become straight walls instead of staircases. |
| Outline | `slabOutline(masks, t)`: the unit tile clipped by the half-planes of every chamfer of steps 0..t. Upper slabs nest inside lower ones and never leave the tile. Each segment carries a silhouette flag (its side drops, or it is a chamfer). |
| Walls | `wallRuns(outline)`: runs of silhouette segments that face the camera (`facesCamera`: normal towards +x+y), each with open-air ends. `shadeOf(a)`: 0 for the lit +y face, 1 for the shaded +x face. |
| Ledges | `ledges(masks, min)`: the steps whose top shows in front of the step above (a chamfer sets it back) by at least `min` tiles² since the last, and the last step: where the relief sprites cut a column in parts (§7.3). A diagonal front's staircase has one (half a tile); a corner's 0.38 chamfer does not count at `min` 0.2. |

### 7.2 Painter ([rock.ts](../src/render/art/rock.ts))

`drawColumn(ctx, proj, cls, masks, {detail, seed, k, top, vein, layers, slabs})` draws the slabs
bottom-up in the manner of Moebius's desert mesas (owner, 2026-10-16: « les montagnes ne sont pas
très belles, il faut faire mieux »: the cliffs read like crates, the high massif lilac boxes). Detail
is 0 (far paint, < 32 px/tile), 1 (worker, ≥ 32 px/tile) or 2 (sprites); the caller's `proj` picks
the projection, and the seed comes from the look (`columnSeed(cls, masks, columnVariant(x, y))`), so
the sprites and the paint draw the very same rim.

- **The rock is layered, not boxed.** The strata are one table by absolute height for every column
  (`BEDS`: thin beds of uneven thickness, a bed every half level or so, a thick bed's base every one
  to two levels, each thick bed paler or darker than the last), so a bed runs on from tile to tile at
  its height and a long cliff reads as one face. Each plane wanders a hair along the wall — nil where
  a tile meets the next. A wall is filled bed by bed in flat tones (`wallColor(cls, shade, z, tone)`:
  the hardness, the face's light, deeper with height, the bed's tone), and a slab whose wall carries
  on the wall below (`flush`) has no crease at its foot nor ink on the rim below it (`slabTop`: a
  side the step above carries on up is no silhouette). Walls run a hair past a tile's edge where the
  next tile carries them on (`OVERRUN`): no hairline between sprites.
- **Hardness reads in the texture** as much as in the colour (`ROCK`, H1–H4; the excavator's research
  gates by it): the soft sandstone shows every thin bed, cross-bedding and weathering pits; the
  red-bed thicker beds broken by joints; the sienna rock massive beds split by long jagged fractures
  with a lit edge; the heartrock dark plum, faceted, glinting, its veins glowing (`C.cyan`/`C.led`:
  they light at night). Each step wears the rock of its height (`layers`, terrain.ts `layersOf`: the
  class of the land round it at that height — hardness follows level — else the step above's), so a
  tall column's lower walls and ledges carry on its neighbours' layers.
- **A lip open to the sky** (`lips`: not carried on up by the step above) has a caprock band over a
  shadowed overhang, a rim bitten a little inwards with its corners rounded (`ROUND`) and, now and
  then, a notch with its gully cut down the face (the rim's knee, `KNEE`); the bite is nil at a side's
  ends, so rims meet across tiles, and only inwards, so the top never leaves its tile. Down the face:
  desert-varnish streaks from the lip (a pale one now and then), grooves with a lit edge, a fallen
  block's pale scar, occlusion at the foot, pen hatching hung from under the caprock on the shaded
  faces. Lit lip, silhouettes (ink ribbons, the ground contact heaviest), open-air verticals up the
  knee, folds.
- **Tops** (`topMarks`, kept off the tile's edges): sand pockets with ripples in the soft rock, raised
  slabs and cracks in the harder, a boulder now and then on the hard crests, facets and glints on
  the heartrock — no grid of dots. `topColor(cls, level)`: the hardness's top, paler and cooler a
  level up (aerial perspective, never another material).
- **Talus**: on a step's top where the step above stands back (a ledge in front of a chamfered wall:
  drawn with the ledge, so it takes the ledge's shade), the occlusion of the wall's foot, fallen
  blocks (`stone`: a lit top over a shaded body, inked) and gravel; where a higher neighbour's wall
  rises from a top, the same as a decal (`drawFoot`, `Foot`: the stretch of the neighbour's own side
  standing there, terrain.ts `footOf`).

`columnShadow` casts a footprint along the light.

**The quartz vein** (D87: a face ore set in a cliff; `ColumnOpts.vein`, from `columnLook`: rock
holding a face ore). Its column wears a milky seam that wanders across its camera-facing wall runs
(`veinSeam`), crystal clusters breaking out of it (`veinCrystals`, detail ≥ 1) and points along the
lip of its top (`veinLip`, sprites only). The quartz is drawn by one helper and palette (`QZ`: white
faces, an ice-blue shade on the terminations, a cool violet-black ink), plain paint with no light
token (a vein does not glow at night), shared by the cliff, the plan's seam and the machines' cut
quartz, so it reads the same wherever it shows. The far paint keeps its crystals flat on the wall,
so nothing sticks out from under the sprites near the camera.

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

**A stream up on a massif** (D94: map 4's drainage; a river tile above the floor). Its column's top is
a `river` (`TopLook.flow`, the eighth of a turn it runs to, from the chunk's biome code `RIVER_BIOME` +
flow; `fall`, the relief levels down to the next tile along it), its walls the hardest rock round it.
The tile is running water (`C.river`) with strokes along its way (`streamMarks`), its banks inked
where the land beside is not water at its height; its corners that touch no water are cut half a
tile along each side (`WEDGE`; never at the lip of its fall), and a rock tile at its height where it
steps on diagonally past a corner takes a wedge of it (`streamWedges`; `TopLook.run`: some water round
it runs), on the line the rock tiles' corners of water already follow where three tiles of it meet:
a stream that steps, orthogonally or diagonally, is one straight channel. Where it falls (its way
faces a camera-facing wall, `fallsDown`), a sheet of running water covers that wall down to the lower
tile (`waterfall`: white and pale-blue streaks, long on a tall fall, broken into rapids on a fall of
one level; the lip's curl), foam across the stream at the lip, and foam and spray at the foot of the
wall (`splash`). The plan view's fall marks are gaps.ts's.

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
headroom. Per-chunk relief (levels, per-step masks, rock class, top, vein, `foot`, `layers`) is
computed with the worker's own `buildWindow` + `windowLevels` + `columnLook` + `footOf` +
`windowLayers` and cached. A sprite's atlas key is `${cls}:${masks}:${variant}:${topKey}` (`:q` added
for a vein column, D87: its own sprite, with headroom above for the crystal points on its lip,
`VEIN_HEAD`; `:l…` for a column whose steps are not all its own rock; `:p<t0>-<t1>` for a part),
with two hashed variants (`columnVariant`). **Parts**: a column is cut at its ledges (relief.ts
`ledges`, at least `LEDGE_MIN` 0.2 tile² of a lower top showing: a diagonal front's staircase), its
parts at the same depth key, bottom first (equal keys keep their order), each tinted by the sun's
shade at its own top — a ledge belongs to the terrace in front, shaded with it, not lit with the high
top behind (owner, 2026-10-16: the terraces under a cliff were a checkerboard of diamonds); a part's
frame spans its own heights only. **Talus decals**: where a higher neighbour's wall rises from a top
(`foot`), a decal of its own (`t:${cls}:${footKey}:${variant}`, a few dozen looks for the whole land,
rock.ts `drawFoot`) lifted onto the top, at its column's key + 0.01, tinted as its top. Baking is
capped at 8 ms per frame. A block appears only when all of its sprites are baked; otherwise it is
retried next frame and the paint shows meanwhile (`pending` counts the waiting ones). Sprites are 2×
(scale 0.5), anchored on the tile's back corner at `tileToIso(x, y)`. `invalidate(ck)` drops the 3 ×
3 neighbourhood, because masks and smoothing read neighbours. `stats()` feeds perf `reliefSprites`
and `reliefBaked`. **The tint** (`setSun`): a part's top in the shadow of higher rock, from samples
on its top (a ledge's on the ledge only) walked back towards the sun against the rock as drawn
(`heightAt`: a chamfered column stands where its outlines are, so the tops along one straight wall
take the same shade), cached per tile and height for the sun of the moment and smoothed over the
tops and ledges round it at that height (5 × 5). `level(x, y)` returns a tile's
top (0 = floor): `tileTop`, the one height function, today the level the columns are drawn at. The
overlays use it to lift iso marks onto rock tops: shifting `level·SHIFT` tiles along −x−y moves a
point exactly `level·LH` px up in iso.

**DynAtlas** ([dyn-atlas.ts](../src/render/art/dyn-atlas.ts)) grows on demand. `add(key, w, h,
ox, oy, draw)` bakes through a temp canvas onto shelf-packed 2048² pages (6 px padding) and
accumulates `spent` ms. `flush()` uploads dirty pages once per frame and resets the budget. It
never evicts: the key space is bounded (4 hardnesses × mask combinations × 2 variants × the few
layer, part and top looks; the talus decals a few dozen). The mesas of 2026-10-16 cost about a
fifth more atlas than the boxes did over the same views (a sweep of eight mid-zoom views round
the cirque: 488 frames, 15.9 Mpx on 7 pages before; 667 frames, 18.9 Mpx on 9 after — the ledge
parts, the layers, the decals). A step's layer is keyed only where it shows (a wall or a ledge).

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
| `b:<id>:<rot>:<lv>`, `bt:<id>:<rot>:<lv>` | `bKey` / `btKey(id, rot, lv)` | A building's look at level `lv` > 1 (`artLevels`: the Heart's levels 2–5, D86, D118) | As its sprite | As its sprite | rot 0 only (the Heart never turns; views fall back to rot 0) |
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
   (sand, dune, mesa, peach, salt, hardpan; rock, H1–H4, one warm family from pale ochre sandstone
   through terracotta and sienna to plum heartrock, deeper on its walls with height, its tops paler
   and cooler up high; violet only in the shade — `C.rock1…4`, rock.ts `ROCK`, §7.2).
   Machinery is cold painted metal (steel blues, teal, violet, ice) with hot accents (coral, brass,
   hazard) and glowing lights (`led`, `ledWarm`, `ledRed`, `ledGreen`, `glow*`). Ports: turquoise
   intakes, coral nozzles. `num()` gives a Pixi tint, `mix()`/`rgba()` blend, and
   `pushTokensToCss()` exposes `--t-<token>` so the DOM and the canvas agree.
5. **Deterministic.** Strokes are seeded (`makeRng`, `hash32`); terrain randomness is hashed from
   world coordinates; atlas packing is ordered.
6. **Detail by scale.** Ground details appear at ≥ 16 px/tile; rock detail is 0/1/2 (§7.2). Nothing per
   tile that repeats as a grid: marks are scattered and kept off a tile's edges, and what crosses tiles
   (strata, rims, a stream's banks) meets the next tile's exactly (owner, 2026-10-16: no crates, no
   grid of dots, no checkerboard).
7. **Item glyphs are precise vector icons** (owner, 2026-10-12: "we need something precise, recognizable"): plain paths, each part drawn by `part()` in [recipes/items.ts](../src/render/art/recipes/items.ts): a flat body, a shaded and a lit crescent (`rim()`, light from the top-left), one 1.6 px ink outline (`OUT`); no wobble and no hatching. They must read at 12–20 px, on a ribbon and in the HUD; a new item gets a silhouette no other item has.
8. **Power reads as power** (owner, 2026-10-12: "poles should look more like poles"; wires to "a precise place on every building"). The pole is a utility pole — a slim weathered-steel post on a concrete footing, a crossarm level across the screen (the local diagonal (1, −1)) on two braces, porcelain pin insulators, a junction box with its light, a drop cable (nobody climbs it: no pegs); the pylon a square steel lattice with a crossarm and suspension strings. Every building that takes part in power shows where its wires clamp: an insulator from [art/terminals.ts](../src/render/art/terminals.ts) — glazed porcelain (`C.ice`), a brass clamp, on a short dark service mast — at the point its table gives (§10, *WiresView*). The first pole's petal-cup drawing is kept, unused (`petalMastIso`, `petalMastTop`).
9. **The CrierBelt mark** (owner, 2026-10-12: "simpler, more sci-fi"): a ringed planet — a teal world with a crisp shadow crescent, a brass belt rising to the right, its far half behind the planet, its near half across it; two colours, one precise ink line, flat fills, no wobble (`crierMarkMapped` in [shapes.ts](../src/render/art/shapes.ts)). It reads at 8 px (the crescent drops out below 7). One drawing through a `map(u, v)`: a sign from above (`crierMark`), a deck or a wall in iso (`crierMarkIso`, `crierMarkFace`), the Heart's curved uplink dish (`dish3d`), the intro's register (a canvas), the landing crane's hub. It wore it on the trade post and the Heart's dish until 2026-10-13 (owner: "the planet icons are not needed", D58); it is left on CrierBelt's own things: the register's heading, the freight container, the landing crane.
10. **The trade post keeps a flame apron** (owner, 2026-10-14: "should block any construction in a 1 case radius around it because of the flames of the drones… a special ribbon at the entrance, and on the other side for the imports, that can resist to the flames", D62). Its 5 × 5 footprint is drawn in three parts, the same in iso (`trade_post` in [recipes/buildings.ts](../src/render/art/recipes/buildings.ts)) and in plan ([recipes/buildings-top.ts](../src/render/art/recipes/buildings-top.ts)). **The pad** (`TP_PAD`, the middle 3 × 3): the D58 platform on a `slab` / `plinth` over that rect only (their `at` argument), its hazard edge broken by the exit's hood, the deck (`TP_DECK` at local (2.5, 2.5), radius `TP_DECK_R`, height `DECK_Z`), three lamp posts (`TP_LAMPS`) and the power pedestal (`TP_PED`) with its wire terminal ([terminals.ts](../src/render/art/terminals.ts)). **The scorched apron** (the outer ring, `tpApron` / `scorchTop`): baked ground at the edge, ragged burns darkening towards the pad (`SCORCH`: baked, burnt, soot), blast streaks fanning out, stipple soot, cracks with a pale lip, sand fused to lilac glass, a few coral embers (paint, not LED tokens: the night would light them white), and CrierBelt's keep-out line in hazard dashes, half burnt off; its marks come from one seeded `apronMarks()` in local tiles, so both views and all four rotations agree. **The two flame-proof ribbons** (`TP_RIBBON`: the entrance across local (2, 4), the exit across (2, 0), at rotation 0; `tpRibbon` / `tpRibbonTop`): a dark-steel chute ramping from the ground at the apron's edge up to the pad (iso), its band (`TP_BAND`, a ribbon's width) laid with ceramic heat-shield plates, low riveted shield walls (`TP_WALL`) tempered along their length (`TP_TEMPER`: straw at the cool end, bronze, purple, blue at the pad), chevrons in the port's colour (cyan in, coral out) pointing the way the items go, and at the pad an armoured hood (`tpHood` / `tpHoodTop`) whose dark mouth faces the ribbon. The far ribbon is drawn before the pad, the near one after everything on it. The apron and the ribbons lie on the ground and **cast no shadow** (the recipe skips them in a `ShadowFrame`: a cast shadow is stretched from the foot with the day, and would drag a 5 × 5 decal across the sand).

11. **The incinerator is a pit that burns what falls in** (owner, 2026-10-14: "the incinerator should have a style that shows more clearly that it will destroy the item. Maybe a hole in the ground with a flame that activates when an item falls in it?", D51). One tile, the same in iso (`pitIso` in [recipes/buildings.ts](../src/render/art/recipes/buildings.ts)) and plan (`pitTop` in [recipes/buildings-top.ts](../src/render/art/recipes/buildings-top.ts)), its geometry in `PIT` (local tiles, levels: the collar's radii and top, the throat's floor below the ground, the chutes' width and lip): scorched ground (`pitMarks`: soot blotches and cracks, seeded once for both views); a low riveted collar whose top is tempered by the heat (`PIT_TEMPER`: brass at its edge to blue at the throat); a dark throat whose far wall darkens into a coral glow down to a grate over the fire bed (`EMBER`, paint, not LED tokens: the pit's night glow is its fire's, lights-view.ts); on every side a steel chute from the tile's edge up over the collar to a lip above the throat, a turquoise band at its mouth (the way in, as every in-port) and a cyan chevron pointing in. It is drawn in parts (`PitPart`): the `back` (ground, throat, the collar's far half, the far chutes) and the `front` (the collar's near half, the near chutes), so the world can put an item falling in and the flame's root behind the near rim; the atlas sprite is both (`all`: icons, picking). **The flame** (`pitFlameIso`, `PIT_FLAMES` heights × two flickers, and the embers at level 0): flat tongues, coral outside, orange, a pale core, inked in dark coral, sparks over the tallest; embers rising and a wisp of smoke as it dies. In plan, the flame seen from above (`pitFlameTop`): a ragged star of coral tongues over the throat, faded in with the fire. The ground and the hole cast no shadow (a `ShadowFrame` skips them): only the collar and the chutes do.
12. **The Core grows with its level** (owner, 2026-10-15: « par défaut le cœur ne devrait rien avoir dans ses angles, et chaque niveau rajoute un truc… Il faudrait que le style du cœur s'améliore à chaque niveau. », D86). The Heart has one look per level (`artLevels('hearth')` = 5, level 5 since D118; `artLevelOf(id, sim.hearthLevel)` picks it; other buildings have one). Its recipe takes the level (`draw(ctx, f, seed, lv)`, the plan's `(ctx, f, seed, lv)`), the same in both views. At level 1 its four slab corners are bare, each with a mounting plate stencilled on it (`mountPlateIso` / `mountPlateTop`: paint and four bolts, nothing standing). Each level mounts one piece on a corner (`HEART_CORNERS`, local tiles): 2 the data outlet on its out port's tile (south-east; its nozzle is drawn only from then, `portDrawn`), 3 the expertise archive (south-west: a white enamel drum banded in violet, a glazed band of brass memory platters, indicator dots, a domed cap and antenna; `archiveIso` / `archiveTop`; the way into the Expertise window since D93 — a click on it in either view, `Picker.heartPieceAt` in app/picking.ts: its corner tile in plan, its drum's volume in iso), 4 the grid station (north-east: a lattice mast with a copper coil ring and a red aviation light behind a teal transformer cabinet with bushings; `stationIso` / `stationTop`, its spots in `stationSpots`), 5 the uplink (north-west, behind the depot, D118: a slim lattice mast striped coral and white on three guy wires, a small dish high up facing the roof dish's sky, a whip with a steady cyan lamp, a violet radio cabinet behind; `uplinkPieceIso` / `uplinkPieceTop`, its spots in `uplinkSpots`; set off to the screen's left of the corner's line, where the flag's pole stands). The trims fill out with it (`heartLook(lv)`): one roof beacon and one LED strip a face at level 1 (`HEART_BEACONS`, the nearest first); a coral cornice under the roof's edge, a second beacon and strip at 2; brass pilasters at the depot's corners, a third beacon and a drone at work over the roof hatch at 3; a hazard-striped skirt at the depot's foot and floodlights on the slab (`HEART_FLOODS`, between the ports' aprons) at 4; a crown of lamps at 5 (`heartLook(lv).crown`, `HEART_CROWN`: a brass rim on the coral cornice studded with lamps, cyan and warm by turns, none where the roof dish or the flag would cover it — a ring of light round the depot at night; still three beacons, the fourth roof corner holding the flag). The solar rows never change, so the solar overlays stay keyed by building and rotation. Levels 4's and 5's pieces are placeholders (level 3's opens the expertises, D93); levels 3–5 each open a tier of research (D118). Review: `node scripts/heart-shots.mjs`.
13. **The deep bore is a heavy rig over its own hole** (owner, 2026-10-16: « the Deep Bore should have a more impressive design »). The big brother of the 2×2 drill, about twice its height, the same family (a lattice derrick, a brass drill string, a geared table, a coral power house), drawn the same in iso (`boreBody` / `boreTable` in [recipes/buildings.ts](../src/render/art/recipes/buildings.ts)) and plan (`boreBodyTop` / `boreTableTop` in [recipes/buildings-top.ts](../src/render/art/recipes/buildings-top.ts)) from one geometry, `BORE` in [recipes/moving.ts](../src/render/art/recipes/moving.ts). **The derrick**: four steel legs on concrete footings, from `base` tiles either side of the axis at the ground to the crown at `top` (`boreLeg`), coral girts (`girts`), X-braces in every bay above an open portal (plain strokes, `rod`: the lattice is a few hundred bars and ink's ribbons cost the bake for no visible wobble), a racking board with two work lamps on its east face (`board`), the coral crown block with its sheave cluster, work lamps on the side legs' heads and a red beacon on top; the hoisting lines down to the hazard-yellow travelling block, its hook and the swivel. **At its heart**: the wellhead collar sunk in the ground (pale concrete, bolted, the hole's dark mouth), the rotary table on it, the square brass kelly from the table up to the swivel; violet heartrock spoil (`SPOIL`) heaped round the collar between the legs and in the back corners. No slab under the rig: the ground and the deposit's ore show between the footings, so the plan tells what it mines. **Round it**: the draw-works on the west (a teal motor house, the big brass drum, the drilling line up to the crown's fast sheave), the coral power house on the south (grilles, LEDs, a radiator fan; the wires' terminal on its roof, off the derrick's diagonals), a rack of drill pipe on the east, and at the front, on a skid, the outlet works: a belt up from the collar to a splitter that tips the ore down two chutes into the hoppers over the two outlets. **Its moving part** (`MOVING` 8 phases, `sym` 4): the table's teeth and four slots and the kelly's square turn a quarter turn a period while it works (`workTurns`), still and greyed when switched off (D83). The kelly stands inside the derrick, so in every rotation one leg is exactly in front of it (`boreNearLeg`): the part carries that leg, with the hook and the travelling block, and is always the nearer (`over: () => true`); the body keeps everything else that stands tall off the diagonals' columns (the power house, its terminal — deep-bore.test.ts checks it —, the draw-works), and only low things in the corners (the hoppers, the spoil). The kelly's square is the drill family's brass string, the near leg crosses it in front: what a rig looks like. No lamp on the part in iso (the night lights and the unlit picture come from the body); in plan the part is the table with the derrick round the axis redrawn over it (clipped to a disc) and the crown with its beacon on the axis. In plan the derrick shows its legs and two girts only: all five and the braces meshed into a lid over the collar, the spoil and the table. Cost: about 2.3 Mpx of atlas (the full sprite, the body and 8 phases in 4 rotations, both views; it was 0.8) and about 130 ms of the boot bake; the atlas went from 12 to 13 pages with it (the 12th was full).
14. **The electric smelter is an induction furnace** (D106; it must read apart from the coal smelter's brick shaft and stacks and from the arc furnace's electrodes on their mast). Drawn the same in iso (`electric_smelter` in [recipes/buildings.ts](../src/render/art/recipes/buildings.ts)) and plan ([recipes/buildings-top.ts](../src/render/art/recipes/buildings-top.ts)) from one geometry (`ES_POT`: the crucible's place, radius, coil and rim heights; `ES_CAB_Z`, the cabinet's roof; `ES_SLAB`, `ES_CERAMIC`): a squat crucible wrapped in a copper induction coil (`COPPER`, a seam each turn) under five laminated steel yokes, a ceramic mouth and a pour lip towards the outlet, the melt orange-hot in it (`ledWarm` with a `glowPeach` core and slag crusts: lamp tokens, so it goes dark when the furnace stops and glows at night); copper bus bars on two porcelain stand-offs from the teal inverter cabinet (`cabinetIso`, a hazard band, a high-voltage sign — `hvSignIso`) to the coil's leads; on the cabinet's roof its wire terminal and the heavy cable from it down into a brass gland, the big cable inlet; a bank of capacitor cans (`CAN`) by the intake. No stack, no smoke. While it works, cyan arcs (`sparkIso`: a jagged seeded line, a translucent halo, a core in the cold lamp token, a white thread) jump across the melt and at the bus bars' leads; switched off (D83) the recipe leaves them out (`isUnlit`) and the melt is dark glass. Not in `HOT`: its night pool is cold, its lamps cyan but the melt.
15. **The steam boiler is a small steam power plant** (D114; it must read at a glance apart from the 1×2 coal generator's fire basket and the electric smelter's induction furnace). Drawn the same in iso (`steam_boiler` in [recipes/buildings.ts](../src/render/art/recipes/buildings.ts): `boilerBody`, `flywheelIso`) and plan (`boilerBodyTop`, `flywheelTop` in [recipes/buildings-top.ts](../src/render/art/recipes/buildings-top.ts)) from one geometry, `SB` (local tiles and levels: the firebox, its doors' span, the hopper, the chimney, the drum, the shaft, the dynamo, the cylinder, the pump, the flywheel and the `split` plane), with its colours `SB_ENAMEL`, `SB_COAL`, `SB_WATER`, `SB_WHEEL`. On the left, over the coal intake, a brick firebox (courses and joints in plain strokes, `hairlines` / `brickFace`: ink's ribbons by the hundred cost the bake for nothing at this size) strapped in steel, a fire door on its east and west faces (`fireDoorIso`: whichever turns to the camera, one in every rotation, clear of the drum; the arched opening in `ledWarm` with a `glowPeach` core and grate bars, so it goes dark when the boiler stops and glows at night), a flared coal hopper heaped with angular lumps behind it, and the tallest part, a battered brick chimney on its roof (`chimneyIso`: a steel collar, iron bands, a corbelled crown with an iron rim round the dark throat); across the middle the pale riveted drum on two saddles (`boilerDrumIso`: three brass bands — clipped to the drum, its near end redrawn over them with a bolted manhole —, a brass steam dome, a weighted safety valve, a gauge on a stalk with its dial turned to the camera); on the right the engine on one shaft — the dynamo (`dynamoIso`: a teal field drum between coral end bells, the brass commutator and brushes, LEDs and a high-voltage sign on its pedestal; the wires' terminal on its drum, [terminals.ts](../src/render/art/terminals.ts)), the cylinder lying along y on its bed with the steam chest, the crosshead between its guides and the connecting rod to the crank (`engineIso`, a work lamp on a post at its end) —, the steam main from the dome to the chest with its stop valve (`steamMainIso`), the feed pump by the water intake with its brass air vessel and the cyan-steel feed pipes into the drum's end (`feedPumpIso`). While it burns, coal smoke thinning into white puffs drifts up and to the right from the chimney (`plumeIso`, `sootPuff`) and a wisp rises from the safety valve; switched off (D83) or in its cast shadow the recipe leaves them out (`isUnlit`, `ShadowFrame`). **Its moving part** (`MOVING` 8 phases, `sym` 6): the big coral flywheel on the shaft's east end turns a sixth of a turn a period while it works (`workTurns`, its generator's node at `Ok`), still and greyed when stopped. Everything else stands this side of the plane x = `SB.split`, so the part is the nearer exactly when the east side faces the camera (`over: facing(f, 1)`); the wheel sits in a pit in the slab, its tread and near ring in `ringPoly` (a ring wound as one polygon, the hole left by the winding), the inner tread glimpsed through it, six spokes (`rod`), the hub's bolts (`bolts`: plain discs, `rivet` inks each and the part is drawn in every phase). In plan the part is the rim's tread over its tall shadow, the joints of its cast segments sliding along it. In `HOT`: an amber night pool. Cost: about 1.45 Mpx of atlas (the full sprite, the body and 8 phases in 4 rotations, both views; no new page) and about 50 ms of the boot bake (95 with the moving part).

| Module | Draws | Frame |
|---|---|---|
| [shapes.ts](../src/render/art/shapes.ts) | Seen from above: plinth (over the footprint, or a part of it: `at`), dome, bulb, pipe, rotor, petals, antenna, arm, spire, vault, port, grille, dish, LEDs, cable, hull, chevron, tankTop, stack, crate, drumTop, truss, `terminalTop` (a power terminal), the CrierBelt mark (`crierMarkMapped`, `crierMark`)… | `Frame(S, M, w, h, rot)`: `p(x, y)` maps unrotated tile coords → px, `l(len)`, `dir(side)` |
| [iso-shapes.ts](../src/render/art/iso-shapes.ts) | Iso volumes: `box`, `slab` (over the footprint, or a part of it: `at`), `cylinder`, `domeIso`, `vaultIso`, `rotorIso`, `mastIso`, `dishIso`, `sphereIso`, `wheelIso`, `bucketWheelIso` (turning by a phase), `cupIso`, `pipeIso`, `portIso`, `prismIso`, `frustumIso`, `latheIso`, `drumIso`, `trussIso`, `chevronIso`, `terminalIso` (a power terminal: service mast, porcelain, clamp), `crierMarkIso` / `crierMarkFace`, `face*` / `faceInk` details | `IsoFrame(w, h, rot, head)` at 2× (`IS` 64, `IH` 32, `ILH` 32 px/level, margin 14): `p(x, y, z)`, `rect`, `ell`, `depth`; `Scene` = painter's queue; `ShadowFrame` lays every point on the ground along the light (cast shadows) |
| [recipes/buildings.ts](../src/render/art/recipes/buildings.ts) | `R[id] = {head, draw(ctx, f, seed, lv)}` (`lv`: the look's level, 1 but for the Heart: `artLevels`, `artLevelOf`, `portDrawn`, `heartLook`, `HEART_CORNERS`, D86), or `{head, moving: {body, part(…, t), over(f), shadow?}}` for a building with a moving part; `drawBuilding` adds ports from content (far sides under the body, near over it) and the kit's power terminals (last); `drawBuildingMoving` (body and phases apart); `rod` (a plainly stroked bar, for lattices by the hundred); `boreNearLeg` (the deep bore's leg its part draws); `shadowFrameOf` / `drawBuildingShadow` (the cast shadow); `fallback`; `isoHead`; `needsRotations`; `petalMastIso` (the first pole's art, kept, unused) | IsoFrame |
| [recipes/buildings-top.ts](../src/render/art/recipes/buildings-top.ts) | `R[id] = (ctx, f, seed, lv)`, or `MOVING_TOP[id] = {body, part}`; `drawBuildingTop`, `drawBuildingTopMoving`; ports via `shapes.port`, the kit's power terminals via `terminalTop`; `needsRotationsTop`; `petalMastTop` (kept, unused) | `Frame(TOP_PX 64, TOP_MARGIN 14)` |
| [recipes/moving.ts](../src/render/art/recipes/moving.ts) | `MOVING[id] = {frames, sym}` (phases baked per period, periods per turn); the shared geometry: `TURBINE` + `vaneAt` (the crown), `SAND_WHEEL` + `bucketFull` (the bucket wheel), `HRotor` with `PITCH_ROTOR` and `BIG_ROTOR` (the pitch-control and big turbines' rotors, D69); `BORE` + `boreLeg`, `boreSquare` (the deep bore's derrick, collar, table and kelly) | — |
| [recipes/belts.ts](../src/render/art/recipes/belts.ts) | `BELT_TIERS` colours (and rails: the glazed ribbon's glass-edged, D103); `drawStraight`, `drawCorner` (rails overrun the edges for seamless joins), `drawInlet` (a side merge), `drawDeck` (skybridge span); the camouflaged ribbon (D109) buried — a sand mound with dune ridges (a lit crest, its shadow), the buried rails' edges dashed, a faint chevron, no rails nor lights — and `drawCamoVent`, its vent tile (a dark seam, a glint), which the buildings view lays on one straight tile in five by a hash of the tile (atlas `CAMO_VENT_KEY`) | 64 px canvas |
| [recipes/items.ts](../src/render/art/recipes/items.ts), [icons.ts](../src/render/art/recipes/icons.ts) | One glyph per `Glyph` kind, coloured by `ItemDef.color`; `ICON_IDS` cartouches | 32 / 40 px |

Worker-safe modules (no DOM, no Pixi): `terrain.ts`, `rock.ts`, `ink.ts`, `tokens.ts` (except
`pushTokensToCss`) and `relief.ts`.

## 10. World views

**BuildingsView.** `rebuild(sim)` (on structural change) re-draws only what changed (D92, *Updates
and culling* below). A
building gets an iso sprite in `objects` (`bKey(id, rot, lv)`, falling back to rot 0; `lv` the Heart's level, D86, else 1; scale `k`;
anchored at `tileToIso(e.x, e.y)`; zIndex `buildingZ`) and a plan sprite on `plan` (`btKey`, in tile
units). Pending construction (`builtAt ≠ 0`) draws at alpha 0.45; dormant buildings
(`sim.isDormant`) get a grey wash (`0x9b97a8`, an "unpainted model"); see *Switched off* below for a building that does not work. Ribbons and conduits become
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
stands but the `onRock` kinds on rock (the wind turbine, the pole, the pylon,
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

**Conduits pouring down a terrace** (D114: a conduit's water pours one terrace down, never up). A
conduit whose next tile stands exactly one terrace lower and takes water — a conduit, or a building
whose intake may face it, not a ribbon (traction-lifts.ts `fallOfConduit`, the sim's rule in
compile.ts) — gets a downpipe against the wall on the low tile ([recipes/falls.ts](../src/render/art/recipes/falls.ts)
`drawFall`: a hood bending the line over the high tile's edge, the glazed duct in the conduit's
colours down the wall on two clamps, its window showing the deep water falling in pale streaks, foam
at its foot), one sprite on the elevator's 1 × 2 frame and anchor, keyed by `liftZ` like an elevator
(the wall facing away: behind the high column, only the hood peeking over), and a plan mark centred on
the wall in the marks' band (`drawFallTop`: the hood and the water in its mouth, a dark drop band on
the low side, a double chevron for the way down, foam). Its frames are baked on demand on the
elevators' sheet (`fallFrames`, one a way and drop); the conduit's `sigOf` carries its fall.

**Moving parts** ([recipes/moving.ts](../src/render/art/recipes/moving.ts), [world/moving-parts.ts](../src/render/world/moving-parts.ts)).
A building listed in `MOVING` (the wind turbines' crowns and rotors, the sand collector's bucket wheel, the face cutter's drum, the deep bore's rotary table and kelly, the steam boiler's flywheel) shows
its body (`bodyKey`) and, as a second sprite, its part (`partKey(key, k)`), in both views: in iso
at the body's key ± 0.2 (over the body when `Atlas.moving` says the part is the nearer one in that
rotation, under it otherwise; lifted with it on the mountains), in plan over it. `animate(sim, seconds, grade)`, per frame with the
game time (paused: nothing turns), moves each part's phase at its rate (periods per second =
turns per second × `sym` × the building's own factor 0.92–1.08, `spinSeed`) and swaps its two
textures when the phase index changes — a few texture swaps on one atlas page, no repaint, no
upload. Turns per second: a turbine on a grid follows the local wind its generator sees (D95:
`windTurns(wind ‰, cutIn, cutOut)`, the wind `turbineWind(producer.local, weatherAt(now))` — the
producers cached per graph version —; 0.1–0.75, a slow drift 0.03 below its cut-in, braked at its
cut-out), a turbine on no grid stands still
(switched off, D83: wiring it sets it going), a machine's part turns while its node works (`workTurns`:
0.14 × the grid's satisfaction when `Ok` / `LowPower`, else 0), a generator's (the steam boiler's
flywheel, D114) at the full 0.14 while it burns (`Ok`: a short grid is one its generators feed flat out); a site under construction, a
dormant building or one switched off (`WorkLook`) stands still. Speeds ease towards their target (about a second), so a gust
spins the crowns up; a rebuild keeps each part's phase and speed. `movingCount` counts them.

**Switched off** (D83; [world/work-look.ts](../src/render/world/work-look.ts), [art/unlit.ts](../src/render/art/unlit.ts),
[art/recipes/off.ts](../src/render/art/recipes/off.ts)). A production building that does not work
shows it: no light, no fire, no motion, its colours greyed and darker. Watched kinds
(`LOOKS_AT_WORK`): machines, drills (sand and data collectors too), pumps, fuel generators,
geothermal plants, research labs, servers, wind turbines, solar panels — not the logistics, the
Heart, the stores and posts, nor the excavator and backfiller (to be redesigned). What counts as
working (`workOf`, read from the sim, never written): a machine crafting while powered, a drill or
pump extracting, a generator burning, a lab whose project's clock runs, a server on a powered grid,
a turbine, panel or geothermal plant on a grid. A *passing* stop (`Starved`, `Blocked`, a
generator `Idle` or short of fuel, a lab waiting for data) keeps the lit look `WORK_GRACE` (40)
ticks after the building last worked, so a machine fed a little slower than it crafts does not
blink between crafts; a hard stop (no recipe, no power, no grid, dormant, still a site) switches it
off at once. `WorkLook` samples the watched buildings once per game tick at most (nothing while
paused) and returns the flips; the buildings view applies only those. Its *unlit picture*: the
building's own recipe re-run through `unlitCtx` — a fill or stroke in a light token (the very
tokens the night lights' spy reads, recipes/fx.ts) drawn in dark glass (`UNLIT`) when opaque and
left out when translucent (its baked halo); a recipe leaves out what goes out with the machine
itself when `isUnlit(ctx)` (the brazier's flames and sparks, its coals cold; the fumarole tap's
steam) — then greyed (`switchOff`: 60 % towards the luminance, 80 % bright, a touch of the night's
lilac). Baked on demand into the view's own DynAtlas at the lit sprite's size and anchor (a
texture swap), at most `OFF_BAKE_MS` (6 ms) a frame; until its picture is baked a building takes
`OFF_TINT` instead. A moving part is greyed with `OFF_TINT` and stands still; at night the lights
view hides the building's glows and work lamp and greys a panel's petals and cells. A rebuild keeps
what is known (a building switched off is drawn so at once). `FL.workLook(id?)` counts them.

**Updates and culling** (D92). Each entity keeps its sprites (both views, its shadow, its moving
part, its look, its pit, its elevator) in a record with what they were drawn from (`sigOf`: a
building's kind, place, turn, built or not, dormant or not, its stand, the look it wears (the Heart's
level, D86), its chosen item; a ribbon's kind, place, piece, inlets, tile height and elevator). On a
structural change `rebuild` works the stands out again and compares: an entity whose signature is
unchanged keeps its sprites, one that changed or is new is laid again, one gone is dropped; the
skybridges' spans and the flag are two groups with their own signature. Placing a ribbon re-draws it
and the neighbours whose bend or inlet it changed. Dropped sprites leave each layer in one pass when
there are many (`removeMany`: `removeChild` searches the layer, so removing 40 000 one by one was
quadratic). Equal depth keys keep the order a rebuild from scratch lays them in: every sprite sorts at
`tie(key, rank)` = key − 2⁻³⁶·(2²⁸ − rank), rank = entity id × 16 + the order its sprites are laid,
then the spans, then the flag — a hair (at most 2⁻⁸) under its key, so another view's sprite at the
very key (the lights' solar overlays, the junctions' passages) still sorts after the buildings. The
floor ribbons have their own sorted container on `belts` (`buildings:belts`), the shadows' container is
sorted too; both are render groups, as is `plan` (layers.ts), so the terrain's chunks streaming in as the
camera pans re-batch the graded world without the tens of thousands of pieces, shadows and plan sprites
of a big base, and a cull or a building laid re-batches only its own group. `rebuildAll(sim)` throws everything away and draws from scratch; another colony
(`setSim`) starts from nothing. `lastUpdate` counts the sprites laid and removed.
*Culling*: records are bucketed by the 16-tile square of their origin; `cull(viewTiles)`, per frame,
compares the range of squares within `CULL_MARGIN` (12 tiles: art standing on the mountains, lifts, the
longest shadows) of the view with the last one and flips `culled` (a Pixi flag apart from `visible`, so
the views' own visibility — a pit's flame, a lifted shadow at night, the intro's hidden Heart — is kept)
on the records of the squares that changed side. A culled moving part keeps turning but swaps no
texture; it shows its phase when it comes back. *Shadows*: their container's alpha (a render group's
uniform) is set only when its 8-bit value changes, to ⌊α·255⌋ / 255 — what the batcher packed when it
was a plain container, whose alpha set every frame walked and re-packed every shadow under it.

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
`underPass` decides the passage from what stands in line east and west, past any junctions (as the
engine's `across` looks): a ribbon running into or away from the junction, **or a building's port
facing it on that axis** (a trade post's exit feeds it, a machine's input is fed through it).
Owner's bug, 2026-10-17: a junction at a trade post's exit showed no ribbon under its bridge when
nothing in line past it ran on east–west (a ribbon turning off the axis, or none yet) — the old
rule looked at ribbons only. The passage is rebuilt whole with every structural change, so a
building placed or removed beside a junction needs no signature of its own
(junctions-view.test.ts).

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
zoomed out); hidden below zoom 0.28 and culled outside `viewTiles` ± 1 — and the lines whose box
(their tiles and their paths' ends, worked out with the graph) lies more than `BOX_MARGIN` (8 tiles) from
the view are not read at all (D92: room for an item gliding in from the tile before, and for the line
out of a routing block drawing what the line into it took through it). Particles are pooled, one
`ParticleContainer` per atlas page, the particle list rebuilt only when the count changes. For the
trace rigs, `debugOn` / `debugSnapshot()` (`FL.itemsTrace(on)`) record every drawn item: its rank
this frame, tile coords, height, item, whether it rides a deck (`over`), its depth key among the
volumes (`sorted`, NaN on the floor). For the Gleaners (D112), `watch` (tiles) and `seen`: what was drawn on each watched tile this frame (item, tile coords, view px, size), so a hand meets the very token and takes it from where it was drawn. An item falling into a pit shrinks to half and fades out
(sprites only: in plan it is already under the incinerator's sprite).

**GhostView.** On `ghost` (tile units), `draw(pre, sim, hover, showHover)` redraws only when a
JSON signature of the `Preview` changes. Each piece shows its plan sprite (alpha 0.72, reddened
when refused), or a straight belt piece for ribbons — the traction ribbon's for a ribbon refused at a
step (`needs_lift`, D77): the piece that would take it. Its footprint is washed and outlined on top,
cyan when it fits and red (`ledRed`) when it does not: the `Graphics` sits above the sprite
container. Then come the marking box (ink when clearing, coral when marking), the demolition box
with the doomed footprints, and a white hover outline when nothing else shows. Outside a box,
`doomed` lists what a placement would replace (D24): amber footprints drawn *under* the ghost
(a separate `Graphics`), since they are refunded, not destroyed. See [input.md](input.md) for
`Preview`. A directional routing block (`isDirectional`: router, sorter, inverted sorter, both
gates — in from the back only) shows its flow over its ghost (`flowArrows`, from the piece's own
rotation, which over a ribbon is the way the items enter that tile, its back to the feed even on a
curve, until R turns it: `Sim.placementRot`, D98): a big turquoise
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
  in a dashed `peachD` frame; a neighbouring base's (D110, `land.neighbour(p) ≥ 0`) in one
  `coralD` outline round its holding (drawn where its parcel meets one that is not of the same
  base), hatched coral along x + y every three tiles in the land mode only (its buildings, drawn by
  the buildings view, are what shows it is someone else's), its emblem badge at its hub's middle
  in the land mode in place of the usable-floor gauge (not for sale: no gauge, no pips). Rebuilt on a signature of the view's parcel
  range, the zoom's step (a third of an octave), the starting square's reach and the bought,
  granted and leased sets; line widths are screen pixels at that step (`1 / (TOP × zoom)` tiles a
  pixel), so a border reads the same zoomed in or out. Alpha `max(te, landOn)`: shown while
  building, as the zones were, and always in the land mode. With `landOn` (the shell sets it,
  with `landHover` and `landSel`, from `LandTool` each frame) it adds the parcel grid over the
  whole range (ink, 1.2 px), each parcel's **usable floor** as a gauge at its middle (D94,
  `drawFloors`: a paper disc ringed in ink, its share of usable floor — `parcelFloor`, sim/world/floor.ts
  — filled clockwise from the top in `turqD`, `peachD` under a third, and to its right three
  diamonds stacked, its ore's tier — `parcelOre` — filled in the colour of the ore it holds most,
  the rest empty: space or ore at a glance; 1.6 tiles across, 8 screen px at least; the land's diffs
  in the signature, so a dug tile redraws it) and marks the hovered
  parcel (a paper wash, an ink frame) and the picked one (a cyan frame with ink corner ticks),
  rebuilt on their own signature.
- *Running water* ([world/rivers-view.ts](../src/render/world/rivers-view.ts), D94, `decals`): from zoom 0.8,
  a paper-white dash drifts down each river tile on the floor in view along its way (a stream up on a
  massif stands on its column: the relief draws it) (the biome code), fading in
  and out over a 0.6-tile run (three strokes a frame, by band of alpha); the river tiles in view
  are found again only when the view moves by a block of 8 tiles (at most 900). On the ground
  plane, under the relief and the buildings and under the fog.
- *Dig / fill marks*: coral (dig) or cyan (fill) squares with two hatch strokes, brighter with a
  progress bar where a machine works. The flat copy fades in with `te`; the iso copy is lifted onto
  rock tops by `levelAt(x, y)·SHIFT` and fades out.
- *Reach*: a coral circle around the selected excavator or backfiller (`BAL.digReach` from the
  excavator's footprint edge, so `digReach + max(w, h)/2` from its centre, D54 / `fillReach`), or
  around the one in hand (`ghostReach`).
- *Selection outline*: cyan with ink corner ticks around the inspected building's footprint; a flat
  copy fades in with `te`, and an iso copy, shifted onto the rock top it stands on (`footLevel` of
  `levelAt` × `SHIFT`), fades out (owner, 2026-10-13: a turbine's outline lay on the ground below it).
- *The grids by colour* were the power overlay (P) until D88: they are the Électricité view's now
  (**ViewsView**, below). `needsWire` (the dashed coral « no wire » frame) is exported for it.
- *Link tool marks* (`linking`: the tool's `LinkPreview`, set by the shell): with a source, its
  reach as the rounded rectangle its footprint sweeps out to the range, the source outlined in
  cyan, the buildings a click would wire that are on no grid yet in turquoise (D80), the ones waiting
  for a wire beyond the reach in a dashed coral frame (`needsWire`), its wires' other
  ends in ink; without one, a cyan ring on every pillar and on the Heart, and the hovered pillar's
  reach and marks; a pole or pylon held to be placed shows its reach and marks the same way
  (`LinkTool.ghost`, set by the shell when no Link tool is in hand); the hovered building outlined in the colour of the
  click's verdict (turquoise wire, coral cut, red refused); when the land bars the hovered wire
  (`block`, D78), that tile washed red with a cross, flat in plan and on its rock top in iso
  (`blockPlan` / `blockIso`, lifted by `levelAt` × `SHIFT`, cross-faded). Rebuilt on the preview's
  `sig` and the barring tile.
- *Selection*: a cyan footprint outline with ink corner ticks, readable in both views.

**ViewsView** (D88, [world/views-view.ts](../src/render/world/views-view.ts)). The specialised
views draw one system bold over the base dimmed; `update(sim, frame, readouts)` each frame, the
readings (`Readouts`, [src/sim/readouts/](../src/sim/readouts/)) taken by the shell at 4 Hz
([app.md](app.md)). Read-only, like every view.
- *The veil*: a paper sprite (`Texture.WHITE` tinted `C.paper`) over the visible tile rect (its
  projection covers the screen), on `veil`: over the buildings, ribbons and items, under the wires.
  Its alpha eases to `VEIL[view]` (Électricité 0.66, Logistique 0.62, Production 0.5, Vent 0.55;
  Normal and Terrain 0) in `VEIL_FADE` 0.22 s; the view's marks fade with it.
- *Flat marks* (`viewFlat`, tile units): two Graphics, flat (alpha `te`) and lifted onto the rock
  tops (`liftOf` × `SHIFT`, alpha `1 − te`), rebuilt when their signature changes. Électricité: each
  building washed by what it is to power (owner, 2026-10-16; `PowerMark.group`, art/view-icons.ts
  `POWER_GROUP_COLOR`): what makes it (turbines, panels, fuel generators, the ground's heat, the Core)
  gold, the accumulators turquoise (a fifth tone: they give and take), what draws it on a grid slate
  blue, what needs it and reaches no grid (no wire, asleep) coral — the unwired also in `needsWire`'s
  dashed frame —, what needs none (ribbons, routing blocks, stores: `needsNoPower`) greyed out under
  the rest; each grid keeps its colour (`GRID_COLORS[net % n]`) on its pillars' rings (ink under the
  grid's colour) and its wires (wires-view.ts); a
  pillar's reach (the Link tool's rounded rectangle) under the cursor. Logistique: each chain as a
  path through its tiles' centres (from its tail's edge to its head's; a leap — a bridge, a
  junction's pass — left out), an ink edge under a stroke in `heatColor(util)` by tenths, jams
  `ledRed`, idle lines paper; the Gleaners' night (D103, `Graph.glean`): each exposed ribbon tile hatched in
  ink with a night badge (a midnight disc, a peach crescent: `crescent`), each guarded one ringed in
  glass blue; each buried tile (D109: a camouflaged ribbon, faint on the sand otherwise) edged on both
  sides with sand dashes over an ink edge. Production: footprints washed by state (`on` turquoise, `pause` amber — a weak grid's too, D91 —, `off` coral).
  Vent (D95; its own pair of Graphics, `heatPlan` / `heatIso`, under the flat marks): the visible
  land washed by today's exposure (`windField(sim.grid.source).at(x, y, bearing)`) in cells of 1, 2
  or 4 tiles by the zoom, grouped by the colour's tenth (`windColor`: art/view-icons.ts `WIND_RAMP`,
  calm paper → pale turquoise → turquoise → deep teal), each cell lifted by the land's level in
  iso; ink arrows on a lattice (every 9 cells) pointing the way the wind blows, longer where it blows
  harder; the turbines' footprints inked. The field's chunks not read yet are read
  `WIND_CHUNKS_PER_FRAME` (6) a frame; the wash is redrawn when more are in, the rect passes its
  16-cell margin, the cell size, the bearing or the turbines change.
- *Badges* (`viewMarks`, view world px): pooled containers of an icon sprite (the marks of
  [art/view-icons.ts](../src/render/art/view-icons.ts), baked on first use) and a bar (ink frame,
  paper inside, a fill). Each hangs over its building's head in iso (`liftOf` + `isoHead` levels,
  × `LH` × (1 − te)) and on its footprint in plan, sized `MARK_PX` 30 × √zoom (bounded) on screen;
  rebuilt with each reading, placed when the projection or the zoom moves. Électricité: a source's
  kind with its output / rating as a turquoise bar, an accumulator's charge, a consumer's upright
  gauge (height by rating, log; fill by draw; coral on a grid short of power; left out below zoom
  0.3), a trouble instead (`unwired`, `asleep`, `dark`, `site`). Logistique: `jam` / `dead` at a
  line's head. Production: why a building stops or waits — a
  building at work on a grid under 100 % waits under the half-bolt (`low`, D91: `weakGrid`). Vent:
  each turbine's `wind` mark with what it gives now against its rating (coral when nothing).

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
  gets dim lines; a wire to a construction site or a dormant building is dashed; in the Électricité
  view (D88) each grid's wires take its colour, bold (4.2 px iso, 0.15 tile plan), fully opaque. One batched stroke per style.
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
- *Cost*: geometry rebuilt only when `links.version` or `graph.version` moves, and redrawn only when a
  wire's ends, grid, way or curve differ from what is drawn (`sameWires`, D92: every structural change
  recompiles the graph, and re-tessellating thousands of strokes cost a big base ~30 ms); restyled when a
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
placed with P: over the post in iso, smaller (× 0.45) and flatter (altitudes
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

**GleanersView** (D103, D112; [world/gleaners-view.ts](../src/render/world/gleaners-view.ts), art in
[recipes/gleaners.ts](../src/render/art/recipes/gleaners.ts); owner, 2026-10-17: « ils doivent venir
en groupe, aller vers un tapis où il y a des objets en mouvement, et réellement les récupérer », then
after playing: « les glaneurs apparaissent derrière la machine qui est derrière eux, et l'un d'eux
semble ne pas réussir à réellement prendre l'objet du tapis. Et ils sont partis vers ma base »).
Render only: the sim holds what they take; this shows each raid where and when the sim runs it. At
each new graph (`rebuild`): a glass hood over each glazed ribbon on the floor (the belt's own piece
and matrix: `beltPiece`, `beltMatrix`; none on rock yet); **every raid** (`raidPosts`, `raidAt`) with
its way into the desert (`desertBearing`: of 24 bearings from the middle post, the one whose first 14
tiles cross the fewest buildings, ribbons and fences, rock or water and tiles of the claim's land,
the nearer weighing more, leaning away from the Core; how far it runs clear sets how far out they
come from and go), the band waiting on the line's side facing it, a tile off each post (1.8 on its near side, south or
east, where one tile off each would hide its neighbour's cell and the token taken there); the post
tiles go to the items view to watch (`ItemsView.watch`); bands of two or three for every fifth glazed tile beside open floor (`Graph.glean.glass`) and two for
every sixth fence-side floor tile (`Graph.glean.prowl`; in the lists' order, so a short line or fence still
gets its visit), each with its own way in and out. Per frame — after the items view, whose
`seen` says where each token on a post's tile is drawn this frame — only while they are out
(`gleanNight` now, or a raid's arrival or tail across dusk and dawn), culled to the visible tiles, at
most 48 figures. A raid: the band glides in along its bearing during the 170 ticks before it (each 10
ticks after the one before, fading in) and waits, bobbing and swaying. **A Gleaner reaches only for
the token the sim will take**: each frame its post asks its chain what it takes on the line's next
step (`Chain.raidWillTake`, the very rule `raidStep` runs, read before that tick); for a token, the
arm goes out over the last 8 ticks and the hand follows that token where it is drawn, meeting it at
the tile's centre as the step comes. On that step the sim takes it: from that frame the belt draws it
no more, and the item appears in the hand where its token was last drawn and rides the arm back up
(12 ticks), then is held up before the hood, glowing. No token to take, no reach. Each take is
checked as it first shows: foreseen (`unforeseen`: another item; `unseen`: none), its token off the
belt that frame (`onBelt`), else `paired`; one first shown more than two ticks late (off screen then,
or ticks jumped) is only counted (`late`). Once every post has taken (40 ticks after the last take) or the raid is over, the band
drifts back out along its bearing together (170 ticks, fading out), carrying what it took. So what the
player sees is what the morning report counts: one token a post, the one that was on the belt. A
glazed tile's visit (every 2 400 ticks): in from the desert to the hood, two taps of the long fingers
with a glint on the glass, back out; a fence's: in, pacing along the outside, a reach at the mesh,
out. **Depth**: in iso each figure's body, long arm and held item are sprites in `objects` (iso px,
through M like every volume), keyed on the shared scale by the tile it floats over (`figZ` = 8·(⌊x⌋ +
⌊y⌋) + 1.25: kind 1 as a building on the floor, a little after one; the arm and the item at the line's
key when they reach over a line nearer the viewer, else just behind or before the body), so a building
in front of it draws over it and one behind it under it; the key changes only when it crosses a
tile, so the volumes re-sort rarely. Its soft shadow lies on `items` (under every volume); in plan a
flat copy on `items` (view px, with the plan sprites' fade). Canvases 56 world px tall in iso, 30 in
plan: the body floating over its shadow (poses `glide`, `carry`, `reach`, four frames of its tail and
wisps, rotated by its sway), the long arm (`drawGleanerArm`, stretched and turned from the leant
shoulder to its target) and what it holds (the belt's own glyph at the belt's size, `itemPx`). On
`lights` (additive, their own container) each has a halo, its lantern eyes and the glow of what it
carries, sized to stay visible from afar (world px over the zoom), dimmed to a trace when a building
or a cliff stands just in front of it (`hiddenAt`; a tap's glint on glass hidden so is not drawn). Textures baked at construction (at twice their size). `FL.gleaners()`
counts the figures (arriving, waiting, reaching, grabbing, carrying, tapping, prowling) and the takes
checked (`paired`, `onBelt`, `unforeseen`, `unseen`, `late`) and lists the next raids;
[scripts/gleaner-shots.mjs](../scripts/gleaner-shots.mjs) pauses the game, sets a silo behind and one
in front of a band, and steps a real raid frame by frame, every take before and after its step.

### Neighbouring bases ([world/neighbours-view.ts](../src/render/world/neighbours-view.ts), [art/recipes/neighbour-dress.ts](../src/render/art/recipes/neighbour-dress.ts), D110)

Another claim's land carries a working base (sim/world/neighbours.ts lays it out from the seeds;
[land.md](land.md)), drawn so it never passes for the claim's (owner, 2026-10-17: « leurs bâtiments
ressemblent trop aux miens », « il n'y a rien qui marche »). `NeighboursView` asks for the bases within
a parcel and a half of the view (`Neighbours.inRect`) when the view's range of parcels changes or the
fog lifts, and lays each one whose lift pad is surveyed, once, keyed by its hub parcel:
- through the buildings view (`layForeign`: records of their own, apart from the claim's, kept
  through a full rebuild, dropped for another colony with `foreignEpoch`): its buildings as ghost
  entities (ids from `FOREIGN_ID0`, 12 000 000 + 64 a base), the claim's art multiplied 62 % by its
  emblem colour faded warm (`WASH`), never switched off (no `WorkLook`), parts always turning
  (machines at half a turn a second, turbines with the open desert's wind); its ribbons from the line
  itself (a bend where the line turns); its flag on the ground by the pad;
- through the lights view: its buildings' lamps, and its lanterns (its tents' doors, its banner
  poles' tips), always on at night;
- through the wires view (`layForeign`): its grid's wires hung terminal to terminal like the
  claim's, always lit, in a graphics of their own;
- its Core (`drawCore`: no deck, no modules — a low octagonal stone plinth, a plank drum with a
  dark door, a cone of canvas gores, crates on its corners, pennants, its trade's top piece:
  `NEIGHBOUR_CORE_TOP`, a mast, a chimney that smokes, a lantern or a dish), 3 × 3 and lower than the
  claim's, drawn in place of the def the sim laid it as; its wires hang from its crown
  (`coreWireZ`), its lanterns glow at its door and crown;
- its dress, baked once per colour pair on a DynAtlas: a patched, stitched tarp of its colours
  under every building (the `decals` plane, so both views; the widest patch of colour at far zoom),
  covered depots (dome tents in gores), banner poles with long swallow-tailed banners, cairns along
  its edge (iso among the volumes at their depth key, plan flat).
Per frame, for the bases in view only: the goods riding its ribbons (a loop on the game clock, one
every 1.6 tiles at 1.1 tiles a second, the belt glyphs at the items view's size, on the `items`
layer), smoke from its furnaces' chimneys (pooled soft puffs on `fxTop`, rising and drifting,
fading), its name on a cloth band (`status`, constant on screen, from zoom 1.05 out, in iso only), and at each
minute's turn one base in five (a draw from its hub and the minute) sends a CrierBelt drone up from
its pad (the cargo view's `launch`). A click on any of its pieces with nothing in hand (`Picker.neighbourAt`: their volumes in iso, their
tiles in plan; a claim's building in front wins) shows the base's card (ui/neighbour-card.ts: emblem,
name, « Base voisine », trade); the land panel reads it too; in the
Terrain view the overlays draw its holding's outline, its emblem at its hub and, under it, « Base
voisine » and its name (`neighbourLabel`, the shell's words: render reads no i18n).

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
- *What the art bakes in.* `isoArt(id, rot, lv)` / `planArt(id, rot, lv)` re-run a building's recipe (at its look's level, D86) on
  a spy context, a Canvas2D stand-in that rasterises nothing and records every opaque fill in an
  LED token (`led`, `glowCyan`, `glowTurq`: cold; `ledWarm`, `glowPeach`: warm; `ledRed`;
  `ledGreen`) with its bounds, and every fill in `PV` with its polygon, in sprite px from the
  anchor. Cached per (building, rotation, level), about 1 ms per new one. Lights therefore follow the
  art whatever it becomes: a recipe only has to draw its lights with the LED tokens at full
  opacity (`light()`, `faceLeds`).
- *Glows.* One white texture (hot core, long falloff) tinted per sprite, additive: points spread
  9× their size, strips 5×, areas wider than 7 world px get a soft haze. Cyan stays cyan, red and
  green stay; amber only on machines that run hot (`HOT`: kilns, coal generator, ceramic oven,
  sunheart, geothermal plant), and amber LEDs on any other machine glow work-lamp white.
- *Night rigs* (`nightRig`, from the kind and footprint only, never from art positions): a pool
  of work-lamp light on the ground (cold round the Heart, the landing pads of trade
  posts — a post's pool covers its pad, not its apron — and, faintly, big machines; amber round hot machines), and the Heart's pulsing uplink
  beacon over its footprint's centre at its `isoHead` — its dish's feed horn — on the light baked there (`beaconSpot`: the nearest
  emitter within 8 sprite px, else the point; it took « the highest light » until 2026-10-15, which was the west link mast's
  insulator, 15 px over the feed; heart-look.test.ts checks every level and turn). Small blocks, ribbons, masts and the sleeping solar panels get
  none.
- *The incinerators' fire.* Each pit gets a warm haze on its throat, a tall amber one up its flame
  and a core (iso), a haze in plan; per frame their alpha is 0.12 (the bed smoulders) + 0.88 × its
  fire's heat (pits.ts `pitFire`, as the buildings view stepped it the frame before), so the pit
  flares at night as an item falls in.
- *On the mountains.* A building's stand (`standOf`, worked out by the buildings view's rebuild,
  which runs first) lifts its iso glows, its pool and its beacon by its level, and sorts its solar
  overlays at its key + 0.25; plan lights stay flat.
- *Switched off* (D83). A watched building's glows and work lamp are one run of each pool
  (`groups`); while the buildings view's `WorkLook` says it is switched off they are hidden, and a
  solar panel's petals and cells are greyed (`OFF_TINT`). Re-applied only when the look's
  `version` moves (a flip somewhere): one pass over the groups, writing only those that changed.
- *Cost.* Pooled sprites, laid on structural changes only and building by building (D92): each
  building keeps its glows, beacon, pit glows and solar overlays in a record with what they were laid
  from (`sigOf`: kind, place, turn, built, dormant, hidden, stand, the Heart's art level); a change lays
  again only the buildings whose record changed, their old glows back to the free pools. The glow
  containers are sorted by rank (the building's id × 256 + the order its glows are laid): added light
  rounds a little differently in another order where many glows stack (up to 60 levels on a server
  rack's LEDs), so they keep the order a rebuild from scratch lays them in (`rebuildAll`). The solar
  overlays sort a hair after their key (+ 2⁻³⁶ × rank), after every sprite at it, in entity order.
  Base20k: 21 → 2.9 ms a structural change. Per frame: the `lights` render
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
multiplied in a cool blue-violet. They drift downwind of the world's prevailing wind (D95: the shell
calls `setDrift` with the bearing's unit vector; 0.22 tiles per world second) on a 224-tile torus
wrapped round the camera, so the sky is a function of the world clock. Strength
`clouds × (1 − te) × 0.5`, faded out below zoom 0.4 (the torus's seams).

**The wind's hints** (`WindHints`, D95, [world/wind-hints-view.ts](../src/render/world/wind-hints-view.ts)).
Before the Anémométrie plan the player reads the wind only off the land and off what a turbine
gives; these are its rare signs (owner, on the first draft: the sand « ne devrait pas être sur les
montagnes, c'est pour le désert. Et il y en a trop », « les traits sont trop gros »). Pen work, no
sprite: one Graphics on its own P plane in `shade` (graded: darker at night), redrawn each frame
while a hint is up. A **gust**: two or three hairline ink flicks, uneven (0.9–2.3 tiles), staggered
along the wind and a little apart across it, gently bent, a soft start and a tapered end, each
drawing itself out then thinning away from its start, drifting downwind; on the floor or high up.
**Sand**, on open desert floor only (sand, dunes, hardpan, worked ground; never rock, water, a chasm
or under a building): two or three low streaks of the dune's brown skimming the ground downwind,
and small ripple arcs across the wind behind them. Widths are screen pixels (`HAIR` 1.1, the sand's
1.4, divided by the projection's scale and the zoom), so a flick stays a hairline when zoomed in.
Rare and only in clearly strong wind: about one try a second per 1 000 visible tiles (0.5–4; the
tries off screen dropped by the shell's `onScreen`), one taken with a chance growing with the square
of its local wind from 1 500 ‰ (sure at 2 700); high ground at a third of that, gusts only; at most
four up at once; nothing in a calm hour. Lifted onto their rock in iso (level × `SHIFT` × (1 − te)).
The draws come from a small LCG of their own (render only). `FL.app.windHints.count` says how many
are up; `boost` (more tries, never more up) and `spawnAt` are the shots' levers (scripts/wind-shots.mjs).

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

Buildings have no LOD, but those off screen are culled (D92, §10 *Updates and culling*). The plan's L1 ("objects as dots, animations at 15 Hz below 0.55") and L2
levels are not built.

## 12. Perf overlay ([perf-overlay.ts](../src/render/perf-overlay.ts))

`PerfMeter` wraps the WebGL2 draw calls (`drawElements`, `drawArrays`, and their `Instanced`
variants) to count them per frame. `frame(ms, dt)` computes fps and the max frame time over 0.5 s
windows. `set(key, v)` adds stats (`tickMs`, `renderMs`, `chunks`, `chunksMissing`, `vramMB`,
`reliefSprites`, `reliefBaked`, `items`, `lights`, `wires`, `culled` (buildings culled, D92), `atlasMs`). `toggle()` (Backquote) shows a `.perf` panel;
`FL.perf()` returns a copy for the smoke test.

### Frame costs on big bases (D92)

`node scripts/render-bench.mjs` (headless Chrome, 1440 × 900, dpr 1; medians of three 2-second
recordings; the machine shared with other runs, so ±0.5 ms is noise). Frame = the frame's JS time
(sim ticks, views, UI, the render call); render = the render call alone. Every case ran at 60 fps
before and after, but the Électricité view on base20k (53–56 fps: its 4 Hz readings, p95 32–42 ms,
untouched). The p95 of the other cases is the frame that carries a 10 Hz sim tick and the work look's
sample (5–13 ms on base20k, untouched).

| Base, case | Before: frame (render) ms | After: frame (render) ms |
|---|---|---|
| late (922 entities), iso near / mid / far | 2.2 (0.7) / 2.1 (0.7) / 2.0 (0.8) | 2.0 (0.6) / 2.1 (0.6) / 2.0 (0.7) |
| late, plan mid · night · a view (P / F / O) | 1.8 (0.6) · 1.8 (0.5) · 2.0–2.2 | 1.8 (0.5) · 1.9 (0.5) · 1.9–2.0 |
| late, a structural change: the buildings' rebuild · the frame | 4.4 ms · 16–17 ms | 0.6 ms (4.1 from scratch) · 12–13 ms |
| base20k (25 201 entities), iso near / mid / far | 5.5 (3.1) / 5.6 (3.0) / 4.3 (3.1) | 1.1 (0.3) / 1.6 (0.4) / 3.2 (1.4) |
| base20k, plan near / mid / far | 6.5 (3.7) / 6.6 (3.7) / 5.4 (3.8) | 3.1 (1.5) / 3.3 (1.5) / 3.5 (1.7) |
| base20k, iso mid by night · a view (P / F / O) | 3.8 (0.9) · 4.2 / 5.6 / 5.5 | 1.8 (0.5) · 1.3 / 1.5 / 1.8 |
| base20k, panning: iso near · plan near · iso far | 5.3 (2.9) · 6.3 (3.5) · 4.6 (3.2) | 1.1 (0.2) · 3.1 (1.5) · 2.1 (0.6) |
| base20k, a structural change: the buildings' rebuild · the lights' · the frame | 286 ms · 21 ms · 437–444 ms | 11.3 ms (81 from scratch) · 2.9 ms · 68–75 ms |

What is left in base20k's structural frame: the graph's compile (~25 ms), the buildings' signatures
(~11 ms), the items' paths (~3–4 ms), the lights' signatures (~3 ms), the render groups re-batched. In plan at far zoom everything is
on screen: culling cannot help, the moving parts' texture swaps and the plan sprites are the cost.

### Long sessions and the cost of a frame (D100)

`node scripts/soak.mjs` plays a debug base (grown) for half an hour in headless Chrome at dpr 2, as a
player would (the camera moving, the views and screens opened, buildings placed and removed),
sampling every minute after a forced garbage collection. Nothing grows without bound that matters:

| What | Over 30 minutes of play |
|---|---|
| JS heap kept | 50 → 57–66 MB in the first five minutes (the statistics and ledger filling their windows), then flat (1.5 MB an hour, noise) |
| DOM nodes, event listeners | flat (±40 an hour; open a screen five times: the same counts after a collection) |
| Pixi's live textures | 85–117: the terrain's chunks, kept under their 256 MB budget by their LRU (it is full within five minutes at dpr 2) |
| Pixi's texture table | +3 400 slots an hour: Pixi 8 keeps a null slot for each texture it ever managed (the terrain's chunks come and go) — a few hundred KB an hour |
| The command log (`sim.log`) | +430 entries an hour of building: kept for replay, not saved, ~40 KB an hour |
| Unlit pictures (D83), atlas pages | 5 → 8 pictures, one page; the shadows' and the relief's pages bounded by their key spaces |

What a long session costs is the frames: the whole browser (its process tree in `ps`: the renderer's
main thread ~18–21 % of a core, the GPU process ~8 %, the compositors ~6 %, the sound ~1 %) spends
~30 % of a core at 60 frames a second on the grown base, playing or paused alike (the scene redraws
either way). Measured with `AB=` (two builds in alternating windows, the medians; the machine's
load drifts a lot):

| State | Before D100 | After D100 | Battery saver (« Basse consommation ») |
|---|---|---|---|
| Playing | 31 % | 31 % | 25 % |
| Paused | 29 % | 29 % | 24 % |
| A full screen open (the tree) | 39 % | 21 % | 21 % |

- **Under a full screen** (`ScreenHost.covers`: the tree, the statistics, the Crier, the absence
  report, the expertises — 94 % paper and a backdrop blur) the world is drawn 10 times a second
  (`App.frame`, `COVERED_S`), the time it did not draw handed to the next `drawWorld`: it still moves
  behind the paper, and the browser no longer re-blurs a fresh canvas at every frame. The sim, its
  events and the DOM keep their pace.
- **« Basse consommation »** (settings, live): at most 30 frames drawn a second (`FramePacer` in
  main.ts's loop; the frames in between are not even asked for: a timer waits until one is nearly
  due), and from the next launch the economical GPU (`powerPreference: 'low-power'`). A frame's
  rendering is only part of the cost: the cap saves about a fifth.
- **A hidden tab** costs nothing but two timers: no animation frame, so no tick and no drawing (the
  catch-up pays the time back on return), and the sound suspends (audio/sound.ts). Headless Chrome
  keeps every page visible, so the soak cannot measure it.
- Not changed (each would change the look): the main menu's backdrop blur over the whole live base
  (the base drifts behind it at 60 frames a second, re-blurred at each), the 2× resolution and the antialiasing (the
  « Mode performance » setting), a cap by default on displays faster than 60 Hz.

## 13. Recipes

### Adding the art for a new building (iso sprite, plan sprite, icon, `isoHead`)

1. **Content first.** The building must exist in `src/content/buildings.ts` (`w`, `h`, `kind`,
   `ports`; see [content.md](content.md)). The atlas bakes every id in `BUILDING_IDS`; without a
   recipe the building gets the fallback (a riveted crate-like machine). No people at the base
   (D29, [lore.md](lore.md)): no lit windows, doors, glass domes or greenery; machines show
   machine things (LEDs, beacons, floodlights, dishes, racks). The research buildings (D68) are
   racks and cabinets: the lab, the data collector's mast, the servers' cooling.
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
   shadows below 50 % opacity so they stay out of it. The switched-off picture comes for free
   too (D83, *Switched off* in §10): the same LED tokens go dark; anything else that goes out with
   a production building — flames, sparks, steam — is skipped when `isUnlit(ctx)` (art/unlit.ts;
   the brazier and the fumarole tap do it). Compare `drawOff` with the lit drawing.
10. **A moving part** (a rotor, a wheel). List the building in `MOVING` ([recipes/moving.ts](../src/render/art/recipes/moving.ts))
    with its `frames` (phases baked per period: 8–16) and `sym` (periods per turn: its
    symmetry — the picture at phase 1 must be the one at phase 0, so a 3-vane rotor turns a
    third of a turn per period and an 8-bucket wheel an eighth; spokes and buckets must share
    the symmetry). In `buildings.ts` give `R[id]` a `moving: {body, part(ctx, f, s, t), over(f)}`
    instead of `draw`: body and part must be parted by a plane (a vertical one, or the horizontal
    one under a crown) so one is wholly nearer the viewer in each rotation — `over(f)` says when
    the part is. Optionally `shadow(ctx, f, s)` for what the part casts (a spinning crown casts a
    solid band). A part boxed in by its body (the deep bore's kelly inside its derrick) can carry the
    still piece in front of it and be always the nearer (`over: () => true`): the body then keeps
    everything else off the part's screen column, in every rotation. In `buildings-top.ts` add `MOVING_TOP[id] = {body, part}` (the part goes over).
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
   app that flips a public flag, like `landOn` (set by the land mode). A whole system shown on its
   own belongs in a specialised view instead (D88: `ViewsView`, `app/views.ts`, a `Readouts` part).
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
  `sortableChildren`. Every add or remove re-sorts the whole layer. The buildings view lays its
  sprites a hair under their key (`tie`, D92): another view's sprite at the very same key sorts after
  them, as when the buildings were rebuilt first; never give a key a smaller offset than 0.004.
- **Removing many children one by one is quadratic.** `removeChild` searches the layer for the child:
  tearing down 40 000 sprites one by one cost a 25 000-entity base 0.3 s. Remove them in one pass
  (the buildings view's `removeMany`: the layer emptied and refilled), or keep them.
- **Ground-plane picking.** `screenTile` works at z = 0. This suits the tools (plan half only);
  iso building picking uses volume hulls `isoHead · LH` high instead — lifted for a building
  standing on the mountains (from `level·LH`, its sprite's pixels lifted too), ranked by the
  stand's key. A click that hits no sprite takes what its ray meets first (`surfaceTile`: a rock
  top or a cliff, that tile's occupant), not the ground tile far behind the rock.
- **Strokes on P planes** are in tile units and get squashed with the plane in iso.
- **Hard-coded sizes.** `>> 5`, `& 31` and `32` (chunk size) in terrain.ts, the worker and
  relief-view; `1024` (world size) in overlays-view.

## 15. Known gaps

- **Unused or misnamed layers.** `decals` holds only the rivers' running water (D94, `world/rivers-view.ts`); `status` is empty (the drifters went, D108). Status cartouches (`ic:*`)
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
- **Standing on the mountains (D44):** the overlays (the Link tool's marks; not
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
  not the sim (power still follows the world clock).
- **Culling and updates (D92):** every building keeps both its sprites (iso and plan) while in view,
  culled by 16-tile squares, not one by one, with a 12-tile margin; the skybridges' spans and the flag
  are never culled. The night glows (lights view) and the specialised views' marks are not culled. A change
  that touches many entities at once (a lease lapsing, the Heart's level) re-draws them all, in one pass.
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
  rate into a building or out of a store's outlet lets one go per 10 ticks. When a building splits a
  flowing ribbon, the engine re-counts the upstream half's whole items: its tail item may stand
  about a second until it is whole again. Routing blocks linked to routing blocks (or fed by a
  building and feeding one) are balanced by item count, not by mu, as their flows are not seen.
- **Legacy and dead code:** the pre-morph helpers in iso.ts and camera-math.ts (kept alive by
  tests; `projection.test.ts` now covers the live maths), `rendererName`, `DynAtlas.canvasOf`.
  DynAtlas never evicts, and its 6 px padding differs from the static atlas's 8 px despite its
  comment. (The unused `belt:skybridge:*` frames are gone.)

## Tests

| Test | Guards |
|---|---|
| [relief.test.ts](../src/render/relief.test.ts) | One whole terrace per level of the land (D52); a lone column is chamfered and stays inside its tile; a diagonal staircase becomes one straight wall; slabs nest (no overhang); only camera-facing walls, with open ends; `BORDER` covers every column leaning into a chunk; `tileTop` is the level the sprites and the paint draw (`windowLevels`), at the world's edges too; a click ray lands on the first rock top or cliff it meets (`surfaceTile`) |
| [iso.test.ts](../src/render/iso.test.ts) | `tileToIso` ↔ `isoToTile` identity, diamond directions, plus the legacy helpers |
| [camera-math.test.ts](../src/render/camera-math.test.ts) | World ↔ screen identity, zoom about a point, clamping, chunk ranges on negatives (legacy top-down space) |
| [daynight.test.ts](../src/render/daynight.test.ts) | The 24-hour clock on the world day; the grade never goes black and turns smoothly; lights only at night, clouds only by day; the seen sun follows SOLAR; the plan view's lighter grade |
| [art/recipes/fx.test.ts](../src/render/art/recipes/fx.test.ts) | The light spy turns LED fills into emitters and `PV` fills into cell polygons; every building recipe runs on the spy; night rigs (the Heart's beacon, amber only on hot machines) |
| [art/recipes/heart-look.test.ts](../src/render/art/recipes/heart-look.test.ts) | D86: the Heart has one look per level; its pieces stand on four distinct corner tiles, the data outlet on its out port's from `BAL.hearthDataLevel` (its nozzle drawn only then); each level lights more than the last in iso and plan, its solar cells the same at every level |
| [art/recipes/deep-bore.test.ts](../src/render/art/recipes/deep-bore.test.ts) | The deep bore stands far taller than the drill; its part carries no lamp in iso and only the beacon on its axis in plan (night lights and the switched-off look right in any phase); the leg its part draws is the one exactly in front of the kelly, and its terminal stays clear of that column; the kelly's square repeats every quarter turn |
| [art/recipes/moving.test.ts](../src/render/art/recipes/moving.test.ts) | Moving parts draw their body and every phase in every baked rotation (iso and plan); the turbine's red light sits on its axis in every phase; the sand wheel stays behind its split plane; the silhouette context keeps solid fills only, in one colour; every building draws as its own cast shadow |
| [world/wire-geom.test.ts](../src/render/world/wire-geom.test.ts) | Every building that takes part in power has terminals on its footprint and under its head; the art (iso and plan, every baked rotation) draws each one; an anchor lands on a terminal, turned exactly as the art turns it (IsoFrame); a building drawn once keeps its rot-0 points; a pole takes a wire along its arm on the end pin, across it on the top pin; the Heart its nearer link mast; a building on the mountains hangs its wires from its terminals lifted by its level (a pole on the floor keeps its own); the catenary sags most at mid-span, capped, never to the ground even from the lowest terminal |
| [art/recipes/cargo.test.ts](../src/render/art/recipes/cargo.test.ts) | The sky-crane keeps the intro's numbers; the cargo drone is the same drawing (red to port, green to starboard, LEDs on the hub) and fits its canvas; the container passes through the deck's iris and the iris fits the deck (`TP_DECK_R`); the cables splay out from the container's eyes to the winches; the container draws at any depth in the iris and not at all once sunk |
| [world/cargo-flight.test.ts](../src/render/world/cargo-flight.test.ts) | The deck mirrors the trade post's art (`TP_DECK` in the middle of `TP_PAD`, `DECK_Z`, the drone's engines over the pad) and turns with the footprint as IsoFrame turns the art; both sequences run without a jump; the container goes through the deck only while the iris is open, hangs a cable's length under the drone, leaves the deck only once hooked and lands with its swing died out; the drone never sinks into its load; both end with nothing on screen; the next drone starts once the deck is clear |
| [world/moving-parts.test.ts](../src/render/world/moving-parts.test.ts) | Turbines turn faster in stronger wind (bounded, a mesa outspins the cirque, a turbine on the mountains the cirque floor in any gust), machines only while they work; each building's start phase and speed factor are stable and spread |
| [world/work-look.test.ts](../src/render/world/work-look.test.ts) | D83, on the real engine: a wire mill looks at work while it crafts, keeps the look `WORK_GRACE` ticks once its ore runs out, then is switched off; a drill whose wire is cut is off at once; only flips are reported, once per tick; a turbine off on no grid, on once wired; a lab with no project off; logistics, the Heart and the excavator never watched |
| [art/unlit.test.ts](../src/render/art/unlit.test.ts) | D83: through `unlitCtx` an opaque lamp is dark glass, its halo is left out, other paint goes through and the style is put back; `switchOffPixels` greys and darkens, keeps alpha |
| [art/rock.test.ts](../src/render/art/rock.test.ts) | The mesas (2026-10-16): the strata are one rising, uneven table up past the highest rock, the soft rock showing every bed; tops pale and walls deepen with height, harder rock darker; a step's rim bites only inwards (never leaves its tile, whatever the seed), meets the next tile's at a side's ends, and is no silhouette where the step above carries the wall on; a column is cut at a diagonal front's ledge, not at a corner's chamfer (`ledges`); each step wears the rock of its height (`layersOf`); a stream up on a massif (D94) stands at its level, its top running water with its way and fall, and pours a sheet down the wall it runs off (none where it does not fall) |
| [art/vein.test.ts](../src/render/art/vein.test.ts) | D87: a rock tile holding a face ore is a vein column (`columnLook`), drawn with its seam and crystals on its walls (the far paint only the seam at its lightest detail); in plan a vein shows its crystals along the edges that drop to lower ground, a buried ore keeps the faint hidden dot |
| [world/cast-shadows.test.ts](../src/render/world/cast-shadows.test.ts) | The shadow map is the identity for the reference light, sends the reference displacement to the sun's and keeps the cross direction; no shadow at night, shortest at noon, long and soft in a low sun, smooth through the day; at every hour a shadow runs straight away from the sun and nothing drawn (the far side of the seam) lies past a building's sun-side edge, which the stretch alone did at dawn; the bake's clip is exactly the far side; no shadow of the day reaches past `shadowReach` |
| [world/stand.test.ts](../src/render/world/stand.test.ts) | A building stands at 0 on the floor, on the rock top on the mountains (`tileTop`, the highest under its footprint; the ghost asks the same, ribbons lie flat); it sorts after every column under it (its front corner too), past the flat rock its shadow falls on, never past a higher column or a building on the floor ahead (a ribbon there changes nothing), behind the lifted buildings in front of it |
| [world/flow-arrows.test.ts](../src/render/world/flow-arrows.test.ts) | The ghost's way-in arrow comes from the tile behind into the block, the three ways out leave by the front and sides, in every rotation; only the blocks that take in at the back get them |
| [world/item-flow.test.ts](../src/render/world/item-flow.test.ts) | The paths: a bend round its corner; a junction's hump on the north–south line (the art's own profile, drawn over the bridge a little before and after), none under the east–west one |
| [world/junctions-view.test.ts](../src/render/world/junctions-view.test.ts) | `underPass`: a ribbon either side either way; a trade post's and a kiln's ports facing the junction in every orientation (exit feeds, entrance is fed); nothing for the deck axis |
| [world/cell-flow.test.ts](../src/render/world/cell-flow.test.ts) | Items drawn from the cells (D57), the real engine at 60 frames a second: a line through a junction (over its hump), a skybridge and onto a swift ribbon into an incinerator (it rides into the pit); a router dealing a line out three ways; a jammed line (each item still, on its tile's centre). Nothing jumps, nothing pops up but at a source, nothing vanishes but into a building |
| [world/belt-lift.test.ts](../src/render/world/belt-lift.test.ts) | Items at their tile's top; up a traction elevator (onto the car, up with it standing still, off over the edge; the car back down alone), down one onto a ribbon, a slide onto a building; among the volumes (`itemZ`): after their ribbon, keyed by the next tile of a plateau as they cross onto it, by their own against higher rock in front; down a step away from the viewer, after the high column while on the car at the top, behind it (and over the elevator's front frame) once it sinks, under a building in front; into an incinerator, over its pit on the near half, behind its flame on the far half and once it tips in |
| [world/pits.test.ts](../src/render/world/pits.test.ts) | The way into a pit: flat on the ribbon, up the chute, then an accelerating fall, gone before a full line's next hand-off; the flame's heat (up fast, down, embers, nothing) and levels; driven by the real engine at 60 frames a second, one flare for every item that falls in, items seen falling, no jump, the fire out once nothing comes |
| `scripts/smoke.mjs` | WebGL renderer; 20k particles > 30 fps; relief sprites > 100 near and 0 far; pan/zoom sweep settles with `chunksMissing === 0`; the morph settles; 10k items > 30 fps |

Untested: `proj`/`isoToView` endpoints, the `setView` fades, `Camera.zoomBy`/`panScreen` (the real
tile-space versions), the terrain LRU, `beltPiece`, and the `rockZ`/`buildingZ` interleave on the
floor (stand.test.ts covers it on the mountains). These are cheap pure tests to add ([testing.md](testing.md)).

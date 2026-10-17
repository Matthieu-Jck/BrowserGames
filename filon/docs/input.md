# Input (`src/input/**`)

`Input` turns DOM events into camera moves, which it applies itself, and into key actions, digit
slots and pointer events, which it hands to the app. Fingers (D96) become the same pointer events
through the touch gestures (§2b). The app converts pointer positions to tiles
and feeds them to `Tools`. `Tools` turns tile gestures into sim commands, plus a `Preview` that the
ghost and the tip draw. Movement-like keys bind by physical position (AZERTY native); mnemonics
bind by the layout's letter.

## Where things are

| Path | Role |
|---|---|
| [input.ts](../src/input/input.ts) | `Input`: DOM listeners, drag-pan, wheel zoom, keyboard pan, the fingers through `TouchGestures`, dispatch through `InputHooks` |
| [touch.ts](../src/input/touch.ts) | `TouchGestures` (D96, pure): touch pointers → pan, pinch zoom, tap, a tool's drag, long press as the right button; `SLOP`, `LONG_MS`, `TouchEffect`, `TouchTool` ([touch.test.ts](../src/input/touch.test.ts)) |
| [bindings.ts](../src/input/bindings.ts) | `Action` union, `BINDINGS` table, `actionOf`, `slotOf`, `HELD` |
| [tools.ts](../src/input/tools.ts) | `Tools`: tool states, gestures → sim commands, `Preview`, `ToolResult`, `originFor`, `snapOrigin` (a drill onto the deposits' blocks, D104) |
| [belt-path.ts](../src/input/belt-path.ts) | `beltPath`: the L a ribbon drag lays; `dirTo` |
| [link-tool.ts](../src/input/link-tool.ts) | `LinkTool`: the « Relier » tool (power wires, D25) — source, clicks → `link` / `unlink`, `LinkPreview` |
| [land-tool.ts](../src/input/land-tool.ts) | `LandTool`: the land mode (« Terrain », D60) — on / off, the hovered parcel, the one a click picks; the land panel buys and leases (§4c) |
| [belt-path.test.ts](../src/input/belt-path.test.ts), [bindings.test.ts](../src/input/bindings.test.ts), [link-tool.test.ts](../src/input/link-tool.test.ts) | Unit tests of the folder |

Related: [app.md](app.md) (controls map actions to app operations; picking maps screen to tile),
[render.md](render.md) (the ghost, ribbon bend pieces, camera), [ui.md](ui.md) (build bar, tip),
[i18n.md](i18n.md) (hint strings), [engine.md](engine.md) (`place`, `planBelts`, `placeBelts`,
`remove`, `designate`, `link`, `unlink`), [testing.md](testing.md), [extending.md](extending.md) (end-to-end checklists).

## 1. Flow

```
DOM events ─▶ Input ─┬─ pan drags, wheel, held keys ────────────▶ Camera (directly)
                     ├─ onAction(a, e) · onSlot(slot, shift) ───▶ app controls / build mode
                     └─ onPointerDown/Move/Up(PointerInfo) ─────▶ app controls
                                                                    │ screen → tile through the current P
                                                                    ▼
                              Tools.down/move/up(x, y, button) ──▶ Sim commands → ToolResult → toasts
                              Tools.preview()  (every frame) ────▶ GhostView, Tip
```

`Input` never touches the sim, and `Tools` never sees screen pixels. The app gates both:
- Tools get presses and releases only on the plan side of the morph (`te > 0.5`); moves always
  update `tools.hover`.
- `toolActive()` (a tool in hand, plan side) is what turns a left drag from panning into the tool.
- A plain left click selects through picking whenever `toolActive()` is false: nothing in hand, or
  the iso side.
- The preview is computed only on the plan side, with the pointer over the canvas.

## 2. `input.ts`

| Target | Event | Effect |
|---|---|---|
| canvas | `pointerdown` | Focuses the canvas, then starts a pan drag (pointer captured) or calls `onPointerDown` |
| window | `pointermove` | Continues a pan drag (`camera.panScreen(dx, dy)`) or calls `onPointerMove` |
| window | `pointerup` | Ends a pan drag (forwarding a click if it barely moved) or calls `onPointerUp` |
| canvas | `wheel` (non-passive) | `preventDefault`; `camera.zoomBy(exp(−deltaY·k), clientX, clientY, w, h)`, k = 0.0015, or 0.01 with Ctrl (trackpad pinch) |
| canvas | `contextmenu` | Suppressed: the right button is a tool button |
| window | `keydown`, `keyup` | See the dispatch below |
| window | `blur` | Clears held keys and Space, so panning never sticks after Alt-Tab |
| canvas · window | `pointerdown` · `pointermove` · `pointerup` · `pointercancel` of `pointerType: 'touch'` | The touch gestures (§2b) instead of the above |

**Pan drags and clicks.** A press starts a camera drag on the middle button, on the left button
with Space held, or on the left button when `toolActive()` is false. The last kind is a click
candidate: if the pointer moved less than 5 px (sum of |dx| + |dy|), the release is forwarded as
`onPointerUp`, which is how a plain click selects while a drag pans. Middle and Space drags never
click. Right presses always go to the hooks. `dragging()` reports a drag past the threshold
(nothing uses it yet).

**`PointerInfo`** = `{sx, sy, button, shift, ctrl, overCanvas}`. Coordinates are CSS px, which are
canvas px because the canvas is fixed full-window. `ctrl` is Ctrl or Cmd. `overCanvas` means the
event target is the canvas. Presses only come from the canvas, but moves and releases come from
the window: a drag released over a panel still completes, on the tile under the panel. The app
uses `overCanvas` to skip selection, the ghost and the tip over panels. `shift` and `ctrl` are not
read by the app yet.

**Keyboard dispatch** (`keydown`):
1. Ignored while a form control has focus (`INPUT`, `TEXTAREA`, `SELECT` — the inspector's
   pickers — or contentEditable).
2. `Space` sets the pan modifier (`preventDefault`); a focused UI button is blurred first, so
   Space never presses it again.
3. Everything else goes through **`resolveKey(e)`** (bindings.ts, pure and unit-tested), which
   holds all the precedence:
   - with Ctrl or Cmd, only `undo` exists, matched by the layout's letter (AZERTY's Z sits on
     KeyW); Ctrl+C, Ctrl+X, Ctrl+R… do nothing in the game;
   - the digit row (`slotOf(e.code)`: Digit1 → 0 … Digit0 → 9, without Alt) → `{ slot, shift }`
     → `onSlot`: Shift opens a category tab, otherwise a slot of the open tray (opening the last
     category first);
   - then physical codes, then layout letters (`actionOf`), `undo` excluded without a modifier.
4. Held actions (`HELD`: the four pans and `fast`) go into a set that `frame(dt)` consumes; other
   actions ignore auto-repeat and call `onAction(a, e)`.

`frame(dt)` pans at 900 screen px/s, 2.5× while `fast` (Shift) is held. `keyup` releases held actions.

**`InputHooks`**, the app's side ([app.md](app.md)):

| Hook | The app does |
|---|---|
| `toolActive()` | A tool in hand and the plan side in effect |
| `onAction(a, e)` | The controls' action switch |
| `onSlot(slot, shift)` | Build mode: a tray slot, or a category with Shift |
| `onPointerDown/Move/Up(p)` | Picks the tile through the current projection, calls `Tools`, reports the result |
| `touchTool()` (optional) | What one finger does with the tool in hand: `none` (nothing, or the iso side), `tap` (a building: placed by a tap), `drag` (a ribbon, the demolition box, the brush) |
| `onPointerCancel()` (optional) | A second finger came down: `Tools.dropDrag` drops the drag or right box under way, the tool stays in hand |

## 2b. Touch (D96)

Fingers on the canvas go through [touch.ts](../src/input/touch.ts), a pure state machine that
`Input` feeds (`down` / `move` / `up`, the times from `performance.now()`) and whose effects it
applies: `hover` / `down` / `move` / `up` reach the app as the mouse's `PointerInfo` (`overCanvas`
true), `pan` and `zoom` go to the camera, `cancel` to `onPointerCancel`, `long` to a short vibration
where the device has one. Mouse, pen and keyboard never come here.

| Fingers | Nothing in hand (or the iso side) | A building in hand (`tap`) | A ribbon, the box, the brush (`drag`) |
|---|---|---|---|
| One, a tap (moved < `SLOP` = 10 px) | A click: select, the Link tool's click, the land mode's parcel | Placed where the finger was (a press and a release) | One tile: a ribbon tile, a one-tile box |
| One, a drag | Pans the camera | Pans (no building laid by a finger that meant to pan) | The tool's drag, from where the finger came down |
| One, still for `LONG_MS` (480 ms) | The right button: a right click (in build mode: demolish; unwinds the Link tool and the land mode); moving on drags a right box | The right button: the tool put away | The right button: the drag dropped, else the tool put away |
| Two | Pinch: zoom about their middle, pan with it; what one finger had started is dropped (`cancel`, `Tools.dropDrag`); the finger left after a pinch pans and never clicks | ← | ← |

A touch that came down on a panel is the panel's: only fingers pressed on the canvas are tracked.
The long-press timer runs in `Input` (`armLong`) while one finger is pending. On the interface,
`touch-action: pan-x pan-y` keeps a pinch from zooming the page ([ui.md](ui.md#the-responsive-layout-d96));
the canvas has `touch-action: none`. Without R, « Tourner » in the build bar turns the building in
hand on a touch screen. [touch.test.ts](../src/input/touch.test.ts) covers each row; the
responsive script drives real touch events at 390 × 844 ([testing.md](testing.md)).

## 3. `bindings.ts`

There are two kinds of binding:
- `codes`: physical positions (`KeyboardEvent.code`). Used for movement, pipette, perf, cancel and,
  through `slotOf`, the digit row. On AZERTY they land on ZQSD, the pipette on A, and the digits
  work without Shift.
- `keys`: the layout's character (`KeyboardEvent.key`, lowercased when it is a single character).
  Used for mnemonics, so M is the market ("marché") wherever M sits.

`actionOf(e)` returns the first action whose `codes` contains `e.code`, else the first whose
`keys` contains the key: codes always win. `HELD` lists the continuous actions.

| Action | Binding | Kind | What the app does |
|---|---|---|---|
| `panUp`/`panDown`/`panLeft`/`panRight` | KeyW/↑, KeyS/↓, KeyA/←, KeyD/→ (AZERTY Z Q S D) | code, held | Keyboard pan (`Input.frame`) |
| `fast` | ShiftLeft, ShiftRight | code, held | Pan ×2.5 |
| `rotate` | `r` | key | `tools.rotate(±1)` (Shift+R reverses) |
| `pipette` | KeyQ (AZERTY A) | code | Takes the building under the cursor in hand, with its rotation (not the Hearth) |
| `deconstruct` | `x` | key | Toggles the demolition tool |
| `cancel` | Escape | code | Unwinds one layer: screen (a page of it first) → drag or tool → selection → a specialised view (back to Normal, D88) → build mode → the main menu (not under automation, [app.md](app.md)) |
| `undo` | `z` + Ctrl/Cmd | key | Not handled (M8) |
| `zoomIn` / `zoomOut` | codes `Equal` `NumpadAdd` (+ key `+`) / `Minus` `NumpadSubtract` | code | ×1.25 / ×0.8 about the screen centre — while the tech tree is open, its zoom instead (D111: `ScreenHost.zoomKey`), and `0` (Digit0, the tenth slot) shows the whole tree. By position: `-` `=` on QWERTY, `)` `=` on AZERTY (whose `-` is the 6, a build slot) |
| `viewPower` | `p` | key | The **Électricité** view (D88: the grids, their sources and draw, the troubles; [ui.md](ui.md#the-specialised-views-d88)), or back to Normal — P was the power overlay's key, which the view replaces; offered once the tutorial shows the power. KeyP on both layouts |
| `viewLogistics` | `f` | key | The **Logistique** view (D88: the ribbons' throughput as a heat, jams, dead ends, the Gleaners' night), or back to Normal — F (flux, flow) was kept for a flow overlay. KeyF on both layouts |
| `viewProduction` | `o` | key | The **Production** view (D88: at work, waiting, stopped and why), or back to Normal — O for ouvrages / output; free on both layouts (KeyO) |
| `viewWind` | `v` | key | The **Vent** view (D95: where the wind blows, from where, the turbines; [ui.md](ui.md#the-specialised-views-d88)), or back to Normal — V for vent; offered once the Anémométrie plan is learnt (`App.viewShown`). KeyV on both layouts |
| `scrResearch` / `scrStats` | `t` / `g` | key | Opens the screen (the tree once the tutorial has revealed it; the Statistics once the ledger plan is unlocked, D41) |
| `scrExpertise` | `e` | key | Opens the Expertise window once the Core mounts its Archive (level 3, D93); a click on the Archive does too |
| `scrMarket` | `m` | key | Not handled (M6) |
| `home` | `h` | key | Glides back to the Hearth |
| `perf` | Backquote, IntlBackslash | code | Perf overlay |
| `build` | `b` | key | Toggles build mode (plan view) |
| `mark` | `c` | key | Toggles the dig/fill brush |
| `link` | `l` | key | Toggles the Link tool (« Relier » / Link: power wires, §4b) — KeyL on both layouts |
| `land` | `i` | key | Toggles the land mode (« Terrain » / Land: the parcels, buy or lease, §4c), which is the **Terrain** view (D88) — « immobilier »; the key the zones' overlay had, the map of where one may build that the parcels replace (D60). KeyI on both layouts |
| `hideUi` | `u` | key | Hides the interface to look at the base (`body[data-noui]`; owner, 2026-10-12: the menus hide the game). Panning, zoom, `home` and the views' keys (P, F, O) keep it hidden; Escape or any other action brings it back first — KeyU on both layouts |
| *(slots)* | Digit1 … Digit0 | code (`slotOf`) | Tray slot; Shift+digit = category |

Space (pan modifier) is hard-coded in `input.ts`, not in the table.

## 4. `tools.ts`

`Tools` takes `() => Sim`, so a swapped colony is picked up. `hover` is the last tile seen by
`move`; `def` is the building in hand.

| `state.k` | Fields | Entered by |
|---|---|---|
| `build` | `def`, `rot` | `select(def, rot = lastRot)` for ordinary buildings |
| `belt` | `def`, `rot`, `from`, `flip` | `select` when `isDragDef(def)` (kind `belt`, `conduit` or `fence` — D103: a fence line is dragged like a ribbon and planned by `planBelts`, one fence a free tile) |
| `remove` | `from` | `demolish()` |
| `mark` | `from`, `clear` | `mark()` |
| `null` | — | Nothing in hand |

**Gestures** (tiles; the app forwards them only on the plan side):

| Tool | Left press | Left release | Right press | Right release |
|---|---|---|---|---|
| `build` | Places at `originFor` immediately (over what it replaces) → `{placed: 1}` or `{refused}` | — | Puts the tool away | — |
| `belt` | `from` = tile | Lays the sim's plan of `beltPath(from → tile)` (`placeBelts`) → `{placed: n}` (with `left: {n, reason}` when the plan left tiles out: their count, the first one's reason), or the plan's first refusal (none when the drag only runs over what is already there) | Drops the drag, else puts the tool away | — |
| `remove` | `from` = tile | Removes the box → `{removed}` | Starts a right box | Removes the box → `{removed}` |
| `mark` | `from`, `clear = false` | `designate(box, true)` → `{marked}` | `from`, `clear = true` | `designate(box, false)` → `{cleared}` |
| none | (Input pans or selects) | — | Starts a right box | Removes the box → `{removed}` |

- **Placement.** `originFor(def, rot, hx, hy)` centres the rotated footprint on the cursor; for even
  sizes the cursor is on the upper-left of the two middle tiles. `snapOrigin` is what the ghost, the
  click and R use: on a land whose deposits come in whole blocks (map 4, D104), a 2 × 2 or 4 × 4 drill
  whose footprint would cover ore there moves its corner down onto the blocks' grid (`oreSnap`,
  [sim/ore-blocks.ts](../src/sim/ore-blocks.ts)): it always keeps the cursor's tile, and a deposit is
  covered whole drill by drill. The 3 × 3 deep bore, a sand collector, a face cutter and anything off
  the ore stay where the cursor puts them.
- **Placing over things** (decision D24, rules in [engine.md](engine.md#placement-and-replacement)).
  A building may go over buildings of its own replace group that lie wholly inside its footprint:
  a router over a ribbon, a swift ribbon over a ribbon, a distributor over four ribbons or routers,
  a pylon over a pole, a deep bore over a drill. They are refunded first, so their refund
  counts towards the cost. Re-placing the very same building (or turning one whose rotation means
  nothing, such as a router or a mast) is `occupied`. A sorter turned round keeps its chosen item.
- **Ribbon drags** are laid on release only, as `sim.planBelts(def, path)` plans them whole
  ([belt-plan.ts](../src/sim/systems/belt-plan.ts), D73) — the plan the ghost shows meanwhile, as a
  faint placeholder:
  - a tile already holding this ribbon in this direction is skipped;
  - another tier or another direction is replaced (an upgrade, a turn);
  - a routing block, junction or bridge end on the path is **kept** when the drag is 2+ tiles
    (lines are dragged through routers); a one-tile drag (a click) replaces it;
  - **auto-junction**: where the drag runs straight across a ribbon of any tier lying
    perpendicular to it (not at the drag's first or last tile, not at its bend), a junction
    (`crossing`) is laid instead, so both lines keep flowing. Junctions never chain (D73,
    `junction_chain`): a ribbon runs between two of them;
  - **a step** a plain ribbon would face takes a **traction ribbon** by itself once `traction` is
    learnt (D73); never two steps in a row (`lift_room`, D65);
  - **a neighbouring base's open land** a flat ribbon may not cross is laid with **camouflaged
    ribbons** by itself once `xp_camo` is learnt (D109), after the bridges (a short run a pair can
    leap keeps the line's pace); a plain ribbon on free land stays plain;
  - **an obstacle** — a run of tiles refused as `occupied`, `terrain` (water…), `chasm` or `river`
    (map 4, D94), `neighbour_land` (D110) or `junction_chain` (two lines side by side) — is leapt by a **bridge pair** on the ribbon tiles
    just before and after it, when `bridge` is learnt, the run is straight, the start is fed from
    straight behind, the pair is within reach (`4 + bridgeSpan`) on one level and no other bridge of
    that direction on the line would take the leap; what lies between stays as it is (`leapt`);
  - the tiles share one budget in path order, so a drag that runs short turns `unaffordable` from
    the tile where it would stop;
  - a tile facing a step its piece cannot take is left out (D77: `needs_lift` for a ribbon before
    traction is learnt, `steep` two terraces away, `cliff` for a conduit facing a step up or two down —
    one down it pours, D114), and so is an obstacle no
    bridge pair can leap; the rest is laid and the toast counts what was left out.
- **Rotation.** `rotate(dir)` flips the bend during a ribbon drag, turns a build or ribbon tool
  otherwise (remembered in `lastRot` for the next pick), and does nothing for remove and mark.
  After a drag, the ribbon tool keeps the last tile's direction. A building turns from the rotation
  its ghost shows (`sim.placementRot` at the hover): over a ribbon a directional routing block shows
  the way the items enter that tile (D98), a face cutter the turn that puts its back to the wall.
  R also sets the build tool's `turned`: from then on, while that building stays in hand, its
  rotation is the player's over a ribbon too — the preview passes it to `placementRot` and the click
  to `place(…, turned)`. Taking a building again (the bar, the pipette) or Esc clears it.
- **Cancel.** `cancel()` (Esc) drops the right box first, then a drag in progress, then the tool.
  It returns `true` if it dropped anything, so the app's Esc chain stops there. `dropDrag()` drops
  only the right box or the drag, keeping the tool (a second finger: a pinch, §2b).
- **Demolition box.** Every entity touching the inclusive box, except the Hearth, is removed with
  `sim.remove`; the engine refunds it. A click is a 1-tile box. In build mode with nothing in hand,
  a right click demolishes the building under the cursor.
- **The dig/fill brush.** On release, `sim.designate(tiles, true)` marks revealed rock to dig and
  shallow/deep water or salt flats to fill. The sim picks the job kind and skips occupied fill
  tiles. A right drag clears marks. Excavators and backfillers in reach then work the marks
  ([engine.md](engine.md)).

**`Preview`**, from `preview()` every frame. The first match wins: a demolition box (right box, or
the remove tool's `from ?? hover`), then a mark box, then build or ribbon pieces.

| Field | Meaning |
|---|---|
| `pieces` | `GhostPiece {def, x, y, rot, ok, reason}`: one for a building, one per planned tile of a ribbon drag (a `crossing`, `traction_ribbon` or `skybridge` piece where the plan lays one). Tiles already holding this ribbon in this direction are shown as `ok` and free; a block the drag keeps, and a tile a bridge pair leaps, get no piece (they stay as they are). |
| `drag`, `leaps` | A ribbon drag in progress (nothing laid before the release: the ghost draws the plan faint), and its bridge pairs' ends `[x0, y0, x1, y1]` (a dashed line between them) |
| `buried` | `{n, land}` (D109): how many camouflaged pieces stand off the claim's land, and whose land — a neighbouring base's (`neighbour_land`) when any does, else free land (`outside_zone`; `landReason`). The tip names it |
| `box`, `doomed` | Demolition box (tiles, inclusive) and the entity ids it would remove. Without a box, `doomed` lists what the pieces that fit would replace |
| `mark` | `{box, clear, n}`: `n` tiles would be marked or cleared |
| `reason` | First refusal along the preview (`PlaceReason`) |
| `cost` | Map from item index to milli-items, net: each piece's `canPlace` cost (or the building's base `costOf` when refused before costing), minus the base cost of what it replaces. Only items actually spent are listed, so the tip's "missing" test (stock < cost) is the affordability rule |

GhostView draws it, keying its redraw on `pieces`, `box`, `doomed`, `mark`, `drag`, `leaps` and the hover
([render.md](render.md#10-world-views)). The tip shows the cost, the refusal and the mark count.
`ToolResult {placed?, removed?, refused?, left?, marked?, cleared?}` becomes toasts in the app's build
mode: a refusal shows its `reason.*` string, a drag laid in part how many tiles it left out and why
(`toast.left`, D77), and removals and marks get info toasts.

## 4b. `link-tool.ts`: the « Relier » tool (D25)

Power goes through wires the player strings ([engine.md](engine.md#power)); this tool strings and
cuts them. It is not a `Tools` state: it works in **both views**, and a left drag still pans.

| | |
|---|---|
| Take it | L, the « Relier » slot at the end of the Énergie tray, or the inspector's « Relier » on a pillar or the Heart (which starts from that one). Taking any other tool puts it away, and taking it puts the tool in hand away (`BuildMode.link`) |
| Pick the source | Click a pillar or the Heart (`picked`; the inspector shows it). A click on another building first: `needs_pillar` |
| Wire / cut | Each click on a building toggles a wire with the source: `sim.link(source, id)` if there is none (refused with its `LinkReason`: `range`, `slots`, `slots_other`, `not_linkable`…), `sim.unlink` if there is one |
| Change source | Click the source again (`dropped`), or Shift+click another pillar |
| Unwind | Esc or a right click: the source first, then the tool (`cancel()`); the app's Esc chain asks it before the build tools |

The shell resolves the building under the cursor with `picker.entityAt` (volume hulls in iso,
the tile's occupant in plan) and hands its id to `click(id, shift)`; each frame it sets `hover`
the same way. `verdict(id)` says what a click would do (`pick`, `drop`, `link`, `unlink` or the
refusal), so the views can preview it. `LinkToolResult {picked?, dropped?, linked?, unlinked?,
refused?, asleep?}` → `BuildMode.reportLink`: a refusal is a toast (`link.reason.*`), a new source is
selected, a wire to a sleeping building (`asleep`: `Sim.dormancy`, D80) an info toast saying why it
stays dashed (`link.asleep.land` / `.research`).

**`LinkPreview`** (`preview()`, cached; `sig` changes whenever anything in it does): `source`,
`ring` (its footprint and range, for the reach outline — before a source is picked, the hovered
pillar's), `targets` (what a click would wire now and is on no grid yet, D80: `canLink` ok — pylons
farther than the source's own range included, a wire taking the longer reach — and either a
building on no grid or a pillar of another grid; what else is in reach is wired by a click all the
same, unmarked), `loose` (with a ring: built, awake, non-pillar buildings on no grid beyond the
reach, waiting for a wire), `linked` (its wires), `points` (no source yet: every pillar and the Heart), `hover` and its
`verdict`, and `block`: when the verdict is `blocked` (D78), the first tile from the source that
rises above the wire (`wireObstacle`), which the overlays mark. **`ghost(def, x, y, rot)`**: the
same preview for a pole or a pylon held to be placed (null for any other building) — its ring where
it would stand and the buildings on no grid a wire from it could reach (`linkCheck` with the ghost
as an end: reach, height, the land between), `loose` the rest; the shell hands it to the overlays
while the build tool holds a pillar. The overlays draw the ring and marks, the wires view the preview wire
([render.md](render.md#10-world-views)). The build bar's hint line reads `build.hint.link` (no
source) or `build.hint.linkFrom`.

## 4c. `land-tool.ts`: the land mode (D60)

The claim builds on the parcels it holds ([land.md](land.md)); the land mode is where the
player looks at them and buys or leases one. Like the Link tool it is not a `Tools` state:
nothing is placed, a left drag still pans, and it is driven by the shell.

| | |
|---|---|
| Take it | I, or the view selector's parcel (the Terrain view, D88; `MapViews.set('land')` → `BuildMode.land`, [app.md](app.md)): every tool goes away, the selection is dropped, the view turns to plan and zooms out to a few parcels. Taking any tool, opening a category or the Link tool ends it |
| Hover | Each frame the shell sets `hover` to the parcel under the cursor (`picker.tileAt` → `parcelUnder`, the tile clamped to the world; −1 over the UI). The overlays mark it and the tip shows its price |
| Pick | A plain left click → `click(p)`: it becomes `selected` (true if it changed); the land panel shows it ([ui.md](ui.md#the-land-mode-and-its-panel-d60)), whose buttons call `buyLand` / `rentLand` / `endLease` |
| Unwind | Esc or a right click: the picked parcel first, then the mode (`cancel()`, through `BuildMode.landCancel`, which gives the zoom back and stands the colony up in iso unless a category is open); the app's Esc chain asks it after the Link tool and before the build tools |

[land-facts.test.ts](../src/ui/land-facts.test.ts) checks its order (a click picks, Esc lets the
parcel go, then the mode).

## 5. `belt-path.ts`

`beltPath(ax, ay, bx, by, flip, rot)` returns `[x, y, rot]` per tile. The path is an L from press to
release, x first then y (y first when `flip`; R flips during a drag). Every tile points at the next
(`dirTo`), and the last keeps the direction of the last leg. A single tile keeps the tool's `rot`.
The automatic corner needs no special piece in the path: the corner tile points along the second
leg, and render's `beltPiece` draws it as a bend because exactly one side neighbour feeds it.

[belt-path.test.ts](../src/input/belt-path.test.ts) guards: a click lays one tile in the tool
rotation; a straight drag points every tile along the drag; an L goes x first (y first when
flipped) and turns at the corner; a backwards drag stays adjacent tile to tile.

The smoke test ([testing.md](testing.md)) drives the real mouse at `FL.tileToScreen` positions. It
covers: click a drill onto a deposit (tip visible); drag an L of 7 ribbons, then box-demolish them
with X (refunded); see a kiln refused off the claim's land, with its reason and the land mode's
key; open and close build mode with B; mark rock with the brush; open the inspector by clicking
the Hearth in iso; open the land mode with I, pick a parcel by mouse and buy it from the panel; on
the late debug base, P, F, O, V and I switch the views, a click inspects on the view's facet, Esc and
the selector's Normal go back (D88); at 390 × 844 the HUD folds, the inspector is a bottom sheet and
the build bar scrolls (D96). Real fingers are driven by `scripts/responsive.mjs`'s touch step.

## 6. Recipes

### Recipe: adding a key action

1. In `bindings.ts`, add the name to `Action` and an entry to `BINDINGS`. Use `codes` for
   positional keys and `keys` for mnemonics: lowercase single characters, named keys (`'Enter'`)
   verbatim.
2. Check for collisions:
   - The digit row is consumed as slots before any action.
   - A `codes` binding on a letter position shadows the mnemonics that sit there on other layouts
     (AZERTY: KeyW is `z`, KeyQ is `a`, KeyA is `q`).
   - Space is the pan modifier.
   - Watch for browser shortcuts.
3. A continuous action goes into `HELD` and is read from `held` in `Input.frame(dt)`.
4. Handle it in the app's controls ([app.md](app.md)). Check `e.shiftKey`, `e.ctrlKey` and
   `e.metaKey` there if modifiers matter: Input only gates `undo` and the slots.
5. Surface it in the hint strings (`build.hint.*`, `fr.ts` + `en.ts`, [i18n.md](i18n.md)) when it
   matters while building.
6. Test it: `actionOf({ code, key })` is pure, so a `bindings.test.ts` with QWERTY and AZERTY
   events (`{ code: 'KeyW', key: 'z' }`) takes a few lines.

### Recipe: adding a new tool

1. Add a `ToolState` variant (`{ k: 'mytool'; from: [number, number] | null; … }`) and an entry
   method on `Tools`, like `mark()`.
2. Give it gestures in `down` and `up`, for both buttons; the right-button branch of `down` decides
   whether a right press puts the tool away. Handle it in `cancel` (drop a drag before the tool) and
   in `rotate`.
3. Act only through `Sim` methods (`canPlace`, `place`, `placeBelts`, `remove`, `designate`, or a
   new command that follows [engine.md](engine.md)); never mutate sim state. Return a `ToolResult`,
   adding a field if needed, and have the app's build mode toast it with an i18n key.
4. Extend `Preview` and fill it in `preview()`, minding the precedence. Draw it in
   `GhostView.draw`, and **add the new fields to its signature** or the ghost will not redraw.
   Add it to the tip (its own signature) if it has a cost or a count.
5. Add entry points: a key action and/or a build-bar button ([ui.md](ui.md)), a hint key
   `build.hint.<k>` plus the app's hint mapping, and a case in `window.FL.tool()` (`src/debug.ts`)
   so the smoke test can select it.
6. Keep geometry pure and unit-tested, like `belt-path.ts`, and drive the gesture end-to-end in
   `scripts/smoke.mjs`.

## 7. Pitfalls and known gaps

- **Layouts** (fixed in the architecture pass, guarded by `bindings.test.ts`): zoom keys are
  positional (no more AZERTY `-` on the 6 slot), Ctrl/Cmd chords only mean undo (by letter, so
  AZERTY Ctrl+Z is not a pan), selects keep their keys, a focused button no longer eats Space.
- **The pipette's hint names the layout's key** (fixed 2026-10-15, [ui/keycap.ts](../src/ui/keycap.ts)):
  the build hint says `{pip}`, the letter at `KeyQ` on this keyboard — from the browser's layout
  map (`navigator.keyboard.getLayoutMap()`, Chromium), else from the keys the player presses
  (AZERTY's A⇄Q, Z⇄W swap tells it from the first pan), else the language's guess (`key.pipette`:
  A in French, Q in English) until the keyboard has said. Other hints name mnemonic keys (bound by
  letter), which need nothing. (The remove tool's hint says that the right button demolishes too,
  and Esc puts the tool away.)
- **`wheel` ignores `deltaMode`**: a browser that reports line deltas would zoom very slowly.
- **Mark preview:** `n` does not apply the sim's "occupied tiles are not filled" rule, so it can
  overcount fills. Tile indices hard-code `1024` (`boxTiles`, the mark preview).
- **Stale or unused code.** The `rbox` comment ("works with any tool") is stale: build and ribbon
  tools are put away, and the brush clears marks. Unused: `Tools.pipette` (the app re-implements it
  so it also works in iso), `entityTiles`, `Input.dragging`, `PointerInfo.shift/ctrl`. The
  `edgeScroll` setting exists but nothing implements it.
- **Replaced buildings in the ghost:** GhostView draws `doomed` only inside a demolition box, so the
  entities a placement or drag would replace are listed in the preview but not highlighted yet.
- **Tests:** `belt-path.ts` and `bindings.ts` (`resolveKey`, both layouts) have unit tests; `Tools` is driven by the smoke test, and its build-tool rotation (the ghost over a ribbon, R, `turned`, D98) by [entry-rot.test.ts](../src/sim/entry-rot.test.ts). The drag plan it shows is the sim's `planBelts`, tested in [replace.test.ts](../src/sim/replace.test.ts).

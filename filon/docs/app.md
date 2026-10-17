# The shell (`src/app`, `main.ts`, `debug.ts`, `settings.ts`)

The shell boots the game, owns every part, wires them together and runs the frame. It is the only layer allowed to import everything, and nothing imports it (`src/architecture.test.ts`). It holds no game rules: those live in the engine ([engine.md](engine.md)). It mostly decides **when** things happen: when ticks run, when views rebuild, when the DOM refreshes.

| File | Role |
|---|---|
| [main.ts](../src/main.ts) | Boot: fonts and styles, settings → language and UI scale, boot veil, Pixi stage, atlas bake, founding the colony, the `App`, the main menu, the rAF loop, the echo worker probe, `window.FL` last |
| [app/app.ts](../src/app/app.ts) | `App`: the hub. Constructs and holds the layers, camera, input, views, tools, UI and controllers; `frame(dt)` |
| [app/view.ts](../src/app/view.ts) | `ViewState`: iso ⇄ plan morph (`mode`, `t`, eased `te`, projection `P`), `visibleTiles()` |
| [app/picking.ts](../src/app/picking.ts) | `Picker`: screen ⇄ tile, building under the cursor (iso volume hit-test) |
| [app/build-mode.ts](../src/app/build-mode.ts) | `BuildMode`: open build category, tool in hand, digit slots, hint line, tool-result toasts, reach circle in hand; the land mode (`land`, `landCancel`, D60) |
| [app/screens.ts](../src/app/screens.ts) | `ScreenHost`: full screens (the main menu, research T, stats G, the Crier M, the dev art board), one at a time; optional per-frame `frame(dt)`, `back()` (pages), `opened` / `closed` hooks, `modal`, `zoomKey(how)` (a screen with a zoom of its own takes the zoom keys while open: the tech tree, D111). Also the main menu's shell side: `installMenu` (menu + settings pages, the preferences they write, the HUD hidden, `MenuDrift`, the camera behind the veil; the « Débogage » page and its badge when `debugOffered()`) |
| [app/debug-bases.ts](../src/app/debug-bases.ts) | `installDebugBases`: ready-made bases at a few stages of the game ([sim/scenarios.ts](../src/sim/scenarios.ts)) swapped in for the player's base, which is kept aside untouched, and the way back; `realSim()` is the base persistence must save (see *Debug bases* below) |
| [app/intro.ts](../src/app/intro.ts) | `installIntro`: the intro's shell side ([D31](decisions.md)) — when it plays (a new, unnamed base, once the main menu closes; never under automation, `?nomenu` or `?demo`), the Heart hidden until it lands, the landing's camera, naming the claim, the bus events `intro:land` / `intro:done`. Returns the `IntroShell` that `FL.intro` drives |
| [app/sim-events.ts](../src/app/sim-events.ts) | `drainSimEvents`: `SimEvent` → toasts, bus, view rebuild (one typed handler per kind) |
| [app/views.ts](../src/app/views.ts) | `MapViews`: the specialised views (D88) — which one is on (Normal, Électricité, Logistique, Production, Vent — D95, with the Anémométrie plan —, Terrain = the land mode), `set` / `toggle` / `cancel` (Esc) / `reset` (a colony swapped), and at 4 Hz the active view's readings (`Readouts`: [src/sim/readouts/](../src/sim/readouts/)) for the renderer's `ViewsView` and the side card; the ribbon lines sampled once a second in any view (see *Specialised views* below) |
| [app/controls.ts](../src/app/controls.ts) | `Controls`: key actions and pointer routing (tools in plan, inspection on click); for a finger (D96) `touchTool` (a building is placed by a tap, a ribbon, a box or the brush drag) and `cancelDrag` (a pinch drops a drag) |
| `App.goToFlow` (app.ts) | Where a recurring flow of the purse is managed (D102, the purse's card): a post's sales or a standing order on the Crier's Trade tab (`CrierScreen.focusLine` flashes its line), tokens, the Compute Plan or rental in the tech tree (on the first running project: the research host's `focus`), a lease in the land mode with its parcel picked |
| [app/layout.ts](../src/app/layout.ts) | `installLayout` (D96): the responsive layout's numbers — the zoom (`applyUiScale` again on every resize, orientation change and visual-viewport change: the UI scale × the window's fit), the window in #ui's px (`--win-w/h`), where the HUD ends (`--hud-b`, its right cluster `--hud-rb`) and how tall the open build bar stands (`--bar-h`), measured by ResizeObservers; the renderer re-sized on the next frame when the window changed ([ui.md](ui.md#the-responsive-layout-d96)) |
| [app/sound.ts](../src/app/sound.ts) | `installSound`: what the base sounds like ([audio.md](audio.md)): the first click or key unlocks the audio, a hidden tab mutes it, each frame a world snapshot (the day/night look's hour, the gust level, zoom, items and machines in view, the base's activity) and the cues (bus `sfx`, screens, the morph, selection, button clicks, toasts by kind, spot trades read off the command log); sets `app.sound` |
| [debug.ts](../src/debug.ts) | `window.FL`: the deterministic handle for the console and the smoke test ([testing.md](testing.md)) |
| [settings.ts](../src/settings.ts) | Player preferences, not the colony (language, UI scale, perf mode, « Basse consommation » (D100), edge scroll, the three volumes: general, music, effects and ambience), in localStorage; `applyUiScale()`. Edited by the menu's settings page through `installMenu`; the sound reads the volumes every frame |

## Boot (`main.ts`)

1. Fonts (`@fontsource/*`) and the stylesheets are imported. The locale comes from the settings, else from `navigator.languages`; `<html lang>` and the title follow `locale()` on every switch. `applyUiScale()` sets `--ui-scale`.
2. A boot veil is shown, and `createStage()` initialises Pixi (async; WebGL).
3. `bakeAtlas()` paints all the static art into atlas pages ([render.md](render.md)).
4. **The base** (`bootColony` in [app/persistence.ts](../src/app/persistence.ts), [persistence.md](persistence.md)):
   - Take the one-tab lock (a second tab shows « Reprendre ici »), then open the newest whole save.
   - If more than 2 s is owed, run the catch-up behind the veil (« Le Cœur rattrape le temps passé… »).
   - With no save, found a base (`foundColony(seed)`): a random player seed (1 under automation and `?demo`; `?seed=` forces one), and `foundingEpoch` the current world minute (clamped to `WORLD_EPOCH0`).
   - `?demo` neither loads nor saves. A save that does not open stops the boot (`#err`) rather than found a new base over it.
5. `new App(stage, atlas, sim)` and `installLayout(app)` (D96: the zoom for this window, the HUD's and the bar's measures; the App gave the inspector, the views' card and the land panel their sheet grips), then `installMenu(app, auto)` registers the **main menu** ([D27](decisions.md)) and, when `auto`, opens it, so it is up when the boot veil lifts. `auto` (`menuAuto`) is false under automation (`navigator.webdriver`: the smoke test and the screenshot scripts run headless Chrome and must not find a menu in the way) and with `?nomenu`; `?menu` forces it. Without `auto` the menu never opens by itself (neither at boot nor on Esc); `FL.menu(true)` and the HUD button still open it. « Jouer » opens the absence report first when one is pending (`app.away`, `app.changes`), and so does the boot itself without a menu (`?nomenu`). `installPersistence(app, booted, menu.bases)` follows: autosave, the world clock, the absence screen, `app.persistence`. `?paused` opens the base paused (tests). A probe of a module worker (`sim/echo.worker.ts`) proves that workers bundle in dev and in the preview build.
   Right after, `installIntro(app, auto)` registers the **intro** ([D31](decisions.md)), with `auto` false under automation, `?nomenu` and `?demo`. On a new base (no claim name yet) it hides the Heart at once, so the menu drifts over the empty cirque, and plays when the menu closes (see Screens).
6. `installSound(app, Date.now())` ([D30](decisions.md)): silent until the first gesture. One `requestAnimationFrame` loop: `dt` is clamped to 0.1 s; it calls `updateTweens(dt)`, then `app.frame(dt)`, then `sound.frame(dt)`. With « Basse consommation » on (D100, `settings.lowPower`, read every frame) a `FramePacer` ([core/pace.ts](../src/core/pace.ts)) lets through at most 30 frames a second, whatever the display's rate; the sim follows `dt`, so it keeps its pace.
7. The veil fades, `body[data-ready]` is set (the smoke test waits for it), and `installDebug()` attaches `window.FL`.
8. Boot errors (including unhandled rejections from Pixi's async init) show in `#err`. `index.html` installs the listeners before any module loads.

## The `App` hub

`App` keeps references to everything, so the controllers (and `window.FL`) reach parts through it: `app.view`, `app.picker`, `app.build`, `app.screens`, `app.controls`, `app.tools`, `app.camera`, `app.sim`, the views (`terrain`, `relief`, `buildings`, `items`, `ghost`, `overlays`, `viewsView`, `cargo`, `landing`, `lights`, `clouds`, `windHints`: the wind's rare hints, D95; `gleaners`: the Gleaners at night and the glass hoods, D103), the specialised views (`views`, `viewBar`, `viewPanel`; `focus(id)`: select and glide there; `viewShown(v)`: offered yet), `dayNight` (the time of day's grade and the `FL.dayPhase` offset) and the UI (`hud`, `bar`, `inspector`, `landPanel`, `toasts`, `tip`, `stats`, and the tutorial's `quests` log and `guide`, the night notice `night`, the Gleaners' cards `gleanCard`, D103), the tools (`tools`, `link`, `landTool`). Its own state is small: `selected` (the inspected entity), `paused`, the tick accumulator and the UI clock.

Hosts: UI components never import the shell. Each declares a small host interface (`HudHost`, `BuildBarHost`, `InspectorHost`, `LandHost`, `ViewBarHost`, `ViewPanelHost`, `ResearchHost`, `StatsHost`, `QuestLogHost`, `GuideHost`, `NightNoticeHost`, `GleanCardHost`), and the App passes closures for those. That keeps the UI testable in isolation, and makes it explicit which actions a component may trigger.

### The frame

```
frame(dt)
  view.update(dt); camera.P = view.P; layers.setView(P, te)
  input.frame(dt)
  tickSim(dt)              accumulate dt; run whole 100 ms ticks, ≤ 8 per frame; drop the rest
  drainSimEvents(...)      → if structure changed: buildings.rebuild, items.rebuild, lights.rebuild, bus 'sim:structure'
  grid.dirtyChunks         → terrain.invalidate + relief.invalidate (dug / filled tiles)
  drawWorld(dt)            (under a full screen — `screens.covers`: the tree, the statistics, the Crier — every 0.1 s with the time gathered since, D100) camera → terrain → relief → ghost (+ tip) → link hover → land hover → wires (bold by grid in Électricité) → overlays → the view's veil, marks and badges (`viewsView`, D88) → day/night (dayNight, lights, clouds drifting with the prevailing wind, the wind's hints on the tiles in view: `windHints`, D95) → the Gleaners (`gleaners`, D103) → cargo → landing → buildings (deck lift, moving parts on game time, cast shadows by the grade) → items → stats.sample → stress
  every 0.25 s             views.refresh (the view's readings), hud.refresh, viewBar.refresh, bar.refresh, inspector.refresh, landPanel.refresh, viewPanel.refresh, screens.refresh, guide.refresh, quests.refresh, night.refresh (the night notice, D101), gleanCard.refresh (the Gleaners' cards, D103: fed by the sim's `gleaners` events through the drain's sink)
  guide.frame()            the tutorial's arrow follows its target (camera, panels)
  renderer.render(stage.root)   (only when drawWorld ran)
  reportPerf(...)          numbers for the perf overlay (` key)
```

- **Fixed step**: the simulation is independent of the frame rate. If a frame would need more than 8 ticks (a hitch, a hidden tab), the extra time is dropped there.
- **The world clock** (`Persistence.resync`, [persistence.md](persistence.md)): every 5 s, and when the tab comes back, the time owed beyond 20 ticks is paid with the offline catch-up. `App.caughtUp(report)` restarts the fixed step and rebuilds the views after a long catch-up (`setSim(sim)`). Ten minutes or more opens « Pendant ton absence »; a shorter catch-up shows a toast. The resync waits while the app is paused, while the tab is hidden, while a debug base is in play, and under automation (manual clock: `FL.clock`).
- **Interpolation**: items on ribbons are drawn at `sim.tick + acc / TICK_MS`, so they move smoothly between ticks.
- **Snapping**: the camera snaps to whole pixels only when the morph is at rest (`view.settled`).

## Views: iso and plan (`view.ts`)

- `mode` is the goal (`'iso' | 'plan'`). `BuildMode.open(cat)` asks for plan, `open(null)` for iso, and `FL.view(mode)` switches directly.
- `t` moves linearly towards the goal over `MORPH_S = 0.5` s; `te = ease(t)`; `P = proj(te)` maps tiles to world pixels ([render.md](render.md), projection).
- `view.building` (`te > 0.5`) is the switch for "the plan side is in effect": tools act, the grid shows, picking uses the tile's occupant.
- `visibleTiles()` bounds the screen on the ground and, in iso, on the highest relief, which reveals tiles further down. Overlays and items cull with it.

## Specialised views (`views.ts`, D88)

- `current`: the view on show — the land mode's own state says Terrain (`landTool.active`); else the one chosen. `veiled`: Électricité, Logistique or Production (the base dimmed under them).
- `set(v)`: Terrain turns the land mode on (`BuildMode.land(true)`: tools away, plan view, zoomed out, as always); any other view turns it off first. A view keeps the iso or plan view, the open category and the tool in hand. `toggle(v)` (the keys, the selector's buttons): back to Normal when it is already on. `cancel()` (Esc, after the selection): a veiled view back to Normal.
- `refresh(dt)` at the UI's pace: Électricité `gridReports` + `powerMarks`; Logistique `RibbonSampler.read` + `ribbonSummary`; Production `prodMarks` with the buildings view's `WorkLook.isLit` (a passing stop keeps its grace, D83). Only the active part is filled, `version` bumps; the ribbon lines are sampled once a second in any view so Logistique opens on figures. Emits `mapview:changed` on the bus when the view changes.
- The shell around it: the HUD's energy chip toggles Électricité (`HudHost.openPower`); the inspector's `facet()` is the veiled view (D89); the night glows are dimmed by the veil and the wires faded under Logistique and Production; `setSim` resets the view.
- Read-only: no command, nothing saved (the smoke checks the command log does not grow).

## Picking (`picking.ts`)

- `tileAt(sx, sy)`: the ground tile under a screen point, for the current `P`.
- `seenTileAt(sx, sy)`: the tile as the eye sees it — in plan the ground's, in iso the one the view ray meets first (a rock top or a cliff face, relief.ts `surfaceTile`), else the ground's. The deposit card (D99) reads it.
- `tileToScreen(tx, ty)`: the inverse. The smoke test drives the real mouse with it (`FL.tileToScreen`).
- `entityAt(sx, sy)`: in plan, the tile's occupant. In iso, a building's sprite covers ground behind it, so the nearest entities (a few tiles down-right of the ground hit) are tested by their **volume** — the footprint box lifted to `isoHead(def) × LH` — then by their drawn pixels (the atlas frame's alpha). A ribbon or a conduit (not a traction ribbon: its elevator stands) is a flat piece: only its tile's diamond counts, with no pixel test — as a volume it took the clicks aimed at the trade post's apron behind it (owner, 2026-10-14; the smoke checks ≥ 95 % of the post's ground picks the post). The front-most one wins (`buildingZ`, `standOf`). Falls back to what the cursor's ray meets first (`surfaceTile`).

## Construction (`build-mode.ts`)

- `category`: the open tray of the build bar (null = not building). `toggle()` re-opens the last category.
- `pick(def, rot?)`: takes a building in hand (refused with a toast while locked), opens its category, and drops the selection.
- `demolish()` and `mark()` toggle the demolition tool and the landscaping brush; they open the build bar if needed.
- `slot(n, shift)`: the digit row. Shift + digit opens the n-th category tab shown (`bar.categoryAt`: categories with nothing unlocked have no tab); a plain digit takes the n-th building of the open tray (only unlocked buildings are in it, [ui.md](ui.md#the-build-bar)).
- `hint()`: the bar's help line for the tool in hand. `report(ToolResult)` turns placements, refusals (with the reason; off the claim's land, `outside_zone` or `neighbour_land`, the land mode's key after it: « · I : acheter ou louer »), removals and marks into toasts.
- **The land mode** (D60, [ui.md](ui.md#the-land-mode-and-its-panel-d60), [input.md](input.md#4c-land-toolts-the-land-mode-d60)): `land(on?)` toggles it (through the Terrain view: I, the view selector's parcel; D88). On: the tool in hand and the Link tool put away, the selection dropped, `LandTool.start()`, the plan view, the camera glided out to zoom 0.36 at most (a parcel about 180 px; the zoom before is kept). Off: the zoom given back, and the iso view unless a category is open. `pick`, `demolish`, `mark`, `link` and `open` end it first (`endLand`, the view left to them). `landCancel()` is Esc's and the right click's step: the picked parcel, then the mode. Each frame `App.drawWorld` sets `LandTool.hover` from the pointer (`picker.tileAt` → `parcelUnder`), hands hover, pick and `landOn` to the overlays, and shows the parcel's price in the tip; the land panel (`App.landPanel`) refreshes at 4 Hz with the other cartouches; `setSim` ends the mode.
- `ghostReach()`: the reach circle of an excavator or backfiller held in hand (drawn by the overlays view).

## Screens (`screens.ts`)

`ScreenHost.register(id, screen)` with `screen = { root, refresh() }`. `open(id)` toggles: opening the open screen closes it, `open(null)` closes any. It emits `screen:opened` / `screen:closed` on the bus. Only the open screen refreshes at 4 Hz. The dev art board is registered on first use by `FL.open('artboard')`.

Optional parts of a `Screen`:
- `frame(dt)`: every frame while open (the Crier's orbital view, the menu's camera drift).
- `back()`: Esc steps back inside the screen (a page) and returns true; false lets `ScreenHost.back()` close it.
- `opened()` / `closed()`: called once the screen is in or out of the page.
- `modal`: while it is open, `screens.modal` is true and the game's keys wait: `Controls.action` lets only Esc and the perf overlay through, the digit row is ignored (`onSlot`), and the keyboard pans (`input.frame`) are skipped.

`escapeTo` is the screen Esc opens once nothing is left to unwind (`'menu'` when the menu is automatic, else null).

**The main menu** (`installMenu`, [ui.md](ui.md#the-main-menu-and-the-settings)): registers `'menu'` as a modal screen built from `MainMenu` and its `SettingsScreen` page. The settings host stores each change (`settings`, `saveSettings()`) and applies it: `setLocale` (live), `applyUiScale()` (live), the perf mode (next launch), « Basse consommation » (`setLowPower`: the frame cap at once, the GPU's choice at the next launch, D100), the volumes (`setVolume`: live while the slider moves — the sound reads them every frame —, stored on release, when the effects sliders also play a cue at the new level). On open: `body[data-menu]` (the HUD fades out), the drift starts, « Jouer » takes the focus. On close: the attribute goes, the camera glides back to where it was, the menu returns to its buttons. `MenuDrift` frames the colony to the right of the menu column (an offset of 16 % of the width, 12 % wider), then sways slowly (periods of 53 to 83 s, offsets in screen px through the current projection); with reduced motion it only frames. The colony keeps ticking behind the menu (a persistent world). It returns a `MenuShell` (`open(page?)`, `close()`, `isOpen()`) that `FL.menu` drives.

**Debug bases** (`installDebugBases` in [app/debug-bases.ts](../src/app/debug-bases.ts), wired by `installMenu`; the page in [ui.md](ui.md#the-main-menu-and-the-settings)): offered when `debugOffered()` — the dev server (`import.meta.env.DEV`) or `?debug` on a preview build; `installMenu(app, auto, debug?)` can force it. Six levels (`SCENARIO_IDS`: `claim`, `smelter`, `survey`, `tutorial`, `grown`, `late`), each built on the player's own land (its `playerSeed`) by the scenario builder ([sim/scenarios.ts](../src/sim/scenarios.ts), on the layout kit at the end of [sim/dev.ts](../src/sim/dev.ts): real commands and real time, every spot read off the map — coordinate-free —, founded at the last sunrise before the player's current minute so the build runs in full sun). `load(id)` builds one (1–250 ms in Chrome, the late base about 600 ms) and swaps it in with `App.setSim`; the menu closes and a toast says what was built and how long it took (`console.info` lists what the build forced, skipped or granted, if anything).
- **The player's base is never touched.** The first load keeps the player's `Sim` aside exactly as it stands — frozen: nothing ticks it or sends it a command while it is aside — together with its statistics history; loading another level replaces only the debug base; `restore()` (« Revenir à ma concession », on the page and on the badge) swaps that very object back, so it returns as it was left, same hash (checked headless: load, play, come back). Every debug base is named (`debug.claimName`), so the intro never plays on one; the Heart the intro hides on a new base is shown again on a swap.
- **Persistence**: the autosave writes `bases.realSim()` (the player's base, aside or in play), never a debug base. The resync waits while one is in play, and catches the player's base up once it is back. A debug base is never saved, so the boot never loads one.
- **The badge** (`DebugBadge`, `[data-debug-badge]`): a small dashed chip at the end of the HUD's research row (`Hud.pin`) while a debug base is in play — « ⚑ <level> » and a « ↩ » button back to the claim (`[data-debug-back]`; « Revenir à ma concession » in its tooltip). It flows with the row, never over the world (owner, 2026-10-14: the old badge at the top centre blocked the game).
- `installMenu` returns them as `MenuShell.bases` (null when not offered); `FL.debugSaves()` / `FL.debugSave(id | null)` drive them ([testing.md](testing.md)).

**The intro** (`installIntro` in [app/intro.ts](../src/app/intro.ts), [D31](decisions.md); the story in [lore.md](lore.md#the-intro)): registers `'intro'`, a modal screen built from `IntroScreen` ([ui/screens/intro.ts](../src/ui/screens/intro.ts)). The flow on a new base: main menu → « Jouer » (or Esc) → the comic strip (three panels) → CrierBelt's register (the company's name) → the landing → play. The intro opens on the bus's `screen:closed` for the menu, in a microtask (after `ScreenHost.open` has finished, before anything is drawn), so no frame shows the bare world in between and the quest log's naming modal never sees "no screen up" first. It plays once a session and only while the claim has no name: a named base, automation (`navigator.webdriver`), `?nomenu` and `?demo` skip it, and the naming modal of quest 0 stays the fallback. While it runs, `body[data-intro]` hides the HUD.
- **The Heart out of sight**: `BuildingsView.hide(id)` and `LightsView.hidden` (no glows, no solar overlay) from boot until touchdown. Pure looks: the sim has the Heart from tick 0.
- **The register**: the name goes through `checkName` ([ui/screens/intro-name.ts](../src/ui/screens/intro-name.ts)): `cleanName`'s length rules, then no other claim's name (either language), nothing of CrierBelt's or the world's (`registerOf(sim)`); case-, accent- and dash-insensitive. A promise: the future server plugs in as `NameRegister.remote`. The naming modal and renaming in the quest log apply the same local rules (`nameVerdict`).
- **The landing**: the signed name starts `app.landing` (`LandingView`, [render.md](render.md#10-world-views)) on the Heart's footprint, in iso. Each frame the shell sets the shot with `camera.jumpTo` from the landing's clock: zoom 0.78 → 1, the view raised by half the load's altitude (at most 250 world px), a short decaying jolt at touchdown. At touchdown the real Heart (and its lights) comes back under the landing's own sprite and the bus gets `intro:land`; 1.9 s later the claim takes its name (`sim.nameColony`: quest 0 completes, its toast and stamp show as the HUD fades back in); the frame opens, and at the end (`LAND_END`, about 8.6 s) the screen closes, the camera home on the Heart, and the bus gets `intro:done`.
- **Skipping**: « Passer » / Esc during the story jump to the register, never past it; on the register Esc does nothing (the name is the point); during the landing they hurry it to its end (the name registered, the camera home). Closing it early (`FL.intro(false)`) restores everything, registering a name if one was signed.
- It returns an `IntroShell` (`pending()`, `open(at?)`, `close()`, `state()`) that `FL.intro` drives.

## Sim events (`sim-events.ts`)

`HANDLERS` is a mapped type `{ [K in SimEvent['k']]: handler }`, so adding a `SimEvent` kind in `src/sim/commands.ts` fails to compile until it has a handler here. Current handlers:

| Event | Effect |
|---|---|
| `structure` | after the drain: rebuild the building, item and light views; bus `sim:structure` (the UI refreshes on its own clock) |
| `epoch` | bus `sim:epoch` (M8: quests) |
| `research` | toast (node learnt, or a save's reconversion done: retired since D107); bus `sim:research-done` |
| `dug` | a toast per embedded-ore find |
| `filled` | nothing extra: the chunk repaint covers it |
| `trade` | `App.lift`: a CrierBelt cargo drone hauls a sale's container up from the post's deck (`CargoView.launch`). The lift is also queued for the orbital view (`takeLifts` of the Crier screen). `setSim` grounds every drone (`CargoView.clear`) |
| `delivered` | a toast « Livraison : n × item », and `App.land`: the cargo drone brings the container down onto the post (once per post per tick, D43) |
| `gazette` | toasts for announced events (with the time until they start) and started ones (`src/ui/gazette.ts`) |
| `quest` | a toast « CrierBelt : objectif atteint — name · reward » (`questToast`, `src/ui/quest-log.ts`); the quest log stamps itself on its next refresh |
| `expertise` | (D93) a rank earned — « Expertise acquise : Abattage II », once the Core mounts the Archive — or a reoriented slot in place after its 24 h — « Expertise en place : … »; cue `research` |
| `land` | a parcel changed hands (D60): `bought` / `leased` a notice with the parcel's name and what it cost (« Parcelle achetée : 3 E (−353,60 ◉) », cue `purchase`), `ended` an info notice, `lapsed` a warning (the purse could not pay the hour: what stands there is dormant; cue `notice`), `rent` nothing (the purse shows it). All but `rent` rebuild the views (buildings wake or sleep) |

Most handlers also emit their sound cue on the bus (`sfx`, [audio.md](audio.md)): `research`, `quest`, `lift` (`trade`), `delivered`, `notice` (`gazette`), `vein` (`dug` with ore). The build tools' cues come from `BuildMode.report` / `reportLink` (placed, ribbon tiles, removed, marks, refusals, wires) and the inspector's demolition from `App.removeEntity`.

## Controls (`controls.ts`)

- **Pointer**: with a tool in hand on the plan side, down / move / up go to `Tools`, and the result is reported. A plain left click with nothing active selects `picker.entityAt(...)` (only over the canvas, not over the UI) — or, while the Link tool is in hand (either view), goes to `link.click(id, shift)` and `BuildMode.reportLink`; in the land mode it picks the parcel under the cursor (`landTool.click`); a click on bare ground also pins the deposit card there (`depositCard.tap`, D99: how a finger asks for it, [ui.md](ui.md#the-deposit-card-d99)). A right press unwinds the Link tool (its source, then the tool), then the land mode (its parcel, then the mode), before anything else.
- **Keys** (`input/bindings.ts` maps physical keys to `Action`s): perf overlay, home (glide to the Hearth), build toggle, rotate (Shift: back), pipette (A on AZERTY: copy the building under the cursor with its rotation), demolish, brush, the Link tool (L), research and stats screens, the specialised views (D88: Électricité P, Logistique F, Production O, Vent V — D95 —, Terrain I — the land mode — each toggling with Normal through `MapViews.toggle`, offered once the tutorial has reached them, Vent once the Anémométrie plan is learnt: `App.viewShown`), zoom.
- **Esc** unwinds one layer at a time: open screen (a page of it first: `screens.back()`) → the HUD's Stock panel (D96) → the purse's card (D102) → the Link tool (its source, then the tool) → the land mode (its parcel, then the mode) → tool → selection → a specialised view (back to Normal: `MapViews.cancel`) → build mode → the main menu (`screens.escapeTo`; not under automation).
- **The main menu is modal**: while it is open only Esc and the perf overlay act (see Screens).

## Recipes

**Add a full screen**
1. `src/ui/screens/<name>.ts`: a class with `root: HTMLElement` and `refresh()`, and a host interface for what it may do ([ui.md](ui.md)).
2. Add the id to `ScreenId` in `src/core/kinds.ts` if it is new.
3. In `App`'s constructor: `this.screens.register('<id>', new XScreen(atlas, { … }))`.
4. A key: an `Action` in `src/input/bindings.ts` and a `case` in `Controls.action` → `app.screens.open('<id>')`. A HUD button through `HudHost` if wanted. Pages inside the screen: implement `back()`.
5. i18n keys in `fr.ts` and `en.ts`; `FL.open('<id>')` works automatically; add a smoke step ([testing.md](testing.md)).

**React to a new engine event**: add the variant to `SimEvent` (`src/sim/commands.ts`), then its handler in `HANDLERS`. Keep the handler cheap: it runs inside the frame.

**Add a key action**: `Action` + binding in `bindings.ts`, then a `case` in `Controls.action`. Document the key in the plan's controls table, and in [input.md](input.md) if it is a new kind of control.

**Swap the colony** (a debug base and back, `FL.simulateAbsence`, a long resync): `app.setSim(sim)`. Import and start over reload the page instead, through the boot. It resets the selection and tools, rebuilds the views, repaints the land where it differs (all of it on another player seed, else the chunks either colony dug or filled: the terrain and relief views read a live view of `app.sim.grid`), and clears the statistics history and the cargo lifts queued for the orbital view (they belong to the colony before); `sim:structure` goes out on the bus.

## Known gaps

- The catch-up runs on the main thread (the `late` debug base: 8 h in about 1.3 s, a week in about 16 s since its windy grid and the tile-by-tile ribbons — [offline.md](offline.md#performance)); a Worker comes when a big base makes the resync visible ([persistence.md](persistence.md)).
- The HUD's rates start their minute afresh on a new colony (`knownSim`) and after a catch-up (more than `3 × TPS` ticks between two one-second samples), so a resync never shows as a burst.
- `paused` only stops ticking. There is no pause UI yet.

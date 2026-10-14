# Persistence (M7): the base is kept, and the world keeps time

One persistent base per player ([D1](decisions.md)), unlimited offline production ([D2](decisions.md)). This page covers how the base is stored, opened, caught up and moved between devices, and the rules a change must keep. The engine's save format is in [engine.md](engine.md) (`serialize.ts`). The catch-up itself is in [offline.md](offline.md).

## The layers

| Part | File | Does |
|---|---|---|
| Content table, remap | [sim/save-remap.ts](../src/sim/save-remap.ts), [content/retired.ts](../src/content/retired.ts) | A save carries the content table it was written against. Loading re-points every index by id ([D47](decisions.md)). |
| Store | [persist/kv.ts](../src/persist/kv.ts) | `KV`: IndexedDB in the browser, `MemoryKV` in tests (and when storage is refused) |
| Envelope | [persist/envelope.ts](../src/persist/envelope.ts) | Header and gzip payload, an FNV-1a checksum of the bytes, and the export text (`.ocelle`) |
| Slots | [persist/slots.ts](../src/persist/slots.ts) | `SaveSlots`: a / b alternation, `prev`, the `pre-*` copies, `candidates()`, `putNewest()` |
| Migrations | [persist/migrate.ts](../src/persist/migrate.ts) | `MIGRATIONS[v]`: version v → v + 1, chained; `SaveTooNew`. Today's steps: 1 → 2 (`ribbonsToCells`, D57: a ribbon's parcels become cells, packed from its head, what does not fit and parts of items to the Heart; conduits keep their runs; the throughput credits go); 2 → 3 (`zonesToParcels`, D60: the influence zones' reclaimed tiles (`claimed`) go, and the claim is granted every parcel a building that needs land stands on, waystations included, in `land.granted`; granted parcels raise no price, so no base loses a machine or pays for land it already used); 3 → 4 (`postsToPads`, D62: the 3×3 trade posts come down — their content id renamed `trade_post_3x3`, retired: the remap refunds them and hands their containers to the Heart — with their export streams and standing orders; goods in flight to them land in the Heart); 4 → 5 (`streamsToCargo`, D64: the export streams go; a post's cargo is what its orders buy, what is on its way to it and the purchases its container holds — what its streams did not sell); 5 → 6 (`pylonsToTowers`, D75: the 1×1 pylons' content id becomes `pylon_1x1`, retired: refunded, their wires gone; the new pylon is 2×2) |
| One tab | [persist/lock.ts](../src/persist/lock.ts) | A Web Lock plus a BroadcastChannel « takeover » |
| Opening, the clock | [persist/colony.ts](../src/persist/colony.ts) | `openSaved`, `rebuild`, `worldMs`, `owedTicks`, `catchUpTo`, `saveNow` |
| Shell | [app/persistence.ts](../src/app/persistence.ts) | `bootColony` (boot), `Persistence` (autosave, resync, export / import / wipe, stepping aside), `installPersistence` (the absence screen, the boot report) |
| UI | [ui/screens/absence.ts](../src/ui/screens/absence.ts), [ui/screens/conflict.ts](../src/ui/screens/conflict.ts), the « Sauvegarde » row of [ui/screens/settings.ts](../src/ui/screens/settings.ts) | « Pendant ton absence », « Ta base est ouverte dans un autre onglet », export / import / start over |

`persist` may import `core`, `content`, `market` and `sim` (`architecture.test.ts`). The shell wires it.

## Storage

- **Database**: IndexedDB `ocelle`, one object store `saves`. It is `ocelle-sandbox` under `navigator.webdriver` (the smoke test, screenshot scripts) or with `?sandbox`, so a test never touches a real base. `?demo` neither loads nor saves. IndexedDB is per origin: the dev server (:5183) and the snapshot (:5190) keep separate bases.
- **Slots**: `a` and `b` alternate. Each envelope has a sequence number, and the newest whole one wins. `prev` is refreshed at most every 10 minutes. `pre-import`, `pre-migration` and `pre-wipe` are written before those steps. A damaged slot (checksum) is skipped. The next save goes to the other slot, numbered past every slot seen.
- **Envelope**: `{ format: 'ocelle', version, appVersion, savedAt, tick, colonyName, seq, checksum, payload }`. The payload is `gzip(JSON(SaveData))` (`CompressionStream`). The `late` debug base is about 32 KB of JSON before gzip.
- **Export file** (`<name>-YYYY-MM-DD.ocelle`): the same envelope as JSON text, with the payload in base64. `fromText` refuses anything that is not whole.
- **localStorage**: `ocelle.exported.v1` (the last export, for the 7-day reminder). The older `filon.*` keys (settings, guide, quest log) keep the working title on purpose ([D46](decisions.md)).

## Boot

`main.ts` → `bootColony(q, foundColony, status)`:

1. **Lock** `<db>-colony`. If another tab holds it, the conflict panel offers « Reprendre ici ». `takeOver` posts « takeover »: the first tab saves, lets go and freezes behind the same panel (its button reloads). The second tab then waits for the lock.
2. **Open** the newest whole save that opens (`openSaved`): unseal → `migrate` → `remapSave` → `deserialize` on `new MapGen(worldSeed, playerSeed, mapV ?? 1)`: the land the base was founded on (below). If a load had to change anything (a migration, a content note), the original is copied to `pre-migration`. A save from a newer build (`SaveTooNew`), or whole saves that all fail to open, **stop the boot** (the error box). A new base is never founded over them.
3. **No save**: found a base on a land of its own (a random player seed from `crypto.getRandomValues`; seed 1 under automation and `?demo`; `?seed=` forces one). Its first seconds are ticked to the wall clock. It is saved at once.
4. **Time owed** = now − (`foundingEpoch`·60 000 + `tick`·100 ms). If it is over 2 s, the veil says « Le Cœur rattrape le temps passé… » and `catchUpTo` runs the catch-up on the main thread (a 7-day absence of the `late` debug base: about 0.65 s in Node), then `sim.checkQuests()`.
5. `installPersistence`: an absence of 10 minutes or more in which something happened (`eventful`) becomes `app.away`, and « Jouer » opens the report (without a menu, `?nomenu`, it opens at once). A shorter one becomes a toast. What the content remap changed (`app.changes`) is shown on the same screen.

## While the base runs

- **Autosave** (`Persistence.save`): every 30 s, 2 s after the last `sim:structure`, when the tab hides, on `pagehide` and on `freeze`. Saves run one at a time (a promise chain), so the slots alternate cleanly. It always saves `realSim()`: the player's own base, even while a debug base is in play. A failure shows a toast. `navigator.storage.persist()` is asked once.
- **The world clock** (`Persistence.resync`): a hidden tab pauses rAF, and `App.tickSim` drops time past 8 ticks a frame. So every 5 s, and when the tab comes back, the time owed beyond 20 ticks is paid with the same catch-up. Then `App.caughtUp` rebuilds the views after a non-direct catch-up, and 10 minutes or more opens the report. It is skipped while paused, while the tab is hidden, while a debug base is in play, and when the clock is manual.
- **Manual clock**: under automation the clock is manual by default. The smoke drives time itself (`FL.tick`, `FL.simulateAbsence`), and `FL.clock('live')` switches the clock back. `?paused` opens a base paused, so a hash read after a reload is the base as it was loaded.
- **Export / import / start over** (Settings → « Sauvegarde »):
  - **Export** saves first, then downloads the file.
  - **Import** shows a summary (name, buildings, Heart level, date) and asks for confirmation. It then saves the current base, copies it to `pre-import`, writes the file as the newest save (`putNewest`) and reloads. The boot then opens it and pays the time since it was written.
  - **Start over** asks the player to type « recommencer » / "start over". It copies the base to `pre-wipe`, deletes a, b and prev, and reloads onto new land (the intro plays again).
  - A reminder toast comes when the base is a week old and was not exported for a week, because Safari clears site storage after 7 days without a visit.

## « Avant de partir »: the absence forecast

A page of the main menu ([ui/screens/forecast.ts](../src/ui/screens/forecast.ts), D49), where a player goes before closing the game.
- **What it does**: `forecast(sim, ticks)` ([persist/colony.ts](../src/persist/colony.ts)) copies the base on screen (serialize → JSON → deserialize on the same `TerrainSource`) and runs **the very catch-up** that will pay that absence on the copy. The base itself does not move.
- **It is exact**: the copy ends where the real catch-up ends (`persist.test.ts`: same hash, same production, same ocelles), as long as the player changes nothing. The Crier's prices and the weather are functions of the world clock, so they are in it too.
- **The page**:
  - The player picks 1 h, 8 h, 24 h or 3 days.
  - The page says what stops first and when (`firstStop`: a store full or empty, the power short, the accumulators flat, an order paused), or that nothing stops (and whether production is still lost to full stores).
  - Then the ocelles at the return, and the same panels as the absence report (`reportPanels` in [ui/screens/report-panels.ts](../src/ui/screens/report-panels.ts)).
- **Cost**: one catch-up per choice, never at the 4 Hz refresh. 8 h of the `grown` debug base takes about 0.1 s in Chrome.
- **Debug**: `FL.forecast(hours)` returns the ticks, mode, first stop (kind, item, minutes), ocelles, production and the copy's hash. Selectors: `[data-act="forecast"]` (the menu button), `[data-forecast-hours="1|8|24|72"]`, `[data-forecast-body]` (`[data-busy]` while it runs), `[data-forecast-stop]` (the first stop's kind, empty when none).

## The map a base stands on (D63)

The land is generated, not saved, so a change to the generator would move it under every base. The generator is therefore versioned: content `MAPS` holds each version's parameters, `MAP_VERSION` is the one new bases take (2). A base's save carries its version as `mapV` (an optional top-level field, `FIELDS` plain; written from `sim.grid.source.mapV`). A save without it was written before map versions: it is on map 1, and `rebuild` opens it there (`mapV ?? 1`). It writes `mapV: 1` from its next save on. No `SAVE_VERSION` step: the field's default is the old land. A version this build does not know throws in `MapGen`, so the save does not open (like a newer save version). The forecast copies the base on its own source. The debug bases and the tests take `MapGen`'s default, today's map. Changing the land means adding a `MAPS` entry; [mapgen.test.ts](../src/sim/world/mapgen.test.ts) pins map 1 tile for tile, and [persist.test.ts](../src/persist/persist.test.ts) reopens a save without `mapV` on map 1 at the same hash.

## Rules for changes

- **The land**: never change what an existing map version generates; add a version (above).
- **A new saved field**: optional in `SaveData`, with a default on load ([engine.md](engine.md)). Declare it in `FIELDS` (or `TRADE_FIELDS`) in [save-remap.ts](../src/sim/save-remap.ts): `plain`, `index` (holds content indices: remap it there) or `refs` (entity ids: filter it when a building comes down). TypeScript refuses the build until the field is declared.
- **Content**: inserting or reordering items, buildings or recipes needs nothing. **Renaming** an id: add `old → new` to `RENAMED` in [content/retired.ts](../src/content/retired.ts). **Removing** a building: add its cost to `RETIRED_COSTS`, so saves that hold one are refunded (its store goes to the Heart). The waystation (`outpost`) is the one retired so far (D60). Changing a recipe's inputs or outputs resets its machines (their buffers go to the Heart). Whatever is gone is listed on the report.
- **The save's shape**: bump `SAVE_VERSION` and add a step to `MIGRATIONS` with a test on a fixture save.
- **Nothing vanishes** ([ARCHITECTURE.md](../ARCHITECTURE.md) invariant 4). On load, a ribbon line that no longer compiles the same hands its items to the Heart (`deserialize`).

## Debug hooks

`FL.save()` (hash and seq), `FL.saves()` (slots: seq, savedAt, bytes, ok), `FL.simulateAbsence(h)` (saves, rebuilds from that save, catches up h hours and opens the report; the base's clock is then ahead of the wall clock), `FL.exportText()`, `FL.importText(text)` and `FL.wipe()` (both reload), `FL.clock('live' | 'manual')`, `FL.absence(open?)`. Selectors: `[data-screen="absence"]`, `[data-absence-panel="heart|made|crier|log|changes"]`, `[data-absence-ok]`, `[data-screen="conflict"]` (`[data-left]` in the tab that stepped aside), `[data-conflict-take]`, `[data-save-act="export|import|wipe"]`, `[data-save-note]`, `[data-save-file]`.

## Tests

[persist/persist.test.ts](../src/persist/persist.test.ts) (gzip round trip, one flipped byte, the export text, a/b alternation and fallback, `prev`, the wipe, migrations, opening at the same hash, 8 hours caught up), [sim/save-remap.test.ts](../src/sim/save-remap.test.ts) (every field declared; a reordered table; a rename; a removed building refunded; a changed recipe), `serialize.test.ts` (a skipped tutorial keeps its quest baselines), and [sim/land.test.ts](../src/sim/land.test.ts) (the land survives save → load at the same hash; a version-2 base migrated by `zonesToParcels` keeps its kiln awake, is granted its parcel and pays the same price for the next one). Smoke: the save note, a reload at the same hash, `simulateAbsence(8)` under 15 s with production, export → start over → import at the same hash, and a second tab taking over.

## Known gaps

- The catch-up runs on the main thread, behind the boot veil or between frames. That is fine at today's sizes (a week in under a second). Move it to a Worker (serialize → catch up → serialize back) when a big base makes a resync visible.
- A `pagehide` save is started but not guaranteed to finish: the base may lose up to the last 30 s of the player's actions (never time: the catch-up covers the gap from the save's tick).
- The command log is not saved, so a loaded base cannot be replayed from its founding ([engine.md](engine.md)).
- Under automation the browser's Web Locks are real: two pages of one smoke context share the sandbox lock.

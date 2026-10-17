# Audio (`src/audio`)

Everything Ocelle plays is synthesized in code with the Web Audio API: no music file, no sample, no download ([D30](decisions.md)). Like the ink art, the sound is generated: an ambient score that never loops and follows the world clock and the base's activity, a bed of wind and machines, short, soft cues for the interface and the game's events, and a sound signature for each building ([D120](decisions.md)). The mood is the one of [lore.md](lore.md): a remote automated base in a pastel desert under a constant wind — quiet, wide, a little lonely, warm by day.

Browsers keep audio locked until the player does something: the sound starts on the first click or key (the main menu's « Jouer » in practice). A hidden tab fades out and suspends it. Where there is no Web Audio (Node in the tests, an old browser) every call is a no-op; if the engine ever throws, sound turns itself off with one console warning and the game goes on.

## Files

| File | Role | Pure (unit-tested in Node) |
|---|---|---|
| [theory.ts](../src/audio/theory.ts) | Pitch material: four modes on D, MIDI ⇄ Hz, chords in thirds, the progressions' weights, the pads' upper structures, voice leading, the melody's ladders | yes |
| [director.ts](../src/audio/director.ts) | The musical director: `moodAt(hour)` (time of day → mode, tempo, brightness, density, registers), `pulseLevels(activity, night)`, `activityOf(running)`, and the generative `Score` | yes |
| [sequencer.ts](../src/audio/sequencer.ts) | The look-ahead clock: eighth-note steps with exact audio times, a tempo that may change, missed steps skipped after a stall | yes |
| [levels.ts](../src/audio/levels.ts) | The mix: dB maths, the sliders' squared taper, `DEFAULT_VOLUMES`, the bus trims `MIX`, the voice levels `VOICE`, the ambience levels `AMB` | yes |
| [cues.ts](../src/audio/cues.ts) | The cues' behaviour: generic or specific, priority, gap, trim, measured peak (`CUES`); `arbitrate`, `RateLimiter`, `ribbonTicks` | yes |
| [buffers.ts](../src/audio/buffers.ts) | Generated raw material: white and pink noise, the rattle's click train, the reverb's impulse response, the safety clipper's curve | yes |
| [synth.ts](../src/audio/synth.ts) | The score's instruments (pad, bass, mallet, pluck, knock, shaker) and the envelope helpers | Web Audio |
| [ambience.ts](../src/audio/ambience.ts) | Wind, machine bed, ribbon rattle: three loops whose levels and filters follow the world | Web Audio (its level curves are pure) |
| [sfx.ts](../src/audio/sfx.ts) | The cues' recipes (`RECIPES`), built from two primitives, `tone` and `hiss` (with an optional amplitude modulation, `am`), exported for the signatures with `chordNote` | Web Audio |
| [signatures.ts](../src/audio/signatures.ts) | The buildings' signatures (D120): the table by kind and by id (`KIND_SIGNATURE`, `ID_SIGNATURE`, `signatureOf`, `SIG_OF_DEF`), their trims and measured peaks (`SIGNATURES`), the two variants (`VARIANTS`), the spatial fade (`spatialGain`, `spatialPan`), `mergeSignatures`, `SigLimiter` | yes |
| [signature-sfx.ts](../src/audio/signature-sfx.ts) | The signatures' recipes (`SIG_RECIPES`) and the build's shared set-down | Web Audio |
| [engine.ts](../src/audio/engine.ts) | `SoundEngine`: the mixer graph on any `BaseAudioContext` (live or offline), the score's scheduling, `play(cue)`, `playSignature(sig, variant, gain, pan)`, `setVolumes`, `describe()` | Web Audio |
| [sound.ts](../src/audio/sound.ts) | `Sound`: the front door for the shell — owns the `AudioContext`, unlock, hidden tab, the per-frame cue and signature queues, failure handling, `describe()` | Web Audio, no-op without it |

The shell side is [app/sound.ts](../src/app/sound.ts) (`installSound`): it is the only code that tells the audio layer what happens. **Layering**: `src/audio` imports only `core` (and may use `content` / `i18n`); it knows nothing of the sim, the renderer or the UI. Only the shell imports it, and Web Audio is used nowhere else ([architecture.test.ts](../src/architecture.test.ts)).

## How it runs

```
main.ts loop: app.frame(dt) → sound.frame(dt)               (app/sound.ts)
  volumes from settings (change-only) · world snapshot · cues queued since the last frame
  Sound.frame(world): arbitrate the cues → rate-limit → engine.play(…) → engine.update(world)
  SoundEngine.update: the sequencer hands out the steps of the next 0.35 s → Score.step(i) → instruments,
                      scheduled at exact audio times; the ambience glides (≤ 15 writes / s)
```

The world snapshot (`SoundWorld`) is plain numbers the shell reads each frame: the hour and night factor of the day/night look (`app.dayNight.grade`, so `FL.dayPhase` moves the music too), the weather's gust level (`gustPermille`, the gust part of the wind the turbines see, D95), the camera zoom, the items drawn on ribbons in view, whether a full screen or the menu covers the base, and — four times a second, from a scan of the flow graph — the machines running in the whole base (`activity`) and those in view (weighted towards the centre, with a stereo pan).

### The mixer

```
score voices ─→ music ─────────────────────────→ ┐
      ├─ echo (ping-pong, dotted quarter) ─→ music │
      └─ reverb send ─→ musicWet ──→ ┐             ├─→ master (master slider × visible)
cue recipes ─→ sfx ────────────────────────────→ ┤       → high-pass 22 Hz (DC / sub guard)
      └─ reverb send ─→ sfxWet ───→ reverb (3.2 s) ┘       → limiter (−4 dB, ratio 20) → make-up trim
wind, machines, ribbons ─→ ambience (ducked −5 dB under a veil) ─→ master    → soft clip (> −2 dBFS) → out
```

Each bus runs at its slider's gain: `sliderGain(s) = s²` (half way ≈ −12 dB). The effects slider drives the cues **and** the ambience. The reverb's sends sit behind their bus volume, so turning the music down also turns its reverb down. The limiter's automatic make-up gain (browsers add one) is cancelled right after it (`LIMITER_MAKEUP_DB`, measured), so everything under the threshold passes at unity.

## The score

**The day turns around one centre, D.** Each part of the day has a mode; one to three notes change at each turn, so the colour moves while the music stays itself. Mode changes wait for a chord change, and a new mode opens on its tonic chord. The continuous values follow keyframes over the 24 hours, smoothly joined (`KEYS` in `director.ts`).

| Part (hours) | Mode | Tempo | Pads | Melody |
|---|---|---|---|---|
| Night (20:30–04:00) | Dorian | 54 | low, near-sine (cold), dark, long chords (4–8 bars), thinner bass | rare, short phrases, high, glass-like (inharmonic partial), long reverb |
| Dawn (04:00–07:30) | Lydian (the ♯4: luminous) | 58–63 | opening up | coming in |
| Day (07:30–17:30) | Ionian | 63–66 | warm soft saws, brightest, chords of 2–4 bars | fullest: a phrase every few seconds, kalimba-like |
| Dusk (17:30–20:30) | Mixolydian (the ♭7: warm, golden) | 60 | warm, lowering | lower, warmer |

- **Harmony.** Chords are stacked thirds inside the mode, drawn by weight from the mode's progression (home first, then the modal chord: Lydian's major II, Mixolydian's ♭VII, Dorian's major IV), never twice in a row, home growing likelier the longer the music is away. The pad voices three upper tones (add9-flavoured sets, never a ♭9 over the root) as close as possible to the previous chord, avoiding unisons and semitone rubs; the bass takes the root under the pads.
- **Melody.** Phrases of 2–6 notes (2–4 at night) separated by rests of several beats; a random walk on the mode's ladder (pentatonic at heart, plus the mode's colour note), mostly by steps; strong beats lean on chord tones and the phrase ends on one. Some phrases answer a remembered rhythm or echo a remembered contour, so it sounds composed rather than random.
- **Pulses.** The base's activity (`1 − e^(−running/10)`, running machines, drills and burning coal generators) earns a little rhythm: a soft wooden knock on the bar (a few machines), shakers on off-beats (a working base), a plucked arpeggio of the chord (a busy one). The night halves them.
- **It never loops.** Everything is drawn from a seeded generator (a new seed every session), so the score is endless; `director.test.ts` checks that no 12-note stretch of melody (pitch and rhythm) ever comes back.
- **The effects play along.** Tonal cues take their notes from the chord in force (`Score.harmony()`): a placement or a research done is in key with the music.

## The ambience

| Layer | Sound | Follows |
|---|---|---|
| Wind (le Souffle) | Pink noise in three bands: a low-passed body, a half-speed rumble, a narrow wandering whistle | the gust level ‰ (700 calm … 1300 gusty), smoothed over ~6 s; inside it, slow swells and faster flutter (value noise); a little darker at night |
| Machines | A hum in D (D2 sine + A2 soft saw — in key with the score), a band of whirr, a slow 1.7 Hz throb | how many machines run in view (`1 − e^(−n/5)`), panned towards them |
| Ribbons | A loop of tiny clicks, band-passed around 2.6 kHz | only zoomed in close (zoom 1.1 → 1.9) and over moving items |

## The cues

The shell queues cues as they come and plays each frame's batch once: a **specific** cue that answers the moment (a placement, a refusal, a screen opening, a quest done…) silences the **generic** ones of the same frame (the button click that caused it, the toast that reports it); otherwise only the most important generic one plays. Ambient cues (a cargo lift) silence nothing. Each cue then has its own minimum gap (`gapMs`).

| Cue | When (where it is emitted) | Sounds like | Peak (dBFS, full sliders) |
|---|---|---|---|
| `click` | any button (delegated click listener in `app/sound.ts`) | a paper tap | −20 |
| `tab` | build-bar tabs, Crier tabs, settings options | two light ticks | −21 |
| `select` | a construction site selected (bus `selection:changed`; a standing building plays its signature instead, below) | a tiny glint | −23 |
| `open` / `close` | a full screen opens / closes (bus `screen:*`) | a paper swish and two notes up / down | −16 / −16 |
| `view` | the iso ⇄ plan morph (bus `view:changed`) | a soft airy sweep | −26 |
| `toast.info/good/warn/bad` | any toast, by kind (the toast stack is observed) | a note · two notes up · two level notes · two notes falling | −23 · −20 · −19 · −17 |
| `place` | a building placed (`BuildMode.report`; a machine standing at once plays its signature instead, below) | a soft thunk, a knock, a chord note | −11 |
| `ribbon` | ribbon tiles laid: one tick per tile, ≤ 14, 30–60 ms apart | dry taps climbing the chord | −17 |
| `demolish` | buildings removed (tool or inspector), refunded | a crumble, then two notes falling back to the Heart | −18 |
| `refused` | a placement or a wire refused | a soft thump and two low notes a semitone apart | −11 |
| `mark` | dig / fill marks laid or cleared | a chalk scratch | −24 |
| `link` / `unlink` | a wire strung / cut with « Relier » (`BuildMode.reportLink`) | a rising glide, a spark, a fifth · a falling glide, a snip | −15 / −13 |
| `research` | research done (sim event) | an arpeggio of the chord over a soft swell | −10 |
| `quest` | a CrierBelt objective met (sim event) | an uplink chime: root, fifth, octave, shimmer | −12 |
| `sale` / `purchase` | a spot trade at the Crier (a `spot` command in the colony's log) | two coin pings and a whoosh away · a whoosh in and two pings | −16 / −15 |
| `lift` | a trade post's cargo lifts off (sim event `trade`, ≤ 1 per 15 s) | a distant rising rumble | −25 |
| `delivered` | imported goods arrive (sim event) | a landing thump and a note | −16 |
| `notice` | the Gazette announces or starts an event (sim event) | two soft blips | −19 |
| `vein` | digging uncovers ore (sim event `dug`) | a little sparkle, three notes up | −17 |

## Building signatures

Every building has a short sound evocative of the machine ([D120](decisions.md)), heard twice: **built**, fuller, when it stands, and **picked**, softer and shorter, when the player selects it — the same sound, so the ear learns which machine is which. [signatures.ts](../src/audio/signatures.ts) maps each building to one of 19 signatures by its kind (`KIND_SIGNATURE`), overridden by id (`ID_SIGNATURE`): a new building sounds like its kind with no line to add, and `signatures.test.ts` checks every building of the content. The recipes ([signature-sfx.ts](../src/audio/signature-sfx.ts)) are built from `tone` and `hiss`; their tonal parts take the chord in force (`chordNote`) in a register fixed per signature, so a drill always sounds low and a solar panel high, and both in key.

| Signature | Buildings | Sounds like | Peak built / picked (dBFS, full sliders) |
|---|---|---|---|
| `heart` | the Core | a heartbeat (lub-dub) under two warm chord tones | −13.5 / −22 |
| `drill` | drill, fast drill | a low thud, then the bit's grind (chopped noise) over a low chord tone | −13 / −22 |
| `bore` | deep bore, giant drill | a deeper, longer thrum (a throbbing low saw), then a clank of steel | −13 / −22 |
| `earth` | excavators, backfiller | a hydraulic whine rising, a scoop of gravel, the earth set down | −13.5 / −22 |
| `cutter` | Face Cutter | a stony scrape (gritty noise sweeping down), then a stone's tock | −13.5 / −22 |
| `pump` | pumps | a gurgle: bubbles (sines bending up fast, on the chord) over a slosh | −13.5 / −22 |
| `sand` | sand collector, sifter | a dry pour of grains (chopped high noise), a soft chord tone | −14 / −23 |
| `smelter` | smelters, ceramic oven, coal generator, incinerator | a whoosh of fire (noise opening up, flickering), then a metallic tick | −13.5 / −22 |
| `electric` | electric smelter, arc furnace, charger, etcher, chip fab, accumulators, battery generator | an electric hum on the chord, then crackles | −13.5 / −22 |
| `press` | wire mills, presses, workshops (every other machine) | a mechanical clack-clack; built, the release | −13.5 / −22 |
| `wind` | wind turbines | an airy swoosh crossing the field; built, the blade comes round again | −15 / −23.5 |
| `solar` | solar panel, farm and tower, Sunheart, optics workshop | a glassy shimmer: high chord tones, each beating with a twin | −15 / −23.5 |
| `steam` | steam boiler, geothermal plant | a hiss of steam, then a puff | −13.5 / −22 |
| `lab` | research labs, data collector, test bench | a soft data chirp (quick sines bending up) over a round low tone | −15 / −23.5 |
| `server` | servers, supercomputer, data relay | a digital blip-blip (filtered squares an octave apart) and a tick | −15 / −23.5 |
| `trade` | trade post | a bell (inharmonic partials) answered by a second one, a third built | −13.5 / −22 |
| `silo` | silos | a hollow tin drum: a low body and a resonant ring | −13.5 / −22 |
| `line` | ribbons, routing blocks, junction, bridge, conduit, fence | a light click and a tiny tone | −26 / −32 |
| `pole` | poles, pylons | a tick and a faint electric buzz; built, a little zap | −26 / −32 |

- **Built.** The shell ([app/sound.ts](../src/app/sound.ts)) reads `place` commands off the colony's log, as it reads spot trades: a building on the claim stands at once and plays then; off the claim, a kite flies the materials out, and the site is watched until it stands — it plays then, **near the camera only** (no floor to the fade). A machine's build adds a soft set-down thump, a second stroke or a tail and more room, and takes the `place` thunk's place in that frame; a line piece's or a pole's click joins the thunk, and a ribbon drag's ticks (`ribbon`) stand for it.
- **Picked.** A building selected (bus `selection:changed`): 60 % as long, without the build's extra layers, about 8 dB softer. A construction site keeps the plain `select` glint.
- **Restraint.** A frame's signatures merge, one per signature and variant (counts summed, the loudest one's place kept), two at most, builds first (`mergeSignatures`); each is spaced (`SigLimiter`: 250 ms between two builds of one signature, 450 ms for the quiet family — a drag laid piece by piece clicks once or twice —, 180 ms between two picks of one, 120 ms between any two picks). A signature answers its moment like a specific cue: the frame's clicks and toasts drop. Everything is on the effects slider, and nothing plays while the sound is locked or the tab hidden — what happened meanwhile is not replayed later.
- **Where.** `spatialGain(u, v, zoom, floor)`: full over the middle 60 % of the screen, a third at its edges, nothing half a screen beyond; zoomed out everything is farther (down to 55 %). The player's own act (a placement, a selection from a list) is never under 35 %. The pan follows the building across the screen (half way to the side at the edge).

The intro (D31) has no recipes of its own: [app/sound.ts](../src/app/sound.ts) maps its bus beats onto existing cues — `view` for each story panel and the register, `lift` as the Heart starts down, `place` for the « Accordé » stamp and at touchdown.

## Levels

Set by measurement, not by ear: the engine was rendered in an `OfflineAudioContext` in headless Chrome (the very same graph, driven by suspending the render every 0.1 s to call `update`), then measured: peak, RMS, DC, K-weighted loudness after ITU-R BS.1770-4 (integrated with gating, momentary 400 ms, short-term 3 s), silent seconds, octave-band balance, L/R correlation. Numbers from 2026-10-12, at the **default sliders** (master 100 %, music 80 %, effects 80 %) unless noted:

| What | Integrated | Peak | Notes |
|---|---|---|---|
| Music, day / dawn / dusk | −18.3 … −18.7 LUFS | −4.8 … −7.3 dBFS | never silent, DC < 10⁻⁵, L/R correlation ≈ 0.7 (wide, mono-safe) |
| Music, night | −19.3 LUFS | −7.4 … −8.9 dBFS | sparser and darker, barely quieter |
| Music, a clock sweep through dawn or dusk (150 s) | −18.1 / −18.3 LUFS | −5.8 dBFS | 30-s windows within ±1 LU |
| Wind calm / mid / gusty | −36.8 / −32.7 / −29.9 LUFS | −21 … −14 dBFS | |
| Machine bed alone, 3 / 12 / 40 machines in view | −38.5 / −32.4 / −31.6 LUFS | | |
| Ribbon rattle alone, zoom 2 over 200 items | −38.9 LUFS | −16.6 dBFS | silent at zoom 1 |
| Every cue alone, **full sliders** | | −26 … −10 dBFS | all under −6 dBFS (`CUES[…].peakDb`, checked by `levels.test.ts`) |
| Every building signature alone, **full sliders** (2026-10-17) | | built −15 … −13, picked −23.5 … −22; line pieces −26 / −32 | no NaN, no clipped sample (`SIGNATURES[…].peakDb`, checked by `signatures.test.ts`; rendered by `scripts/sound-levels.mjs`) |
| Full mix, busy day with cues | −17.7 LUFS | −5.2 dBFS | full sliders: −13.8 LUFS, −2.6 dBFS (the limiter holds it) |
| Master chain | unity below −4 dBFS | a 0 dBFS sine comes out at −2.9 dBFS | |

Octave bands of the day's music fall from 500 Hz (−2 dB at 1 kHz, −8 at 2 kHz, −15 at 4 kHz): mellow by design, the melody's overtones on top.

## Tuning: where the knobs are

| To change… | Edit |
|---|---|
| Where the sliders start | `DEFAULT_VOLUMES` in `levels.ts` |
| A whole bus (music, ambience, effects), the veil's duck, the limiter | `MIX` in `levels.ts` |
| One instrument of the score (pad, bass, melody, pulses, echo, reverb return) | `VOICE` in `levels.ts` |
| The wind's layers, the machine bed, the rattle | `AMB` in `levels.ts`; their curves (`windStrength`, `bedLevel`, `rattleLevel`) in `ambience.ts` |
| One cue's level, or how often it may play | `trimDb` / `gapMs` in `CUES` (`cues.ts`) |
| How a cue sounds | its recipe in `RECIPES` (`sfx.ts`) |
| Which signature a building has | `KIND_SIGNATURE` (by kind) or `ID_SIGNATURE` (by id) in `signatures.ts` |
| A signature's level (built, picked) | `trimDb` in `SIGNATURES` (`signatures.ts`) |
| How a signature sounds | its recipe in `SIG_RECIPES` (`signature-sfx.ts`); the variants' length in `VARIANTS` |
| How often signatures play, how far they carry | `VARIANTS[…].gapMs`, `PICK_GAP_MS`, `QUIET_BUILD_GAP_MS`, `MAX_SIGS_PER_FRAME`, `spatialGain` (`signatures.ts`) |
| The music by time of day (tempo, brightness, density, registers, reverb) | `KEYS` in `director.ts`; the part boundaries in `partAt`, the modes in `PART_MODE` |
| Chords and melody material | `PROGRESSIONS`, the upper structures and `LADDERS` in `theory.ts`; bars per chord, rhythms and moves (`BARS`, `GAPS`, `MOVES`) in `director.ts` |
| How much rhythm the activity earns | `pulseLevels` and `activityOf` in `director.ts` |

After a change of level, measure again (below) and update the recorded peaks in `CUES` or `SIGNATURES`.

## Adding a sound

1. Name the cue: add it to `SfxCue` in [core/bus.ts](../src/core/bus.ts).
2. Describe it in `CUES` ([cues.ts](../src/audio/cues.ts)): generic (`ui(prio, gapMs, trimDb, peakDb)`) or specific (`act(gapMs, trimDb, peakDb, covers?)`). Both tables are `Record<SfxCue, …>`: a missing entry does not compile.
3. Write its recipe in `RECIPES` ([sfx.ts](../src/audio/sfx.ts)) with `tone` and `hiss`; take notes from `chordNote(k, i, floor)` when it should be in key.
4. Emit it where the thing happens: `bus.emit('sfx', { cue: 'x' })` (from the shell: `app/build-mode.ts`, `app/sim-events.ts`…), or map an existing bus or DOM event in `app/sound.ts`.
5. Measure it alone at full sliders and record its peak in `CUES` (≤ −6 dBFS; the test fails otherwise).

A new building needs nothing: it sounds like its kind. To give it its own sound, map its id in `ID_SIGNATURE`, or add a signature: a name in `Signature`, a row in `SIGNATURES`, a recipe in `SIG_RECIPES` (0.2–0.6 s; `v.len` scales the decays, `v.full` adds the build's layers and `setDown`), then measure it.

A new instrument of the score: a function in `synth.ts`, a `Voice` in `director.ts` that the `Score` emits, a `case` in `SoundEngine.voice`, a level in `VOICE`.

## Checking levels without ears

**Cues and signatures**: `scripts/sound-levels.mjs` renders each one alone through the real engine in an `OfflineAudioContext` (headless Chrome, full sliders, the whole master chain; each signature over three chords) and fails on a NaN, a clipped sample, a peak over −6 dBFS or one more than 1.5 dB from the recorded one. It imports the TypeScript modules, so it needs a dev server: `npx vite --port 5197 --strictPort`, then `URL=http://localhost:5197 node scripts/sound-levels.mjs` (`--json` for the raw numbers, `--wav <file>` to write every signature in turn, built then picked, at the default sliders, to listen to). In Node, `signatures.test.ts` renders the recipes into a recording fake context: no NaN written to any parameter, every source stopped, the lengths.

**The music and the mix**: that check lives outside the repository (it is a throwaway); to redo it: with the dev server up, open a page on a module URL of the dev server (for example `/src/audio/levels.ts`, which has no HMR client, so edits elsewhere do not reload it), then in the page `import('/src/audio/engine.ts')`, build `new OfflineAudioContext(2, 48000 * seconds, 48000)`, `new SoundEngine(ctx, { seed, volumes, music, ambience })`, `start(0)`, and chain `ctx.suspend(t).then(() => { engine.update(world); …; ctx.resume(); })` every 0.1 s before `startRendering()`. `engine.play(cue, n, t)` schedules cues. Measure the rendered channels in the page (BS.1770 K-weighting at 48 kHz: the two biquads of the standard). Solo a voice by wrapping `SoundEngine.prototype.voice` to keep one `ev.v`; mute ambience layers by wrapping the engine's own `ambience.update`. (Mutating the imported `VOICE` from the page does not work once Vite has busted the module's URL after an edit.)

## Debugging and smoke

- `FL.app.sound.describe()`: `state` (`off` · `locked` · `running` · `hidden` · `failed`), the context's state, the audio clock, the cues played and the last eight (a signature as `sig.<name>.<variant>`, e.g. `sig.drill.build`), the volumes, and the score (`part`, `mode`, `bpm`, `step`, `chord`).
- Under automation the menu does not open, so the first real click of a test unlocks the sound; nothing logs an error when audio cannot start.

## Known gaps

- Little positional sound: the cues are heard from the centre (only the machine bed and the buildings' signatures pan and fade with the distance). A lift far off-screen sounds like one nearby.
- The machine bed counts machines in the view's bounding box (in iso, a diamond's box: a little wider than the screen).
- Mobile Safari unlock relies on `pointerdown` / `keydown`; older iOS needs `touchend`.

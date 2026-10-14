// intro.ts — the intro's shell side (D31). A new base (its claim not named yet) opens on its
// story once the main menu closes (« Jouer », or Esc): the comic strip, CrierBelt's register
// (the company's name), then the Heart's landing in the cirque, after which the tutorial's
// quest log takes over. The DOM is ui/screens/intro.ts, the world effect
// render/world/landing-view.ts; this file holds what neither may do:
//
// · when it plays: never under automation (navigator.webdriver, ?nomenu) nor with ?demo, and
//   only while the claim has no name — the naming modal of quest 0 stays the fallback whenever
//   the intro does not run. `FL.intro(true)` opens it anyway (tests, review);
// · the Heart out of sight from boot (the menu drifts over an empty cirque) until it touches
//   down: BuildingsView.hide / LightsView.hidden — the sim is untouched, the Heart exists from
//   tick 0 and this is pure looks;
// · the landing's camera: the sky over the empty cirque, following the load down and closing
//   in, a jolt at touchdown, then home (centred on the Heart, zoom 1);
// · naming the claim (the `name` command, so quest 0 completes) as the HUD comes back, a beat
//   after touchdown, so the quest log's stamp and CrierBelt's toast are seen;
// · the bus events of the landing (`intro:land`, `intro:done`; the screen emits the beats).
import type { Emblem } from '@/content/emblem';
import { bus, type IntroPanel } from '@/core/bus';
import { BUILDING_IDS } from '@/content/registry';
import type { BuildingId } from '@/content/buildings';
import { t } from '@/i18n/i18n';
import { apply, invert } from '@/render/projection';
import { LAND_END, LAND_TOUCHDOWN } from '@/render/world/landing-view';
import { footprint } from '@/sim/entities';
import { IntroScreen } from '@/ui/screens/intro';
import { registerOf, type NameRegister } from '@/ui/screens/intro-name';
import type { App } from './app';

/** The landing's shot: zoom from the sky to the ground, how far the view rises with the load (world px), the touchdown jolt. */
const ZOOM_SKY = 0.78, ZOOM_GROUND = 1;
const LIFT_MAX = 250;
const SHAKE_PX = 7, SHAKE_S = 0.5;
/** After touchdown, once the crane is away: the HUD comes back and the claim takes its name; then the frame opens. */
const COMMIT_AT = LAND_TOUCHDOWN + 1.9;
const OUT_AT = LAND_END - 0.9;

export interface IntroShell {
  readonly screen: IntroScreen;
  /** Will closing the main menu play the intro? (a new base, not under automation, not seen yet) */
  pending(): boolean;
  /** Open it: at the story, at the register, or straight at the landing (review). */
  open(at?: 'story' | 'name' | 'landing'): void;
  /** Close it now: the Heart shown, a signed name registered. */
  close(): void;
  state(): { open: boolean; panel: IntroPanel | null; landing: boolean; t: number; heartHidden: boolean };
}

const smooth = (a: number, b: number, v: number): number => {
  const k = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return k * k * (3 - 2 * k);
};

/** Register the intro screen; `auto`: it plays by itself on a new base (false under automation and with ?demo). */
export function installIntro(app: App, auto: boolean): IntroShell {
  let played = false;
  /** idle → story (the strip, the register) → landing → over. */
  let phase: 'idle' | 'story' | 'landing' | 'over' = 'idle';
  let signed: string | null = null;
  /** The emblem designed on the register (the claim takes it with its name). */
  let emblem: Emblem | null = null;
  let committed = false;
  let hurried = false;
  let out = false;
  let shake = -1;
  /** The landing has moved the camera (so closing early puts it back home). */
  let moved = false;
  let reg: NameRegister | null = null;

  const heart = (): { id: number; def: BuildingId; x: number; y: number; w: number; h: number; rot: 0 | 1 | 2 | 3 } | null => {
    const e = app.sim.ents.get(app.sim.hearthId);
    if (!e) return null;
    const [w, h] = footprint(e.def, e.rot);
    return { id: e.id, def: BUILDING_IDS[e.def] as BuildingId, x: e.x, y: e.y, w, h, rot: e.rot };
  };
  const hideHeart = (): void => {
    const id = app.sim.hearthId;
    app.buildings.hide(id);
    if (!app.lights.hidden.has(id)) { app.lights.hidden.add(id); app.lights.rebuild(app.sim); }
  };
  const showHeart = (): void => {
    const id = app.sim.hearthId;
    app.buildings.show(id);
    if (app.lights.hidden.delete(id)) app.lights.rebuild(app.sim);
  };
  const pending = (): boolean => auto && !played && !app.sim.quests.named && !!heart();

  const screen = new IntroScreen({
    // The sister claims never change for a world: read them once.
    register: () => (reg ??= registerOf(app.sim)),
    sign: (name, e) => { emblem = e; land(name); },
    // The claim's own number: its seed mixed with its founding minute (every claim differs).
    claimNo: () => (Math.imul(app.sim.playerSeed, 2654435761) ^ app.sim.foundingEpoch) >>> 0,
    hurry: () => { hurried = true; if (app.landing.active) app.landing.skip(); else end(); },
  });

  // ── the landing ──────────────────────────────────────────────────────────

  function land(name: string | null): void {
    const h = heart();
    if (!h) { end(); return; }
    signed = name;
    phase = 'landing';
    out = false;
    shake = -1;
    moved = true;
    hideHeart();
    app.view.setMode('iso');
    app.build.open(null);
    app.select(0);
    screen.landing('descent');
    app.landing.start({ id: h.def, x: h.x, y: h.y, w: h.w, h: h.h, rot: h.rot }, {
      touchdown: () => {
        showHeart();
        shake = 0;
        screen.landing('down', signed ?? (app.sim.colonyName || t('quest.unnamed')));
        bus.emit('intro:land');
      },
      done: () => end(),
    });
    camera(0);
  }

  /** The shot for this frame: up with the load, closing in, the touchdown jolt. */
  function camera(dt: number): void {
    const h = heart();
    if (!h) return;
    const P = app.view.P;
    const tt = app.landing.time;
    const zoom = ZOOM_SKY + (ZOOM_GROUND - ZOOM_SKY) * smooth(0.12, 1, tt / LAND_TOUCHDOWN);
    // Raise the view with the load (world px, on screen up), then the jolt (screen px).
    let wx = 0, wy = -Math.min(LIFT_MAX, app.landing.altitude * 0.5);
    if (shake >= 0 && shake < SHAKE_S) {
      const a = (SHAKE_PX * (1 - shake / SHAKE_S) ** 2) / zoom;
      wx += a * Math.sin(shake * 71);
      wy += a * 0.7 * Math.sin(shake * 53 + 1.3);
      shake += dt;
    }
    const [ux, uy] = apply(invert(P), wx, wy);
    app.camera.jumpTo(h.x + h.w / 2 + ux, h.y + h.h / 2 + uy, zoom);
  }

  /** The claim takes its name and the HUD comes back (quest 0 completes: the log stamps it). */
  function commit(): void {
    if (committed) return;
    committed = true;
    if (emblem) app.sim.setEmblem(emblem); // the Heart's flag shows it (world/heart-flag.ts)
    if (signed && signed !== app.sim.colonyName) {
      app.sim.nameColony(signed);
      app.quests.refresh();
    }
    document.body.removeAttribute('data-intro');
  }

  /** Every frame while the intro is open. */
  function frame(dt: number): void {
    if (phase !== 'landing' || !app.landing.active) return;
    camera(dt);
    const tt = app.landing.time;
    if (tt >= COMMIT_AT) commit();
    if (!out && tt >= OUT_AT) { out = true; screen.landing('out'); }
  }

  /** Over (played through, hurried or closed): everything back as the game expects it. */
  function end(): void {
    if (phase === 'over' || phase === 'idle') return;
    phase = 'over';
    showHeart();
    commit();
    const h = heart();
    if (h && moved) app.camera.jumpTo(h.x + h.w / 2, h.y + h.h / 2, ZOOM_GROUND);
    moved = false;
    bus.emit('intro:done', { skipped: hurried });
    if (app.screens.current === 'intro') app.screens.open(null);
  }

  app.screens.register('intro', {
    root: screen.root,
    modal: true,
    refresh: () => screen.refresh(),
    frame: (dt) => { screen.frame(dt); frame(dt); },
    back: () => screen.back(),
    opened: () => screen.opened(),
    closed: () => {
      screen.closed();
      // Closed early (FL.intro(false)…): finish the landing at once, or just restore.
      if (phase === 'over' || phase === 'idle') return;
      hurried = true;
      if (app.landing.active) app.landing.skip();
      else end();
    },
  });

  function open(at: 'story' | 'name' | 'landing' = 'story'): void {
    if (!heart()) return;
    // A landing still running (FL.intro(true) again): finish it first, so its end cannot close this run.
    if (app.landing.active) app.landing.skip();
    played = true;
    phase = 'story';
    signed = null;
    emblem = null;
    committed = false;
    hurried = false;
    hideHeart();
    document.body.setAttribute('data-intro', '');
    if (app.screens.current !== 'intro') app.screens.open('intro');
    if (at === 'landing') { screen.start('name'); land(app.sim.colonyName || null); } else screen.start(at);
  }

  // A new base: the Heart is not there yet (the menu drifts over the empty cirque), and the
  // intro starts as soon as the menu closes. A microtask: after ScreenHost.open has finished
  // closing the menu, before anything is drawn, so no frame shows the bare world in between.
  if (pending()) hideHeart();
  bus.on('screen:closed', ({ id }) => {
    if (id !== 'menu' || !pending()) return;
    queueMicrotask(() => { if (!app.screens.current && pending()) open('story'); });
  });

  return {
    screen,
    pending,
    open,
    close: () => { if (app.screens.current === 'intro') app.screens.open(null); },
    state: () => {
      const isOpen = app.screens.current === 'intro';
      return { open: isOpen, panel: isOpen ? screen.panel : null, landing: app.landing.active, t: app.landing.time, heartHidden: app.buildings.isHidden(app.sim.hearthId) };
    },
  };
}

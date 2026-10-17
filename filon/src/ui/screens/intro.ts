// intro.ts — the opening sequence of a new base (D31), as a comic strip on paper. Three panels
// fill a page one after the other — Verrière, the glass city, at dusk; the investor who puts
// his savings into his own mining company, to pilot it from afar; CrierBelt's answer, a
// holographic contract from the Ring that opens its services (freight, the Crier, the Gazette),
// stamped « Accordé » — each caption typed out, each panel moving on by itself once read or
// on a click. Then CrierBelt's registration form (owner, 2026-10-12: "like an actual form to
// create a company, and have the player sign it"): the company's name to fill in (the claim
// takes the same name), checked by `checkName` (intro-name.ts: length, the other claims, reserved
// names; a promise, so a server can answer one day), the rest of the form already typed in by
// CrierBelt, then the player's signature (signature-pad.ts) and the « Enregistré » stamp. Then
// the paper lifts off the live world, framed
// like a last panel, while the shell lands the Heart (app/intro.ts, render/world/landing-view.ts)
// and tells this screen where the landing is (`landing('descent' | 'down' | 'out')`).
//
// « Passer » and Esc skip the story to the register (never past it: the name is the point);
// during the landing they hurry it. A modal screen: the game's keys wait. Plain DOM built
// once (`el`), change-only writes; the drawings are intro-art.ts. Bus events at each beat
// (`intro:panel`, `intro:stamp`) for the audio's cues.
import { bus, type IntroPanel } from '@/core/bus';
import { el, setAttr, setText } from '@/core/dom';
import { COLONY_NAME_MAX } from '@/content/quests';
import { locale, t, type MsgKey } from '@/i18n/i18n';
import { cityArt, crierArt, investorArt, markCanvas } from './intro-art';
import { checkName, refusalText, suggestName, type NameRegister, type NameVerdict } from './intro-name';
import { SignaturePad } from './signature-pad';
import { EmblemDesigner } from './emblem-designer';
import { defaultEmblem, type Emblem } from '@/content/emblem';

export type IntroStage = 'story' | 'name' | 'landing';

export interface IntroHost {
  /** The register the name is checked against (the other claims; one day, the server). */
  register(): NameRegister;
  /** The player signed with a free name: the shell lands the Heart (and names the claim, gives it its emblem). */
  sign(name: string, emblem: Emblem): void;
  /** A number of this claim's own (the player's seed): its lot and file numbers on the form. */
  claimNo(): number;
  /** « Passer » / Esc during the landing: hurry it to its end. */
  hurry(): void;
}

const PANELS = ['city', 'investor', 'crierbelt'] as const;
type StoryPanel = (typeof PANELS)[number];
const CAPTION: Record<StoryPanel, MsgKey> = { city: 'intro.city', investor: 'intro.investor', crierbelt: 'intro.crier' };
const ORDER: readonly IntroPanel[] = ['city', 'investor', 'crierbelt', 'name', 'landing'];
/** The typewriter (characters per second; the landing's captions run faster); reading time once a caption is out. */
const TYPE_CPS = 40, LAND_CPS = 56;
const HOLD_S = 2.3;
const HOLD_PER_CHAR = 0.014;
/** CrierBelt's panel, after its caption: the contract in, its lines, the stamp; then a pause. */
const BEATS = [0.2, 0.75, 1.7] as const;
const STAMP_HOLD = 2.5;
/** The form's « Enregistré » stamp, then the landing (ms). */
const REGISTERED_HOLD = 950;
/** The signature box (CSS px). */
const PAD_W = 300, PAD_H = 86;

const chars = (s: string): string[] => [...s];

/** CrierBelt's countersignature, already on the form: a quick scrawl in the company's ink. */
const COUNTER_SIG = '<svg viewBox="0 0 150 54" width="150" height="54" aria-hidden="true">'
  + '<path d="M8 38 C 14 12, 26 10, 24 30 S 30 44, 38 26 S 48 14, 50 30 S 58 40, 66 24 C 70 16, 76 18, 74 30 S 84 42, 92 22 S 104 18, 104 32 S 116 40, 124 26 S 136 20, 142 30" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<path d="M14 45 C 50 51, 100 49, 140 41" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

export class IntroScreen {
  readonly root: HTMLElement;
  readonly modal = true;
  stage: IntroStage = 'story';
  private index = 0;
  /** Seconds into the current panel (or the landing's caption). */
  private clock = 0;
  /** Has the current caption finished typing, and when (on `clock`)? */
  private typed = false;
  private typedAt = 0;
  private beat = 0;
  private stamped = false;
  private readonly panels: Array<{ id: StoryPanel; node: HTMLElement; ghost: HTMLElement; live: HTMLElement; text: string[] }>;
  /** Static texts, re-set on refresh so they follow a language switch. */
  private readonly labels: Array<[HTMLElement, () => string]> = [];
  private readonly skipBtn: HTMLButtonElement;
  // ── the register ──
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly err: HTMLElement;
  private readonly ok: HTMLButtonElement;
  private readonly pad: SignaturePad;
  private readonly fileNo: HTMLElement;
  private readonly place: HTMLElement;
  private readonly dateLine: HTMLElement;
  /** The claim's emblem, designed on the form (emblem-designer.ts). */
  private readonly designer: EmblemDesigner;
  private suggestion = 0;
  private checking = false;
  /** Stamped: the landing is on its way (the form takes no more input). */
  private registered = false;
  // ── the landing's caption ──
  private readonly cap: HTMLElement;
  private readonly capFrom: HTMLElement;
  private readonly capLive: HTMLElement;
  private readonly capGhost: HTMLElement;
  private capText: string[] = [];
  private readonly keys = (e: KeyboardEvent): void => this.key(e);
  /** The language the texts were last set in ('' = never). */
  private loc = '';

  constructor(private readonly host: IntroHost) {
    const label = <E extends HTMLElement>(node: E, text: () => string): E => { this.labels.push([node, text]); return node; };

    // The story page: three panels (the wide one last), captions typed over the drawings.
    const art: Record<StoryPanel, () => string> = { city: cityArt, investor: investorArt, crierbelt: crierArt };
    this.panels = PANELS.map((id) => {
      const ghost = el('span.ic-ghost'), live = el('span.ic-live');
      const extra = id === 'crierbelt' ? [this.contract(label)] : [];
      const node = el('figure.intro-panel', { 'data-intro-panel': id, 'data-state': 'todo' }, [
        el('div.intro-art', { html: art[id]() }),
        ...extra,
        el('figcaption.intro-cap.lettering', {}, [ghost, live]),
      ]);
      return { id, node, ghost, live, text: [] };
    });
    const page = el('div.intro-page', { 'data-intro-page': 'story' }, this.panels.map((p) => p.node));

    // CrierBelt's registration form: the name to fill in, the rest typed in by CrierBelt, a
    // signature at the foot.
    this.input = el('input.ir-input.lettering', {
      type: 'text', maxlength: String(COLONY_NAME_MAX), spellcheck: 'false', autocomplete: 'off', 'data-intro-name-input': '',
      oninput: () => this.clearError(),
    }) as HTMLInputElement;
    this.err = el('div.ir-err', { 'data-intro-err': '', role: 'alert' });
    this.ok = el<'button'>('button.btn.primary.ir-ok', { type: 'submit', 'data-intro-name-ok': '' });
    const reroll = el<'button'>('button.ir-reroll', { type: 'button', 'data-intro-reroll': '', onclick: () => this.reroll() }, '↻');
    this.pad = new SignaturePad(PAD_W, PAD_H);
    this.pad.onChange = () => { setAttr(this.form, 'data-signed', this.pad.signed ? '' : null); if (this.pad.signed) this.clearError(); };
    this.pad.canvas.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      if (!this.registered) this.pad.autograph(this.input.value);
    });
    const clear = el<'button'>('button.ir-clear', { type: 'button', 'data-intro-sign-clear': '', onclick: () => { if (!this.registered) this.pad.clear(); } });
    this.fileNo = el('div.ir-file');
    this.designer = new EmblemDesigner(defaultEmblem(host.claimNo()));
    this.place = el('span.ir-v');
    this.dateLine = el('p.ir-date');
    const row = (k: MsgKey, v: MsgKey | HTMLElement): HTMLElement =>
      el('div.ir-row-f', {}, [label(el('span.ir-k'), () => t(k)), v instanceof HTMLElement ? v : label(el('span.ir-v'), () => t(v))]);
    const section = (n: string, title: MsgKey, body: HTMLElement[]): HTMLElement =>
      el('section.ir-sec', {}, [el('h3.ir-sec-h', {}, [el('span.ir-num', {}, n), label(el('span'), () => t(title))]), ...body]);
    const check = (key: MsgKey): HTMLElement => el('li.ir-check', {}, [el('span.ir-box', { 'aria-hidden': 'true' }, '✓'), label(el('span'), () => t(key))]);
    this.form = el<'form'>('form.intro-register.cartouche', {
      'data-intro-page': 'name', novalidate: '',
      onsubmit: (e: Event) => { e.preventDefault(); void this.submit(); },
    }, [
      el('header.ir-head', {}, [
        el('div.ir-mark', {}, markCanvas(52)),
        el('div.ir-heading', {}, [
          label(el('div.ir-from'), () => t('intro.form.from')),
          label(el('h2.ir-title.lettering'), () => t('intro.form.title')),
          label(el('div.ir-sub'), () => t('intro.form.sub')),
        ]),
        el('div.ir-ref', {}, [label(el('div.ir-form-no'), () => t('intro.form.no')), this.fileNo]),
      ]),
      section('1', 'intro.form.s1', [
        el('label.ir-row-f.ir-name', {}, [
          label(el('span.ir-k'), () => t('intro.name.label')),
          el('span.ir-row', {}, [this.input, reroll]),
        ]),
        el('div.ir-row-f.ir-emblem', {}, [label(el('span.ir-k'), () => t('intro.form.emblem')), this.designer.root]),
        row('intro.form.kind', 'intro.form.kindV'),
        row('intro.form.seat', 'intro.form.seatV'),
      ]),
      section('2', 'intro.form.s2', [
        row('intro.form.place', this.place),
        row('intro.form.run', 'intro.form.runV'),
        row('intro.form.kit', 'intro.form.kitV'),
      ]),
      section('3', 'intro.form.s3', [
        el('ul.ir-checks', {}, [check('intro.form.freight'), check('intro.form.trade'), check('intro.form.news')]),
      ]),
      label(el('p.ir-certify'), () => t('intro.form.certify')),
      this.dateLine,
      el('div.ir-signs', {}, [
        el('div.ir-sign', {}, [
          label(el('div.ir-k'), () => t('intro.form.sign')),
          el('div.ir-pad', {}, [this.pad.canvas, label(el('span.ir-pad-hint'), () => t('intro.form.signHere')), el('span.ir-pad-x', { 'aria-hidden': 'true' }, '✕')]),
          label(clear, () => t('intro.form.clear')),
        ]),
        el('div.ir-counter', {}, [
          label(el('div.ir-k'), () => t('intro.form.counter')),
          el('div.ir-counter-sig', { html: COUNTER_SIG }),
        ]),
      ]),
      el('div.ir-foot', {}, [this.err, label(this.ok, () => t('intro.form.ok'))]),
      label(el('div.ir-stamp.lettering', { 'data-intro-registered': '' }), () => t('intro.form.stamp')),
    ]);

    // The landing: a caption over the framed world.
    this.capFrom = el('div.il-from');
    this.capGhost = el('span.ic-ghost');
    this.capLive = el('span.ic-live');
    this.cap = el('div.intro-landcap.cartouche', { 'data-intro-caption': '' }, [this.capFrom, el('p.il-text.lettering', {}, [this.capGhost, this.capLive])]);

    this.skipBtn = el<'button'>('button.btn.intro-skip', { type: 'button', 'data-intro-skip': '', onclick: (e: Event) => { e.stopPropagation(); this.skip(); } });
    label(this.skipBtn, () => t('intro.skip'));
    this.root = el('section.intro', {
      'data-screen': 'intro', 'data-stage': 'story', role: 'dialog', 'aria-modal': 'true',
      onclick: (e: Event) => { if (this.stage === 'story' && !(e.target as HTMLElement).closest('button')) this.advance(); },
    }, [
      el('div.intro-paper'),
      page,
      this.form,
      el('div.intro-frame'),
      this.cap,
      this.skipBtn,
      label(el('p.intro-hint'), () => t('intro.hint')),
    ]);
    this.refresh();
    setAttr(reroll, 'title', t('intro.name.reroll'));
  }

  /** The beat on screen: a story panel, the register, or the landing. */
  get panel(): IntroPanel | null {
    if (this.stage === 'story') return PANELS[this.index]!;
    return this.stage;
  }

  /** From the top (the story's first panel), or straight to the register. */
  start(stage: 'story' | 'name' = 'story'): void {
    this.checking = false;
    this.registered = false;
    setAttr(this.form, 'data-registered', null);
    this.input.disabled = false;
    this.clearError();
    this.input.value = '';
    this.pad.clear();
    this.designer.set(defaultEmblem(this.host.claimNo()));
    this.suggestion = Math.floor(Math.random() * 1000);
    if (stage === 'name') this.showName();
    else this.show(0);
  }

  /** Re-set the texts after a language switch (the 4 Hz refresh: nothing else changes); the captions keep their progress. */
  refresh(): void {
    if (this.loc === locale()) return;
    this.loc = locale();
    for (const [node, text] of this.labels) setText(node, text());
    setAttr(this.input, 'aria-label', t('intro.name.label'));
    this.designer.refresh();
    for (const p of this.panels) {
      p.text = chars(t(CAPTION[p.id]));
      setText(p.ghost, p.text.join(''));
    }
    const cur = this.panels[this.index];
    if (this.stage === 'story' && cur && this.typed) setText(cur.live, cur.text.join(''));
    this.paperTexts();
  }

  /** The form's typed-in particulars: this claim's file and lot numbers, today's date in Verrière. */
  private paperTexts(): void {
    const no = this.host.claimNo() >>> 0;
    const lot = 1000 + (no % 9000);
    const tail = (Math.floor(no / 9000) % 46656).toString(36).toUpperCase().padStart(3, '0');
    setText(this.fileNo, t('intro.form.file', { n: `CB-${lot}-${tail}` }));
    setText(this.place, t('intro.form.placeV', { lot: String(lot) })); // a number of its own, not 1 001
    const date = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
    setText(this.dateLine, t('intro.form.date', { date }));
    setAttr(this.pad.canvas, 'aria-label', t('intro.form.padLabel'));
  }

  /** Every frame while open: the typewriter, CrierBelt's beats, moving on. */
  frame(dt: number): void {
    this.clock += dt;
    if (this.stage === 'landing') { this.type(this.capLive, this.capText, LAND_CPS); return; }
    if (this.stage !== 'story') return;
    const p = this.panels[this.index]!;
    if (!this.typed) { if (this.type(p.live, p.text)) { this.typed = true; this.typedAt = this.clock; } return; }
    const since = this.clock - this.typedAt;
    if (p.id !== 'crierbelt') {
      if (since >= HOLD_S + HOLD_PER_CHAR * p.text.length) this.next();
      return;
    }
    while (this.beat < BEATS.length && since >= BEATS[this.beat]!) this.setBeat(this.beat + 1);
    if (since >= BEATS[BEATS.length - 1]! + STAMP_HOLD) this.next();
  }

  /** Esc: skip the story to the register; on the register, stay; during the landing, hurry it. */
  back(): boolean {
    this.skip();
    return true;
  }

  opened(): void {
    window.addEventListener('keydown', this.keys);
  }

  closed(): void {
    window.removeEventListener('keydown', this.keys);
    this.input.blur();
  }

  /**
   * Where the landing is, from the shell: 'descent' (the paper lifts off the world, the
   * caption), 'down' (touchdown: CrierBelt's welcome, with the company's name), 'out' (the
   * frame opens onto the game).
   */
  landing(phase: 'descent' | 'down' | 'out', name = ''): void {
    if (phase === 'descent') {
      this.stage = 'landing';
      setAttr(this.root, 'data-stage', 'landing');
      this.input.blur();
      this.caption(t('intro.land.place'), t('intro.land.text'));
      bus.emit('intro:panel', { panel: 'landing', index: ORDER.indexOf('landing') });
    } else if (phase === 'down') {
      this.caption(t('quest.voice'), t('intro.land.done', { name }));
    }
    setAttr(this.root, 'data-phase', phase);
  }

  // ── the story ────────────────────────────────────────────────────────────

  private show(i: number): void {
    this.stage = 'story';
    this.index = i;
    this.clock = 0;
    this.typed = false;
    this.typedAt = 0;
    this.beat = 0;
    this.stamped = false;
    setAttr(this.root, 'data-stage', 'story');
    setAttr(this.root, 'data-phase', null);
    this.panels.forEach((p, j) => {
      setAttr(p.node, 'data-state', j < i ? 'past' : j === i ? 'now' : 'todo');
      if (j >= i) setText(p.live, '');
      if (j > i) setAttr(p.node, 'data-beat', null);
    });
    setAttr(this.panels[i]!.node, 'data-beat', '0');
    bus.emit('intro:panel', { panel: PANELS[i]!, index: i });
  }

  /** A click on the page: finish what is animating, else move on. */
  private advance(): void {
    const p = this.panels[this.index]!;
    if (!this.typed) {
      setText(p.live, p.text.join(''));
      this.typed = true;
      this.typedAt = this.clock;
    } else if (p.id === 'crierbelt' && this.beat < BEATS.length) {
      this.setBeat(BEATS.length);
      this.typedAt = this.clock - BEATS[BEATS.length - 1]!;
    } else this.next();
  }

  private next(): void {
    if (this.index < PANELS.length - 1) this.show(this.index + 1);
    else this.showName();
  }

  private setBeat(n: number): void {
    this.beat = n;
    setAttr(this.panels[this.index]!.node, 'data-beat', String(n));
    if (n >= BEATS.length && !this.stamped) {
      this.stamped = true;
      bus.emit('intro:stamp');
    }
  }

  /** « Passer » / Esc: the story → the register; the landing → its end. */
  private skip(): void {
    if (this.stage === 'story') this.showName();
    else if (this.stage === 'landing') this.host.hurry();
  }

  private key(e: KeyboardEvent): void {
    if (this.stage !== 'story' || e.repeat) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      this.advance();
    }
  }

  /** Type `text` into `node` at the typewriter's pace (on `clock`); true once it is all out. */
  private type(node: HTMLElement, text: string[], cps = TYPE_CPS): boolean {
    const n = Math.min(text.length, Math.floor(this.clock * cps));
    setText(node, text.slice(0, n).join(''));
    return n >= text.length;
  }

  // ── CrierBelt's contract (on its panel) ──────────────────────────────────

  private contract(label: <E extends HTMLElement>(node: E, text: () => string) => E): HTMLElement {
    const item = (key: MsgKey, glyph: string): HTMLElement =>
      el('li.ih-item', {}, [el('span.ih-glyph', {}, glyph), label(el('span'), () => t(key))]);
    return el('div.intro-holo', { 'data-intro-contract': '' }, [
      el('div.ih-head', {}, [
        el('div.ih-mark', {}, markCanvas(54)),
        el('div.ih-brand.lettering', {}, 'CrierBelt'),
      ]),
      label(el('div.ih-from'), () => t('intro.letter.from')),
      label(el('p.ih-text'), () => t('intro.letter.text')),
      el('ul.ih-list', {}, [item('intro.letter.freight', '⇡'), item('intro.letter.trade', '◉'), item('intro.letter.news', '❡')]),
      label(el('div.ih-stamp.lettering', { 'data-intro-stamp': '' }), () => t('intro.letter.stamp')),
    ]);
  }

  // ── the register ─────────────────────────────────────────────────────────

  private showName(): void {
    this.stage = 'name';
    setAttr(this.root, 'data-stage', 'name');
    setAttr(this.root, 'data-phase', null);
    if (!this.input.value.trim()) this.input.value = suggestName(this.suggestion, this.host.register().taken);
    this.paperTexts();
    this.pad.fit();
    bus.emit('intro:panel', { panel: 'name', index: ORDER.indexOf('name') });
    // After the page has turned (the form shows): the keyboard lands in the field.
    window.setTimeout(() => {
      if (this.stage !== 'name') return;
      this.input.focus({ preventScroll: true });
      this.input.select();
    }, 60);
  }

  private reroll(): void {
    if (this.registered) return;
    this.suggestion++;
    this.input.value = suggestName(this.suggestion, this.host.register().taken);
    this.clearError();
    this.input.focus({ preventScroll: true });
  }

  private clearError(): void {
    setText(this.err, '');
    setAttr(this.form, 'data-bad', null);
  }

  private async submit(): Promise<void> {
    if (this.checking || this.registered || this.stage !== 'name') return;
    this.checking = true;
    this.ok.disabled = true;
    const slow = window.setTimeout(() => setText(this.err, t('intro.name.checking')), 160);
    let v: NameVerdict;
    try {
      v = await checkName(this.input.value, this.host.register());
    } finally {
      window.clearTimeout(slow);
      this.checking = false;
      this.ok.disabled = false;
    }
    if (this.stage !== 'name') return; // closed or skipped meanwhile
    if (!v.ok) {
      this.refuse(refusalText(v, this.input.value), 'name');
      this.input.focus({ preventScroll: true });
      return;
    }
    if (!this.pad.signed) {
      this.refuse(t('intro.form.unsigned'), 'sign');
      this.pad.canvas.focus({ preventScroll: true });
      return;
    }
    // Filed: CrierBelt stamps it, and the Heart comes down.
    this.clearError();
    this.registered = true;
    this.input.disabled = true;
    this.designer.locked = true;
    setAttr(this.form, 'data-registered', '');
    bus.emit('intro:stamp');
    const name = v.name, emblem = this.designer.value;
    window.setTimeout(() => { if (this.stage === 'name' && this.registered) this.host.sign(name, emblem); }, REGISTERED_HOLD);
  }

  /** A refusal: its line in CrierBelt's words, and the field it is about shakes (restarted each time). */
  private refuse(text: string, what: 'name' | 'sign'): void {
    setText(this.err, text);
    setAttr(this.form, 'data-bad', null);
    void this.form.offsetWidth;
    setAttr(this.form, 'data-bad', what);
  }

  // ── the landing's caption ────────────────────────────────────────────────

  private caption(from: string, text: string): void {
    setText(this.capFrom, from);
    this.capText = chars(text);
    setText(this.capGhost, text);
    setText(this.capLive, '');
    this.clock = 0;
  }
}

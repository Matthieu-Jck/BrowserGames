// shell.ts — owns the DOM over the canvases: the chapter rail, the glass beat panel, and
// the intro / report-card screens. It rebuilds the panel on every beat (no stale state)
// and routes every interaction back to the app through handlers. Stable data-attributes
// (data-screen, data-beat, data-action, data-control) are the smoke test's handholds.
import { el, clear, qs } from '@/core/dom';
import type { Beat, ChapterDef, SandboxControl, VerdictView } from '@/journey/types';
import type { Severity } from '@/core/kinds';
import { renderVerdict } from './verdict';
import { INTRO } from '@/content/copy';

export interface ShellHandlers {
  onStart(): void;
  onResume(): void;
  onNext(): void;
  onBack(): void;
  onPredict(value: number): void;
  onSandboxChange(key: string, value: number): void;
  onChallengeSubmit(params: Record<string, number>): void;
  onGotoChapter(chapterId: number): void;
  onRestart(): void;
}

export class Shell {
  private rail!: HTMLElement;
  private stage!: HTMLElement;
  private params: Record<string, number> = {};
  private verdictSlot: HTMLElement | null = null;
  private actionSlot: HTMLElement | null = null;

  constructor(
    private root: HTMLElement,
    private chapters: ChapterDef[],
    private handlers: ShellHandlers,
  ) {
    this.build();
  }

  private build(): void {
    clear(this.root);
    this.rail = el('header.rail', { 'data-rail': '' });
    this.stage = el('main.stage', { 'data-stage': '' });
    this.root.append(this.rail, this.stage);
  }

  // ---- intro ---------------------------------------------------------------
  showIntro(hasProgress: boolean): void {
    this.rail.style.opacity = '0';
    clear(this.stage);
    const panel = el('section.intro.panel', { 'data-screen': 'intro' }, [
      el('div.kicker', {}, INTRO.kicker),
      el('h1.title', {}, INTRO.title),
      el('p.tagline', {}, INTRO.tagline),
      el('div.intro-actions', {}, [
        el('button.btn.primary', { 'data-action': 'start', onclick: () => this.handlers.onStart() }, INTRO.enter),
        hasProgress
          ? el('button.btn.ghost', { 'data-action': 'resume', onclick: () => this.handlers.onResume() }, INTRO.resume)
          : null,
      ]),
    ]);
    this.stage.append(panel);
  }

  // ---- rail ----------------------------------------------------------------
  setRail(chapterId: number, beatIndex: number, beatCount: number, stars: Record<number, number>): void {
    this.rail.style.opacity = '1';
    clear(this.rail);
    const chapter = this.chapters.find((c) => c.id === chapterId);
    const pips = el('div.pips', {},
      this.chapters.map((c) =>
        el('button.pip', {
          'data-pip': String(c.id),
          'data-on': c.id === chapterId ? '1' : null,
          'data-stars': String(stars[c.id] ?? 0),
          title: c.title,
          onclick: () => this.handlers.onGotoChapter(c.id),
        }, String(c.id))));
    const label = el('div.rail-label', {}, [
      el('span.rail-ch', {}, `Chapter ${chapterId}`),
      el('span.rail-title', {}, chapter ? chapter.title : ''),
    ]);
    const prog = el('div.rail-prog', {}, `${beatIndex + 1} / ${beatCount}`);
    this.rail.append(label, pips, prog);
  }

  // ---- a beat --------------------------------------------------------------
  showBeat(beat: Beat, chapter: ChapterDef, canBack: boolean): void {
    this.params = {};
    this.verdictSlot = null;
    this.actionSlot = null;
    clear(this.stage);

    const panel = el('section.panel.beat', {
      'data-screen': 'beat',
      'data-beat': beat.id,
      'data-kind': beat.kind,
    });

    if (beat.title) panel.append(el('div.beat-eyebrow', {}, chapter.title));
    if (beat.title) panel.append(el('h2.beat-title', {}, beat.title));
    if (beat.body) panel.append(el('p.beat-body', {}, beat.body));

    const body = el('div.beat-interactive');
    panel.append(body);

    this.verdictSlot = el('div.verdict-slot');
    this.actionSlot = el('div.actions');
    panel.append(this.verdictSlot, this.actionSlot);

    const back = canBack
      ? el('button.btn.tiny.ghost', { 'data-action': 'back', onclick: () => this.handlers.onBack() }, '← Back')
      : null;

    switch (beat.kind) {
      case 'narrate':
        this.mountActions([back, this.nextBtn('Continue')]);
        break;
      case 'predict':
        this.mountPredict(beat, body, back);
        break;
      case 'sandbox':
        this.mountSandbox(beat, body);
        this.mountActions([back, this.nextBtn('Continue')]);
        break;
      case 'challenge':
        this.mountChallenge(beat, body, back);
        break;
      default:
        this.mountActions([back, this.nextBtn('Continue')]);
    }

    this.stage.append(panel);
  }

  private nextBtn(label: string): HTMLElement {
    return el('button.btn.primary', { 'data-action': 'next', onclick: () => this.handlers.onNext() }, label);
  }

  private mountActions(nodes: Array<HTMLElement | null>): void {
    if (!this.actionSlot) return;
    clear(this.actionSlot);
    for (const n of nodes) if (n) this.actionSlot.append(n);
  }

  // predict: a single committed guess, then the reveal happens in the app.
  private mountPredict(beat: Beat, body: HTMLElement, back: HTMLElement | null): void {
    const spec = beat.predict!;
    let value = spec.initial ?? (spec.min ?? 0);
    body.append(el('p.prompt', {}, spec.prompt));
    const { wrap } = this.slider(
      { key: 'guess', label: 'Your guess', min: spec.min ?? 0, max: spec.max ?? 100, step: spec.step ?? 1, initial: value, unit: spec.unit },
      (v) => { value = v; },
    );
    body.append(wrap);
    const lock = el('button.btn.primary', {
      'data-action': 'predict',
      onclick: () => { lock.setAttribute('disabled', ''); this.lockInputs(body); this.handlers.onPredict(value); },
    }, 'Lock in my guess');
    this.mountActions([back, lock]);
  }

  private mountSandbox(beat: Beat, body: HTMLElement): void {
    const sb = beat.sandbox!;
    body.append(el('p.prompt.muted', {}, sb.intro));
    for (const c of sb.controls) {
      this.params[c.key] = c.initial;
      const { wrap } = this.slider(c, (v) => {
        this.params[c.key] = v;
        this.handlers.onSandboxChange(c.key, v);
      });
      body.append(wrap);
    }
  }

  private mountChallenge(beat: Beat, body: HTMLElement, back: HTMLElement | null): void {
    const ch = beat.challenge!;
    body.append(el('p.prompt', {}, ch.prompt));
    for (const c of ch.controls) {
      this.params[c.key] = c.initial;
      this.handlers.onSandboxChange(c.key, c.initial);
      const { wrap } = this.slider(c, (v) => {
        this.params[c.key] = v;
        this.handlers.onSandboxChange(c.key, v);
      });
      body.append(wrap);
    }
    const lock = el('button.btn.primary', {
      'data-action': 'challenge',
      onclick: () => { lock.setAttribute('disabled', ''); this.lockInputs(body); this.handlers.onChallengeSubmit({ ...this.params }); },
    }, 'Lock it in');
    this.mountActions([back, lock]);
  }

  /** Build a labelled range slider with a live numeric readout. */
  private slider(
    c: SandboxControl,
    onInput: (v: number) => void,
  ): { wrap: HTMLElement } {
    const readout = el('span.slider-val', {}, this.fmt(c.initial, c.unit));
    const input = el('input', {
      type: 'range',
      'data-control': c.key,
      min: String(c.min), max: String(c.max), step: String(c.step), value: String(c.initial),
      oninput: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        readout.textContent = this.fmt(v, c.unit);
        onInput(v);
      },
    }) as HTMLInputElement;
    const wrap = el('label.slider', {}, [
      el('span.slider-label', {}, [c.label, readout]),
      input,
    ]);
    return { wrap };
  }

  private fmt(v: number, unit?: string): string {
    if (unit === '$') return `$${Math.round(v)}`;
    return unit ? `${Math.round(v)} ${unit}` : String(Math.round(v));
  }

  private lockInputs(body: HTMLElement): void {
    body.querySelectorAll('input').forEach((i) => i.setAttribute('disabled', ''));
    body.classList.add('locked');
  }

  /** Called by the app after scoring a predict/challenge beat. */
  revealVerdict(view: VerdictView, severity: Severity, lastBeat: boolean): void {
    if (this.verdictSlot) renderVerdict(this.verdictSlot, view, severity);
    this.mountActions([this.nextBtn(lastBeat ? 'See your report card' : 'Continue')]);
  }

  // ---- report card ---------------------------------------------------------
  showReportCard(node: HTMLElement): void {
    this.rail.style.opacity = '0';
    clear(this.stage);
    this.stage.append(node);
  }

  highlightChapter(chapterId: number): void {
    const pip = this.rail.querySelector(`[data-pip="${chapterId}"]`);
    if (pip) qs('[data-rail]').querySelectorAll('.pip').forEach((p) => p.removeAttribute('data-on'));
    pip?.setAttribute('data-on', '1');
  }
}

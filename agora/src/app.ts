// app.ts — the controller. It owns the canvas layers, the ambient field, the scene
// manager, the journey state machine and the DOM shell, and connects them through the
// bus. The economics all lives in econ/; the app just routes player actions to the right
// model, scores them, and tells the scene and the field to react.
import { qs } from '@/core/dom';
import { bus } from '@/core/bus';
import type { Severity } from '@/core/kinds';
import { LayeredCanvas } from '@/render/layers';
import { AgentField } from '@/render/agent-field';
import { SceneManager } from '@/render/scene';
import { SupplyDemandScene } from '@/render/scene-supply-demand';
import { SupplyAuctionScene } from '@/render/scene-auction';
import { ControlsScene } from '@/render/scene-controls';
import { TradeScene } from '@/render/scene-trade';
import { FisheryScene } from '@/render/scene-fishery';
import { palette, setAccent } from '@/render/palette';
import { Journey } from '@/journey/journey';
import { CHAPTERS } from '@/journey/chapters';
import { Shell } from '@/ui/shell';
import type { ShellHandlers } from '@/ui/shell';
import { buildReportCard } from '@/ui/report-card';
import { scorePrediction } from '@/scoring/grade';
import { getProgress, recordBeat, markComplete, wipeProgress } from '@/scoring/progress';
import type { VerdictView } from '@/journey/types';

export class App {
  readonly layers = new LayeredCanvas();
  readonly field = new AgentField(240, 'agora');
  readonly scenes = new SceneManager();
  readonly journey = new Journey(CHAPTERS);
  readonly shell: Shell;

  fps = 0;
  started = false;
  lastEconResult: unknown = null;
  lastVerdict: { severity: Severity; view: VerdictView } | null = null;

  constructor() {
    this.field.resize(this.layers.width, this.layers.height);
    this.scenes.register(new SupplyDemandScene());
    this.scenes.register(new SupplyAuctionScene());
    this.scenes.register(new ControlsScene());
    this.scenes.register(new TradeScene());
    this.scenes.register(new FisheryScene());
    this.scenes.resize(this.layers.width, this.layers.height);

    const handlers: ShellHandlers = {
      onStart: () => this.begin(0),
      onResume: () => this.begin(this.resumeIndex()),
      onNext: () => this.journey.next(),
      onBack: () => this.journey.prev(),
      onPredict: (v) => this.scorePredict(v),
      onSandboxChange: (k, v) => this.scenes.current()?.setParam(k, v),
      onChallengeSubmit: (p) => this.scoreChallenge(p),
      onGotoChapter: (n) => { this.started = true; this.journey.goToChapter(n); },
      onRestart: () => { wipeProgress(); this.begin(0); },
    };
    this.shell = new Shell(qs('#ui'), CHAPTERS, handlers);

    bus.on('beat:entered', () => this.onBeatEntered());
    bus.on('verdict', ({ severity }) => this.reactToVerdict(severity));
    bus.on('journey:complete', () => this.showReportCard());

    window.addEventListener('resize', () => {
      this.field.resize(this.layers.width, this.layers.height);
      this.scenes.resize(this.layers.width, this.layers.height);
    });

    this.shell.showIntro(getProgress().completed || Object.keys(getProgress().chapters).length > 0);
  }

  // ---- flow ----------------------------------------------------------------
  begin(index: number): void {
    this.started = true;
    this.journey.goToIndex(index);
  }

  private resumeIndex(): number {
    // Jump to the first chapter the player hasn't touched yet.
    const prog = getProgress();
    const fresh = CHAPTERS.find((c) => prog.chapters[c.id] === undefined);
    return fresh ? this.firstBeatIndexOf(fresh.id) : 0;
  }

  private firstBeatIndexOf(chapterId: number): number {
    let i = 0;
    for (const c of CHAPTERS) {
      if (c.id === chapterId) return i;
      i += c.beats.length;
    }
    return 0;
  }

  private onBeatEntered(): void {
    const beat = this.journey.beat();
    const chapter = this.journey.chapter();
    setAccent(chapter.accent);
    this.scenes.setActive(beat.scene);
    const scene = this.scenes.get(beat.scene);
    if (scene && beat.sceneParams) {
      for (const [k, v] of Object.entries(beat.sceneParams)) scene.setParam(k, v);
      scene.reveal();
    }
    const stars = getProgress().chapters;
    this.shell.setRail(chapter.id, this.journey.entry().beatIndex, chapter.beats.length, stars);
    this.shell.showBeat(beat, chapter, this.journey.index > 0);
  }

  private scorePredict(value: number): void {
    const beat = this.journey.beat();
    const spec = beat.predict!;
    const score = scorePrediction(value, spec.answer, spec.tolerance);
    const view = spec.verdict(value);
    this.lastVerdict = { severity: score.severity, view };
    this.lastEconResult = { kind: 'predict', value, answer: spec.answer, ...score };
    recordBeat(beat.id, this.journey.chapter().id, score.stars);

    const scene = this.scenes.current();
    scene?.setParam('showEq', 1);
    scene?.setParam('price', value);
    scene?.reveal();

    bus.emit('verdict', { beatId: beat.id, severity: score.severity, metric: view.metric });
    this.shell.revealVerdict(view, score.severity, this.journey.atLast());
  }

  private scoreChallenge(params: Record<string, number>): void {
    const beat = this.journey.beat();
    const spec = beat.challenge!;
    const outcome = spec.evaluate(params);
    this.lastVerdict = { severity: outcome.severity, view: outcome.view };
    this.lastEconResult = { kind: 'challenge', params, ...outcome };
    recordBeat(beat.id, this.journey.chapter().id, outcome.stars);

    bus.emit('verdict', { beatId: beat.id, severity: outcome.severity, metric: outcome.view.metric });
    bus.emit('challenge:scored', { beatId: beat.id, stars: outcome.stars, score: outcome.score });
    this.shell.revealVerdict(outcome.view, outcome.severity, this.journey.atLast());
  }

  private reactToVerdict(severity: Severity): void {
    const intensity = severity === 'catastrophic' ? 0.9 : severity === 'wrong' ? 0.55 : severity === 'close' ? 0.25 : 0;
    const hue = severity === 'nailed' ? palette.good : palette.danger;
    if (intensity > 0) this.field.pulse(intensity, hue);
    this.scenes.current()?.showVerdict(severity);
  }

  private showReportCard(): void {
    markComplete();
    this.scenes.setActive('ambient');
    this.shell.showReportCard(buildReportCard(CHAPTERS, () => { wipeProgress(); this.begin(0); }));
  }

  // ---- debug hooks (driven by window.AG / the smoke test) -----------------
  debugPredict(value: number): void { this.scorePredict(value); }
  debugChallenge(params: Record<string, number>): void { this.scoreChallenge(params); }
  debugSetSandbox(key: string, value: number): void { this.scenes.current()?.setParam(key, value); }
  debugRunSim(): void { this.scenes.current()?.runToCompletion?.(); }
  debugResult(): unknown { return this.scenes.current()?.result?.() ?? this.lastEconResult; }

  /** Auto-solve the current beat using the engine's correct answer. */
  debugSolve(): void {
    const beat = this.journey.beat();
    if (beat.kind === 'predict' && beat.predict) this.scorePredict(beat.predict.answer);
    else if (beat.kind === 'challenge' && beat.challenge?.solution) this.scoreChallenge(beat.challenge.solution);
  }

  debugComplete(): void {
    this.started = true;
    this.journey.goToIndex(this.journey.length - 1);
    this.journey.next(); // fires journey:complete → report card
  }

  debugWipe(): void {
    wipeProgress();
    this.started = false;
    this.scenes.setActive('ambient');
    this.shell.showIntro(false);
  }

  // ---- frame ---------------------------------------------------------------
  update(dt: number, t: number): void {
    this.field.update(dt, t);
    this.scenes.update(dt, t);
  }

  render(t: number): void {
    this.layers.clear('bg');
    this.field.render(this.layers.ctx('bg'), t, this.layers.scroll);
    this.layers.clear('scene');
    if (this.started) this.scenes.render(this.layers.ctx('scene'));
  }
}

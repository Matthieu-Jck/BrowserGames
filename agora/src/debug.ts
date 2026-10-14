// debug.ts — window.AG: a deterministic handle for driving the journey from the console
// and the headless smoke test, without depending on animation or click timing. Analogous
// to replicatas' window.RP and overtime's window.OT.
import type { App } from './app';

export interface AgoraDebug {
  app: App;
  state(): { index: number; chapter: number; beatId: string; kind: string; started: boolean };
  start(): void;
  goToChapter(n: number): void;
  goToBeat(chapter: number, beatIndex: number): void;
  next(): boolean;
  prev(): boolean;
  predict(value: number): void;
  submit(params: Record<string, number>): void;
  setSandbox(key: string, value: number): void;
  solve(): void;
  runSim(): void;
  result(): unknown;
  verdict(): unknown;
  fps(): number;
  complete(): void;
  wipe(): void;
}

export function installDebug(app: App): void {
  const api: AgoraDebug = {
    app,
    state: () => ({
      index: app.journey.index,
      chapter: app.journey.chapter().id,
      beatId: app.journey.beat().id,
      kind: app.journey.beat().kind,
      started: app.started,
    }),
    start: () => app.begin(0),
    goToChapter: (n) => { app.started = true; app.journey.goToChapter(n); },
    goToBeat: (c, i) => { app.started = true; app.journey.goToBeat(c, i); },
    next: () => app.journey.next(),
    prev: () => app.journey.prev(),
    predict: (v) => app.debugPredict(v),
    submit: (p) => app.debugChallenge(p),
    setSandbox: (k, v) => app.debugSetSandbox(k, v),
    solve: () => app.debugSolve(),
    runSim: () => app.debugRunSim(),
    result: () => app.debugResult(),
    verdict: () => app.lastVerdict,
    fps: () => app.fps,
    complete: () => app.debugComplete(),
    wipe: () => app.debugWipe(),
  };
  (window as unknown as { AG: AgoraDebug }).AG = api;
}

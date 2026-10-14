// journey.ts — the beat state machine. It flattens the chapters into an ordered list of
// beats and tracks where the player is. It owns position only; the app listens for
// `beat:entered` and drives the scene, the panel and scoring. Advancing past the last
// beat fires `journey:complete`.
import type { Beat, ChapterDef } from './types';
import { bus } from '@/core/bus';

interface Entry {
  chapter: ChapterDef;
  beat: Beat;
  beatIndex: number; // index within the chapter
}

export class Journey {
  private flat: Entry[] = [];
  private idx = 0;

  constructor(public readonly chapters: ChapterDef[]) {
    for (const chapter of chapters) {
      chapter.beats.forEach((beat, beatIndex) => this.flat.push({ chapter, beat, beatIndex }));
    }
  }

  get length(): number { return this.flat.length; }
  get index(): number { return this.idx; }

  entry(): Entry { return this.flat[this.idx]!; }
  beat(): Beat { return this.flat[this.idx]!.beat; }
  chapter(): ChapterDef { return this.flat[this.idx]!.chapter; }
  atLast(): boolean { return this.idx >= this.flat.length - 1; }

  /** Announce the current beat. Call once after construction to start. */
  announce(): void {
    const e = this.entry();
    bus.emit('beat:entered', { chapter: e.chapter.id, beatId: e.beat.id, kind: e.beat.kind });
  }

  /** Advance one beat. Returns false (and fires journey:complete) at the end. */
  next(): boolean {
    if (this.idx >= this.flat.length - 1) {
      bus.emit('journey:complete');
      return false;
    }
    this.idx++;
    this.announce();
    return true;
  }

  prev(): boolean {
    if (this.idx <= 0) return false;
    this.idx--;
    this.announce();
    return true;
  }

  goToIndex(i: number): void {
    this.idx = Math.max(0, Math.min(this.flat.length - 1, i));
    this.announce();
  }

  /** Jump to the first beat of a chapter (1-based id). */
  goToChapter(chapterId: number): void {
    const at = this.flat.findIndex((e) => e.chapter.id === chapterId);
    if (at >= 0) { this.idx = at; this.announce(); }
  }

  goToBeat(chapterId: number, beatIndex: number): void {
    const at = this.flat.findIndex((e) => e.chapter.id === chapterId && e.beatIndex === beatIndex);
    if (at >= 0) { this.idx = at; this.announce(); }
  }
}

// terrain.worker.ts — paints terrain chunks off the main thread (OffscreenCanvas → transferred
// ImageBitmap). Pure painting: the main thread sends the chunk window arrays and which
// texture it wants — the ground ('g', both views), the relief paint ('r', iso only) or the rock's
// sun shadows ('s', iso only, for the light `sun`).
import { paintChunk, paintRelief, paintSunShadows, WIN, type PaintData } from './terrain';

interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

// Scratch canvases reused per size (the ground field and the shadow layer differ).
const scratches = new Map<string, OffscreenCanvas>();
const scratch = (w: number, h: number): OffscreenCanvas => {
  const key = `${w}x${h}`;
  let c = scratches.get(key);
  if (!c) { c = new OffscreenCanvas(w, h); scratches.set(key, c); }
  return c;
};

export interface PaintRequest extends PaintData { key: string; ppt: number; kind: 'g' | 'r' | 's'; sun?: readonly [number, number] }

/** Reply: the bitmap, null when there is nothing to paint (no rock), or an error message. */
export interface PaintReply { key: string; bitmap: ImageBitmap | null; error?: string }

scope.onmessage = (e: MessageEvent) => {
  const req = e.data as PaintRequest;
  try {
    const size = 32 * req.ppt;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d')!;
    if (req.terrain.length !== WIN * WIN) throw new Error('bad window');
    if (req.kind === 'r' || req.kind === 's') {
      const any = req.kind === 'r' ? paintRelief(ctx, req, req.ppt, scratch) : paintSunShadows(ctx, req, req.ppt, req.sun ?? [0, 0]);
      if (!any) { scope.postMessage({ key: req.key, bitmap: null } satisfies PaintReply); return; }
    } else paintChunk(ctx, req, req.ppt, scratch);
    const bitmap = canvas.transferToImageBitmap();
    scope.postMessage({ key: req.key, bitmap } satisfies PaintReply, [bitmap]);
  } catch (err) {
    // Always answer: the main thread keeps a request "in flight" until it hears back.
    scope.postMessage({ key: req.key, bitmap: null, error: err instanceof Error ? err.message : String(err) } satisfies PaintReply);
  }
};

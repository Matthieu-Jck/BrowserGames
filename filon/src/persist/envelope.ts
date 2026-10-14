// envelope.ts — a save as it is stored and exported: a small readable header (format, payload
// version, the build that wrote it, when, the tick, the base's name, its sequence number) around
// the payload — the colony's SaveData as JSON, gzipped — and a checksum of those bytes, so a
// damaged slot is recognised and skipped instead of loaded (plan §9, « jamais de remise à zéro
// silencieuse »). The export file (`.ocelle`) is the same envelope as JSON text, the payload in
// base64.
import type { SaveData } from '@/sim/serialize';

export const FORMAT = 'ocelle';

export interface Envelope {
  format: typeof FORMAT;
  /** SaveData.v of the payload (migrations follow it). */
  version: number;
  appVersion: string;
  /** Wall-clock ms when it was written. */
  savedAt: number;
  tick: number;
  colonyName: string;
  /** Grows by one with every save of this base (the newest valid slot wins). */
  seq: number;
  checksum: number;
  /** gzip(JSON(SaveData)). */
  payload: Uint8Array;
}

/** FNV-1a over the bytes: any single changed byte changes it (each step is a bijection of the state). */
export function checksum(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193) >>> 0;
  return h;
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function seal(data: SaveData, meta: { savedAt: number; seq: number }): Promise<Envelope> {
  const payload = await gzip(JSON.stringify(data));
  return {
    format: FORMAT, version: data.v, appVersion: __APP_VERSION__, savedAt: meta.savedAt, tick: data.tick,
    colonyName: data.colonyName, seq: meta.seq, checksum: checksum(payload), payload,
  };
}

/** Is it one of ours, whole? (No decompression: cheap enough to check every slot.) */
export function intact(e: unknown): e is Envelope {
  const v = e as Partial<Envelope> | null;
  return !!v && v.format === FORMAT && v.payload instanceof Uint8Array && typeof v.seq === 'number'
    && typeof v.version === 'number' && checksum(v.payload) === v.checksum;
}

/** The SaveData inside (throws if the envelope is damaged). */
export async function unseal(e: Envelope): Promise<SaveData> {
  if (!intact(e)) throw new Error('damaged save');
  return JSON.parse(await gunzip(e.payload)) as SaveData;
}

/** The export file's text. */
export function toText(e: Envelope): string {
  let bin = '';
  for (let i = 0; i < e.payload.length; i += 0x8000) bin += String.fromCharCode(...e.payload.subarray(i, i + 0x8000));
  return JSON.stringify({ ...e, payload: btoa(bin) });
}

/** An export file's envelope, or null when it is not one (or not whole). */
export function fromText(text: string): Envelope | null {
  try {
    const o = JSON.parse(text) as Omit<Envelope, 'payload'> & { payload: string };
    if (typeof o.payload !== 'string') return null;
    const bin = atob(o.payload);
    const payload = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) payload[i] = bin.charCodeAt(i);
    const e = { ...o, payload };
    return intact(e) ? e : null;
  } catch {
    return null;
  }
}

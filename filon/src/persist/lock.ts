// lock.ts — one tab plays the base at a time (plan §9). Two tabs ticking and saving the same
// base would overwrite each other's progress, so the tab that plays holds a Web Lock; a second
// tab finds it taken and offers « Reprendre ici »: it asks the first tab (BroadcastChannel) to
// save and let go, then waits for the lock and loads the base from that fresh save. Browsers
// without Web Locks play without the guard.

export interface ColonyLock {
  /** Let the lock go (after a final save). */
  release(): void;
  /** Another tab asks to take the base over: save, release, step aside. */
  onTakeover(cb: () => void): void;
}

const channelOf = (name: string): BroadcastChannel | null => {
  try { return typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null; } catch { return null; }
};

function hold(name: string, wait: boolean): Promise<ColonyLock | null> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const channel = channelOf(name);
  let free: (() => void) | null = null;
  let takeover: (() => void) | null = null;
  const handle: ColonyLock = {
    release: () => { free?.(); free = null; channel?.close(); },
    onTakeover: (cb) => { takeover = cb; },
  };
  if (channel) channel.onmessage = (e: MessageEvent) => { if (e.data === 'takeover') takeover?.(); };
  if (!locks) return Promise.resolve(handle);
  return new Promise((resolve) => {
    void locks.request(name, wait ? {} : { ifAvailable: true }, (lock) => {
      if (!lock) { channel?.close(); resolve(null); return undefined; }
      resolve(handle);
      return new Promise<void>((r) => { free = r; });
    });
  });
}

/** The lock if no other tab holds it, else null. */
export const tryLock = (name: string): Promise<ColonyLock | null> => hold(name, false);

/** Ask the tab holding the lock to let go, and wait for it. */
export function takeOver(name: string): Promise<ColonyLock> {
  const channel = channelOf(name);
  channel?.postMessage('takeover');
  channel?.close();
  return hold(name, true) as Promise<ColonyLock>;
}

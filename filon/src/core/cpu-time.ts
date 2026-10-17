// cpu-time.ts — the clock of the tests' time limits (docs/testing.md, "Time limits"): the CPU time
// the calling thread has spent, so a limit measures the code's own work, not how busy the machine
// is. On the wall clock, several sessions running vitest at once failed limits that hold alone (the
// debug bases built in under 3 s, a market week in under 0.5 s, the bench's catch-up). It reads
// `process.threadCpuUsage` (Node ≥ 23.9): vitest's default pool runs several test files as threads
// of one process, whose `process.cpuUsage` would add their work to ours. Where that is missing (an
// older Node, a browser), it falls back to the wall clock, as the limits ran before.
// Test-only: nothing of the engine imports it (the determinism guard bans clocks there).

interface Usage { user: number; system: number }

const proc = (globalThis as { process?: { threadCpuUsage?: () => Usage } }).process;

/** Does the clock count this thread's CPU time (else the wall clock)? */
export const CPU_CLOCK = typeof proc?.threadCpuUsage === 'function';

/** The clock now, in ms: this thread's CPU time (user + system), else the wall clock. */
export function clockMs(): number {
  if (!CPU_CLOCK) return performance.now();
  const u = proc!.threadCpuUsage!();
  return (u.user + u.system) / 1000;
}

/** Run `fn`: its value, its time on the clock (`ms`) and on the wall (`wall`, for the logs). */
export function timed<T>(fn: () => T): { value: T; ms: number; wall: number } {
  const c0 = clockMs(), w0 = performance.now();
  const value = fn();
  return { value, ms: clockMs() - c0, wall: performance.now() - w0 };
}

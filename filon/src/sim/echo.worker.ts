// echo.worker.ts — M0 probe: proves module workers bundle and round-trip in dev AND in the
// preview build (the classic place where worker URLs break). Replaced by catchup.worker.ts.

interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(msg: unknown): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e: MessageEvent) => {
  scope.postMessage({ echo: e.data, from: 'worker' });
};

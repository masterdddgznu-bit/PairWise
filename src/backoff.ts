/**
 * Deterministic backoff used by tests. Do not change the formula.
 * backoff = min(maxBackoff, base * 2^(attempt-1)) + jitter
 * jitter = hash(runId:taskId:attempt) % (floor(exp/2)+1)
 */
export function expectedBackoffMs(
  attempt: number,
  baseBackoffMs: number,
  maxBackoffMs: number,
  runId: string,
  taskId: string,
): number {
  const exp = Math.min(
    maxBackoffMs,
    baseBackoffMs * 2 ** Math.max(0, attempt - 1),
  );
  const key = `${runId}:${taskId}:${attempt}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const jitter = h % (Math.floor(exp / 2) + 1);
  return exp + jitter;
}

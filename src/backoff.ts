export function backoffMs(
  baseBackoffMs: number,
  backoffCapMs: number,
  attempt: number,
): number {
  let delay = baseBackoffMs;
  for (let i = 1; i < attempt; i += 1) {
    delay *= 2;
    if (delay >= backoffCapMs) {
      return backoffCapMs;
    }
  }
  return Math.min(delay, backoffCapMs);
}

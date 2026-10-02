export function retryDelay(base: number, failedAttempt: number): number {
  return base * 2 ** (failedAttempt - 1);
}

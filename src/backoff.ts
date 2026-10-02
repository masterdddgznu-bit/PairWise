export function retryDelay(base: number, failedAttempt: number): number {
  return base * failedAttempt;
}

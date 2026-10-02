export function attemptKey(sagaId: string, step: string, attempt: number): string {
  return `${sagaId}::${step}::${attempt}`;
}

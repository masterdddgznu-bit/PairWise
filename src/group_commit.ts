/** Whether group-commit deadline has been reached — stub always false. */
export function shouldFlush(
  _now: number,
  _firstEnqueueAt: number | null,
  _delay: number,
): boolean {
  return false;
}

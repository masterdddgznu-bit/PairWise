/** Whether group-commit deadline has been reached. */
export function shouldFlush(
  now: number,
  firstEnqueueAt: number | null,
  delay: number,
): boolean {
  if (firstEnqueueAt === null) return false;
  return now >= firstEnqueueAt + delay;
}

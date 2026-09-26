/** Whether the group-commit deadline has been reached. */
export function shouldFlush(
  now: number,
  firstEnqueueAt: number | null,
  delay: number,
): boolean {
  return firstEnqueueAt !== null && now >= firstEnqueueAt + delay;
}

export function tick(local: number): number {
  return local + 1;
}
export function onReceive(local: number, msgClock: number): number {
  return Math.max(local, msgClock) + 1;
}
/** return <0 if a has priority over b (a should go first) */
export function cmpRequest(
  aTs: number,
  aId: number,
  bTs: number,
  bId: number,
): number {
  if (aTs !== bTs) return aTs < bTs ? -1 : 1;
  if (aId !== bId) return aId < bId ? -1 : 1;
  return 0;
}

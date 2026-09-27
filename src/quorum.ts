export function majorityOf(n: number): number {
  return Math.floor(n / 2) + 1;
}
export function hasQuorum(count: number, n: number): boolean {
  return count >= majorityOf(n);
}

export function nextIndex(_i: number, _n: number): number {
  return (_i + 1) % _n;
}
export function defaultUids(_n: number): number[] {
  return Array.from({ length: _n }, (_, index) => index);
}

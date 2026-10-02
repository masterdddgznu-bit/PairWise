export function leftChild(_i: number): number {
  return 2 * _i;
}

export function rightChild(_i: number): number {
  return 2 * _i + 1;
}

export function parent(_i: number): number {
  return Math.floor(_i / 2);
}

export function midSplit(_left: number, _right: number): number {
  return Math.floor((_left + _right) / 2);
}

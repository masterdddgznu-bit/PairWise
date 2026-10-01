/** Count Sketch table helpers. */
export function createTable(depth: number, width: number): number[][] {
  return Array.from({ length: depth }, () => new Array<number>(width).fill(0));
}

export function cloneTable(table: number[][]): number[][] {
  return table.map((row) => row.slice());
}

export function countNonZero(table: number[][]): number {
  let count = 0;
  for (const row of table) {
    for (const cell of row) {
      if (cell !== 0) count++;
    }
  }
  return count;
}

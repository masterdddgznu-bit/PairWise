export type Dot = {
  nodeId: string;
  counter: number;
};

export type Hint = {
  target: string;
  key: string;
  value: string;
  version: Dot;
};

export type PutResult = {
  ok: boolean;
  written: string[];
  hinted: { holder: string; target: string }[];
};

export type GetResult = {
  value: string | undefined;
  repaired: number;
};

/** LWW order: (counter, nodeId) lexicographic; larger wins. */
export function compareDots(a: Dot, b: Dot): number {
  if (a.counter !== b.counter) return a.counter - b.counter;
  if (a.nodeId === b.nodeId) return 0;
  return a.nodeId < b.nodeId ? -1 : 1;
}

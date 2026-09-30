/** Signature helpers — starter stub. */
export const EMPTY_SLOT = 0xffffffff;

export function createEmptySignature(_k: number): Uint32Array {
  throw new Error("createEmptySignature not implemented");
}

export function updateSignature(_sig: Uint32Array, _key: string, _seed: number): void {
  throw new Error("updateSignature not implemented");
}

export function mergeSignatures(_target: Uint32Array, _other: Uint32Array): void {
  throw new Error("mergeSignatures not implemented");
}

export function countFilled(_sig: Uint32Array): number {
  throw new Error("countFilled not implemented");
}

export function estimateFromSignatures(_a: Uint32Array, _b: Uint32Array): number {
  throw new Error("estimateFromSignatures not implemented");
}

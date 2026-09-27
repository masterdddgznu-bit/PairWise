import type { MerkleProof } from "./types.js";

export function makeProof(
  _key: string,
  _live: { key: string; value: string }[],
): MerkleProof | null {
  throw new Error("makeProof not implemented");
}

export function verifyProof(_proof: MerkleProof): boolean {
  throw new Error("verifyProof not implemented");
}

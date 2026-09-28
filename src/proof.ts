import type { MerkleProof } from "./types.js";
import { leafHash, nodeHash } from "./hash.js";
import { buildLevels, computeRoot } from "./tree.js";
import type { LiveEntry } from "./tree.js";

export function makeProof(
  key: string,
  live: LiveEntry[],
): MerkleProof | null {
  const sorted = [...live].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const index = sorted.findIndex((e) => e.key === key);
  if (index === -1) return null;

  const levels = buildLevels(sorted);
  const path: MerkleProof["path"] = [];
  let pos = index;

  for (let level = 0; level < levels.length - 1; level += 1) {
    const current = levels[level];
    if (pos % 2 === 0) {
      if (pos + 1 < current.length) {
        path.push({ side: "R", hash: current[pos + 1] });
      }
    } else {
      path.push({ side: "L", hash: current[pos - 1] });
    }
    pos = Math.floor(pos / 2);
  }

  return {
    key,
    value: sorted[index].value,
    root: computeRoot(sorted),
    path,
  };
}

export function verifyProof(proof: MerkleProof): boolean {
  let hash = leafHash(proof.key, proof.value);
  for (const step of proof.path) {
    hash =
      step.side === "L"
        ? nodeHash(step.hash, hash)
        : nodeHash(hash, step.hash);
  }
  return hash === proof.root;
}

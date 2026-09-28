import { leafHash, nodeHash } from "./hash.js";
import { buildLevels } from "./tree.js";
import type { MerkleProof } from "./types.js";

export function makeProof(
  key: string,
  live: { key: string; value: string }[],
): MerkleProof | null {
  const sorted = [...live].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const leafIndex = sorted.findIndex((e) => e.key === key);
  if (leafIndex < 0) return null;

  const entry = sorted[leafIndex];
  const levels = buildLevels(sorted);
  const root = levels[levels.length - 1][0];
  const path: MerkleProof["path"] = [];

  let idx = leafIndex;
  for (let lvl = 0; lvl < levels.length - 1; lvl++) {
    const nodes = levels[lvl];
    const sibling = idx ^ 1;
    if (sibling < nodes.length) {
      path.push({
        side: sibling < idx ? "L" : "R",
        hash: nodes[sibling],
      });
    }
    idx = idx >> 1;
  }

  return { key: entry.key, value: entry.value, root, path };
}

export function verifyProof(_proof: MerkleProof): boolean {
  let hash = leafHash(_proof.key, _proof.value);
  for (const step of _proof.path) {
    hash =
      step.side === "L"
        ? nodeHash(step.hash, hash)
        : nodeHash(hash, step.hash);
  }
  return hash === _proof.root;
}

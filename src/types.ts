export type Entry = {
  key: string;
  value: string;
  ver: number;
  deleted: boolean;
  expireAt: number | null;
};

export type ProofStep = {
  side: "L" | "R";
  hash: string;
};

export type MerkleProof = {
  key: string;
  value: string;
  root: string;
  path: ProofStep[];
};

export type DiffOp = {
  key: string;
  value: string;
  ver: number;
  deleted: boolean;
};

export type DeleteOpts = {
  ttlMs?: number;
};

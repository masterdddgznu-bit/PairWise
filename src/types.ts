export type DiffResult = {
  added: string[];
  removed: string[];
  changed: string[];
};

export type SnapOpts = {
  ttlMs?: number;
};

export type Stats = {
  snapshots: number;
  versions: number;
};

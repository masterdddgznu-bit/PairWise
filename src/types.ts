export type LeafNodeState = {
  id: number;
  keys: string[];
  values: number[];
  next: number | null;
};

export type InternalNodeState = {
  id: number;
  keys: string[];
  children: number[];
};

export type BPlusTreeState = {
  order: number;
  frozen: boolean;
  rootId: number;
  nextId: number;
  leaves: LeafNodeState[];
  internals: InternalNodeState[];
};

export type BPlusStats = {
  order: number;
  frozen: boolean;
  size: number;
  height: number;
  leafCount: number;
};

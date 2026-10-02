export type AvlNodeState = {
  id: number;
  key: string;
  value: number;
  height: number;
  leftId: number | null;
  rightId: number | null;
};

export type AvlTreeState = {
  frozen: boolean;
  rootId: number | null;
  nextId: number;
  nodes: AvlNodeState[];
};

export type AvlStats = {
  frozen: boolean;
  size: number;
  height: number;
  nodeCount: number;
};

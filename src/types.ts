export type FibNodeState = {
  id: number;
  key: string;
  priority: number;
  degree: number;
  mark: boolean;
  parentId: number | null;
  childId: number | null;
  leftId: number | null;
  rightId: number | null;
};

export type FibHeapState = {
  frozen: boolean;
  minId: number | null;
  nextId: number;
  nodes: FibNodeState[];
};

export type FibStats = {
  frozen: boolean;
  size: number;
  treeCount: number;
  maxDegree: number;
  markedCount: number;
};

/** Mutable min handle for link / cut / consolidate helpers. */
export type FibHandle = {
  min: import("./node.js").FibNode | null;
};

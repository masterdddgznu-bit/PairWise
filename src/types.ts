export type Dot = {
  replicaId: string;
  counter: number;
};

export type TaggedElem = {
  elem: string;
  dot: Dot;
};

export type Delta = {
  adds: TaggedElem[];
  removes: TaggedElem[];
};

export type VersionVector = Record<string, number>;

export type TagView = {
  live: Dot[];
  tomb: Dot[];
};

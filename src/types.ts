export type Dot = {
  replicaId: string;
  counter: number;
};

export type Entry = {
  key: string;
  value: string | null;
  dot: Dot;
};

export type Delta = {
  entries: Entry[];
};

export type VersionVector = Record<string, number>;

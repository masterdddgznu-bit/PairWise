export type Dot = {
  replicaId: string;
  counter: number;
};

export type Atom = {
  id: Dot;
  value: string | null;
  leftOrigin: Dot | null;
};

export type Delta = {
  atoms: Atom[];
};

export type VersionVector = Record<string, number>;

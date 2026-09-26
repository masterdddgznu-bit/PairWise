import type { VectorClock } from "./vector_clock.js";

export type Op = {
  key: string;
  value: string;
  vv: VectorClock;
  replicaId: number;
  counter: number;
};

export type VersionedValue = {
  value: string;
  vv: VectorClock;
};

export type SiblingSet = VersionedValue[];

export type GetResult = {
  values: string[];
  context: VectorClock;
};

export type PutResult = {
  context: VectorClock;
};

export interface VirtualClock {
  now(): number;
}

export interface SchemaEvoOptions {
  clock: VirtualClock;
  rolloutMs: number;
  maxSubjects?: number;
  maxVersions?: number;
  maxConsumers?: number;
  maxRollouts?: number;
}

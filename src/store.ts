/** Placeholder for cross-cutting snapshot envelope. */
export type SnapshotEnvelope = {
  mode: string;
  watermark: { maxEvent: number };
  tumbling?: unknown;
  session?: unknown;
  late: unknown;
};

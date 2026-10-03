import type { VirtualClock } from "./clock.js";

export type SnapLaneOptions = {
  clock: VirtualClock;
  maxSnaps?: number;
};

export type LaneKind = "head" | "snapshot" | "branch";

export type LaneMeta = {
  name: string;
  kind: LaneKind;
  readonly: boolean;
  deadline: number | null;
  /** map key -> pageId */
  entries: Map<string, number>;
};

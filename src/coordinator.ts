import type { Message, Phase } from "./types.js";

export class Coordinator {
  phase: Phase = "idle";
  txId: string | null = null;
  inbox: Message[] = [];
  cohortSnapshot: number[] = [];
  votes = new Map<number, boolean>();
  acks = new Set<number>();
  voteDeadline = 0;
  preDeadline = 0;
}

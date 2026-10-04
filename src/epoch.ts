export type EpochState = "open" | "sealing" | "sealed";
export type TicketState = "pending" | "running" | "done" | "cancelled";

export interface Ticket {
  ticket: number;
  payload: string;
  state: TicketState;
  fence?: number;
}

export interface EpochRecord {
  epoch: number;
  state: EpochState;
  tickets: Map<number, Ticket>;
  pendingQueue: number[];
  runningCount: number;
  results: Array<{ ticket: number; payload: string }>;
  sealAt?: number;
  nextTicket: number;
}

export function createEpoch(epoch: number): EpochRecord {
  return {
    epoch,
    state: "open",
    tickets: new Map(),
    pendingQueue: [],
    runningCount: 0,
    results: [],
    nextTicket: 1,
  };
}

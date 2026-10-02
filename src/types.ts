export type LogEntry = { index: number; payload: string };

export type ReplicLogOptions = {
  n: number;
  w: number;
};

export type ReplicLogSnapshot = {
  n: number;
  w: number;
  committed: number;
  down: number[];
  logs: LogEntry[][];
};

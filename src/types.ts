export type LockMode = "IS" | "IX" | "S" | "SIX" | "X";

export type AcquireOpts = {
  wait?: boolean;
  timeoutMs?: number;
};

export type WaitInfo = {
  resource: string;
  mode: LockMode;
};

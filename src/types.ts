export type LockMode = "S" | "X";

export type TxStatus = "active" | "waiting" | "committed" | "aborted";

export type TwoPlOptions = {
  deadlock?: boolean;
  lockTimeoutMs?: number;
};

export type Waiter = {
  txId: string;
  key: string;
  mode: LockMode;
  expireAt: number;
};

export type Grant = {
  txId: string;
  mode: LockMode;
};

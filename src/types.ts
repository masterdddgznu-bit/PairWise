export type Mail = { from: number; payload: string };

export type CausalMessage = {
  from: number;
  seq: number;
  payload: string;
  vc: number[];
};

export type Missing = { from: number; seq: number };

export type RepairRequest = {
  to: number;
  missing: Missing[];
};

export type VecBufOpts = {
  repairTimeoutMs?: number;
};

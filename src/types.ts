export type Frame = {
  key: string | null;
  value: number;
  ref: boolean;
};

export type ClockState = {
  capacity: number;
  hand: number;
  frames: Frame[];
};

export type ClockStats = {
  capacity: number;
  frozen: boolean;
  size: number;
  hand: number;
};

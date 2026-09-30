export type SSEntry = {
  key: string;
  count: number;
  error: number;
};

export type SSStats = {
  capacity: number;
  size: number;
  totalOffered: number;
  frozen: boolean;
};

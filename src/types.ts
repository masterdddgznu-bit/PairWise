export type Timer = {
  id: string;
  payload: string;
  deadline: number;
  seq: number;
};
export type FiredTimer = {
  id: string;
  payload: string;
  deadline: number;
};

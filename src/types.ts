export type Event = {
  id: string;
  key: string;
  eventTime: number;
  value: string;
};

export type JoinOut = {
  id: string;
  key: string;
  left: Event;
  right: Event;
  eventTime: number;
};

export type Side = "L" | "R";

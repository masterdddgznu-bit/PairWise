export type Dot = {
  nodeId: string;
  counter: number;
};

export type Hint = {
  target: string;
  key: string;
  value: string;
  version: Dot;
};

export type PutResult = {
  ok: boolean;
  written: string[];
  hinted: { holder: string; target: string }[];
};

export type GetResult = {
  value: string | undefined;
  repaired: number;
};

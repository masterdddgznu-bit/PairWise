export type Message = {
  kind: "COLOR";
  from: number;
  color: number;
  epoch: number;
};

export type Phase = "idle" | "six" | "three" | "done";

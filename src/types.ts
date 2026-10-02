export type Message = {
  kind: "COLOR";
  from: number;
  color: number;
  round: number;
  step: number;
};

export type Phase = "idle" | "running" | "done";

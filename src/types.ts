export type Message = {
  kind: "COLOR";
  from: number;
  color: number;
  round: number;
};

export type Phase = "idle" | "running" | "done";

export type ElectionMsg = { type: "election"; from: number };
export type OkMsg = { type: "ok"; from: number };
export type CoordinatorMsg = { type: "coordinator"; leaderId: number };
export type Msg = ElectionMsg | OkMsg | CoordinatorMsg;

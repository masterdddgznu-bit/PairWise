export type AppMsg = { kind: "app"; payload: string };
export type MarkerMsg = { kind: "marker" };
export type Msg = AppMsg | MarkerMsg;

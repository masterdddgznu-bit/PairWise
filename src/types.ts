export type TenantConfig = {
  id: string;
  weight: number;
  maxInFlight: number;
};

export type RequestState = "queued" | "running" | "done" | "timeout" | "cancelled";

export type AdmitCtlOptions = {
  clock: import("./clock.js").VirtualClock;
  globalLimit: number;
  tenants: TenantConfig[];
};

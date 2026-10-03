export type LockMode = "IS" | "IX" | "S" | "SIX" | "X";

export type ResourceSpec = {
  id: string;
  parent: string | null;
};

export type GranLockOptions = {
  resources: ResourceSpec[];
};

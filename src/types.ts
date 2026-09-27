export type Effect = "allow" | "deny";

export type Grant = {
  subject: string;
  role: string;
  resource: string;
  effect: Effect;
  expireAt: number | null;
};

export type GrantOpts = {
  ttlMs?: number;
  effect?: Effect;
};

export type AuthzEventType = "grant" | "revoke" | "expire";

export type AuthzEvent = {
  seq: number;
  type: AuthzEventType;
  subject: string;
  role: string;
  resource: string;
  at: number;
};

export type TxnOp =
  | {
      type: "grant";
      subject: string;
      role: string;
      resource: string;
      opts?: GrantOpts;
    }
  | { type: "revoke"; subject: string; role: string; resource: string }
  | { type: "addRoleParent"; child: string; parent: string };

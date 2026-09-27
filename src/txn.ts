import { TxnError } from "./errors.js";
import type { AuthzPolicy } from "./policy.js";
import type { TxnOp } from "./types.js";

export function applyTxn(policy: AuthzPolicy, ops: TxnOp[]): void {
  const snapshot = policy.snapshot();
  try {
    for (const op of ops) {
      switch (op.type) {
        case "grant":
          policy.grant(op.subject, op.role, op.resource, op.opts);
          break;
        case "revoke":
          if (!policy.revoke(op.subject, op.role, op.resource)) {
            throw new TxnError(
              `revoke target not found: ${op.subject}/${op.role}/${op.resource}`,
            );
          }
          break;
        case "addRoleParent":
          policy.addRoleParent(op.child, op.parent);
          break;
      }
    }
  } catch (err) {
    policy.restore(snapshot);
    if (err instanceof TxnError) throw err;
    throw new TxnError(err instanceof Error ? err.message : String(err));
  }
}

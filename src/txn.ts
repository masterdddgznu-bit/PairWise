import { TxnError } from "./errors.js";
import type { AuthzPolicy } from "./policy.js";
import type { TxnOp } from "./types.js";

export function applyTxn(policy: AuthzPolicy, ops: TxnOp[]): void {
  const snapshot = policy.snapshotState();
  try {
    for (const op of ops) {
      if (op.type === "grant") {
        policy.commitGrant(op.subject, op.role, op.resource, op.opts);
      } else if (op.type === "revoke") {
        const removed = policy.commitRevoke(op.subject, op.role, op.resource);
        if (!removed) {
          throw new TxnError(
            `revoke target does not exist: ${op.subject}/${op.role}/${op.resource}`,
          );
        }
      } else {
        policy.commitAddRoleParent(op.child, op.parent);
      }
    }
  } catch (err) {
    policy.restoreState(snapshot);
    if (err instanceof TxnError) throw err;
    const message = err instanceof Error ? err.message : "transaction failed";
    throw new TxnError(message);
  }
}

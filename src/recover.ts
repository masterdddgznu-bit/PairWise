import type { Journal } from "./journal.js";
import type { Participant } from "./participant.js";
import type { CoordinatorState } from "./coordinator.js";

type RecoveredTx = {
  prepared: boolean;
  preparedParticipants: number[];
  final?: "committed" | "aborted";
};

/**
 * Replay the journal after a coordinator crash.
 *
 * Transactions that reached the prepare point without a terminal record are
 * committed; everything else left open is aborted, and any participant-side
 * in-doubt locks are released. New decision records are appended to the
 * journal so recovery is idempotent across repeated crashes.
 */
export function recoverFromJournal(
  journal: Journal,
  participants: Participant[],
  state: CoordinatorState,
): void {
  const txs = new Map<string, RecoveredTx>();

  const track = (txId: string): RecoveredTx => {
    let tx = txs.get(txId);
    if (!tx) {
      tx = { prepared: false, preparedParticipants: [] };
      txs.set(txId, tx);
    }
    return tx;
  };

  for (const entry of [...journal.entries()]) {
    const tx = track(entry.txId);
    if (entry.type === "prepared") {
      tx.prepared = true;
      tx.preparedParticipants = [...entry.participants];
    } else if (entry.type === "commit") {
      tx.final = "committed";
    } else if (entry.type === "abort") {
      tx.final = "aborted";
    }
  }

  const inDoubtByTx = new Map<string, Set<number>>();
  for (const participant of participants) {
    for (const txId of participant.inDoubtTxIds()) {
      let set = inDoubtByTx.get(txId);
      if (!set) {
        set = new Set<number>();
        inDoubtByTx.set(txId, set);
      }
      set.add(participant.id);
    }
  }

  for (const [txId, tx] of txs) {
    if (tx.final) {
      state.restore(txId, tx.final, tx.preparedParticipants);
      continue;
    }

    if (tx.prepared) {
      journal.append({ type: "commit", txId });
      for (const id of tx.preparedParticipants) {
        participants[id]?.commit(txId);
      }
      state.restore(txId, "committed", tx.preparedParticipants);
    } else {
      journal.append({ type: "abort", txId });
      const lockedBy = inDoubtByTx.get(txId);
      if (lockedBy) {
        for (const id of lockedBy) {
          participants[id]?.forceAbort(txId);
        }
      }
      state.restore(txId, "aborted", tx.preparedParticipants);
    }
  }
}

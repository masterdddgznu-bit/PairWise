import type { Journal } from "./journal.js";
import type { Participant } from "./participant.js";
import type { CoordinatorState } from "./coordinator.js";

export function recoverFromJournal(
  journal: Journal,
  participants: Participant[],
  state: CoordinatorState,
): void {
  const prepared = new Map<string, number[]>();
  const finished = new Map<string, "committed" | "aborted">();
  const begun: string[] = [];

  for (const e of journal.entries()) {
    if (e.type === "begin") {
      begun.push(e.txId);
      state.begin(e.txId);
    } else if (e.type === "prepared") {
      prepared.set(e.txId, e.participants);
    } else if (e.type === "commit") {
      finished.set(e.txId, "committed");
    } else if (e.type === "abort") {
      finished.set(e.txId, "aborted");
    }
  }

  for (const txId of begun) {
    const final = finished.get(txId);
    if (final) {
      state.setStatus(txId, final);
      continue;
    }
    const ids = prepared.get(txId);
    if (ids) {
      journal.append({ type: "commit", txId });
      for (const id of ids) participants[id]?.commit(txId);
      state.setParticipants(txId, ids);
      state.setStatus(txId, "committed");
    } else {
      journal.append({ type: "abort", txId });
      for (const p of participants) p.forceAbort(txId);
      state.setStatus(txId, "aborted");
    }
  }
}

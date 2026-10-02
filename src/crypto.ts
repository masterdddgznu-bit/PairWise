import type { SmMessage } from "./types.js";
export function makeSig(pid: number, value: string, signersPrefix: number[]): string {
  return `${pid}:${value}:c${signersPrefix.join(",")}`;
}
export function verifySm(msg: SmMessage, commanderId: number): boolean {
  if (msg.kind !== "SM") return false;
  const { signers, proof, value } = msg;
  if (signers.length === 0 || proof.length !== signers.length) return false;
  if (signers[0] !== commanderId) return false;
  const seen = new Set<number>();
  for (let i = 0; i < signers.length; i++) {
    if (seen.has(signers[i])) return false;
    seen.add(signers[i]);
    if (proof[i] !== makeSig(signers[i], value, signers.slice(0, i + 1))) return false;
  }
  return true;
}

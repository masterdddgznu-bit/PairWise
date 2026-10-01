import type { EchoMessage } from "./types.js";

export function makeSig(pid: number, value: string, round: number, signersPrefix: number[]): string {
  return `${pid}:${value}:r${round}:c${signersPrefix.join(",")}`;
}

export function verifyEcho(msg: EchoMessage, sourceId: number): boolean {
  if (msg.kind !== "ECHO") return false;
  const { signers, proof, value, round } = msg;
  if (!Array.isArray(signers) || !Array.isArray(proof)) return false;
  if (signers.length === 0 || signers.length !== proof.length) return false;
  if (!signers.includes(sourceId)) return false;
  if (new Set(signers).size !== signers.length) return false;
  for (let i = 0; i < signers.length; i++) {
    if (proof[i] !== makeSig(signers[i], value, round, signers.slice(0, i + 1))) {
      return false;
    }
  }
  return true;
}

import { TrustRollError } from "./errors";
import { CertificateSnapshot, CoordinatorSnapshot, JournalEntry } from "./types";

function validateAnchorPhase(state: CoordinatorSnapshot): void {
  for (const [, anchor] of state.anchors) {
    if (!anchor.trusted.includes(anchor.issuance)) {
      throw new TrustRollError("JOURNAL_PHASE", "issuance anchor is not trusted");
    }
    const rotation = anchor.rotation;
    if (rotation) {
      if (!anchor.trusted.includes(rotation.target)) {
        throw new TrustRollError("JOURNAL_PHASE", "rotation target is not trusted");
      }
      for (const cohort of rotation.requiredCohorts) {
        if (!anchor.cohorts.includes(cohort)) {
          throw new TrustRollError("JOURNAL_PHASE", "required cohort is not a member");
        }
      }
      for (const cohort of rotation.acknowledged) {
        if (!rotation.requiredCohorts.includes(cohort)) {
          throw new TrustRollError("JOURNAL_PHASE", "acknowledged cohort is not required");
        }
      }
    }
  }
}

function validateLineage(state: CoordinatorSnapshot): void {
  const certsByTenant = new Map(state.certificates.tenants);
  for (const [, certs] of state.certificates.tenants) {
    const bySerial = new Map<string, CertificateSnapshot>(certs);
    for (const [serial, cert] of certs) {
      if (cert.replacedBy !== null) {
        const successor = bySerial.get(cert.replacedBy);
        if (!successor || successor.replaces !== serial) {
          throw new TrustRollError("JOURNAL_LINEAGE", "dangling replacedBy link");
        }
      }
      if (cert.replaces !== null) {
        const predecessor = bySerial.get(cert.replaces);
        if (!predecessor || predecessor.replacedBy !== serial) {
          throw new TrustRollError("JOURNAL_LINEAGE", "dangling replaces link");
        }
      }
    }
  }
  for (const [tenant, obligations] of state.obligations) {
    const certs = certsByTenant.get(tenant);
    for (const obligation of obligations) {
      if (!certs || !certs.some(([serial]) => serial === obligation.sourceSerial)) {
        throw new TrustRollError("JOURNAL_LINEAGE", "obligation references unknown certificate");
      }
    }
  }
}

function validateSnapshot(state: CoordinatorSnapshot): void {
  validateAnchorPhase(state);
  validateLineage(state);
}

export function validateJournal(entries: JournalEntry[], now: number): void {
  entries.forEach((entry, index) => {
    if (entry.seq !== index + 1) {
      throw new TrustRollError("JOURNAL_GAP", `sequence gap at entry ${index + 1}`);
    }
    if (entry.at > now) {
      throw new TrustRollError("JOURNAL_TIME", "journal entry is ahead of the clock");
    }
    validateSnapshot(entry.state);
  });
}

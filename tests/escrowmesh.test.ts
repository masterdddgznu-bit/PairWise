import { EscrowError, EscrowMesh, JournalEntry } from "../src";

function seeded(capacity = 200): EscrowMesh {
  const mesh = new EscrowMesh(capacity);
  mesh.addTenant(
    {
      tenantId: "acme",
      quota: 100,
      regions: [
        { regionId: "east", amount: 60 },
        { regionId: "west", amount: 40 },
      ],
    },
    0,
  );
  return mesh;
}

function prepare(mesh: EscrowMesh, epoch = 1, amount = 15, nonce = `n${epoch}`) {
  return mesh.prepareTransfer({
    tenantId: "acme",
    from: "east",
    to: "west",
    amount,
    epoch,
    nonce,
    at: epoch,
  });
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("expected action to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(EscrowError);
    expect((error as EscrowError).code).toBe(code);
  }
}

test("tenant split and global capacity are conserved", () => {
  const mesh = seeded();
  expect(mesh.tenantView("acme")).toMatchObject({
    configuredQuota: 100,
    consumed: 0,
    availableByRegion: { east: 60, west: 40 },
  });
  expect(mesh.globalView()).toEqual({ capacity: 200, allocated: 100, remaining: 100 });
});

test("cross-tenant pressure rolls back tenant and WAL atomically", () => {
  const mesh = seeded(120);
  const before = mesh.journal();
  expectCode(
    () =>
      mesh.addTenant(
        { tenantId: "other", quota: 30, regions: [{ regionId: "north", amount: 30 }] },
        1,
      ),
    "GLOBAL_CAPACITY",
  );
  expect(mesh.journal()).toEqual(before);
  expect(mesh.globalView().allocated).toBe(100);
  expectCode(() => mesh.tenantView("other"), "UNKNOWN_TENANT");
});

test("invalid regional split is an atomic failure", () => {
  const mesh = seeded();
  const before = mesh.journal().length;
  expectCode(
    () =>
      mesh.addTenant(
        { tenantId: "bad", quota: 20, regions: [{ regionId: "x", amount: 19 }] },
        1,
      ),
    "QUOTA_SPLIT",
  );
  expect(mesh.journal()).toHaveLength(before);
  expect(mesh.globalView().allocated).toBe(100);
});

// INTERLEAVED
test("prepare locks sender while an existing reservation remains independent", () => {
  const mesh = seeded();
  const reservation = mesh.reserve({
    tenantId: "acme", regionId: "east", worker: "w", owner: "o", amount: 20, leaseMs: 20, at: 1,
  });
  const transfer = prepare(mesh, 1, 30);
  expect(mesh.tenantView("acme")).toMatchObject({
    availableByRegion: { east: 10, west: 40 },
    reservedByRegion: { east: 20, west: 0 },
    lockedByRegion: { east: 30, west: 0 },
  });
  mesh.releaseReservation({ reservationId: reservation.id, owner: "o", fence: reservation.fence, at: 2 });
  mesh.acceptTransfer({ transferId: transfer.id, epoch: 1, nonce: "n1", at: 3 });
  expect(mesh.tenantView("acme").availableByRegion).toEqual({ east: 30, west: 70 });
});

test("prepare rejects zero amount and self-transfer without WAL", () => {
  const mesh = seeded();
  const count = mesh.journal().length;
  expectCode(() => prepare(mesh, 1, 0), "INVALID_AMOUNT");
  expectCode(
    () => mesh.prepareTransfer({
      tenantId: "acme", from: "east", to: "east", amount: 1, epoch: 1, nonce: "self", at: 1,
    }),
    "SELF_TRANSFER",
  );
  expect(mesh.journal()).toHaveLength(count);
});

test("prepare retry is idempotent but conflicting nonce identity is rejected", () => {
  const mesh = seeded();
  const transfer = prepare(mesh);
  expect(prepare(mesh)).toEqual(transfer);
  expect(mesh.journal()).toHaveLength(2);
  expectCode(
    () => mesh.prepareTransfer({
      tenantId: "acme", from: "east", to: "west", amount: 16, epoch: 1, nonce: "n1", at: 1,
    }),
    "TRANSFER_CONFLICT",
  );
  expect(mesh.journal()).toHaveLength(2);
});

// INTERLEAVED
test("accept credits receiver exactly once and cannot later cancel", () => {
  const mesh = seeded();
  const transfer = prepare(mesh);
  const accepted = mesh.acceptTransfer({ transferId: transfer.id, epoch: 1, nonce: "n1", at: 4 });
  expect(mesh.acceptTransfer({ transferId: transfer.id, epoch: 1, nonce: "n1", at: 9 })).toEqual(accepted);
  expect(mesh.journal()).toHaveLength(3);
  expectCode(
    () => mesh.cancelTransfer({ transferId: transfer.id, epoch: 1, nonce: "n1", at: 10 }),
    "TRANSFER_PHASE",
  );
  expect(mesh.tenantView("acme").availableByRegion).toEqual({ east: 45, west: 55 });
});

// INTERLEAVED
test("cancel restores sender once amid receiver reservation", () => {
  const mesh = seeded();
  const receiver = mesh.reserve({
    tenantId: "acme", regionId: "west", worker: "w", owner: "owner", amount: 35, leaseMs: 10, at: 1,
  });
  const transfer = prepare(mesh, 1, 20);
  mesh.cancelTransfer({ transferId: transfer.id, epoch: 1, nonce: "n1", at: 2 });
  mesh.cancelTransfer({ transferId: transfer.id, epoch: 1, nonce: "n1", at: 3 });
  expect(mesh.tenantView("acme").availableByRegion).toEqual({ east: 60, west: 5 });
  mesh.commitReservation({ reservationId: receiver.id, owner: "owner", fence: receiver.fence, at: 4 });
  expect(mesh.tenantView("acme").consumed).toBe(35);
});

test("lane epochs reject stale replay while independent direction advances", () => {
  const mesh = seeded();
  const first = prepare(mesh, 3, 5, "later");
  mesh.cancelTransfer({ transferId: first.id, epoch: 3, nonce: "later", at: 4 });
  expectCode(() => prepare(mesh, 2, 5, "stale"), "STALE_EPOCH");
  const reverse = mesh.prepareTransfer({
    tenantId: "acme", from: "west", to: "east", amount: 5, epoch: 1, nonce: "reverse", at: 5,
  });
  expect(reverse.phase).toBe("prepared");
});

// INTERLEAVED
test("regional reservations constrain transfer prepare atomically", () => {
  const mesh = seeded();
  mesh.reserve({
    tenantId: "acme", regionId: "east", worker: "w", owner: "o", amount: 50, leaseMs: 100, at: 1,
  });
  const before = mesh.journal().length;
  expectCode(() => prepare(mesh, 1, 11), "LOCAL_CAPACITY");
  expect(mesh.journal()).toHaveLength(before);
  expect(mesh.tenantView("acme").lockedByRegion.east).toBe(0);
});

// INTERLEAVED
test("expired but undriven reservation stays locked and owner cannot mutate it", () => {
  const mesh = seeded();
  const held = mesh.reserve({
    tenantId: "acme", regionId: "east", worker: "w", owner: "o", amount: 50, leaseMs: 4, at: 1,
  });
  const before = mesh.journal().length;
  expectCode(
    () => mesh.releaseReservation({ reservationId: held.id, owner: "o", fence: held.fence, at: 5 }),
    "LEASE_EXPIRED",
  );
  expectCode(() => prepare(mesh, 1, 11), "LOCAL_CAPACITY");
  expect(mesh.journal()).toHaveLength(before);
  expect(mesh.tenantView("acme").reservedByRegion.east).toBe(50);
});

// INTERLEAVED
test("drive releases expiries in deterministic expiry then id order", () => {
  const mesh = seeded();
  const later = mesh.reserve({
    tenantId: "acme", regionId: "east", worker: "a", owner: "o", amount: 5, leaseMs: 9, at: 1,
  });
  const first = mesh.reserve({
    tenantId: "acme", regionId: "east", worker: "b", owner: "o", amount: 5, leaseMs: 4, at: 2,
  });
  const tied = mesh.reserve({
    tenantId: "acme", regionId: "east", worker: "c", owner: "o", amount: 5, leaseMs: 5, at: 1,
  });
  expect(mesh.drive(10)).toEqual([first.id, tied.id, later.id]);
  expect(mesh.tenantView("acme").availableByRegion.east).toBe(60);
});

test("stale owner and fence attempts append no WAL", () => {
  const mesh = seeded();
  const held = mesh.reserve({
    tenantId: "acme", regionId: "east", worker: "w", owner: "right", amount: 5, leaseMs: 10, at: 1,
  });
  const before = mesh.journal().length;
  expectCode(
    () => mesh.commitReservation({ reservationId: held.id, owner: "wrong", fence: held.fence, at: 2 }),
    "STALE_OWNER",
  );
  expectCode(
    () => mesh.commitReservation({ reservationId: held.id, owner: "right", fence: held.fence + 1, at: 2 }),
    "STALE_FENCE",
  );
  expect(mesh.journal()).toHaveLength(before);
});

// INTERLEAVED
test("commit consumes quota while accepted transfer only relocates rights", () => {
  const mesh = seeded();
  const held = mesh.reserve({
    tenantId: "acme", regionId: "west", worker: "w", owner: "o", amount: 10, leaseMs: 10, at: 1,
  });
  const transfer = prepare(mesh, 1, 20);
  mesh.acceptTransfer({ transferId: transfer.id, epoch: 1, nonce: "n1", at: 2 });
  mesh.commitReservation({ reservationId: held.id, owner: "o", fence: held.fence, at: 3 });
  const view = mesh.tenantView("acme");
  expect(view.consumed).toBe(10);
  expect(view.availableByRegion).toEqual({ east: 40, west: 50 });
});

test("release restores local rights and terminal action cannot repeat", () => {
  const mesh = seeded();
  const held = mesh.reserve({
    tenantId: "acme", regionId: "west", worker: "w", owner: "o", amount: 10, leaseMs: 10, at: 1,
  });
  mesh.releaseReservation({ reservationId: held.id, owner: "o", fence: held.fence, at: 2 });
  const before = mesh.journal().length;
  expectCode(
    () => mesh.releaseReservation({ reservationId: held.id, owner: "o", fence: held.fence, at: 3 }),
    "RESERVATION_PHASE",
  );
  expect(mesh.journal()).toHaveLength(before);
});

// INTERLEAVED
test("journal recovery preserves active transfer reservation and exact views", () => {
  const mesh = seeded();
  const held = mesh.reserve({
    tenantId: "acme", regionId: "west", worker: "w", owner: "o", amount: 8, leaseMs: 20, at: 1,
  });
  const transfer = prepare(mesh, 1, 12);
  const recovered = EscrowMesh.fromJournal(200, mesh.journal(), 5);
  expect(recovered.tenantView("acme")).toEqual(mesh.tenantView("acme"));
  expect(recovered.transferView(transfer.id)).toEqual(mesh.transferView(transfer.id));
  expect(recovered.reservationView(held.id)).toEqual(mesh.reservationView(held.id));
  expect(recovered.journal()).toEqual(mesh.journal());
});

// INTERLEAVED
test("replay then expiry preserves reservation ids and worker fence monotonicity", () => {
  const mesh = seeded();
  const old = mesh.reserve({
    tenantId: "acme", regionId: "east", worker: "w", owner: "one", amount: 5, leaseMs: 4, at: 1,
  });
  mesh.drive(5);
  const recovered = EscrowMesh.fromJournal(200, mesh.journal(), 5);
  const next = recovered.reserve({
    tenantId: "acme", regionId: "east", worker: "w", owner: "two", amount: 5, leaseMs: 5, at: 6,
  });
  expect(old.id).toBe("r1");
  expect(next.id).toBe("r2");
  expect(next.fence).toBe(2);
});

test("recovery rejects sequence gaps and future entries", () => {
  const entries = seeded().journal();
  const gap = structuredClone(entries);
  gap[0].seq = 2;
  expectCode(() => EscrowMesh.fromJournal(200, gap, 10), "JOURNAL_GAP");
  const future = structuredClone(entries);
  future[0].at = 11;
  expectCode(() => EscrowMesh.fromJournal(200, future, 10), "FUTURE_JOURNAL");
});

// INTERLEAVED
test("recovery rejects impossible transfer conservation and duplicate mutation", () => {
  const mesh = seeded();
  const transfer = prepare(mesh, 1, 10);
  mesh.acceptTransfer({ transferId: transfer.id, epoch: 1, nonce: "n1", at: 2 });
  const impossible = mesh.journal();
  impossible[1].data.amount = 90;
  expectCode(() => EscrowMesh.fromJournal(200, impossible, 10), "LOCAL_CAPACITY");
  const duplicate = mesh.journal();
  duplicate.push({ ...structuredClone(duplicate[2]), seq: 4 });
  expectCode(() => EscrowMesh.fromJournal(200, duplicate, 10), "DUPLICATE_MUTATION");
});

test("recovery rejects invalid terminal phase transition", () => {
  const mesh = seeded();
  const transfer = prepare(mesh);
  mesh.acceptTransfer({ transferId: transfer.id, epoch: 1, nonce: "n1", at: 2 });
  const entries = mesh.journal();
  entries.push({
    seq: 4,
    at: 3,
    kind: "transfer.cancelled",
    data: { transferId: transfer.id, epoch: 1, nonce: "n1" },
  });
  expectCode(() => EscrowMesh.fromJournal(200, entries, 10), "TRANSFER_PHASE");
});

test("queries and journal are defensive copies", () => {
  const mesh = seeded();
  const transfer = prepare(mesh);
  const view = mesh.tenantView("acme");
  view.availableByRegion.east = 999;
  const transferCopy = mesh.transferView(transfer.id)!;
  transferCopy.phase = "cancelled";
  const journal = mesh.journal();
  (journal[0].data.regions as { regionId: string; amount: number }[])[0].amount = 999;
  expect(mesh.tenantView("acme").availableByRegion.east).toBe(45);
  expect(mesh.transferView(transfer.id)!.phase).toBe("prepared");
  expect((mesh.journal()[0].data.regions as { amount: number }[])[0].amount).toBe(60);
});

// INTERLEAVED
test("tenants and regions remain isolated under transfer reserve drive", () => {
  const mesh = seeded(200);
  mesh.addTenant(
    { tenantId: "beta", quota: 50, regions: [{ regionId: "east", amount: 50 }] },
    1,
  );
  const held = mesh.reserve({
    tenantId: "acme", regionId: "east", worker: "w", owner: "o", amount: 10, leaseMs: 2, at: 2,
  });
  const betaBefore = mesh.tenantView("beta");
  const transfer = prepare(mesh, 1, 10);
  mesh.acceptTransfer({ transferId: transfer.id, epoch: 1, nonce: "n1", at: 3 });
  expect(mesh.drive(4)).toEqual([held.id]);
  expect(mesh.tenantView("beta")).toEqual(betaBefore);
});

// INTERLEAVED
test("receiver can reserve accepted rights without touching sender truth", () => {
  const mesh = seeded();
  const transfer = prepare(mesh, 1, 30);
  mesh.acceptTransfer({ transferId: transfer.id, epoch: 1, nonce: "n1", at: 2 });
  const held = mesh.reserve({
    tenantId: "acme", regionId: "west", worker: "w", owner: "o", amount: 60, leaseMs: 10, at: 3,
  });
  expect(mesh.tenantView("acme").availableByRegion).toEqual({ east: 30, west: 10 });
  mesh.releaseReservation({ reservationId: held.id, owner: "o", fence: held.fence, at: 4 });
  expect(mesh.tenantView("acme").availableByRegion).toEqual({ east: 30, west: 70 });
});

test("unknown destination and token mismatch are side-effect free", () => {
  const mesh = seeded();
  const before = mesh.journal().length;
  expectCode(
    () => mesh.prepareTransfer({
      tenantId: "acme", from: "east", to: "missing", amount: 1, epoch: 1, nonce: "x", at: 1,
    }),
    "UNKNOWN_REGION",
  );
  const transfer = prepare(mesh);
  expectCode(
    () => mesh.acceptTransfer({ transferId: transfer.id, epoch: 1, nonce: "wrong", at: 2 }),
    "TRANSFER_TOKEN",
  );
  expect(mesh.journal()).toHaveLength(before + 1);
});

请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

## 目标

实现进程内 **多参与者 prepare/commit 协调（TxnPrep）**：事务 enlist 资源、两阶段表决、超时与崩溃恢复。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自 `VirtualClock`。

模块文件名需存在并可由 `index` 导出：`clock` / `types` / `errors` / `locks` / `participant` / `journal` / `timeouts` / `coordinator` / `index`。内部状态如何拆分自定，但 **验收以不变量与 tests 为准**，不要假设只有一种类结构。

## 构造

```ts
new TxnPrep({
  clock: VirtualClock,
  participants: string[],     // 非空、唯一
  prepareTimeoutMs: number,   // >= 1：begin 后进入 preparing 起算
  commitTimeoutMs: number,    // >= 1：全票 prepared 后进入 committing 起算
})
```

非法配置 → `InvalidConfigError`。

## 事务状态（协调者视角）

`open | preparing | prepared | committing | committed | aborting | aborted | unknown`

- `begin(txnId)`：创建 `open`；重复 id → `DuplicateTxnError`。
- `enlist(txnId, participantId, keys: string[])`：仅 `open` 可 enlist；未知 participant → `UnknownParticipantError`；`keys` 非空且元素非空；同一 txn 对同一 participant 可多次 enlist（keys **并集**）。
- `prepare(txnId)`：
  - 从 `open`/`preparing` 触发：对所有已 enlist 的 participant 尝试获取其 keys 的排他锁并进入本地 `prepared`（带 txn 的写缓冲可先空——本仓库不要求 value 读写，只做锁与表决）。
  - 任一 participant 锁冲突或该 participant 已为其它 txn `prepared` 占用冲突 key → 该次 prepare 整体失败：所有已成功 prepare 的 participant 必须 abort/释放，协调者 → `aborted`，返回 `'aborted'`。
  - 全部成功 → `prepared`，返回 `'prepared'`。
  - 对已 `prepared`/`committed` 的重复 `prepare`：幂等返回对应终态语义（`prepared` 仍 `'prepared'`；已 `committed` → `InvalidStateError`；已 `aborted` → `'aborted'`）。
- `commit(txnId)`：
  - 仅 `prepared`/`committing` 可提交：通知所有 enlisted participant commit（释放锁，本地标 committed），协调者 → `committed`，返回 `'committed'`。
  - 已 `committed`：幂等 `'committed'`。
  - `aborted`/`open` 等非法 → `InvalidStateError`。
  - 若状态为 `unknown`：不可直接 commit，→ `InvalidStateError`（必须先 `recover(txnId)`）。
- `abort(txnId)`：对未终态事务强制 abort（释放锁）；已 `committed` → `InvalidStateError`；已 `aborted` 幂等。
- `status(txnId)` / `participantsOf(txnId)`（enlisted id 字典序）。

## 超时（`drive`）

- 首次 `prepare` 开始时记录 `prepareDeadline = now + prepareTimeoutMs`。若仍处于 `preparing`（实现上也可在同步 prepare 内完成；若你把 prepare 做成可跨 `drive` 的异步阶段，则须遵守截止期）——**本仓库允许同步 prepare**；但仍须支持：若 `prepare` 尚未被调用且事务在 `open`，**不**因 prepareTimeout 自动 abort。
- 进入 `prepared` 后首次需要 commit 时，协调者可停留在 `prepared`；当调用方迟迟不 `commit`，**不会**仅因等待就 abort。
- **commit 超时**：一旦调用 `commit` 进入 `committing`，设 `commitDeadline = now + commitTimeoutMs`。若在截止前未能完成所有 participant commit（测试通过「注入参与者挂起」模拟——见 `setParticipantHang(pid, hang)`），则协调者变为 `unknown`，返回 `'unknown'`，**不要**盲 abort（可能已有参与者 commit）。
- `drive()`：处理已到期的 preparing 等待（若你实现了异步 prepare）与其它截止逻辑；返回本轮因超时改变状态的 `txnId[]` 字典序。同步实现时 `drive` 仍必须处理：对已 `committing` 且超时的事务转入 `unknown`。

## 参与者挂起（测试注入）

- `setParticipantHang(participantId, hang: boolean)`：为 `true` 时，该 participant 的 `commit` 调用不完成（锁不释放、本地不成 committed），用于触发 commit 超时 → `unknown`。
- `prepare`/`abort` 不受 hang 影响。

## 崩溃恢复

- `exportState(): string` / `importState(json: string)`：可往返协调者事务状态、enlist 集、journal 决策、参与者锁与本地阶段。
- `recover(txnId): 'committed' | 'aborted' | 'unknown'`（仅 `unknown` 或导入后的可疑事务）：
  - 若 journal 记录决策为 `commit` 且询问所有 participant 均已 `committed` 或仍 `prepared`：对仍 `prepared` 者补 commit → `'committed'`。
  - 若任参与者已 `aborted` 或缺失 enlist：对仍 prepared 者 abort → `'aborted'`。
  - 若参与者状态分裂（部分 committed、部分 aborted）→ 保持 `'unknown'`（人工介入）；测试不会要求自动修复分裂，但必须能识别并返回 `'unknown'`。

## 锁

- 粒度：`(participantId, key)` 排他。
- 持有到 participant abort 或 commit。
- 冲突 prepare → 整个 txn abort。

## 查询

- `phaseOf(txnId)` 同 `status`
- `locksOf(participantId): string[]` 当前持有的 key 字典序
- `localPhase(participantId, txnId): 'none'|'prepared'|'committed'|'aborted'`

不要改 `tests/`；通过 `npm test` 与 `npm run build`。

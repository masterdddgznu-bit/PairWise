请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

## 目标

实现进程内 **带视图的 quorum 复制日志（ViewLog）**：当前视图有唯一 primary；仅 primary 可 append；副本 ack；达到法定人数后按索引连续 commit；视图切换截断未提交尾部。禁止真实网络 / DB / `setTimeout` / `Math.random`。`VirtualClock` 用于 `propose` 超时（见下）。

模块文件需存在并可由 `index` 导出：`clock` / `types` / `errors` / `replica` / `log` / `acks` / `view` / `viewlog` / `index`。内部切分自定，**以不变量与 tests 为准**。

## 构造

```ts
new ViewLog({
  clock: VirtualClock,
  replicas: string[],     // 非空、唯一
  quorum?: number,        // 默认 floor(n/2)+1；须满足 1 <= quorum <= n
  proposeTimeoutMs?: number, // 默认 100，>=1：未提交 propose 的截止
})
```

- 副本集合固定为构造时字典序。
- 初始 `view === 1`，`commitIndex === 0`，`lastIndex === 0`，日志空（索引从 1 开始）。
- `primary()`：`sortedReplicas[(view - 1) % n]`。

## Append / Ack / Commit

- `append(asReplica, payload): number`
  - `asReplica` 必须是当前 `primary()`，否则 `NotPrimaryError`。
  - 追加条目 `{ index: lastIndex+1, view, payload, proposedAt: clock.now() }`，`lastIndex++`，primary 自动对本索引 ack 自己，返回 index。
- `ack(replica, view, index): boolean`
  - 未知 replica → `UnknownReplicaError`。
  - 若 `view !== 当前 view` 或 `index` 不存在或 `index > lastIndex` → 返回 `false`（忽略）。
  - 否则记录该 replica 对本 index 的 ack；返回 `true`。
  - **提交推进**：`commitIndex` 只能连续 +1。当 `commitIndex+1` 存在，且 ack 该索引的不同 replica 数 `>= quorum`，则 `commitIndex++`，并重复直到不能再推进。
- `get(index)`：仅 `1..commitIndex` 可读，返回 `{ index, view, payload }`；否则 `undefined`。
- `lastIndex()` / `commitIndex()` / `view()` / `primary()` / `ackedBy(index): string[]`（字典序）。

## 视图切换

- `viewChange(newView): void`
  - `newView` 必须为整数且 `> 当前 view`，否则 `InvalidViewError`。
  - 删除所有 `index > commitIndex` 的条目；`lastIndex = commitIndex`。
  - 清除这些被删索引的 ack；`view = newView`。
  - 未提交的 propose 一律丢弃（无返回）。

## Propose 超时

- `drive(): number[]`：扫描未提交条目（`commitIndex < index <= lastIndex`），若 `clock.now() >= proposedAt + proposeTimeoutMs`，将这些 index **字典序**返回，并 **截断**：删除从最小超时 index 起的尾部（`lastIndex` 回退到 `minTimeoutIndex - 1`，但不低于 `commitIndex`），清除对应 ack。已提交不受影响。
- 同一条目超时后不会再出现在后续 `drive`（已删除）。

## 状态

- `exportState(): string` / `importState(json: string)`：恢复 view、日志、acks、commit/last、时钟无关字段；坏 JSON → `InvalidStateError`。

不要改 `tests/`；通过 `npm test` 与 `npm run build`。

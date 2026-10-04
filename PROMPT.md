## 简述

实现进程内世代屏障：固定数量成员就当前世代报到；全员到达则该世代关闭并立刻打开下一世代；未齐套且已有人报到时，超时经 `drive` 中止当前世代（每轮最多一世代）。成员可从当前等待集合撤出。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`GenBar`，以及错误类 `GenBarError` 和至少 `InvalidConfigError` / `InvalidPartyError` / `DuplicateArriveError` / `UnknownGenerationError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new GenBar({
  clock,
  size,
  timeoutMs,
})
```

- `size` 整数 `>= 2`（成员 `partyId` 为 `1..size`）。
- `timeoutMs` 整数 `>= 1`。
- 非法配置抛 `InvalidConfigError`。
- 初始当前世代为 `1`，状态 `open`。

`arrive(partyId): { generation: number; status: 'waiting' | 'complete' }`

- `partyId` 须为 `1..size` 的整数，否则 `InvalidPartyError`。
- 只报到**当前 open 世代**。
- 同一世代同一成员已在等待集合中 → `DuplicateArriveError`。
- 加入等待集合，记下到达时间。
- 若因此人数达到 `size`：当前世代变为 `closed`，立即打开 `generation+1`（空、open），本次返回 `{ generation: 刚关闭的世代, status: 'complete' }`。
- 否则 `{ generation: 当前世代, status: 'waiting' }`。

`withdraw(partyId): boolean`

- 非法 `partyId` → `InvalidPartyError`。
- 当前世代 open 且该成员在等待集合中：移除，`true`。若集合因此变空，该世代的超时锚点清除。
- 否则 `false`（含已 closed/aborted 的历史世代，不能撤回）。

超时锚点：当前世代 open 且等待集合非空时，锚点为集合中**最早到达时间**；集合变空则锚点为空。`withdraw` 后若仍有人，锚点改为剩余成员里最早到达时间（不是重置为 now）。

`drive(): { aborted: number | null }`

- 仅当当前世代 open、等待人数 `>= 1` 且 `< size`，并且 `now >= 锚点 + timeoutMs`：将该世代标为 `aborted`，打开下一世代，返回 `{ aborted: 被中止的世代号 }`。
- 一轮 `drive` 最多中止一个世代。时间虽已超过许多个 timeout，也不得在单次 `drive` 里连跳。
- 空等待集合即使时间流逝也不中止。
- 不满足条件 → `{ aborted: null }`。
- `arrive` **不会**因时间流逝自动中止。

查询：

- `currentGeneration(): number`
- `mode(): 'open' | 'closed' | 'aborted'` 指**当前世代**的状态。刚 `complete`/`abort` 后当前已是新的 open 世代，故一般为 `'open'`。
- `statusOf(generation): 'open' | 'closed' | 'aborted'` 未知世代（从未打开过，或大于当前）→ `UnknownGenerationError`。
- `waitingIds(): number[]` 当前 open 世代等待成员，升序。
- `arrivedIds(generation): number[]` 该世代最终留下的成员快照（closed 为全员；aborted 为中止时仍在集合中的；open 为当前等待），升序。未知世代抛错。
- `completedCount(): number` 至今 `closed` 的世代数（aborted 不计）。
- `abortedCount(): number`

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。

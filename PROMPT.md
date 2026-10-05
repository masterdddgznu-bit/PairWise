## 简述

实现进程内多方到齐闩：构造时固定 party 集合、超时与法定人数/比例；`arrive` 登记到达；达到 quorum 立刻 opened；超时不会自动发生，必须 `drive`；`reset` 开启新一代。查询不做超时判定。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`JoinLatch`，以及错误类 `JoinLatchError` 和至少 `InvalidConfigError` / `InvalidPartyError` / `UnknownPartyError` / `DuplicateArriveError` / `LateError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new JoinLatch({
  clock,
  parties,
  timeoutMs,
  quorumCount?: number,
  quorumFraction?: number,
})
```

- `parties`：非空字符串数组，长度 `>= 1`，去重后数量须与原长度相同，每个名非空；否则 `InvalidConfigError`。
- `timeoutMs` 整数 `>= 1`。
- **法定阈值**（必须恰好提供一种）：
  - `quorumCount`：整数，`1 .. parties.length`；或
  - `quorumFraction`：有限数，`0 < fraction <= 1`，所需人数为 `ceil(fraction * parties.length)`（至少 1）。
  - 两者都给或都不给 → `InvalidConfigError`。
- 初始：`generation = 1`，`deadline = now + timeoutMs`，状态 `pending`，无到达。
- 宜拆成多模块（party 集合、跨代到达日志、quorum 判定），具体文件划分自定。

状态：`pending` | `opened` | `timedOut`。

`arrive(party): { status: 'accepted'; remaining: number; generation: number }`

- `party` 非空，否则 `InvalidPartyError`。
- 未知 party → `UnknownPartyError`。
- 状态已是 `opened` 或 `timedOut` → `LateError`。
- 该 party 本代已到达 → `DuplicateArriveError`。
- 否则记入本代到达（按首次 arrive 序），并写入跨代到达日志。
- `remaining` = `max(0, required - arrivedCount)`（距离 quorum 还差多少；已达 quorum 则为 0）。
- 若因此 `arrivedCount >= required`：状态变为 `opened`。
- `arrive` **不会**因超时改状态（即使 `now >= deadline`，只要尚未 `drive` 且未 opened，仍可 arrive 并可能 opened）。

`drive(): { status: 'pending' | 'opened' | 'timedOut' }`

- 若已是 `opened` 或 `timedOut`：原样返回。
- 若 `pending` 且已达 quorum：变为 `opened`（防御性）。
- 若 `pending` 且 `now >= deadline`：变为 `timedOut`。
- 若 `pending` 且未到截止：保持 `pending`。
- `arrive`/`reset`/查询 **不会**执行超时判定。

`reset(): { generation: number }`

- 清空本代到达（跨代日志保留历史），状态 `pending`，`generation += 1`，`deadline = now + timeoutMs`。
- 返回新的 `generation`。

查询：

- `status()` / `generation()` / `deadline()` / `required(): number`
- `parties(): string[]` 构造时顺序。
- `arrived(): string[]` 本代已到达，按首次 arrive 序。
- `missing(): string[]` 本代未到达，按 `parties()` 原顺序。
- `arrivedIn(generation): string[]` 指定代的到达序；未知代（从未存在）→ `[]`；`generation < 1` 非整数 → 视为未知返回 `[]`。
- `wasPresent(party, generation): boolean` 该 party 是否在指定代到达过；非法/未知 party → `UnknownPartyError`；非法 party 字符串空 → `InvalidPartyError`。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。

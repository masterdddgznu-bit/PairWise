## 简述

实现进程内多层晋级队列：`push` 的新项总在 tier 0；`drive` 按停留年龄与层内人数门槛晋级（每轮每项最多一层）；`pop` 后对 id 与 tenant 登记冷却，冷却期内禁止同 id 再 push，且同 id/同 tenant 项不可被晋级。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`TierQ`，以及错误类 `TierQError` 和至少 `InvalidConfigError` / `InvalidIdError` / `DuplicateIdError` / `CapacityError` / `CooldownError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new TierQ({
  clock,
  promoteMs,
  cooldownMs,
  tierCount?: number,
  maxItems?: number,
  promoteMinSize?: number,
})
```

- `promoteMs`、`cooldownMs` 整数 `>= 1`。
- `tierCount` 默认 3、整数 `>= 2`（合法 tier 为 `0 .. tierCount-1`）。
- `maxItems` 默认 16、整数 `>= 1`。
- `promoteMinSize` 默认 1、整数 `>= 1`：某一层要发生晋级时，该层当前人数须 `>= promoteMinSize`（顶层永不晋级）。
- 非法配置抛 `InvalidConfigError`。

每项：`id`、`tenant`、`payload`、`tier`、`stamp`（进入当前 tier 的时刻），以及稳定的首次 push 序。

`push(id, payload, tenant?: string): { status: 'accepted' }`

- `id` 非空，否则 `InvalidIdError`。
- `tenant` 缺省等于 `id`；若传入则须非空字符串，否则 `InvalidIdError`。
- 已存在同 id → `DuplicateIdError`。
- 若 id 仍在冷却中 → `CooldownError`。
- 已满 → `CapacityError`。
- 否则：`tier = 0`，`stamp = now`，记入首次 push 序，`accepted`。
- `push` **不会**晋级任何项，也**不会**清冷却。

`cancel(id): boolean`

- 非法 id → `InvalidIdError`。
- 存在则移除，`true`；否则 `false`。不触发冷却。

`drive(): { promoted: string[]; cooledSkipped: string[] }`

对所有未在顶层的项，按**首次 push 序**检查：

- 若 `now < stamp + promoteMs`：跳过。
- 若 id 或 tenant 处于冷却：记入 `cooledSkipped`（去重保持首次出现序），不晋级。
- 若该项当前所在 tier 的人数 `< promoteMinSize`：跳过（不记入 cooledSkipped）。
- 否则：`tier += 1`，`stamp = now`，记入 `promoted`。
- **单次 `drive` 每项最多升一层**（即使墙钟已够升多层）。
- 人数门槛以本轮开始时的层人数快照为准（本轮已晋级离开的项仍计入原层快照，新进入的层不增加本轮快照）。
- `peek`/`pop`/`push` **不会**执行晋级。

`peek(): { id: string; payload: unknown; tier: number; tenant: string } | null`

- 取 `tier` 最大者；并列取首次 push 序更早者。不移除。空 → `null`。

`pop(): { id: string; payload: unknown; tier: number; tenant: string } | null`

- 与 `peek` 相同选择，取出并移除。
- 对被 pop 的 id **与**其 tenant 分别登记冷却，截止 `now + cooldownMs`（同一 key 重复登记则刷新截止时间）。
- 冷却在 `now < until` 期间有效；`now === until` 已结束。

查询：

- `ids(): string[]` 全部 id，首次 push 序。
- `size(): number`。
- `tierOf(id): number | null`；非法 id 抛错；不存在 → `null`。
- `tenantOf(id): string | null`；非法 id 抛错。
- `idsInTier(tier): string[]`：`tier` 必须是整数且 `0 <= tier < tierCount`，否则 `InvalidConfigError`；该层 id，首次 push 序。
- `cooldownUntil(key: string): number | null`：`key` 为 id 或 tenant；无冷却或已到期（相对 now）→ `null`；返回截止时刻。非法空 key → `InvalidIdError`。

正确性以不变量与测试为准。宜拆成多模块（分层队列、晋级策略、冷却登记）协作。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。

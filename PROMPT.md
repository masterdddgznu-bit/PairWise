## 简述

实现进程内层级预算托管：组织树登记预算节点，在祖先剩余可用容量约束下对节点做 escrow 预留；通过 release / settle / drive 过期释放或落账；全部成功变更写入 WAL，且 `fromJournal` 恢复后可观测状态与行为一致。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`HierEsc`、`HierEsc.fromJournal`，以及错误类 `HierEscError` 和至少 `InvalidConfigError` / `InvalidArgError` / `CapacityError` / `ConflictError` / `StateError` / `UnknownError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new HierEsc({
  clock,
  maxNodes?: number,
  maxEscrows?: number,
})
```

- `maxNodes` 默认 32、`maxEscrows` 默认 64；均为整数 `>= 1`。
- 非法配置 → `InvalidConfigError`。

**组织树与预算账**

- `addNode(id, parentId, limit)`：`id` 非空字符串；`parentId` 为 `null` 表示根，否则父节点必须已存在；同 id 重复 → `ConflictError`；未知父 → `UnknownError`；节点数超容 → `CapacityError`。
- `limit` 为整数且 `>= 0`，否则 `InvalidArgError`。
- 每个节点维护**仅本节点**的 `used` / `reserved`；`available = limit - used - reserved`。
- `limitOf` / `usedOf` / `reservedOf` / `availableOf(id)`：未知节点 → `UnknownError`。查询不得产生副作用（不得顺带过期 escrow）。

**Escrow 生命周期**

- `reserve(nodeId, amount, ttlMs): { escrowId }`：
  - `amount` 为正数、`ttlMs` 为正整数，否则 `InvalidArgError`。
  - 未知节点 → `UnknownError`；活跃 escrow 数达 `maxEscrows` → `CapacityError`。
  - **路径约束**：从目标节点沿祖先走到根，路径上**每个**节点的 `available` 都必须 `>= amount`；任一不足 → `CapacityError`。通过后只增加目标节点的 `reserved`（不改写祖先计数）。
  - 新建 escrow：`held`，`deadline = now + ttlMs`，分配单调递增的整数 `escrowId`（从 1 起）。
- `release(escrowId)`：仅 `held` 可释放；扣回目标节点 `reserved`，状态 → `released`；未知 → `UnknownError`；非 held → `StateError`。
- `settle(escrowId)`：仅 `held` 可结算；目标节点 `reserved` 减少、`used` 增加同等金额，状态 → `settled`；未知 / 非 held 同上错误类。
- `drive()`：将所有 `held` 且 `deadline <= now` 的 escrow 过期：扣回对应 `reserved`，状态 → `expired`；按 `escrowId` 升序处理。查询类 API 不得代替 `drive` 做过期。
- `statusOf(escrowId)`：返回 `held` / `settled` / `released` / `expired`；未知 → `UnknownError`。

**WAL 双真相**

- 成功变更必须追加日志；失败抛错不得追加、不得留下部分突变。
- `journal()` 返回只读拷贝。
- `HierEsc.fromJournal(clock, opts, entries)` 重放后，树结构、各节点 limit/used/reserved/available、escrow 状态与后续 `reserve` 分配的下一 id，均须与源实例可观测一致。

正确性以不变量与测试为准。宜拆多模块，不指定内部文件名。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。

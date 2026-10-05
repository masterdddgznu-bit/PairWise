## 简述

实现进程内多 lane FIFO 调度器：`push` 进入指定 lane；`pop` 在**仍有信用**的非空 lane 之间轮转服务，并在队头等待过久时优先救济饥饿 lane；每次成功弹出消耗该 lane 的 1 点信用。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`RotateQ`，以及错误类 `RotateQError` 和至少 `InvalidConfigError` / `InvalidArgError` / `UnknownLaneError` / `DuplicateIdError` / `CapacityError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new RotateQ({
  clock,
  starveMs,
  maxPerLane?: number,
  defaultCredit?: number,
})
```

- `starveMs` 整数 `>= 1`。
- `maxPerLane` 默认 8、整数 `>= 1`。
- `defaultCredit` 默认 1、整数 `>= 0`（新建 lane 的初始信用）。
- 非法配置抛 `InvalidConfigError`。
- 初始无 lane，轮转游标 `null`。

`ensureLane(lane): void`

- `lane` 非空字符串，否则 `InvalidArgError`。
- 已存在 no-op；新建空 FIFO，追加到 **lane 环序尾**（ensure 先后），信用设为 `defaultCredit`。
- 若这是第一个 lane，游标设为该 lane。

`grant(lane, n): void` / `creditOf(lane): number`

- `lane` 须已知，否则 `UnknownLaneError`；`n` 须为整数 `>= 1`，否则 `InvalidArgError`。
- `grant` 将信用增加 `n`（无上限）。`creditOf` 返回当前信用。

`push(lane, id, payload): { status: 'accepted' }`

- `lane`/`id` 均须非空，否则 `InvalidArgError`。
- 未知 lane → `UnknownLaneError`。
- 全局 id 已存在于任一 lane → `DuplicateIdError`。
- 该 lane 长度已达 `maxPerLane` → `CapacityError`。
- 否则入该 lane 队尾，记录 `enqueuedAt = now`。
- `push` **不**改变游标，也**不**改信用、不 `pop`。

`cancel(id): boolean`

- 非法 id → `InvalidArgError`。在某 lane 中则移除并 `true`，否则 `false`。不改游标与信用。

**pop 选择不变量（何为对，非逐步剧本）**

一次 `pop` 最多弹出一项；无任何**可服务** lane 时返回 `null`（游标不变）。可服务指：lane 非空且 `creditOf(lane) >= 1`。

- **饥饿优先**：在可服务 lane 中，若存在队头满足 `now - enqueuedAt >= starveMs`，则只在这些饥饿候选里选；先比队头 `enqueuedAt` 最小，再并列比 **ensure 环序更靠前**。弹出后将该 lane 信用减 1，游标移到该 lane 在环上的下一位（环绕）。
- **否则轮转**：从当前游标起沿环序寻找第一个可服务 lane，弹其队头，信用减 1，游标移到该 lane 的下一位。一圈皆不可服务 → `null`，游标不变。
- 信用为 0 的 lane **不可**被饥饿或轮转选中（即便非空、即便已饥饿）。
- 空队列 lane 仍留在环上；`ensureLane` 顺序定义环序，不被 `pop`/`cancel` 删除。

查询：

- `lanes(): string[]` 环序。
- `cursor(): string | null` 当前游标（下一轮普通轮转的起点）。
- `ids(lane)` / `size(lane)` / `sizeAll()` / `enqueuedAtOf(id)`：未知 lane 或非法 id 按上列错误类抛错；缺失 id → `null`。

正确性以不变量与测试为准。宜拆成 per-lane FIFO、环游标、饥饿/信用守卫等多模块，但不指定内部文件名。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。

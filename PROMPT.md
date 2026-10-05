## 简述

实现进程内戳记就绪队列：项先以未盖章登记，盖章后仅当戳值不超过水位才可释放；所有变更追加逻辑事件，查询与并列次序与日志一致。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`StampQ`，以及错误类 `StampQError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidStampError` / `InvalidWatermarkError` / `CapacityError` / `IllegalOpError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。时钟用于事件时间戳字段；就绪不直接依赖 wall 时间，而依赖戳与水位。

```ts
new StampQ({
  clock,
  maxItems?: number,           // 默认 16，>= 1
  initialWatermark?: number,   // 默认 -1，有限整数
})
```

非法配置 → `InvalidConfigError`。

项状态：`unstamped` | `stamped`。容量计入**所有仍登记项**（含未盖章与不可释放已盖章）。

`offer(id, payload): { status: 'accepted' }`

- `id` 非空，否则 `InvalidIdError`。
- 重复 id → `IllegalOpError`。
- 已满 → `CapacityError`。
- 成功：`unstamped`，追加事件 `offer`。

`stamp(id, stamp): boolean`

- 非法 id → `InvalidIdError`；`stamp` 须有限整数，否则 `InvalidStampError`。
- 不存在 → `UnknownIdError`。
- 已是 `stamped` → `IllegalOpError`。
- `unstamped` → 设为 `stamped` 与戳值，追加 `stamp`，`true`。

`restamp(id, stamp): boolean`

- 校验同上。
- 仅 `stamped` 可 restamp；`unstamped` → `IllegalOpError`。
- 更新戳值，追加 `restamp`，`true`。
- restamp 后若 `stamp > watermark`，该项变为不可释放（仍登记）。

`advanceWatermark(wm): number`

- `wm` 有限整数，否则 `InvalidWatermarkError`。
- **禁止水位回退**：`wm < 当前水位` → `IllegalOpError`。
- `wm === 当前` 幂等成功；更大则更新。
- 追加 `watermark`，返回新水位。

可释放：`stamped` 且 `stamp <= watermark`。

`peek(): { id; payload; stamp } | null` / `pop(): ... | null`

- 在可释放项中选取：先按 `stamp` 升序；并列按该 id **最后一次**使其变为当前戳值的日志事件序（`stamp`/`restamp` 事件的全局序号）升序；再并列按 `offer` 序。
- `peek` 不移除；`pop` 移除并追加 `pop` 事件。
- 无可释放 → `null`。

`drive(): { drained: Array<{ id; payload; stamp }> }`

- 以调用开始时的水位与登记集为快照：反复弹出当时可释放者，直到没有。
- drive 过程中水位不被本题其它调用改写；实现按开始水位判定即可。
- 每弹一项写 `pop` 事件。

`cancel(id): boolean`

- 非法 id 抛错；不存在 `false`。
- 存在则移除（无论盖章与否），追加 `cancel`，`true`。

查询：

- `watermark(): number`
- `size()` / `ids()`：全部仍登记，按 offer 序。
- `stampOf(id): number | null` — 未盖章或不存在 → `null`；非法 id 抛错。
- `isReleasable(id): boolean` — 不存在 → `UnknownIdError`。
- `events(): Array<{ seq; at; type; id?: string; stamp?: number; watermark?: number }>` — 全局追加序；`type` 为 `offer|stamp|restamp|watermark|pop|cancel`。

宜拆成双态登记、水位门禁、重做日志三块；并列次序必须能由日志复原。内部文件名自定。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。

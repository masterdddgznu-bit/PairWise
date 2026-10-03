请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

## 目标

实现进程内 **因果广播投递缓冲（CausBuf）**：每节点维护向量钟；发送携带 VC；接收时按因果条件投递或缺口缓冲；缓冲有容量上限；可导出/导入状态。禁止真实网络 / DB / `setTimeout` / `Math.random`。`VirtualClock` 只写入 checkpoint 的 `procTime`（`clock.now()`），不参与投递条件。

模块文件需存在并可由 `index` 导出：`clock` / `types` / `errors` / `vclock` / `buffer` / `deliver` / `causbuf` / `index`。内部切分自定，**以不变量与 tests 为准**。

## 构造

```ts
new CausBuf({
  clock: VirtualClock,
  nodes: string[],   // 非空、唯一；将按字典序固定为 VC 分量顺序
  self: string,      // 必须 ∈ nodes
  capacity?: number, // 默认 64，>= 1：未投递缓冲条数上限
})
```

非法 → `InvalidConfigError`。初始每个分量 VC=0。

## 向量钟与消息

- `VC` 为 `Record<nodeId, number>`（所有 nodes 皆有键）。
- `Message = { sender, vc, payload, seq }`，其中 `seq === vc[sender]`（发送时赋值）。
- `send(payload: string): Message`：
  - `self` 分量 `+1`；
  - 返回消息：`sender=self`，`vc` 为发送后时钟的拷贝，`payload`，`seq=vc[self]`。
- 未知 sender / vc 缺键 / 非有限分量 → `receive` 抛 `InvalidMessageError`。

## 因果投递条件（经典）

对缓冲中来自 `s` 的消息 `m`，在本地时钟 `L` 下可投递 iff：

1. `m.vc[s] === L[s] + 1`
2. 对所有 `k !== s`：`m.vc[k] <= L[k]`

投递后：`L[s] += 1`（等价于 `L[s] = m.vc[s]`）。**不要**对其它分量取 max（本模型与「广播因果」标准递进一致）。

`receive(m)`：
- 若 `m.sender === self`：忽略（不缓冲、不投递），返回 `'ignored'`。
- 若已投递过相同 `(sender, seq)` 或缓冲中已有：返回 `'duplicate'`。
- 若 `m.vc[sender] <= L[sender]`：视为陈旧/重复，返回 `'duplicate'`。
- 否则入缓冲；然后尽可能多地投递（见下）；返回 `'buffered'` 或 `'delivered'`（若本次 receive 触发了至少一条投递——含刚入缓冲的这条或此前缺口被补上的）。

投递顺序：在每一轮扫描中，按 `(sender 字典序, seq 升序)` 选择所有当前可投递消息依次投递；重复扫描直到本轮无新投递。

## 容量

- 缓冲（未投递）条数不得超过 `capacity`。
- 入缓冲前若已满：淘汰 **一条** 缓冲消息——选 `sender` 字典序最大，同发送者选 `seq` 最大者（最「远」的缺口）；返回值仍表示新消息结果，但 `dropped(): Message | undefined` 可查询最近一次淘汰（测试用 `lastDropped()`）。
- 若新消息本身因满而被拒绝：不允许；必须先淘汰再插入新消息。

## 拉取与查询

- `poll(): Message[]`：取出并清空已投递队列（FIFO；同轮按上述顺序追加）。
- `clock(): Record<string, number>` 拷贝。
- `pending(): number` 缓冲条数。
- `lastDropped(): Message | undefined` 最近淘汰；初始 `undefined`。
- `exportState(): string` / `importState(json: string)`：恢复 VC、缓冲、已投递集合（用于去重）、投递队列、lastDropped；坏 JSON → `InvalidStateError`。

不要改 `tests/`；通过 `npm test` 与 `npm run build`。

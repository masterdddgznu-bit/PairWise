## 简述

实现进程内按流空洞缓冲：每条流维护期望序号；正好到达则连同已缓冲的连续后续一起进入可取队列；超前到达则暂存；过期空洞经 `drive` 每次最多跳一格；流之间互不影响。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`HoleBuf`，以及错误类 `HoleBufError` 和至少 `InvalidConfigError` / `InvalidPushError` / `UnknownStreamError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new HoleBuf({
  clock,
  maxBuffered?: number,
  skipAfterMs?: number,
})
```

- `maxBuffered` 默认 16、整数 `>= 1`（**每条流**最多暂存多少个超前序号）。
- `skipAfterMs` 默认 10、整数 `>= 1`。
- 非法配置抛 `InvalidConfigError`。

每条流独立：`nextSeq` 从 1 起；从未 `push` 过的流视为 `nextSeq === 1`、缓冲为空。

`push(stream, seq, payload): { status: 'delivered' | 'buffered' | 'rejected' }`

- `stream` 非空字符串；`seq` 为有限整数且 `>= 1`。否则 `InvalidPushError`。
- `seq < nextSeq`，或该 `seq` 已在缓冲中 → `rejected`（不覆盖 payload）。
- `seq === nextSeq`：该条进入可取队列，然后把缓冲里紧随其后的连续序号一并交付，推进 `nextSeq`，返回 `delivered`。
- `seq > nextSeq`：若该流缓冲条数已达 `maxBuffered` → `rejected`；否则写入缓冲，返回 `buffered`。
- `push` **不会**因为时间流逝而自动跳洞。

空洞计时：当某流「缓冲非空且 `nextSeq` 不在缓冲中」时，视为存在空洞。空洞等待起点为「该状态开始成立时的 `clock.now()`」；一旦空洞消失（补齐或缓冲清空），计时清除。跳过一格空洞后若仍有空洞，等待起点重置为**当前 now**（新的一格重新计时）。

`take(stream): { seq: number; payload: unknown } | null`

- 取出该流可取队列队头（交付顺序即序号升序）。
- 从未出现过的流或队列空 → `null`（不抛错）。

`skip(stream): { skipped: number | null; nextSeq: number }`

- 未知流（从未 push）→ `UnknownStreamError`。
- 仅当存在空洞（缓冲非空且缺 `nextSeq`）时跳过**恰好一格**：记下被跳过的 `nextSeq`，`nextSeq += 1`，再把新的连续缓冲交付进可取队列。返回 `{ skipped: 被跳过的序号, nextSeq }`。
- 无空洞 → `{ skipped: null, nextSeq }`，状态不变。

`drop(stream, seq): boolean`

- 未知流 → `UnknownStreamError`。
- 从缓冲去掉该 `seq`：成功 `true`；不在缓冲 `false`。不影响已进入可取队列的条目。

`reset(stream): void`

- 未知流 → `UnknownStreamError`。
- 清空该流缓冲与可取队列，`nextSeq` 回到 1，空洞计时清除。
- 累计 `deliveredCount` **不**因 reset 清零。

`drive(): { skipped: Array<{ stream: string; seq: number }> }`

1. 考察当前已存在的流。
2. 若该流空洞已等待 `>= skipAfterMs`：按与 `skip` 相同规则跳**恰好一格**（一轮 `drive` 内每流最多一格）。
3. 返回本轮跳过的记录：先按 `stream` 字典序，再按 `seq` 升序。

查询：

- `nextSeq(stream): number` 未知流为 1。
- `bufferedSeqs(stream): number[]` 升序；未知流 `[]`。
- `pendingTake(stream): number` 可取队列长度；未知流 0。
- `deliveredCount(stream): number` 该流累计进入可取队列的条数（含 skip 后从缓冲连上的）；未知流 0。跳过的空洞本身不计入。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。

请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的 **写时复制（COW）快照键值库** 半成品。head 上单次 put/get/del 常见路径通常正常；把「snapshot 后改 head、branch 出新可写 lane、TTL 到期 drop、多快照共享未改动页、GC 回收」组合起来会出现读串味或活引用被回收。请从版本页引用与回收对账出发定位，而不是只改一处表面分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止真实网络、数据库、`setTimeout`/`Math.random`；时间只通过 `VirtualClock` 推进。

## 期望语义（以 tests 为准）

构造：`new SnapLane({ clock, maxSnaps? })`
- `maxSnaps` 默认 `16`（`>= 1`）：同时存活的 named snapshot 上限（不含 head / branch lane）。

概念：
- **head**：默认可写 lane，id 固定为 `"head"`。
- **snapshot**：`snapshot(name, ttlMs | null)` 从当前 head（或指定可读 lane）冻结只读视图；`ttlMs` 非 null 时 `deadline = now + ttlMs`。
- **branch**：`branch(fromName, newName)` 从只读快照拉出新的可写 lane（独立 COW）；branch lane 不计 TTL，占 `maxSnaps` 名额。

API：
- `put(lane, key, value)` / `get(lane, key)` / `del(lane, key): boolean`
  - 只读 snapshot 上 put/del → `ReadOnlyError`
  - 未知 lane → `UnknownLaneError`
- `snapshot(name, ttlMs?: number | null, fromLane?: string)`：默认 from `head`。name 已存在 → `DuplicateLaneError`。达到 maxSnaps → `LimitError`。
- `branch(fromName, newName)`：from 必须存在；newName 占用名额。
- `drop(name)`：删除 snapshot/branch（不能 drop `head`）；释放页引用。
- `drive()`：drop 所有 `now >= deadline` 的 snapshot（branch 无 deadline）；返回被 drop 的 name **字典序**。
- `lanes()`：当前名称列表（含 head），字典序。
- `isReadonly(name)`。

COW 不变量：
- snapshot/branch 创建时与来源共享未改动条目；对可写 lane 的 put/del 不得改变其它 lane 已观察到的值。
- 某 key 在某 lane 删除后，该 lane `get` 为 `undefined`，其它仍引用旧页的 lane 不受影响。

模块：`clock` / `types` / `errors` / `pages` / `lanes` / `gc` / `snaplane` / `index`。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。

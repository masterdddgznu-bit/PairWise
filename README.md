# hirsch

进程内 Hirschberg–Sinclair 双向环领袖选举：相位 k 向左右各探测 2^k 跳；较大 uid 的 PROBE 被转发或在跳数耗尽时 REPLY；绕回自身则当选并广播 LEADER。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```

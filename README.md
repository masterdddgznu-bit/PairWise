# yoyo

进程内 **Yo-Yo 领袖选举**：连通无向图上按 uid 定向 active 边，交替 DOWN（YO）汇聚候选与 UP（YO）剪枝，直至只剩一个源。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```

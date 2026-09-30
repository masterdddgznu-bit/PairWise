# asynbfs

进程内 **异步 BFS**：连通无向图上由 root 发出距离脉冲；节点采纳更小 `dist`（相等时保留先到父），并向邻居继续扩散；收敛后得到以 root 为根的 BFS 距离与生成树。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```

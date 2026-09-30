# dfstree

进程内 **分布式 DFS 生成树**：连通无向图上以 EXPLORE/RETURN 令牌做深度优先扩展；首次 EXPLORE 设父并继续向下，已访问则立即 RETURN（非树边）；子树返回后继续下一未用邻居，initiator 收齐后收敛。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
